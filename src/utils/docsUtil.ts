/**
 * 模块名称：docsUtil.ts
 * 文档工具函数模块
 *
 * 功能描述：
 * - 提供文档创建功能的核心实现
 * - 支持从 Markdown 创建文档
 * - 提供 Yjs block 操作的辅助函数
 * - 支持文档导出为 Markdown
 *
 * 导出的主要函数：
 * - createDocFromMarkdownCore: 从 Markdown 创建文档（核心函数）
 * - collectDocForMarkdown: 收集文档信息用于导出为 Markdown
 * - getWorkspaceTagOptions: 获取工作区标签选项
 *
 * 导出的辅助函数：
 * - findBlockIdByFlavour: 查找指定 flavour 的 block ID
 * - findBlockById: 根据 ID 查找 block
 * - childIdsFrom: 获取子元素 ID 数组
 * - getStringArray: 获取字符串数组
 * - asText: 将文本内容转换为字符串
 */

import * as Y from 'yjs';
import { createGraphQLClient } from './graphqlClient.js';
import {
	wsUrlFromGraphQLEndpoint,
	connectWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate
} from './wsClient.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import type { MarkdownOperation, TextDelta } from '../markdown/types.js';
import { SELECT_COLORS } from '../core/constants.js';
import { generateId } from './misc.js';

/**
 * 获取 Block 版本号
 */
function blockVersion(flavour: string): number {
	switch (flavour) {
		case 'affine:page':
			return 2;
		case 'affine:surface':
			return 5;
		default:
			return 1;
	}
}

/**
 * 设置 Block 的系统字段
 */
function setSysFields(block: Y.Map<any>, blockId: string, flavour: string): void {
	block.set('sys:id', blockId);
	block.set('sys:flavour', flavour);
	block.set('sys:version', blockVersion(flavour));
}

/**
 * 创建 Y.Text
 */
function makeText(content: string | TextDelta[]): Y.Text {
	const yText = new Y.Text();
	if (typeof content === 'string') {
		if (content.length > 0) {
			yText.insert(0, content);
		}
		return yText;
	}
	let offset = 0;
	for (const delta of content) {
		if (!delta.insert) {
			continue;
		}
		yText.insert(offset, delta.insert, delta.attributes ? { ...delta.attributes } : {});
		offset += delta.insert.length;
	}
	return yText;
}

/**
 * 确保 Note Block 存在
 */
function ensureNoteBlock(blocks: Y.Map<any>): string {
	const existingNoteId = findBlockIdByFlavour(blocks, 'affine:note');
	if (existingNoteId) {
		return existingNoteId;
	}

	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	if (!pageId) {
		throw new Error('Document has no page block; unable to insert content.');
	}

	const noteId = generateId(12, 'note');
	const note = new Y.Map<any>();
	setSysFields(note, noteId, 'affine:note');
	note.set('sys:parent', null);
	note.set('sys:children', new Y.Array<string>());
	note.set('prop:xywh', '[0,0,800,95]');
	note.set('prop:index', 'a0');
	note.set('prop:hidden', false);
	note.set('prop:displayMode', 'both');
	const background = new Y.Map<any>();
	background.set('light', '#ffffff');
	background.set('dark', '#252525');
	note.set('prop:background', background);
	blocks.set(noteId, note);

	const page = blocks.get(pageId) as Y.Map<any>;
	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
	if (!(pageChildren instanceof Y.Array)) {
		pageChildren = new Y.Array<string>();
		page.set('sys:children', pageChildren);
	}
	pageChildren.push([noteId]);
	return noteId;
}

// /**
//  * 确保 Surface Block 存在
//  */
// function ensureSurfaceBlock(blocks: Y.Map<any>): string {
// 	const existingSurfaceId = findBlockIdByFlavour(blocks, 'affine:surface');
// 	if (existingSurfaceId) {
// 		return existingSurfaceId;
// 	}

// 	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
// 	if (!pageId) {
// 		throw new Error('Document has no page block; unable to create/find surface.');
// 	}

// 	const surfaceId = generateId(12, 'surface');
// 	const surface = new Y.Map<any>();
// 	setSysFields(surface, surfaceId, 'affine:surface');
// 	surface.set('sys:parent', null);
// 	surface.set('sys:children', new Y.Array<string>());
// 	const elements = new Y.Map<any>();
// 	elements.set('type', '$blocksuite:internal:native$');
// 	elements.set('value', new Y.Map<any>());
// 	surface.set('prop:elements', elements);
// 	blocks.set(surfaceId, surface);

// 	const page = blocks.get(pageId) as Y.Map<any>;
// 	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
// 	if (!(pageChildren instanceof Y.Array)) {
// 		pageChildren = new Y.Array<string>();
// 		page.set('sys:children', pageChildren);
// 	}
// 	pageChildren.push([surfaceId]);
// 	return surfaceId;
// }

/**
 * 收集后代 Block IDs
 */
