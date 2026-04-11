/**
 * 收藏夹核心模块
 * 处理收藏夹的创建、列表、更新、删除、添加/移除文档等操作
 * 使用 WebSocket + Yjs 方式存储在工作区的 setting.map.collections 中
 */

import { getWorkspaceId } from '../utils/config.js';
import {
	connectWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate,
	getWorkspaceDocInfo
} from '../utils/wsClient.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * CollectionInfo: 收藏夹类型定义
 *
 * @property id - 收藏夹唯一 ID
 * @property name - 收藏夹名称
 * @property rules - 收藏夹规则（过滤条件）
 * @property allowList - 允许列表中的文档 ID 数组
 */
interface CollectionInfo {
	id: string;
	name: string;
	rules: {
		filters: unknown[];
	};
	allowList: string[];
}

/**
 * normalizeCollection: 规范化收藏夹数据
 *
 * @param value - 原始值
 * @returns 规范化的 CollectionInfo 或 null
 */
function normalizeCollection(value: unknown): CollectionInfo | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const collection = value as Record<string, unknown>;
	if (typeof collection.id !== 'string' || typeof collection.name !== 'string') {
		return null;
	}
	const allowList = Array.isArray(collection.allowList)
		? collection.allowList.filter((entry): entry is string => typeof entry === 'string')
		: [];
	const rules =
		collection.rules &&
		typeof collection.rules === 'object' &&
		!Array.isArray(collection.rules) &&
		Array.isArray((collection.rules as Record<string, unknown>).filters)
			? {
					filters: (
						(collection.rules as Record<string, unknown>).filters as unknown[]
					).slice()
				}
			: { filters: [] };

	return {
		id: collection.id,
		name: collection.name,
		rules,
		allowList
	};
}

/**
 * readCollections: 读取收藏夹列表
 *
 * @param array - Y.Array 对象
 * @returns CollectionInfo 数组
 */
function readCollections(array: Y.Array<any>): CollectionInfo[] {
	const collections: CollectionInfo[] = [];
	for (let i = 0; i < array.length; i++) {
		const normalized = normalizeCollection(array.get(i));
		if (normalized) {
			collections.push(normalized);
		}
	}
	return collections;
}

/**
 * findCollectionIndex: 查找收藏夹索引
 *
 * @param array - Y.Array 对象
 * @param id - 收藏夹 ID
 * @returns 索引位置，未找到返回 -1
 */
function findCollectionIndex(array: Y.Array<any>, id: string): number {
	for (let i = 0; i < array.length; i++) {
		const normalized = normalizeCollection(array.get(i));
		if (normalized?.id === id) {
			return i;
		}
	}
	return -1;
}

/**
 * collectionListHandler: 获取所有收藏夹列表
 *
 * 功能描述：
 * - 通过 WebSocket + Yjs 获取工作区的所有收藏夹
 * - 返回按名称排序的收藏夹列表，包含 ID、名称和文档数量
 *
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 收藏夹数组
 */
export async function collectionListHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		const collections = current instanceof Y.Array ? readCollections(current) : [];

		return [...collections]
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((col) => ({
				id: col.id,
				name: col.name,
				docCount: col.allowList.length
			}));
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionInfoHandler: 获取指定收藏夹信息
 *
 * 功能描述：
 * - 获取指定收藏夹的详细信息
 * - 返回收藏夹中的文档列表（包含 ID 和标题）
 *
 * @param params.id - 收藏夹 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含收藏夹 ID、名称、文档列表和数量的对象
 */
