/**
 * 标签核心模块
 * 处理标签的创建、列表、添加/移除文档等操作
 * 使用 WebSocket + Yjs 方式存储
 */

import { getWorkspaceId } from '../utils/config.js';
import {
	connectWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate
} from '../utils/wsClient.js';
import { SELECT_COLORS } from './constants.js';
import * as Y from 'yjs';
import { generateId } from '../utils/misc.js';

/**
 * TAG_OPTION_COLORS: 标签颜色列表
 *
 * 复用 database.ts 中的 SELECT_COLORS 颜色
 * 使用淡雅柔和的颜色方案，适合视觉展示
 */
const TAG_OPTION_COLORS = SELECT_COLORS;

/**
 * normalizeTag: 规范化标签名称
 *
 * @param tag - 原始标签名称
 * @returns 去除首尾空白后的标签名称
 */
function normalizeTag(tag: string): string {
	return tag.trim();
}

/**
 * getTagOptionsArray: 获取标签选项数组
 *
 * 功能描述：
 * - 从 meta 的正确路径 meta.properties.tags.options 获取标签选项数组
 * - 这是 Affine 存储标签选项的标准结构
 *
 * @param meta - 工作区的 meta Y.Map
 * @returns 标签选项数组，若不存在则返回 null
 */
function getTagOptionsArray(meta: Y.Map<any>): Y.Array<any> | null {
	const properties = meta.get('properties');
	if (!properties || !(properties instanceof Y.Map)) {
		return null;
	}
	const tags = properties.get('tags');
	if (!tags || !(tags instanceof Y.Map)) {
		return null;
	}
	const options = tags.get('options');
	if (!options || !(options instanceof Y.Array)) {
		return null;
	}
	return options;
}

/**
 * ensureTagOptionsArray: 确保标签选项数组存在
 *
 * 功能描述：
 * - 如果 meta.properties.tags.options 不存在，则创建它
 * - 返回可用的标签选项数组
 *
 * @param meta - 工作区的 meta Y.Map
 * @returns 标签选项 Y.Array
 */
function ensureTagOptionsArray(meta: Y.Map<any>): Y.Array<any> {
	let properties = meta.get('properties') as Y.Map<any> | undefined;
	if (!properties) {
		properties = new Y.Map<any>();
		meta.set('properties', properties);
	}

	let tags = properties.get('tags') as Y.Map<any> | undefined;
	if (!tags) {
		tags = new Y.Map<any>();
		properties.set('tags', tags);
	}

	let options = tags.get('options') as Y.Array<any> | undefined;
	if (!options) {
		options = new Y.Array<any>();
		tags.set('options', options);
	}

	return options;
}

/**
 * parseTagOption: 解析单个标签选项
 *
 * @param raw - 原始的 Y.Map 对象
 * @returns 解析后的对象，包含 id、value、color；若解析失败返回 null
 */
function parseTagOption(raw: any): { id: string; value: string; color: string } | null {
	if (!raw || !(raw instanceof Y.Map)) {
		return null;
	}
	const id = raw.get('id');
	const value = raw.get('value');
	const color = raw.get('color');
	if (typeof id !== 'string' || typeof value !== 'string') {
		return null;
	}
	return {
		id,
		value,
		color: typeof color === 'string' ? color : '#6B7280'
	};
}

/**
 * getWorkspaceTagOptionList: 获取工作区标签选项列表
 *
 * 功能描述：
 * - 从 meta 中解析所有标签选项
 * - 返回包含 id、value、color 的对象数组
 *
 * @param meta - 工作区的 meta Y.Map
 * @returns 标签选项数组
 */
function getWorkspaceTagOptionList(
	meta: Y.Map<any>
): Array<{ id: string; value: string; color: string }> {
	const options = getTagOptionsArray(meta);
	if (!options) {
		return [];
	}

	const result: Array<{ id: string; value: string; color: string }> = [];
	options.forEach((item: any) => {
		const parsed = parseTagOption(item);
		if (parsed) {
			result.push(parsed);
		}
	});
	return result;
}

// /**
//  * getDocTagArray: 获取文档的标签数组
//  *
//  * @param doc - 文档的 Y.Doc 对象
//  * @returns 标签 Y.Array<string>，若不存在则返回 null
//  */
// function getDocTagArray(doc: Y.Doc): Y.Array<string> | null {
// 	const meta = doc.getMap('meta');
// 	if (!meta) {
// 		return null;
// 	}
// 	const tags = meta.get('tags');
// 	if (!tags || !(tags instanceof Y.Array)) {
// 		return null;
// 	}
// 	return tags as Y.Array<string>;
// }