function collectDescendantBlockIds(blocks: Y.Map<any>, startIds: string[]): string[] {
	const result: string[] = [];
	const visited = new Set<string>();
	const stack = [...startIds];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		if (visited.has(current)) continue;
		visited.add(current);
		result.push(current);
		const block = findBlockById(blocks, current);
		if (!block) continue;
		const children = childIdsFrom(block.get('sys:children'));
		for (const childId of children) stack.push(childId);
	}
	return result;
}

/**
 * 合并警告数组（去重）
 */
function mergeWarnings(...sources: string[][]): string[] {
	const deduped = new Set<string>();
	for (const source of sources) {
		for (const warning of source) {
			deduped.add(warning);
		}
	}
	return [...deduped];
}

/**
 * 创建 Block
 */
function createBlock(type: string, text: string, extra?: Record<string, any>) {
	const blockId = generateId(12, type);
	const block = new Y.Map<any>();

	switch (type) {
		case 'paragraph':
		case 'heading': {
			setSysFields(block, blockId, 'affine:paragraph');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			const blockType = type === 'heading' ? 'h1' : 'text';
			block.set('prop:type', extra?.level ? `h${extra.level}` : blockType);
			block.set('prop:text', makeText(text));
			break;
		}
		case 'quote': {
			setSysFields(block, blockId, 'affine:paragraph');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', 'quote');
			block.set('prop:text', makeText(text));
			break;
		}
		case 'list': {
			setSysFields(block, blockId, 'affine:list');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', extra?.style || 'bulleted');
			block.set('prop:checked', extra?.checked || false);
			block.set('prop:text', makeText(extra?.deltas || text));
			break;
		}
		case 'code': {
			setSysFields(block, blockId, 'affine:code');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:language', extra?.language || 'txt');
			block.set('prop:text', makeText(text));
			break;
		}
		case 'divider': {
			setSysFields(block, blockId, 'affine:divider');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			break;
		}
		case 'callout': {
			setSysFields(block, blockId, 'affine:callout');
			block.set('sys:parent', null);
			const calloutChildren = new Y.Array<string>();
			const textBlockId = generateId(12, 'paragraph');
			const textBlock = new Y.Map<any>();
			setSysFields(textBlock, textBlockId, 'affine:paragraph');
			textBlock.set('sys:parent', null);
			textBlock.set('sys:children', new Y.Array<string>());
			textBlock.set('prop:type', 'text');
			textBlock.set('prop:text', makeText(text));
			calloutChildren.push([textBlockId]);
			block.set('sys:children', calloutChildren);
			block.set('prop:icon', { type: 'emoji', unicode: '💡' });
			block.set('prop:backgroundColorName', 'grey');
			break;
		}
		case 'table': {
			setSysFields(block, blockId, 'affine:table');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			const rows = extra?.rows || 2;
			const cols = extra?.columns || 2;
			const tableData = extra?.tableData || [];

			const rowIds: string[] = [];
			for (let i = 0; i < rows; i++) {
				const rowId = generateId(12, 'row');
				block.set(`prop:rows.${rowId}.rowId`, rowId);
				block.set(`prop:rows.${rowId}.order`, `r${String(i).padStart(4, '0')}`);
				rowIds.push(rowId);
			}

			const columnIds: string[] = [];
			for (let i = 0; i < cols; i++) {
				const columnId = generateId(12, 'col');
				block.set(`prop:columns.${columnId}.columnId`, columnId);
				block.set(`prop:columns.${columnId}.order`, `c${String(i).padStart(4, '0')}`);
				columnIds.push(columnId);
			}

			for (let rowIndex = 0; rowIndex < rowIds.length; rowIndex += 1) {
				const rowId = rowIds[rowIndex];
				for (let colIndex = 0; colIndex < columnIds.length; colIndex += 1) {
					const columnId = columnIds[colIndex];
					const cellText = tableData[rowIndex]?.[colIndex] ?? '';
					block.set(`prop:cells.${rowId}:${columnId}.text`, makeText(cellText));
				}
			}
			break;
		}
		case 'bookmark': {
			setSysFields(block, blockId, 'affine:bookmark');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:style', 'horizontal');
			block.set('prop:url', extra?.url || '');
			block.set('prop:caption', extra?.caption || null);
			block.set('prop:description', null);
			block.set('prop:icon', null);
			block.set('prop:image', null);
			block.set('prop:title', null);
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:index', 'a0');
			break;
		}
		default: {
			setSysFields(block, blockId, 'affine:paragraph');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', 'text');
			block.set('prop:text', makeText(text));
		}
	}

	return { blockId, block };
}

/**
 * 应用 Markdown 操作到文档
 */
