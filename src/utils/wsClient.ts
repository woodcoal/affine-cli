/**
 * 模块名称：wsClient.ts
 * WebSocket 客户端模块
 *
 * 功能描述：
 * - 提供与 Affine WebSocket 服务交互的功能
 * - 用于读取和写入 Y.js CRDT 状态
 * - 支持文档的加载、更新、删除操作
 * - 支持工作区元数据提取（页面信息、标签选项）
 *
 * 导出的函数：
 * - wsUrlFromGraphQLEndpoint: 从 GraphQL URL 推导 WebSocket URL
 * - connectWorkspaceSocket: 连接工作区 WebSocket
 * - joinWorkspace: 加入工作区
 * - loadDoc: 加载文档快照
 * - pushDocUpdate: 推送文档更新
 * - deleteDoc: 删除文档
 * - extractWorkspacePages: 提取页面元数据
 * - getWorkspaceTagOptions: 获取标签选项
 * - extractTagNames: 提取标签名称
 * - getWorkspaceDocInfo: 获取工作区文档信息
 */

import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { getApiConfig } from './config.js';

const DEFAULT_WS_CLIENT_VERSION = '0.26.0';
const WS_CONNECT_TIMEOUT_MS = 10000;
const WS_ACK_TIMEOUT_MS = 10000;

/**
 * wsUrlFromGraphQLEndpoint: 从 GraphQL 端点 URL 推导 WebSocket URL
 *
 * @param endpoint - GraphQL 端点 URL（如 https://app.affine.pro/graphql）
 * @returns WebSocket URL（如 wss://app.affine.pro）
 *
 * 转换规则：
 * - https:// → wss://
 * - http:// → ws://
 * - 移除末尾的 /graphql
 */
export function wsUrlFromGraphQLEndpoint(endpoint: string): string {
	return endpoint
		.replace('https://', 'wss://')
		.replace('http://', 'ws://')
		.replace(/\/graphql\/?$/, '');
}

/**
 * connectWorkspaceSocket: 连接工作区 WebSocket
 *
 * @param wsUrl - WebSocket URL
 * @param cookie - 认证 Cookie（可选）
 * @param bearer - Bearer Token（可选）
 * @returns Socket.io 连接对象
 * @throws 连接超时或连接失败
 *
 * 注意事项：
 * - 使用 websocket 传输
 * - 默认超时 10 秒
 * - 支持自定义认证头
 */
export async function connectWorkspaceSocket(): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const { apiUrl, apiToken } = getApiConfig();

		let settled = false;
		const extraHeaders: Record<string, string> = {};
		// if (cookie) extraHeaders['Cookie'] = cookie;
		if (apiToken) extraHeaders['Authorization'] = `Bearer ${apiToken}`;

		const url = wsUrlFromGraphQLEndpoint(apiUrl);
		const socket = io(url, {
			transports: ['websocket'],
			path: '/socket.io/',
			extraHeaders: Object.keys(extraHeaders).length ? extraHeaders : undefined,
			autoConnect: true
		});

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			cleanup();
			socket.disconnect();
			reject(new Error(`WebSocket 连接超时 (${WS_CONNECT_TIMEOUT_MS}ms)`));
		}, WS_CONNECT_TIMEOUT_MS);

		const onError = (err: any) => {
			if (settled) return;
			settled = true;
			cleanup();
			socket.disconnect();
			reject(err);
		};

		const onConnect = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(socket);
		};

		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('connect', onConnect);
			socket.off('connect_error', onError);
		};

		socket.on('connect', onConnect);
		socket.on('connect_error', onError);
	});
}

/**
 * joinWorkspace: 加入工作区
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @returns 加入成功时 resolve，超时或失败时 reject
 * @throws 加入工作区超时
 */
