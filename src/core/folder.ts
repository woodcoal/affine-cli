/**
 * 文件夹核心模块
 * 处理文件夹的创建、列表、重命名、删除、添加/移动/移除文档等操作
 */

import { getWorkspaceId } from '../utils/config.js';
import {
	createWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate,
	getWorkspaceDocs
} from '../utils/wsClient.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * specialWorkspaceDbDocId: 生成工作区特殊文档 ID
 *
 * 功能描述：
 * - Affine 使用特殊的文档 ID 格式来存储工作区的附加数据
 * - 格式：db${workspaceId}${tableName}
 *
 * @param workspaceId - 工作区 ID
 * @param tableName - 表名（如 'folders'）
 * @returns 特殊文档 ID 字符串
 */
function specialWorkspaceDbDocId(workspaceId: string, tableName: string): string {
	return `db$${workspaceId}$${tableName}`;
}

/**
 * isDeletedRecord: 判断记录是否已删除
 *
 * @param record - Y.Map 记录
 * @returns 是否已删除
 */
function isDeletedRecord(record: Y.Map<any>): boolean {
	return record.get('$$DELETED') === true || record.size === 0;
}

/**
 * readOrganizeNodes: 读取 Organize 节点
 *
 * 功能描述：
 * - 从 Y.Doc 的 share 中读取所有组织节点
 * - 过滤掉已删除的记录和无效记录
 *
 * @param doc - Y.Doc 对象
 * @returns 节点数组，每个包含 id、type、data、parentId、index
 */
function readOrganizeNodes(doc: Y.Doc): any[] {
	const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) {
			continue;
		}
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map) || isDeletedRecord(record)) {
			continue;
		}
		const raw = record.toJSON();
		if (!raw || !raw.id || !raw.type) {
			continue;
		}
		nodes.push(raw);
	}
	return nodes;
}

/**
 * 生成排序索引（在两个索引之间）
 */
async function nextOrganizeIndex(nodes: any[], parentId: string | null): Promise<string> {
	const siblings = nodes
		.filter((node) => node.parentId === parentId)
		.sort((left, right) => left.index.localeCompare(right.index));
	const last = siblings.at(-1);
	return await generateFractionalIndexingKeyBetween(last?.index ?? null, null);
}

function hasSamePrefix(a: string, b: string): boolean {
	return a.startsWith(b) || b.startsWith(a);
}

let generateKeyBetween: ((a: string | null, b: string | null) => string) | null = null;

async function getGenerateKeyBetween() {
	if (!generateKeyBetween) {
		const mod = await import('fractional-indexing');
		generateKeyBetween = mod.generateKeyBetween;
	}
	return generateKeyBetween!;
}

async function generateFractionalIndexingKeyBetween(
	a: string | null,
	b: string | null
): Promise<string> {
	const randomSize = 32;
	const genKey = await getGenerateKeyBetween();

	function postfix(): string {
		return generateId(randomSize, 'blob');
	}

	function subkey(key: string | null): string | null {
		if (key === null) {
			return null;
		}
		if (key.length <= randomSize + 1) {
			return key;
		}
		return key.substring(0, key.length - randomSize - 1);
	}

	const aSubkey = subkey(a);
	const bSubkey = subkey(b);

	if (aSubkey === null && bSubkey === null) {
		return genKey(null, null) + '0' + postfix();
	}
	if (aSubkey === null && bSubkey !== null) {
		return genKey(null, bSubkey) + '0' + postfix();
	}
	if (bSubkey === null && aSubkey !== null) {
		return genKey(aSubkey, null) + '0' + postfix();
	}
	if (aSubkey !== null && bSubkey !== null) {
		if (hasSamePrefix(aSubkey, bSubkey) && a !== null && b !== null) {
			return genKey(a, b) + '0' + postfix();
		}
		return genKey(aSubkey, bSubkey) + '0' + postfix();
	}
	throw new Error('Unreachable fractional indexing state');
}

/**
 * folderAllHandler: 获取所有文件夹列表
 *
 * 功能描述：
 * - 通过 WebSocket + Yjs 获取工作区的所有文件夹
 * - 返回包含 id、title、parentId、index 的文件夹列表
 *
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 文件夹数组
 */
export async function folderAllHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folders = nodes
			.filter((node: any) => node.type === 'folder')
			.map((folder: any) => ({
				id: folder.id,
				title: folder.data || '未命名文件夹',
				parentId: folder.parentId,
				index: folder.index
			}));

		return folders;
	} finally {
		socket.disconnect();
	}
}