async function applyMarkdownOperationsInternal(
	workspaceId: string,
	docId: string,
	operations: MarkdownOperation[]
): Promise<{ appendedCount: number; skippedCount: number; blockIds: string[] }> {
	const gql = await createGraphQLClient();
	const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
	const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);

	try {
		await joinWorkspace(socket, workspaceId);
		const doc = new Y.Doc();
		const snapshot = await loadDoc(socket, workspaceId, docId);
		if (!snapshot.missing) throw new Error(`Document ${docId} not found.`);
		Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));

		const prevSV = Y.encodeStateVector(doc);
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		const noteId = ensureNoteBlock(blocks);
		const noteBlock = findBlockById(blocks, noteId);
		if (!noteBlock) throw new Error('Unable to resolve note block.');
		const noteChildren = ensureChildrenArray(noteBlock);

		// 清除现有内容
		const descendantBlockIds = collectDescendantBlockIds(blocks, childIdsFrom(noteChildren));
		for (const descendantId of descendantBlockIds) blocks.delete(descendantId);
		if (noteChildren.length > 0) noteChildren.delete(0, noteChildren.length);

		const blockIds: string[] = [];
		let skippedCount = 0;

		for (const operation of operations) {
			try {
				let type = operation.type;
				let text = '';
				let extra: Record<string, any> = {};

				switch (operation.type) {
					case 'heading':
						type = 'heading';
						text = operation.text;
						extra = { level: operation.level };
						break;
					case 'paragraph':
						type = 'paragraph';
						text = operation.text;
						break;
					case 'quote':
						type = 'quote';
						text = operation.text;
						break;
					case 'callout':
						type = 'callout';
						text = operation.text;
						break;
					case 'list':
						type = 'list';
						text = operation.text;
						extra = {
							style: operation.style,
							checked: operation.checked,
							deltas: operation.deltas
						};
						break;
					case 'code':
						type = 'code';
						text = operation.text;
						extra = { language: operation.language };
						break;
					case 'divider':
						type = 'divider';
						text = '';
						break;
					case 'table':
						type = 'table';
						text = '';
						extra = {
							rows: operation.rows,
							columns: operation.columns,
							tableData: operation.tableData
						};
						break;
					case 'bookmark':
						type = 'bookmark';
						text = '';
						extra = { url: operation.url, caption: operation.caption };
						break;
					default:
						type = 'paragraph';
						text = '';
				}

				const { blockId, block } = createBlock(type, text, extra);
				blocks.set(blockId, block);
				noteChildren.push([blockId]);
				blockIds.push(blockId);
			} catch {
				skippedCount += 1;
			}
		}

		const delta = Y.encodeStateAsUpdate(doc, prevSV);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(delta).toString('base64'));

		return { appendedCount: blockIds.length, skippedCount, blockIds };
	} finally {
		socket.disconnect();
	}
}

/**
 * 内部创建文档函数
 */
async function createDocInternal(
	workspaceId: string,
	title: string,
	content?: string
): Promise<{ workspaceId: string; docId: string; title: string }> {
	const gql = await createGraphQLClient();
	const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
	const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);

	try {
		await joinWorkspace(socket, workspaceId);

		const docId = generateId(12, 'doc');
		const docTitle = title || 'Untitled';
		const ydoc = new Y.Doc();
		const blocks = ydoc.getMap('blocks');

		// 创建 page block
		const pageId = generateId(12, 'page');
		const page = new Y.Map();
		setSysFields(page, pageId, 'affine:page');
		const titleText = new Y.Text();
		titleText.insert(0, docTitle);
		page.set('prop:title', titleText);
		const children = new Y.Array();
		page.set('sys:children', children);
		blocks.set(pageId, page);

		// 创建 surface block
		const surfaceId = generateId(12, 'surf');
		const surface = new Y.Map();
		setSysFields(surface, surfaceId, 'affine:surface');
		surface.set('sys:parent', null);
		surface.set('sys:children', new Y.Array());
		const elements = new Y.Map<any>();
		elements.set('type', '$blocksuite:internal:native$');
		elements.set('value', new Y.Map<any>());
		surface.set('prop:elements', elements);
		blocks.set(surfaceId, surface);
		children.push([surfaceId]);

		// 创建 note block
		const noteId = generateId(12, 'note');
		const note = new Y.Map();
		setSysFields(note, noteId, 'affine:note');
		note.set('sys:parent', null);
		note.set('prop:displayMode', 'both');
		note.set('prop:xywh', '[0,0,800,95]');
		note.set('prop:index', 'a0');
		note.set('prop:hidden', false);
		const background = new Y.Map<any>();
		background.set('light', '#ffffff');
		background.set('dark', '#252525');
		note.set('prop:background', background);
		const noteChildren = new Y.Array();
		note.set('sys:children', noteChildren);
		blocks.set(noteId, note);
		children.push([noteId]);

		// 如果有初始内容，添加段落
		if (content) {
			const paraId = generateId(12, 'para');
			const para = new Y.Map();
			setSysFields(para, paraId, 'affine:paragraph');
			para.set('sys:parent', null);
			para.set('sys:children', new Y.Array());
			para.set('prop:type', 'text');
			const paragraphText = new Y.Text();
			paragraphText.insert(0, content);
			para.set('prop:text', paragraphText);
			blocks.set(paraId, para);
			noteChildren.push([paraId]);
		}

		// 设置 meta
		const meta = ydoc.getMap('meta');
		meta.set('id', docId);
		meta.set('title', docTitle);
		meta.set('createDate', Date.now());
		meta.set('tags', new Y.Array());

		// 推送文档更新
		const updateFull = Y.encodeStateAsUpdate(ydoc);
		await pushDocUpdate(socket, workspaceId, docId, Buffer.from(updateFull).toString('base64'));

		// 更新工作区元数据
		const wsDoc = new Y.Doc();
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (snapshot.missing) Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const prevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');

		let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
		if (!pages) {
			pages = new Y.Array();
			wsMeta.set('pages', pages);
		}

		const entry = new Y.Map();
		entry.set('id', docId);
		entry.set('title', docTitle);
		entry.set('createDate', Date.now());
		entry.set('tags', new Y.Array());
		pages.push([entry as any]);

		const wsDelta = Y.encodeStateAsUpdate(wsDoc, prevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(wsDelta).toString('base64')
		);

		return { workspaceId, docId, title: docTitle };
	} finally {
		socket.disconnect();
	}
}