export async function joinWorkspace(socket: Socket, workspaceId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`加入工作区超时 (${WS_ACK_TIMEOUT_MS}ms)`));
		}, WS_ACK_TIMEOUT_MS);

		socket.emit(
			'space:join',
			{
				spaceType: 'workspace',
				spaceId: workspaceId,
				clientVersion: DEFAULT_WS_CLIENT_VERSION
			},
			(ack: any) => {
				clearTimeout(timeout);
				if (ack?.error) {
					reject(new Error(ack.error.message || '加入工作区失败'));
				} else {
					resolve();
				}
			}
		);
	});
}

/**
 * loadDoc: 加载文档快照
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @returns 包含 missing（Base64 编码的 Y.js 更新数据）或 state 的对象
 * @throws 加载文档超时
 *
 * 返回对象：
 * - missing: Base64 编码的 Y.js 更新数据（新增内容）
 * - state: Base64 编码的完整 Y.js 状态
 * - timestamp: 更新时间戳
 */
export async function loadDoc(
	socket: Socket,
	workspaceId: string,
	docId: string
): Promise<{ missing?: string; state?: string; timestamp?: number }> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`加载文档超时 (${WS_ACK_TIMEOUT_MS}ms)`));
		}, WS_ACK_TIMEOUT_MS);

		socket.emit(
			'space:load-doc',
			{ spaceType: 'workspace', spaceId: workspaceId, docId },
			(ack: any) => {
				clearTimeout(timeout);
				if (ack?.error) {
					if (ack.error.name === 'DOC_NOT_FOUND') {
						resolve({});
					} else {
						reject(new Error(ack.error.message || '加载文档失败'));
					}
				} else {
					resolve(ack?.data || {});
				}
			}
		);
	});
}

/**
 * pushDocUpdate: 推送文档更新
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @param updateBase64 - Base64 编码的 Y.js 更新数据
 * @returns 更新时间戳
 * @throws 推送更新超时
 */
export async function pushDocUpdate(
	socket: Socket,
	workspaceId: string,
	docId: string,
	updateBase64: string
): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`推送更新超时 (${WS_ACK_TIMEOUT_MS}ms)`));
		}, WS_ACK_TIMEOUT_MS);

		socket.emit(
			'space:push-doc-update',
			{ spaceType: 'workspace', spaceId: workspaceId, docId, update: updateBase64 },
			(ack: any) => {
				clearTimeout(timeout);
				if (ack?.error) {
					reject(new Error(ack.error.message || '推送更新失败'));
				} else {
					resolve(ack?.data?.timestamp || Date.now());
				}
			}
		);
	});
}

/**
 * deleteDoc: 删除文档
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 *
 * 注意事项：
 * - 这是单向操作，不等待响应
 */
export function deleteDoc(socket: Socket, workspaceId: string, docId: string): void {
	socket.emit('space:delete-doc', { spaceType: 'workspace', spaceId: workspaceId, docId });
}

/**
 * extractWorkspacePages: 从 Y.js 工作区文档中提取页面元数据
 *
 * @param wsDoc - Y.Doc 工作区文档
 * @returns 页面数组，包含 id、title、tagsArray、createDate、updateDate
 *
 * 注意事项：
 * - 从 meta.pages 中提取页面信息
 */
export function extractWorkspacePages(wsDoc: Y.Doc): Array<{
	id: string;
	title?: string;
	tagsArray?: any;
	createDate?: string;
	updateDate?: string;
}> {
	const meta = wsDoc.getMap('meta');
	const pages = meta.get('pages') as Y.Array<Y.Map<any>> | undefined;
	if (!pages) return [];

	const result: Array<{
		id: string;
		title?: string;
		tagsArray?: any;
		createDate?: string;
		updateDate?: string;
	}> = [];
	pages.forEach((page: Y.Map<any>) => {
		result.push({
			id: page.get('id'),
			title: page.get('title'),
			tagsArray: page.get('tags'),
			createDate: page.get('createDate'),
			updateDate: page.get('updateDate')
		});
	});
	return result;
}

/**
 * getWorkspaceTagOptions: 从工作区元数据中获取标签选项
 *
 * @param meta - 工作区的 meta Y.Map
 * @returns 标签选项数组，包含 id 和 value
 *
 * 注意事项：
 * - 正确的路径：meta.properties.tags.options
 */