/**
 * folderListHandler: 获取指定文件夹下的子项列表
 *
 * 功能描述：
 * - 获取指定文件夹下的所有子项（文件夹或文档）
 * - 支持仅返回文件夹列表
 * - 通过 WebSocket + Yjs 获取实时数据
 *
 * @param params.id - 父文件夹 ID（必需）
 * @param params.folder - 是否仅返回文件夹/标签，默认 false 返回文档
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 子项数组，包含 id、type、data、title、index
 */
export async function folderListHandler(params: {
	id: string;
	folder?: boolean;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const children = nodes.filter((node: any) => node.parentId === params.id);

		const filteredChildren = params.folder
			? children.filter((node: any) => node.type === 'folder' || node.type === 'tag')
			: children.filter((node: any) => node.type === 'doc');

		const pagesInfo = await getWorkspaceDocs(workspaceId);

		return filteredChildren.map((child: any) => {
			const isFolderRef = child.type === 'tag';
			const title = isFolderRef
				? nodes.find((n: any) => n.id === child.data)?.data || child.data
				: pagesInfo.get(child.data)?.title || child.data || '未命名';
			return {
				id: child.id,
				type: child.type,
				data: child.data,
				title,
				index: child.index
			};
		});
	} finally {
		socket.disconnect();
	}
}

/**
 * folderCreateHandler: 创建新文件夹
 *
 * 功能描述：
 * - 在工作区中创建新文件夹
 * - 支持指定父文件夹和排序索引
 * - 通过 WebSocket + Yjs 实时创建
 *
 * @param params.name - 文件夹名称（必需）
 * @param params.parent - 父文件夹 ID，空字符串表示根级别（可选）
 * @param params.index - 排序索引（可选，默认自动计算）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含创建结果的对象
 */