/**
 * TAG_OPTION_COLORS: 标签颜色列表
 *
 * 复用 database.ts 中的 SELECT_COLORS 颜色
 * 使用淡雅柔和的颜色方案，适合视觉展示
 */
const TAG_OPTION_COLORS = SELECT_COLORS;

/**
 * 获取或创建 Tag 选项
 */
async function ensureTagOption(wsDoc: Y.Doc, tagName: string): Promise<string> {
	const wsMeta = wsDoc.getMap('meta');
	const properties = wsMeta.get('properties') as Y.Map<any> | undefined;
	const tags = properties?.get('tags') as Y.Map<any> | undefined;
	const options = tags?.get('options') as Y.Array<any> | undefined;

	// 查找现有 tag
	if (options) {
		for (let i = 0; i < options.length; i++) {
			const opt = options.get(i);
			if (opt instanceof Y.Map) {
				const value = opt.get('value');
				if (value && value.toLowerCase() === tagName.toLowerCase()) {
					return opt.get('id');
				}
			}
		}
	}

	// 创建新 tag
	const tagId = generateId(8, 'tag');
	const color = TAG_OPTION_COLORS[(options?.length || 0) % TAG_OPTION_COLORS.length];
	const now = Date.now();

	// 确保 properties.tags.options 结构存在
	let targetOptions = options;
	if (!targetOptions) {
		if (!properties) {
			const newProps = new Y.Map<any>();
			wsMeta.set('properties', newProps);
		}
		const finalProps = properties || (wsMeta.get('properties') as Y.Map<any>);
		if (!tags) {
			const newTags = new Y.Map<any>();
			finalProps.set('tags', newTags);
		}
		const finalTags = finalProps.get('tags') as Y.Map<any>;
		targetOptions = new Y.Array<any>();
		finalTags.set('options', targetOptions);
	}

	const optionMap = new Y.Map<any>();
	optionMap.set('id', tagId);
	optionMap.set('value', tagName);
	optionMap.set('color', color);
	optionMap.set('createDate', now);
	optionMap.set('updateDate', now);
	targetOptions.push([optionMap]);

	return tagId;
}

/**
 * 添加文档到文件夹
 */
async function addDocToFolder(workspaceId: string, docId: string, folderId: string): Promise<void> {
	const gql = await createGraphQLClient();
	const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
	const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);

	try {
		await joinWorkspace(socket, workspaceId);

		// folders 存储在特殊文档中
		const foldersDocId = `db$${workspaceId}$folders`;
		const foldersDoc = new Y.Doc();
		const foldersSnapshot = await loadDoc(socket, workspaceId, foldersDocId);

		// 只有当 snapshot 存在时才应用更新
		const hasSnapshot = Boolean(foldersSnapshot.missing);
		if (hasSnapshot) {
			Y.applyUpdate(foldersDoc, Buffer.from(foldersSnapshot.missing!, 'base64'));
		}

		// 收集现有节点
		const nodes: any[] = [];
		if (hasSnapshot) {
			try {
				for (const key of foldersDoc.share.keys()) {
					if (!foldersDoc.share.has(key)) continue;
					const record = foldersDoc.getMap(key);
					if (!(record instanceof Y.Map)) continue;
					if (record.get('$$DELETED') === true || record.size === 0) continue;

					nodes.push({
						id: key,
						type: record.get('type'),
						data: record.get('data'),
						parentId: record.get('parentId'),
						index: record.get('index')
					});
				}
			} catch {
				// 忽略遍历错误
			}
		}

		// 找到文件夹的子项中最大的 index
		let maxIndex = 0;
		const folderChildren = nodes.filter((n) => n.parentId === folderId && n.type === 'doc');
		folderChildren.forEach((n) => {
			if (n.index && parseInt(n.index) > maxIndex) {
				maxIndex = parseInt(n.index);
			}
		});

		// 创建新的链接记录
		const linkId = generateId(12, 'link');
		const record = foldersDoc.getMap(linkId);
		record.set('id', linkId);
		record.set('type', 'doc');
		record.set('data', docId);
		record.set('parentId', folderId);
		record.set('index', String(maxIndex + 1));

		const update = Y.encodeStateAsUpdate(foldersDoc);
		await pushDocUpdate(
			socket,
			workspaceId,
			foldersDocId,
			Buffer.from(update).toString('base64')
		);
	} finally {
		socket.disconnect();
	}
}

/**
 * 从 Markdown 创建文档（核心函数）
 */