export function getWorkspaceTagOptions(meta: Y.Map<any>): Array<{ id: string; value: string }> {
	const properties = meta.get('properties');
	if (!properties || !(properties instanceof Y.Map)) {
		return [];
	}
	const tags = properties.get('tags');
	if (!tags || !(tags instanceof Y.Map)) {
		return [];
	}
	const options = tags.get('options');
	if (!options || !(options instanceof Y.Array)) {
		return [];
	}
	const result: Array<{ id: string; value: string }> = [];
	options.forEach((item: any) => {
		if (item && item instanceof Y.Map) {
			const id = item.get('id');
			const value = item.get('value');
			if (typeof id === 'string' && typeof value === 'string') {
				result.push({ id, value });
			}
		}
	});
	return result;
}

/**
 * extractTagNames: 从 Y.Array 中提取标签名称数组
 *
 * @param tagsArray - 标签 ID 的 Y.Array
 * @param tagOptions - 标签选项数组（id 到 value 的映射）
 * @returns 标签名称数组
 *
 * 注意事项：
 * - 使用 tagOptions 将标签 ID 转换为名称
 * - 只返回能找到对应名称的标签
 */
export function extractTagNames(
	tagsArray: any,
	tagOptions: Array<{ id: string; value: string }>
): string[] {
	if (!tagsArray || !(tagsArray instanceof Y.Array)) {
		return [];
	}
	const byId = new Map<string, string>();
	for (const opt of tagOptions) {
		byId.set(opt.id, opt.value);
	}
	const names: string[] = [];
	tagsArray.forEach((tagId: string) => {
		const tagName = byId.get(tagId);
		if (tagName) {
			names.push(tagName);
		}
	});
	return names;
}

/**
 * getWorkspaceDocInfo: 获取工作区文档信息
 *
 * 功能描述：
 * - 通过 WebSocket 加载工作区文档
 * - 提取所有页面的标题和标签信息
 * - 返回 Map<docId, { title, tags, createDate, updateDate }>
 *
 * @param wsUrl - WebSocket URL
 * @param workspaceId - 工作区 ID
 * @param cookie - 认证 Cookie（可选）
 * @param bearer - Bearer Token（可选）
 * @returns 文档信息 Map
 */
export async function getWorkspaceDocInfo(workspaceId: string) {
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		const doc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
		}

		const meta = doc.getMap('meta');
		const tagOptions = getWorkspaceTagOptions(meta);
		const pages = extractWorkspacePages(doc);
		const pagesInfo = new Map<
			string,
			{ title: string; tags: string[]; createDate?: string; updateDate?: string }
		>();
		for (const page of pages) {
			if (page.id) {
				const tagNames = extractTagNames(page.tagsArray, tagOptions);
				pagesInfo.set(page.id, {
					title: page.title || '',
					tags: tagNames,
					createDate: page.createDate,
					updateDate: page.updateDate
				});
			}
		}
		return pagesInfo;
	} finally {
		socket.disconnect();
	}
}

// /**
//  * 获取工作区文档简要信息（标题和标签）
//  * 返回 Map<docId, { title, tags }>
//  */
// export async function getWorkspaceDocSummary(
// 	wsUrl: string,
// 	workspaceId: string,
// 	cookie?: string,
// 	bearer?: string
// ): Promise<Map<string, { title: string; tags: string[] }>> {
// 	return getWorkspaceDocInfo(wsUrl, workspaceId, cookie, bearer);
// }

// /**
//  * 从 Y.js 文档中提取标题
//  */
// export function extractDocTitle(doc: Y.Doc): string {
// 	const blocks = doc.getMap('blocks') as Y.Map<any>;
// 	for (const [, raw] of blocks) {
// 		if (!(raw instanceof Y.Map)) continue;
// 		if (raw.get('sys:flavour') === 'affine:page') {
// 			const titleText = raw.get('prop:title');
// 			if (titleText instanceof Y.Text) {
// 				return titleText.toString();
// 			}
// 		}
// 	}
// 	return '';
// }