export async function collectionInfoHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		const collections = current instanceof Y.Array ? readCollections(current) : [];
		const collection = collections.find((entry) => entry.id === params.id);

		if (!collection) {
			throw new Error(`收藏夹 ${params.id} 不存在`);
		}

		const pagesInfo = await getWorkspaceDocInfo(workspaceId);

		const docs = collection.allowList.map((docId) => {
			const pageInfo = pagesInfo.get(docId);
			return {
				id: docId,
				title: pageInfo?.title || '未命名文档'
			};
		});

		return {
			id: collection.id,
			name: collection.name,
			docs,
			docCount: collection.allowList.length
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionCreateHandler: 创建新收藏夹
 *
 * 功能描述：
 * - 在工作区中创建新收藏夹
 * - 初始收藏夹为空（allowList 为空数组）
 * - 通过 WebSocket + Yjs 实时创建
 *
 * @param params.name - 收藏夹名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含创建结果的对象
 */
export async function collectionCreateHandler(params: {
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		let current = setting.get('collections') as Y.Array<any> | undefined;
		if (!(current instanceof Y.Array)) {
			current = new Y.Array<any>();
			setting.set('collections', current);
		}

		const collection: CollectionInfo = {
			id: generateId(12, 'coll'),
			name: params.name,
			rules: {
				filters: []
			},
			allowList: []
		};

		current.push([collection]);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(update).toString('base64')
		);

		return {
			success: true,
			id: collection.id,
			name: collection.name
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionUpdateHandler: 更新收藏夹名称
 *
 * 功能描述：
 * - 更新指定收藏夹的名称
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 收藏夹 ID（必需）
 * @param params.name - 新收藏夹名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含更新结果的对象
 */
export async function collectionUpdateHandler(params: {
	id: string;
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('工作区没有收藏夹');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`收藏夹 ${params.id} 不存在`);
		}

		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`收藏夹 ${params.id} 数据格式错误`);
		}
		const next: CollectionInfo = {
			...previous,
			name: params.name
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(update).toString('base64')
		);

		return {
			success: true,
			message: `收藏夹已重命名为 "${params.name}"`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionDeleteHandler: 删除收藏夹
 *
 * 功能描述：
 * - 删除指定的收藏夹
 * - 不会删除收藏夹中的文档，只删除收藏夹本身
 *
 * @param params.id - 收藏夹 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含删除结果的对象
 */
export async function collectionDeleteHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('工作区没有收藏夹');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`收藏夹 ${params.id} 不存在`);
		}
		current.delete(index, 1);

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(update).toString('base64')
		);

		return {
			success: true,
			message: `收藏夹 ${params.id} 已删除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionAddHandler: 添加文档到收藏夹
 *
 * 功能描述：
 * - 将指定文档添加到收藏夹
 * - 如果文档已在收藏夹中，不会重复添加
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 收藏夹 ID（必需）
 * @param params.target - 要添加的文档 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含添加结果的对象
 */
export async function collectionAddHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('工作区没有收藏夹');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`收藏夹 ${params.id} 不存在`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`收藏夹 ${params.id} 数据格式错误`);
		}
		const next: CollectionInfo = {
			...previous,
			allowList: Array.from(new Set([...previous.allowList, params.target]))
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(update).toString('base64')
		);

		return {
			success: true,
			message: `文档 ${params.target} 已添加到收藏夹 ${params.id}`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * collectionRemoveHandler: 从收藏夹移除文档
 *
 * 功能描述：
 * - 从指定收藏夹中移除文档
 * - 文档本身不会被删除，只移除与收藏夹的关联
 *
 * @param params.id - 收藏夹 ID（必需）
 * @param params.target - 要移除的文档 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含移除结果的对象
 */
export async function collectionRemoveHandler(params: {
	id: string;
	target: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const setting = doc.getMap('setting');
		const current = setting.get('collections');
		if (!(current instanceof Y.Array)) {
			throw new Error('工作区没有收藏夹');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`收藏夹 ${params.id} 不存在`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`收藏夹 ${params.id} 数据格式错误`);
		}
		const next: CollectionInfo = {
			...previous,
			allowList: previous.allowList.filter((id) => id !== params.target)
		};

		doc.transact(() => {
			current.delete(index, 1);
			current.insert(index, [next]);
		});

		const update = Y.encodeStateAsUpdate(doc);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(update).toString('base64')
		);

		return {
			success: true,
			message: `文档 ${params.target} 已从收藏夹 ${params.id} 移除`
		};
	} finally {
		socket.disconnect();
	}
}