export async function createDocFromMarkdownCore(parsed: {
	workspaceId?: string;
	title?: string;
	markdown: string;
	strict?: boolean;
	parentDocId?: string;
	tags?: string;
	folder?: string;
}) {
	const workspaceId = parsed.workspaceId;
	if (!workspaceId) {
		throw new Error('workspaceId is required');
	}

	// 解析 Markdown
	const parsedMarkdown = parseMarkdownToOperations(parsed.markdown);
	let operations = [...parsedMarkdown.operations];

	// 提取标题（如果未指定，使用第一个一级标题）
	let title = (parsed.title ?? '').trim();
	if (!title && operations.length > 0) {
		const first = operations[0];
		if (first.type === 'heading' && first.level === 1) {
			title = first.text.trim() || 'Untitled';
			operations = operations.slice(1);
		}
	}

	// 如果仍未获取到标题，使用文档内容的前 N 个字符
	if (!title) {
		// 从原文提取前 N 个字符作为标题
		const MAX_TITLE_LENGTH = 50;
		const rawContent = parsed.markdown.trim();
		if (rawContent) {
			// 移除 Markdown 格式符号，获取纯文本
			let plainText = rawContent
				.replace(/^#+\s*/gm, '') // 移除标题标记
				.replace(/\*\*([^*]+)\*\*/g, '$1') // 移除粗体
				.replace(/\*([^*]+)\*/g, '$1') // 移除斜体
				.replace(/`([^`]+)`/g, '$1') // 移除行内代码
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除链接
				.replace(/^[-*+]\s+/gm, '') // 移除列表标记
				.replace(/^\d+\.\s+/gm, '') // 移除有序列表标记
				.replace(/^>\s+/gm, '') // 移除引用标记
				.replace(/```[\s\S]*?```/g, '') // 移除代码块
				.replace(/!\[.*?\]\(.*?\)/g, '') // 移除图片
				.trim();

			// 取前 N 个字符
			if (plainText.length > MAX_TITLE_LENGTH) {
				// 在单词边界或指定位置截断
				const truncated = plainText.substring(0, MAX_TITLE_LENGTH);
				// 尝试找到一个合适的断点（空格处）
				const lastSpace = truncated.lastIndexOf(' ');
				if (lastSpace > MAX_TITLE_LENGTH * 0.6) {
					title = truncated.substring(0, lastSpace) + '...';
				} else {
					title = truncated + '...';
				}
			} else if (plainText.length > 0) {
				title = plainText;
			}
		}
	}

	// 如果最终还是没有有效标题（内容为空或全是空白），使用时间格式
	if (!title) {
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		title = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} 无标题`;
	}

	// 解析标签
	const tagNames: string[] = [];
	if (parsed.tags) {
		const tagsStr = parsed.tags.trim();
		if (tagsStr) {
			tagNames.push(
				...tagsStr
					.split(',')
					.map((t) => t.trim())
					.filter((t) => t)
			);
		}
	}

	// 创建文档
	const created = await createDocInternal(workspaceId, title);

	// 添加标签到文档
	if (tagNames.length > 0) {
		const gql = await createGraphQLClient();
		const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
		const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);

		try {
			await joinWorkspace(socket, workspaceId);

			// 加载工作区文档
			const wsDoc = new Y.Doc();
			const snapshot = await loadDoc(socket, workspaceId, workspaceId);
			if (snapshot.missing) {
				Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
			}

			const prevSV = Y.encodeStateVector(wsDoc);
			const wsMeta = wsDoc.getMap('meta');
			const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

			if (pages) {
				for (let i = 0; i < pages.length; i++) {
					const entry = pages.get(i);
					if (entry.get('id') === created.docId) {
						// 获取或创建所有 tag 的 ID
						const tagIds: string[] = [];
						for (const tagName of tagNames) {
							const tagId = await ensureTagOption(wsDoc, tagName);
							tagIds.push(tagId);
						}

						// 添加 tag IDs 到文档条目
						const docTags = entry.get('tags') as Y.Array<string> | undefined;
						if (docTags) {
							for (const tagId of tagIds) {
								docTags.push([tagId]);
							}
						} else {
							const newTags = new Y.Array<string>();
							for (const tagId of tagIds) {
								newTags.push([tagId]);
							}
							entry.set('tags', newTags);
						}
						break;
					}
				}
			}

			// 推送更新
			const delta = Y.encodeStateAsUpdate(wsDoc, prevSV);
			await pushDocUpdate(
				socket,
				workspaceId,
				workspaceId,
				Buffer.from(delta).toString('base64')
			);
		} finally {
			socket.disconnect();
		}
	}

	// 添加文档到文件夹
	if (parsed.folder) {
		try {
			await addDocToFolder(workspaceId, created.docId, parsed.folder);
		} catch {
			// Non-fatal
		}
	}

	// 应用 Markdown 操作
	let applied = {
		appendedCount: 0,
		skippedCount: 0,
		blockIds: [] as string[]
	};

	if (operations.length > 0) {
		applied = await applyMarkdownOperationsInternal(
			created.workspaceId,
			created.docId,
			operations
		);
	}

	// 如果指定了父文档，添加链接
	let linkedToParent = false;
	if (parsed.parentDocId) {
		try {
			const gql = await createGraphQLClient();
			const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
			const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);

			try {
				await joinWorkspace(socket, workspaceId);

				const parentDoc = new Y.Doc();
				const parentSnapshot = await loadDoc(socket, workspaceId, parsed.parentDocId);
				if (parentSnapshot.missing) {
					Y.applyUpdate(parentDoc, Buffer.from(parentSnapshot.missing, 'base64'));
				}

				const prevSV = Y.encodeStateVector(parentDoc);
				const parentBlocks = parentDoc.getMap('blocks') as Y.Map<any>;

				const noteId = ensureNoteBlock(parentBlocks);
				const noteBlock = findBlockById(parentBlocks, noteId);
				if (noteBlock) {
					const noteChildren = ensureChildrenArray(noteBlock);

					const embedId = generateId(12, 'embed');
					const embedBlock = new Y.Map<any>();
					setSysFields(embedBlock, embedId, 'affine:embed-linked-doc');
					embedBlock.set('sys:parent', null);
					embedBlock.set('sys:children', new Y.Array<string>());
					embedBlock.set('prop:index', 'a0');
					embedBlock.set('prop:xywh', '[0,0,0,0]');
					embedBlock.set('prop:lockedBySelf', false);
					embedBlock.set('prop:rotate', 0);
					embedBlock.set('prop:style', 'horizontal');
					embedBlock.set('prop:caption', null);
					embedBlock.set('prop:pageId', created.docId);
					embedBlock.set('prop:title', undefined);
					embedBlock.set('prop:description', undefined);
					embedBlock.set('prop:footnoteIdentifier', null);

					parentBlocks.set(embedId, embedBlock);
					noteChildren.push([embedId]);

					const delta = Y.encodeStateAsUpdate(parentDoc, prevSV);
					await pushDocUpdate(
						socket,
						workspaceId,
						parsed.parentDocId,
						Buffer.from(delta).toString('base64')
					);

					linkedToParent = true;
				}
			} finally {
				socket.disconnect();
			}
		} catch {
			// Non-fatal
		}
	}

	// 生成警告
	const applyWarnings: string[] = [];
	if (applied.skippedCount > 0) {
		applyWarnings.push(
			`${applied.skippedCount} markdown block(s) could not be applied to AFFiNE and were skipped.`
		);
	}
	if (parsed.parentDocId && !linkedToParent) {
		applyWarnings.push(
			`Doc created but could not be linked to parent doc "${parsed.parentDocId}". Link it manually.`
		);
	}
	if (parsed.folder) {
		// folder 警告将在外部处理
	}

	return {
		workspaceId: created.workspaceId,
		docId: created.docId,
		title: created.title,
		linkedToParent,
		tags: tagNames,
		warnings: mergeWarnings(parsedMarkdown.warnings, applyWarnings),
		lossy: parsedMarkdown.lossy || applied.skippedCount > 0,
		stats: {
			parsedBlocks: parsedMarkdown.operations.length,
			appliedBlocks: applied.appendedCount,
			skippedBlocks: applied.skippedCount
		}
	};
}