// /**
//  * ensureDocTagArray: 确保文档有标签数组
//  *
//  * @param doc - 文档的 Y.Doc 对象
//  * @returns 标签 Y.Array<string>
//  *
//  * 注意事项：
//  * - 如果文档没有 meta，抛出异常
//  * - 如果 meta 中没有 tags，创建新的 Y.Array
//  */
// function ensureDocTagArray(doc: Y.Doc): Y.Array<string> {
// 	const meta = doc.getMap('meta');
// 	if (!meta) {
// 		throw new Error('文档没有 meta');
// 	}
// 	let tags = meta.get('tags') as Y.Array<string> | undefined;
// 	if (!tags) {
// 		tags = new Y.Array<string>();
// 		meta.set('tags', tags);
// 	}
// 	return tags;
// }

/**
 * getWorkspacePageEntries: 获取工作区页面条目列表
 *
 * @param wsMeta - 工作区的 meta Y.Map
 * @returns 页面条目数组，每个包含 id 和 entry（Y.Map）
 */
function getWorkspacePageEntries(wsMeta: Y.Map<any>): Array<{ id: string; entry: Y.Map<any> }> {
	const pages = wsMeta.get('pages');
	if (!pages || !(pages instanceof Y.Array)) {
		return [];
	}

	const result: Array<{ id: string; entry: Y.Map<any> }> = [];
	pages.forEach((page: any) => {
		if (page instanceof Y.Map) {
			const id = page.get('id');
			if (typeof id === 'string') {
				result.push({ id, entry: page });
			}
		}
	});
	return result;
}

/**
 * getStringArray: 从 Y.Array 获取字符串数组
 *
 * @param value - Y.Array 或其他值
 * @returns 字符串数组
 */
function getStringArray(value: unknown): string[] {
	if (!value || !(value instanceof Y.Array)) {
		return [];
	}
	const result: string[] = [];
	value.forEach((item: unknown) => {
		if (typeof item === 'string') {
			result.push(item);
		}
	});
	return result;
}

/**
 * tagsListHandler: 列出工作区中的所有标签
 *
 * 功能描述：
 * - 通过 WebSocket 获取工作区的所有标签选项
 * - 统计每个标签关联的文档数量
 * - 返回按名称排序的标签列表
 *
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含工作区 ID、标签总数和标签列表的对象
 *
 * 注意事项：
 * - 标签列表按名称字母顺序排序
 * - 每个标签包含名称、文档数量和颜色信息
 */
