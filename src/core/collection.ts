/**
 * 精选核心模块
 * 处理精选的创建、列表、更新、删除、添加/移除文档等操作
 * 使用 WebSocket + Yjs 方式存储在工作区的 setting.map.collections 中
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
 * CollectionInfo: 精选类型定义
 *
 * @property id - 精选唯一 ID
 * @property name - 精选名称
 * @property rules - 精选规则（过滤条件）
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
 * normalizeCollection: 规范化精选数据
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
 * readCollections: 读取精选列表
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
 * findCollectionIndex: 查找精选索引
 *
 * @param array - Y.Array 对象
 * @param id - 精选 ID
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
 * collectionListHandler: 获取所有精选列表
 *
 * 功能描述：
 * - 通过 WebSocket + Yjs 获取工作区的所有精选
 * - 返回按名称排序的精选列表，包含 ID、名称和文档数量
 *
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 精选数组
 */
export async function collectionListHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

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
	}
}

/**
 * collectionInfoHandler: 获取指定精选信息
 *
 * 功能描述：
 * - 获取指定精选的详细信息
 * - 返回精选中的文档列表（包含 ID 和标题）
 *
 * @param params.id - 精选 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含精选 ID、名称、文档列表和数量的对象
 */
export async function collectionInfoHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

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
			throw new Error(`精选 ${params.id} 不存在`);
		}

		const pagesInfo = await getWorkspaceDocs(workspaceId);

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
	}
}

/**
 * collectionCreateHandler: 创建新精选
 *
 * 功能描述：
 * - 在工作区中创建新精选
 * - 初始精选为空（allowList 为空数组）
 * - 通过 WebSocket + Yjs 实时创建
 *
 * @param params.name - 精选名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含创建结果的对象
 */
export async function collectionCreateHandler(params: {
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

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
	}
}

/**
 * collectionUpdateHandler: 更新精选名称
 *
 * 功能描述：
 * - 更新指定精选的名称
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 精选 ID（必需）
 * @param params.name - 新精选名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含更新结果的对象
 */
export async function collectionUpdateHandler(params: {
	id: string;
	name: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

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
			throw new Error('工作区没有精选');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`精选 ${params.id} 不存在`);
		}

		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`精选 ${params.id} 数据格式错误`);
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
			message: `精选已重命名为 "${params.name}"`
		};
	} finally {
	}
}

/**
 * collectionDeleteHandler: 删除精选
 *
 * 功能描述：
 * - 删除指定的精选
 * - 不会删除精选中的文档，只删除精选本身
 *
 * @param params.id - 精选 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含删除结果的对象
 */
export async function collectionDeleteHandler(params: {
	id: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

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
			throw new Error('工作区没有精选');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`精选 ${params.id} 不存在`);
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
			message: `精选 ${params.id} 已删除`
		};
	} finally {
	}
}

/**
 * collectionAddHandler: 添加文档到精选
 *
 * 功能描述：
 * - 将指定文档添加到精选
 * - 如果文档已在精选中，不会重复添加
 * - 通过 WebSocket + Yjs 实时更新
 *
 * @param params.id - 精选 ID（必需）
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
	const socket = await createWorkspaceSocket();

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
			throw new Error('工作区没有精选');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`精选 ${params.id} 不存在`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`精选 ${params.id} 数据格式错误`);
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
			message: `文档 ${params.target} 已添加到精选 ${params.id}`
		};
	} finally {
	}
}

/**
 * collectionRemoveHandler: 从精选移除文档
 *
 * 功能描述：
 * - 从指定精选中移除文档
 * - 文档本身不会被删除，只移除与精选的关联
 *
 * @param params.id - 精选 ID（必需）
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
	const socket = await createWorkspaceSocket();

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
			throw new Error('工作区没有精选');
		}
		const index = findCollectionIndex(current, params.id);
		if (index < 0) {
			throw new Error(`精选 ${params.id} 不存在`);
		}
		const previous = normalizeCollection(current.get(index));
		if (!previous) {
			throw new Error(`精选 ${params.id} 数据格式错误`);
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
			message: `文档 ${params.target} 已从精选 ${params.id} 移除`
		};
	} finally {
	}
}