/**
 * 收集文档信息用于导出为 Markdown
 * 参考 .resources/core/docs/util.ts 中的实现
 */

// ==================== 工具函数 ====================

/**
 * 获取标签数组（从 meta 中获取）
 */
function getTagArray(meta: Y.Map<any>): string[] {
	const pages = meta.get('pages') as Y.Array<any> | undefined;
	if (!pages) return [];
	for (const page of pages) {
		if (page instanceof Y.Map) {
			const tags = page.get('tags');
			if (tags instanceof Y.Array) {
				return tags.toArray() as string[];
			}
		}
	}
	return [];
}

/**
 * 获取字符串数组
 */
export function getStringArray(value: unknown): string[] {
	if (!(value instanceof Y.Array)) {
		return [];
	}
	const values: string[] = [];
	value.forEach((entry: unknown) => {
		if (typeof entry === 'string') {
			values.push(entry);
		}
	});
	return values;
}

/**
 * 将文本内容转换为字符串
 */
export function asText(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	return '';
}

/**
 * 获取字符串或 null
 */
export function asStringOrNull(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * 获取子元素 ID 数组
 */
export function childIdsFrom(value: unknown): string[] {
	if (!(value instanceof Y.Array)) return [];
	const childIds: string[] = [];
	value.forEach((entry: unknown) => {
		if (typeof entry === 'string') {
			childIds.push(entry);
			return;
		}
		if (Array.isArray(entry)) {
			for (const child of entry) {
				if (typeof child === 'string') {
					childIds.push(child);
				}
			}
		}
	});
	return childIds;
}

/**
 * 查找指定 flavour 的 block ID
 */
export function findBlockIdByFlavour(blocks: Y.Map<any>, flavour: string): string | null {
	for (const [, value] of blocks) {
		const block = value as Y.Map<any>;
		if (block?.get && block.get('sys:flavour') === flavour) {
			return String(block.get('sys:id'));
		}
	}
	return null;
}

/**
 * 根据 ID 查找 block
 */
export function findBlockById(blocks: Y.Map<any>, blockId: string): Y.Map<any> | null {
	const value = blocks.get(blockId);
	if (value instanceof Y.Map) return value;
	return null;
}

/**
 * 确保子元素数组存在
 */
function ensureChildrenArray(block: Y.Map<any>): Y.Array<any> {
	const current = block.get('sys:children');
	if (current instanceof Y.Array) return current;
	const created = new Y.Array<any>();
	block.set('sys:children', created);
	return created;
}

/**
 * 标签选项类型
 */
export type WorkspaceTagOption = {
	id: string;
	value: string;
	color: string;
	createDate: number | null;
	updateDate: number | null;
};

/**
 * 获取工作区的标签选项
 */
export function getWorkspaceTagOptions(meta: Y.Map<any>): WorkspaceTagOption[] {
	const properties = meta.get('properties') as Y.Map<any> | undefined;
	if (!properties) return [];

	const tags = properties.get('tags') as Y.Map<any> | undefined;
	if (!tags) return [];

	const options = tags.get('options') as Y.Array<any> | undefined;
	if (!options) return [];

	const result: WorkspaceTagOption[] = [];
	options.forEach((opt: unknown) => {
		if (opt instanceof Y.Map) {
			result.push({
				id: opt.get('id') || '',
				value: opt.get('value') || '',
				color: opt.get('color') || TAG_OPTION_COLORS[0],
				createDate: opt.get('createDate') || null,
				updateDate: opt.get('updateDate') || null
			});
		}
	});
	return result;
}

/**
 * 获取工作区标签选项映射
 */
export function getWorkspaceTagOptionMaps(meta: Y.Map<any>): {
	options: WorkspaceTagOption[];
	byId: Map<string, WorkspaceTagOption>;
	byValueLower: Map<string, WorkspaceTagOption>;
} {
	const options = getWorkspaceTagOptions(meta);
	const byId = new Map<string, WorkspaceTagOption>();
	const byValueLower = new Map<string, WorkspaceTagOption>();
	for (const option of options) {
		if (!byId.has(option.id)) {
			byId.set(option.id, option);
		}
		const key = option.value.toLocaleLowerCase();
		if (!byValueLower.has(key)) {
			byValueLower.set(key, option);
		}
	}
	return { options, byId, byValueLower };
}

/**
 * 解析标签名称
 */
export function resolveTagLabels(
	tagEntries: string[],
	byId: Map<string, WorkspaceTagOption>
): string[] {
	const deduped = new Set<string>();
	const resolved: string[] = [];
	for (const entry of tagEntries) {
		const raw = entry.trim();
		if (!raw) {
			continue;
		}
		const option = byId.get(raw);
		const label = (option ? option.value : raw).trim();
		if (!label) {
			continue;
		}
		const dedupeKey = label.toLocaleLowerCase();
		if (deduped.has(dedupeKey)) {
			continue;
		}
		deduped.add(dedupeKey);
		resolved.push(label);
	}
	return resolved;
}

/**
 * 映射条目
 */
function mapEntries(value: unknown): Array<[string, any]> {
	if (value instanceof Y.Map) {
		const entries: Array<[string, any]> = [];
		value.forEach((mapValue: unknown, key: string) => {
			entries.push([key, mapValue]);
		});
		return entries;
	}
	if (value && typeof value === 'object') return Object.entries(value as Record<string, any>);
	return [];
}

/**
 * 富文本值转字符串
 */
function richTextValueToString(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		return value
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				if (entry && typeof entry === 'object' && typeof (entry as any).insert === 'string')
					return (entry as any).insert as string;
				return '';
			})
			.join('');
	}
	if (value && typeof value === 'object' && typeof (value as any).insert === 'string')
		return (value as any).insert as string;
	return '';
}