export async function folderCreateHandler(params: {
	name: string;
	parent?: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folderId = generateId(12, 'folder');
		const nextIndex =
			params.index?.toString() ?? (await nextOrganizeIndex(nodes, params.parent ?? null));

		const record = doc.getMap(folderId);
		record.set('id', folderId);
		record.set('type', 'folder');
		record.set('data', params.name);
		if (params.parent !== undefined) {
			record.set('parentId', params.parent === '' ? null : params.parent);
		}
		record.set('index', nextIndex);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			id: folderId,
			title: params.name,
			parentId: params.parent === '' ? null : params.parent,
			index: nextIndex
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderDeleteHandler: 删除文件夹
 *
 * 功能描述：
 * - 删除指定的文件夹
 * - 使用软删除方式（设置 $$DELETED 标记）
 * - 不会删除文件夹中的文档，只删除文件夹本身
 *
 * @param params.id - 要删除的文件夹 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含删除结果的对象
 */
export async function folderDeleteHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!folder) {
			throw new Error(`文件夹 ${params.id} 不存在`);
		}

		const record = doc.getMap(params.id);
		record.set('$$DELETED', true);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `文件夹 ${params.id} 已删除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderAddHandler: 将文档添加到文件夹
 *
 * 功能描述：
 * - 在指定文件夹下添加一个文档链接
 * - 自动计算排序索引
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 目标文件夹 ID（必需）
 * @param params.target - 要添加的文档 ID（必需）
 * @param params.index - 排序索引（可选，默认自动计算）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含添加结果的对象
 */
export async function folderAddHandler(params: {
	id: string;
	target: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));

		const folder = nodeMap.get(params.id);
		if (!folder || folder.type !== 'folder') {
			throw new Error(`文件夹 ${params.id} 不存在`);
		}

		const linkId = generateId(12, 'link');
		const nextIndex = params.index?.toString() ?? (await nextOrganizeIndex(nodes, params.id));

		const record = doc.getMap(linkId);
		record.set('id', linkId);
		record.set('type', 'doc');
		record.set('data', params.target);
		record.set('parentId', params.id);
		record.set('index', nextIndex);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			id: linkId,
			parentId: params.id,
			data: params.target,
			index: nextIndex
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderMoveHandler: 将文档移动到目标文件夹
 *
 * 功能描述：
 * - 如果文档已在某个文件夹中，将其移动到新文件夹
 * - 如果文档不在任何文件夹中，将其添加到目标文件夹
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 目标文件夹 ID（必需）
 * @param params.target - 要移动的文档 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含移动结果的对象
 */
export async function folderMoveHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const targetFolder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!targetFolder) {
			throw new Error(`目标文件夹 ${params.id} 不存在`);
		}

		const existingLink = nodes.find(
			(n: any) => n.data === params.target && n.type === 'doc' && n.parentId
		);

		if (existingLink) {
			const record = doc.getMap(existingLink.id);
			record.set('parentId', params.id);
			const newIndex = await nextOrganizeIndex(nodes, params.id);
			record.set('index', newIndex);
		} else {
			const linkId = generateId(12, 'link');
			const newIndex = await nextOrganizeIndex(nodes, params.id);
			const record = doc.getMap(linkId);
			record.set('id', linkId);
			record.set('type', 'doc');
			record.set('data', params.target);
			record.set('parentId', params.id);
			record.set('index', newIndex);
		}

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `文档 ${params.target} 已移动到文件夹 ${params.id}`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderRemoveHandler: 从文件夹移除文档
 *
 * 功能描述：
 * - 从指定文件夹中移除文档链接
 * - 支持使用链接 ID 或文档 ID 进行移除
 * - 使用软删除方式（设置 $$DELETED 标记）
 *
 * @param params.id - 文档 ID 或链接 ID（必需）
 * @param params.folder - 源文件夹 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含移除结果的对象
 */
export async function folderRemoveHandler(params: {
	id: string;
	folder: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const link = nodes.find(
			(n: any) =>
				n.parentId === params.folder &&
				(n.data === params.id || n.id === params.id) &&
				n.type === 'doc'
		);
		if (!link) {
			throw new Error(`文件夹 ${params.folder} 中不存在文档 ${params.id}`);
		}

		const record = doc.getMap(link.id);
		record.set('$$DELETED', true);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `文档 ${params.id} 已从文件夹 ${params.folder} 移除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderUpdateHandler: 更新文件夹属性
 *
 * 功能描述：
 * - 支持更新文件夹的名称、父文件夹和排序索引
 * - 如果只更新父文件夹，会自动重新计算排序索引
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 要更新的文件夹 ID（必需）
 * @param params.name - 新文件夹名称（可选）
 * @param params.parent - 新父文件夹 ID，空字符串表示根级别（可选）
 * @param params.index - 排序索引（可选）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含更新结果的对象
 */
export async function folderUpdateHandler(params: {
	id: string;
	name?: string;
	parent?: string;
	index?: number;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folder = nodes.find((n: any) => n.id === params.id && n.type === 'folder');
		if (!folder) {
			throw new Error(`文件夹 ${params.id} 不存在`);
		}

		const record = doc.getMap(params.id);
		if (params.name !== undefined) {
			record.set('data', params.name);
		}
		if (params.parent !== undefined) {
			record.set('parentId', params.parent === '' ? null : params.parent);
		}
		if (params.index !== undefined) {
			record.set('index', params.index.toString());
		} else if (params.parent !== undefined) {
			const parentId = params.parent === '' ? null : params.parent;
			const newIndex = await nextOrganizeIndex(nodes, parentId);
			record.set('index', newIndex);
		}

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));

		return {
			success: true,
			message: `文件夹 ${params.id} 已更新`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * folderClearHandler: 清除所有空文件夹
 *
 * 功能描述：
 * - 删除所有没有子文件夹或文档关联的文件夹
 * - 递归执行，直到没有孤立文件夹为止
 * - 使用软删除方式（设置 $$DELETED 标记）
 *
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含删除数量的对象
 */
export async function folderClearHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const docId = specialWorkspaceDbDocId(workspaceId, 'folders');
		const snapshot = await loadDoc(socket, workspaceId, docId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const nodes = readOrganizeNodes(doc);
		const folders = nodes.filter((n: any) => n.type === 'folder');
		const links = nodes.filter((n: any) => n.type !== 'folder');

		const folderIds = new Set(folders.map((f: any) => f.id));
		const parentToChildren = new Map<string, string[]>();
		for (const link of links) {
			if (link.parentId && folderIds.has(link.parentId)) {
				if (!parentToChildren.has(link.parentId)) {
					parentToChildren.set(link.parentId, []);
				}
				parentToChildren.get(link.parentId)!.push(link.id);
			}
		}

		const hasChildren = (folderId: string): boolean => {
			if (parentToChildren.has(folderId) && parentToChildren.get(folderId)!.length > 0) {
				return true;
			}
			const childFolders = folders.filter((f: any) => f.parentId === folderId);
			for (const child of childFolders) {
				if (hasChildren(child.id)) {
					return true;
				}
			}
			return false;
		};

		const deletedFolders: string[] = [];
		let changed = true;
		while (changed) {
			changed = false;
			const currentNodes = readOrganizeNodes(doc);
			const currentFolders = currentNodes.filter((n: any) => n.type === 'folder');

			for (const folder of currentFolders) {
				if (!hasChildren(folder.id)) {
					const record = doc.getMap(folder.id);
					record.set('$$DELETED', true);
					deletedFolders.push(folder.id);
					changed = true;
				}
			}

			if (changed) {
				const update = Y.encodeStateAsUpdate(doc);
				await pushDocUpdate(
					socket,
					workspaceId,
					docId,
					Buffer.from(update).toString('base64')
				);
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}

		return {
			success: true,
			total: deletedFolders.length,
			folers: deletedFolders
		};
	} finally {
		socket.disconnect();
	}
}