export async function tagsListHandler(params: { workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		if (!snapshot.missing) {
			return { workspaceId, totalTags: 0, tags: [] };
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const meta = wsDoc.getMap('meta');
		const pages = getWorkspacePageEntries(meta);
		const tagOptions = getWorkspaceTagOptionList(meta);

		const tagCounts = new Map<string, number>();
		for (const option of tagOptions) {
			tagCounts.set(option.value, 0);
		}

		for (const page of pages) {
			const pageTags = page.entry.get('tags');
			if (pageTags) {
				const tagIds = getStringArray(pageTags);
				const byId = new Map<string, { value: string; color: string }>();
				for (const opt of tagOptions) {
					byId.set(opt.id, opt);
				}
				for (const tagId of tagIds) {
					const opt = byId.get(tagId);
					if (opt) {
						tagCounts.set(opt.value, (tagCounts.get(opt.value) || 0) + 1);
					}
				}
			}
		}

		const tags = [...tagCounts.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([name, docCount]) => {
				const option = tagOptions.find((o) => o.value === name);
				return {
					name,
					docCount,
					color: option?.color
				};
			});

		return {
			workspaceId,
			totalTags: tags.length,
			tags
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * tagsCreateHandler: 创建新标签
 *
 * 功能描述：
 * - 在工作区中创建新标签
 * - 如果标签已存在，返回已存在信息，不重复创建
 * - 自动分配颜色（循环使用预定义颜色）
 *
 * @param params.tag - 标签名称（必需）
 * @param params.color - 标签颜色，如 #3B82F6（可选）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含创建结果的对象
 *
 * 注意事项：
 * - 标签名称不区分大小写，比较时忽略大小写
 * - 如果未指定颜色，自动从预定义颜色中循环选择
 * - 创建成功后返回标签的 id、value、color
 */
export async function tagsCreateHandler(params: {
	tag: string;
	color?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		if (!snapshot.missing) {
			throw new Error(`工作区根文档不存在`);
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const prevSV = Y.encodeStateVector(wsDoc);
		const meta = wsDoc.getMap('meta');

		const existingOptions = getWorkspaceTagOptionList(meta);
		const existing = existingOptions.find((t) => t.value.toLowerCase() === tag.toLowerCase());
		if (existing) {
			return {
				workspaceId,
				tag,
				created: false,
				message: `标签 "${tag}" 已存在`
			};
		}

		const optionsArray = ensureTagOptionsArray(meta);
		const color =
			params.color || TAG_OPTION_COLORS[existingOptions.length % TAG_OPTION_COLORS.length];
		const now = Date.now();

		const optionMap = new Y.Map<any>();
		optionMap.set('id', generateId(8, 'tag'));
		optionMap.set('value', tag);
		optionMap.set('color', color);
		optionMap.set('createDate', now);
		optionMap.set('updateDate', now);
		optionsArray.push([optionMap]);

		const delta = Y.encodeStateAsUpdate(wsDoc, prevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(delta).toString('base64')
		);

		return {
			success: true,
			workspaceId,
			tag,
			color,
			created: true
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * tagsDocAddHandler: 添加标签到文档
 *
 * 功能描述：
 * - 将指定标签添加到文档
 * - 如果标签不存在，自动创建该标签
 * - 如果文档已有该标签，不重复添加
 *
 * @param params.id - 文档 ID（必需）
 * @param params.tag - 标签名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含操作结果的对象
 *
 * 注意事项：
 * - 标签名称不区分大小写
 * - 如果标签不存在会自动创建，颜色自动分配
 */
export async function tagsDocAddHandler(params: {
	id: string;
	tag: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);

		const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (!wsSnapshot.missing) {
			throw new Error(`工作区根文档不存在`);
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, 'base64'));
		const wsPrevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');

		const pages = getWorkspacePageEntries(wsMeta);
		const page = pages.find((entry) => entry.id === params.id);
		if (!page) {
			throw new Error(`文档 ${params.id} 不存在于工作区`);
		}

		const existingOptions = getWorkspaceTagOptionList(wsMeta);
		let tagOption = existingOptions.find((t) => t.value.toLowerCase() === tag.toLowerCase());

		if (!tagOption) {
			const optionsArray = ensureTagOptionsArray(wsMeta);
			const color = TAG_OPTION_COLORS[existingOptions.length % TAG_OPTION_COLORS.length];
			const now = Date.now();

			const optionMap = new Y.Map<any>();
			optionMap.set('id', generateId(8, 'tag'));
			optionMap.set('value', tag);
			optionMap.set('color', color);
			optionMap.set('createDate', now);
			optionMap.set('updateDate', now);
			optionsArray.push([optionMap]);

			tagOption = { id: optionMap.get('id'), value: tag, color };
		}

		const pageTags = page.entry.get('tags') as Y.Array<string> | undefined;
		if (pageTags) {
			const existing = pageTags.toArray();
			if (!existing.includes(tagOption.id)) {
				pageTags.push([tagOption.id]);
			}
		} else {
			const newTags = new Y.Array<string>();
			newTags.push([tagOption.id]);
			page.entry.set('tags', newTags);
		}

		const delta = Y.encodeStateAsUpdate(wsDoc, wsPrevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(delta).toString('base64')
		);

		return {
			success: true,
			message: `标签 "${tag}" 已添加到文档 ${params.id}`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * tagsDocRemoveHandler: 从文档移除标签
 *
 * 功能描述：
 * - 从指定文档中移除标签
 * - 标签本身不会被删除，只移除与文档的关联
 *
 * @param params.id - 文档 ID（必需）
 * @param params.tag - 标签名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含操作结果的对象
 *
 * 注意事项：
 * - 标签名称不区分大小写
 * - 如果标签或文档不存在，抛出异常
 */
export async function tagsDocRemoveHandler(params: {
	id: string;
	tag: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);

		const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (!wsSnapshot.missing) {
			throw new Error(`工作区根文档不存在`);
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, 'base64'));
		const wsPrevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');

		const pages = getWorkspacePageEntries(wsMeta);
		const page = pages.find((entry) => entry.id === params.id);
		if (!page) {
			throw new Error(`文档 ${params.id} 不存在于工作区`);
		}

		const existingOptions = getWorkspaceTagOptionList(wsMeta);
		const tagOption = existingOptions.find((t) => t.value.toLowerCase() === tag.toLowerCase());
		if (!tagOption) {
			throw new Error(`标签 "${tag}" 不存在`);
		}

		const pageTags = page.entry.get('tags') as Y.Array<string> | undefined;
		if (pageTags) {
			const existing = pageTags.toArray();
			const newTags = existing.filter((t) => t !== tagOption.id);
			pageTags.delete(0, existing.length);
			if (newTags.length > 0) {
				pageTags.insert(0, newTags);
			}
		}

		const delta = Y.encodeStateAsUpdate(wsDoc, wsPrevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(delta).toString('base64')
		);

		return {
			success: true,
			message: `标签 "${tag}" 已从文档 ${params.id} 移除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * tagsDeleteHandler: 删除标签
 *
 * 功能描述：
 * - 从工作区中删除指定标签
 * - 删除标签会影响所有使用该标签的文档
 *
 * @param params.tag - 标签名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含操作结果的对象
 *
 * 注意事项：
 * - 标签名称不区分大小写
 * - 删除标签后，所有文档中该标签的关联都会被移除
 * - 如果标签不存在，抛出异常
 */
export async function tagsDeleteHandler(params: { tag: string; workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();
	const tag = normalizeTag(params.tag);

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		if (!snapshot.missing) {
			throw new Error(`工作区根文档不存在`);
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const prevSV = Y.encodeStateVector(wsDoc);
		const meta = wsDoc.getMap('meta');

		const optionsArray = getTagOptionsArray(meta);
		if (!optionsArray) {
			throw new Error(`标签 "${tag}" 不存在`);
		}

		let foundIndex = -1;
		for (let i = 0; i < optionsArray.length; i++) {
			const item = optionsArray.get(i);
			const parsed = parseTagOption(item);
			if (parsed && parsed.value.toLowerCase() === tag.toLowerCase()) {
				foundIndex = i;
				break;
			}
		}

		if (foundIndex === -1) {
			throw new Error(`标签 "${tag}" 不存在`);
		}

		optionsArray.delete(foundIndex, 1);

		const delta = Y.encodeStateAsUpdate(wsDoc, prevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(delta).toString('base64')
		);

		return {
			success: true,
			message: `标签 "${tag}" 已删除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * tagsDocListHandler: 获取指定标签关联的文档列表
 *
 * 功能描述：
 * - 查找所有使用指定标签的文档
 * - 支持大小写敏感/不敏感匹配
 * - 返回文档 ID 和标题列表
 *
 * @param params.tag - 标签名称（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @param params.ignoreCase - 是否忽略大小写，默认 true
 * @returns 包含工作区 ID、标签名、匹配模式和文档列表的对象
 *
 * 注意事项：
 * - 如果标签不存在，返回空列表
 * - 每个文档返回 ID 和标题（无标题时显示 '未命名文档'）
 */
export async function tagsDocListHandler(params: {
	tag: string;
	workspace?: string;
	ignoreCase?: boolean;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await connectWorkspaceSocket();
	const tag = normalizeTag(params.tag);
	const ignoreCase = params.ignoreCase ?? true;

	try {
		await joinWorkspace(socket, workspaceId);
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);

		if (!snapshot.missing) {
			return { workspaceId, tag, ignoreCase, totalDocs: 0, docs: [] };
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const meta = wsDoc.getMap('meta');
		const pages = getWorkspacePageEntries(meta);
		const tagOptions = getWorkspaceTagOptionList(meta);

		const tagOption = tagOptions.find((t) =>
			ignoreCase ? t.value.toLowerCase() === tag.toLowerCase() : t.value === tag
		);

		if (!tagOption) {
			return { workspaceId, tag, ignoreCase, totalDocs: 0, docs: [] };
		}

		const docs = pages
			.filter((page) => {
				const docTags = page.entry.get('tags') as Y.Array<string> | undefined;
				if (!docTags) {
					return false;
				}
				const tagIds = getStringArray(docTags);
				return tagIds.includes(tagOption.id);
			})
			.map((page) => {
				const title = page.entry.get('title');
				return {
					id: page.id,
					title: title || '未命名文档'
				};
			});

		return {
			workspaceId,
			tag,
			ignoreCase,
			totalDocs: docs.length,
			docs
		};
	} finally {
		socket.disconnect();
	}
}