/**
 * 提取表格数据
 */
function extractTableData(block: Y.Map<any>): string[][] | null {
	const rowsValue = block.get('prop:rows');
	const columnsValue = block.get('prop:columns');
	const cellsValue = block.get('prop:cells');

	let rowEntries = mapEntries(rowsValue)
		.map(([rowId, payload]) => ({
			rowId,
			order:
				payload && typeof payload === 'object' && typeof (payload as any).order === 'string'
					? (payload as any).order
					: rowId
		}))
		.sort((a, b) => a.order.localeCompare(b.order));

	let columnEntries = mapEntries(columnsValue)
		.map(([columnId, payload]) => ({
			columnId,
			order:
				payload && typeof payload === 'object' && typeof (payload as any).order === 'string'
					? (payload as any).order
					: columnId
		}))
		.sort((a, b) => a.order.localeCompare(b.order));

	let cells = new Map<string, string>();
	if (rowEntries.length === 0 || columnEntries.length === 0) {
		const flatRows = new Map<string, string>();
		const flatColumns = new Map<string, string>();
		const flatCells = new Map<string, string>();
		block.forEach((value: unknown, key: string) => {
			const rowMatch = key.match(/^prop:rows\.([^.]+)\.order$/);
			if (rowMatch) {
				flatRows.set(rowMatch[1], typeof value === 'string' ? value : rowMatch[1]);
				return;
			}
			const colMatch = key.match(/^prop:columns\.([^.]+)\.order$/);
			if (colMatch) {
				flatColumns.set(colMatch[1], typeof value === 'string' ? value : colMatch[1]);
				return;
			}
			const cellMatch = key.match(/^prop:cells\.([^.]+:[^.]+)\.text$/);
			if (cellMatch) {
				flatCells.set(cellMatch[1], richTextValueToString(value));
			}
		});
		if (flatRows.size > 0 && flatColumns.size > 0) {
			rowEntries = Array.from(flatRows.entries())
				.map(([rowId, order]) => ({ rowId, order }))
				.sort((a, b) => a.order.localeCompare(b.order));
			columnEntries = Array.from(flatColumns.entries())
				.map(([columnId, order]) => ({ columnId, order }))
				.sort((a, b) => a.order.localeCompare(b.order));
			cells = flatCells;
		}
	} else {
		// 使用 cellsValue 提取单元格数据
		if (cellsValue instanceof Y.Map) {
			cellsValue.forEach((cellValue: unknown, key: string) => {
				cells.set(key, richTextValueToString(cellValue));
			});
		}
	}

	const tableData: string[][] = [];
	for (const { rowId } of rowEntries) {
		const row: string[] = [];
		for (const { columnId } of columnEntries) {
			// 尝试多种可能的单元格 key 格式
			const key1 = `${rowId}:${columnId}`;
			const key2 = `${columnId}:${rowId}`;
			let cellText = cells.get(key1) || cells.get(key2) || '';

			// 如果没有找到，尝试从 block 中直接获取
			if (!cellText) {
				const cellKey1 = `prop:cells.${rowId}:${columnId}.text`;
				const cellKey2 = `prop:cells.${columnId}:${rowId}.text`;
				cellText =
					richTextValueToString(block.get(cellKey1)) ||
					richTextValueToString(block.get(cellKey2));
			}

			row.push(cellText);
		}
		tableData.push(row);
	}
	return tableData.length > 0 ? tableData : null;
}

/**
 * Markdown 可渲染块类型
 */
export interface MarkdownRenderableBlock {
	id: string;
	parentId: string | null;
	flavour: string | null;
	type: string | null;
	text: string | null;
	checked: boolean | null;
	language: string | null;
	childIds: string[];
	url: string | null;
	sourceId: string | null;
	caption: string | null;
	tableData: string[][] | null;
}

/**
 * 收集文档信息用于导出为 Markdown
 * 参考 .resources/core/docs/util.ts 中的 collectDocForMarkdown 实现
 */
export function collectDocForMarkdown(
	doc: Y.Doc,
	tagOptionsById: Map<string, WorkspaceTagOption> = new Map()
): {
	title: string;
	tags: string[];
	rootBlockIds: string[];
	blocksById: Map<string, MarkdownRenderableBlock>;
} {
	const meta = doc.getMap('meta');
	const tags = resolveTagLabels(getStringArray(getTagArray(meta)), tagOptionsById);
	const blocks = doc.getMap('blocks') as Y.Map<any>;
	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	const noteId = findBlockIdByFlavour(blocks, 'affine:note');
	const blocksById = new Map<string, MarkdownRenderableBlock>();
	const visited = new Set<string>();
	let title = '';
	const rootBlockIds: string[] = [];
	if (pageId) {
		const pageBlock = findBlockById(blocks, pageId);
		if (pageBlock) {
			title = asText(pageBlock.get('prop:title'));
			rootBlockIds.push(...childIdsFrom(pageBlock.get('sys:children')));
		}
	} else if (noteId) rootBlockIds.push(noteId);
	if (rootBlockIds.length === 0) for (const [id] of blocks) rootBlockIds.push(String(id));

	const visit = (blockId: string) => {
		if (visited.has(blockId)) return;
		visited.add(blockId);
		const block = findBlockById(blocks, blockId);
		if (!block) return;
		const childIds = childIdsFrom(block.get('sys:children'));
		const entry: MarkdownRenderableBlock = {
			id: blockId,
			parentId: asStringOrNull(block.get('sys:parent')),
			flavour: asStringOrNull(block.get('sys:flavour')),
			type: asStringOrNull(block.get('prop:type')),
			text: asText(block.get('prop:text')) || null,
			checked:
				typeof block.get('prop:checked') === 'boolean'
					? Boolean(block.get('prop:checked'))
					: null,
			language: asStringOrNull(block.get('prop:language')),
			childIds,
			url: asStringOrNull(block.get('prop:url')),
			sourceId: asStringOrNull(block.get('prop:sourceId')),
			caption: asStringOrNull(block.get('prop:caption')),
			tableData: block.get('sys:flavour') === 'affine:table' ? extractTableData(block) : null
		};
		blocksById.set(blockId, entry);
		for (const childId of childIds) visit(childId);
	};
	for (const rootId of rootBlockIds) visit(rootId);
	for (const [id] of blocks) visit(String(id));
	return { title, tags, rootBlockIds, blocksById };
}
