/**
 * 日记核心模块
 * 处理日记的列表、创建、追加等操作
 *
 * 功能描述：
 * - 日记本质上是设置了 journal 属性的文档
 * - 属性存储在独立的工作区数据库 db$docProperties 中（SQLite）
 * - journal 属性值格式为 "YYYY-MM-DD"（如 "2024-01-15"）
 * - 通过 WebSocket + Yjs 操作 docProperties 数据库
 * - 使用与 createDocFromMarkdownCore 相同的 markdown 处理方式
 */

import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, fetchYDoc, updateYDoc } from '../utils/wsClient.js';
import {
	createDocFromMarkdownCore,
	collectDocForMarkdown,
	ensureNoteBlock,
	findBlockById,
	markdownOperationToAppendInput,
	normalizeAppendBlockInput,
	createBlock,
	resolveInsertContext
} from '../utils/docsUtil.js';
import { renderBlocksToMarkdown } from '../markdown/render.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import * as Y from 'yjs';
import * as fs from 'fs';

/**
 * JOURNAL_DATE_FORMAT: 日记日期格式
 */
export const JOURNAL_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * isValidJournalString: 验证是否为有效的日记日期字符串
 */
function isValidJournalString(value: unknown): value is string {
	if (!value || typeof value !== 'string') return false;
	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return false;

	const year = parseInt(match[1]);
	const month = parseInt(match[2]);
	const day = parseInt(match[3]);

	if (month < 1 || month > 12) return false;
	if (day < 1 || day > 31) return false;

	const daysInMonth = [
		31,
		28 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0),
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	];
	if (day > daysInMonth[month - 1]) return false;

	return true;
}

/**
 * formatJournalDate: 格式化日期为日记格式
 */
function formatJournalDate(date?: string | Date | number): string {
	if (!date) {
		return new Date().toISOString().split('T')[0];
	}

	if (date instanceof Date) {
		return date.toISOString().split('T')[0];
	}

	if (typeof date === 'string') {
		if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			return date;
		}
		const d = new Date(date);
		if (!isNaN(d.getTime())) {
			return d.toISOString().split('T')[0];
		}
	}

	if (typeof date === 'number') {
		return new Date(date).toISOString().split('T')[0];
	}

	return new Date().toISOString().split('T')[0];
}

/**
 * getDocPropertiesDocId: 获取 docProperties 数据库的特殊文档 ID
 */
function getDocPropertiesDocId(): string {
	return 'db$docProperties';
}

/**
 * journalListHandler: 列出工作区所有日记
 */
export async function journalListHandler(params: {
	workspace?: string;
	count?: number;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const limit = params.count || 20;

	try {
		await joinWorkspace(socket, workspaceId);

		const { doc: wsDoc, exists: wsSnapExists } = await fetchYDoc(
			socket,
			workspaceId,
			workspaceId
		);
		if (!wsSnapExists) {
			return { totalCount: 0, journals: [] };
		}

		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (!pages) {
			return { totalCount: 0, journals: [] };
		}

		const docPropsDocId = getDocPropertiesDocId();
		const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
			socket,
			workspaceId,
			docPropsDocId
		);

		const journals: Array<{
			id: string;
			title: string;
			date: string;
			createDate?: number;
			updateDate?: number;
		}> = [];

		if (propsDocExists) {
			for (let i = 0; i < pages.length; i++) {
				const page = pages.get(i);
				if (!(page instanceof Y.Map)) continue;

				const docId = page.get('id');
				if (!docId) continue;

				const docPropsMap = propsDoc.getMap(docId);
				const journalValue = docPropsMap?.get('journal');

				if (journalValue && isValidJournalString(journalValue)) {
					const title = page.get('title') || journalValue;
					const createDate = page.get('createDate');
					const updateDate = page.get('updateDate');

					journals.push({
						id: docId,
						title,
						date: journalValue,
						createDate,
						updateDate
					});
				}
			}
		}

		journals.sort((a, b) => b.date.localeCompare(a.date));
		const results = journals.slice(0, limit);

		return {
			totalCount: journals.length,
			journals: results
		};
	} finally {
	}
}

/**
 * setJournalPropertyInDocProperties: 在 docProperties 数据库中设置 journal 属性
 */
async function setJournalPropertyInDocProperties(
	socket: any,
	workspaceId: string,
	docId: string,
	date: string
): Promise<void> {
	const docPropsDocId = getDocPropertiesDocId();

	const {
		doc: existingDoc,
		exists,
		prevSV
	} = await fetchYDoc(socket, workspaceId, docPropsDocId);

	if (!exists) {
		const newDoc = new Y.Doc();
		const docPropsMap = newDoc.getMap(docId);
		docPropsMap.set('journal', date);

		await updateYDoc(socket, workspaceId, docPropsDocId, newDoc);
	} else {
		const docPropsMap = existingDoc.getMap(docId);
		docPropsMap.set('journal', date);

		await updateYDoc(socket, workspaceId, docPropsDocId, existingDoc, prevSV);
	}
}

/**
 * getJournalPropertyFromDocProperties: 从 docProperties 数据库获取 journal 属性
 */
async function getJournalPropertyFromDocProperties(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<string | undefined> {
	const docPropsDocId = getDocPropertiesDocId();
	const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
		socket,
		workspaceId,
		docPropsDocId
	);

	if (!propsDocExists) return undefined;

	const docPropsMap = propsDoc.getMap(docId);
	if (!docPropsMap) return undefined;

	const journalValue = docPropsMap.get('journal');
	if (isValidJournalString(journalValue)) {
		return journalValue;
	}

	return undefined;
}

/**
 * findJournalByDate: 根据日期查找日记
 */
async function findJournalByDate(
	socket: any,
	workspaceId: string,
	date: string
): Promise<{ id: string; title: string } | null> {
	const { doc: wsDoc, exists: wsSnapExists } = await fetchYDoc(socket, workspaceId, workspaceId);
	if (!wsSnapExists) return null;

	const wsMeta = wsDoc.getMap('meta');
	const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
	if (!pages) return null;

	const docPropsDocId = getDocPropertiesDocId();
	const { doc: propsDoc, exists: propsDocExists } = await fetchYDoc(
		socket,
		workspaceId,
		docPropsDocId
	);

	if (!propsDocExists) return null;

	for (let i = 0; i < pages.length; i++) {
		const page = pages.get(i);
		if (!(page instanceof Y.Map)) continue;

		const docId = page.get('id');
		if (!docId) continue;

		const docPropsMap = propsDoc.getMap(docId);
		const journalValue = docPropsMap?.get('journal');

		if (journalValue === date && isValidJournalString(journalValue)) {
			const title = page.get('title') || date;
			return { id: docId, title };
		}
	}

	return null;
}

/**
 * journalCreateHandler: 创建新日记
 */
export async function journalCreateHandler(params: {
	date?: string;
	content?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const journalDate = formatJournalDate(params.date);
	const title = journalDate;

	try {
		await joinWorkspace(socket, workspaceId);

		const existingJournal = await findJournalByDate(socket, workspaceId, journalDate);
		if (existingJournal) {
			return {
				success: true,
				exists: true,
				message: `日期 ${journalDate} 的日记已存在`,
				docId: existingJournal.id,
				title: existingJournal.title,
				date: journalDate
			};
		}

		const result = await createDocFromMarkdownCore({
			workspaceId,
			title,
			markdown: params.content || '',
			tags: undefined,
			folder: undefined
		});

		await setJournalPropertyInDocProperties(socket, workspaceId, result.docId, journalDate);

		return {
			success: true,
			exists: false,
			message: `已创建日记 ${journalDate}`,
			docId: result.docId,
			title,
			date: journalDate
		};
	} finally {
	}
}

/**
 * journalAppendHandler: 追加内容到日记
 * 使用与 createDocFromMarkdownCore 相同的 markdown 处理方式
 */
export async function journalAppendHandler(params: {
	id?: string;
	date?: string;
	content: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let content = params.content;
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	if (!content || !content.trim()) {
		return {
			success: true,
			message: '无内容追加'
		};
	}

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`日期 ${journalDate} 的日记不存在，请先创建`);
			}
			targetDocId = journal.id;
		}

		const {
			doc: doc,
			exists: snapExists,
			prevSV: prevSV
		} = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapExists) {
			throw new Error(`文档 ${targetDocId} 不存在`);
		}

		const blocks = doc.getMap('blocks');

		const parsedMarkdown = parseMarkdownToOperations(content);
		const operations = parsedMarkdown.operations;

		if (operations.length === 0) {
			return {
				success: true,
				message: '无有效内容可追加'
			};
		}

		const noteId = ensureNoteBlock(blocks);
		const noteBlock = findBlockById(blocks, noteId);
		if (!noteBlock) {
			throw new Error('无法解析 note block');
		}

		// 使用与 createDocFromMarkdownCore 相同的处理方式
		let lastInsertedBlockId: string | undefined;
		let appendedCount = 0;

		for (const operation of operations) {
			const placement = lastInsertedBlockId
				? { afterBlockId: lastInsertedBlockId }
				: { parentId: noteId };

			// strict: false 跳过 URL 验证
			const input = markdownOperationToAppendInput(
				operation,
				targetDocId,
				workspaceId,
				false,
				placement
			);
			try {
				const normalized = normalizeAppendBlockInput(input);
				const context = resolveInsertContext(blocks, normalized);
				const { blockId, block, extraBlocks } = createBlock(normalized);
				blocks.set(blockId, block);
				if (Array.isArray(extraBlocks)) {
					for (const extra of extraBlocks) blocks.set(extra.blockId, extra.block);
				}
				if (context.insertIndex >= context.children.length) {
					context.children.push([blockId]);
				} else {
					context.children.insert(context.insertIndex, [blockId]);
				}
				lastInsertedBlockId = blockId;
			} catch {
				// 跳过验证失败的 blocks
			}
			appendedCount++;
		}

		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			success: true,
			message: `已追加 ${appendedCount} 个内容块到日记`,
			docId: targetDocId
		};
	} finally {
	}
}

/**
 * journalInfoHandler: 获取日记详情
 */
export async function journalInfoHandler(params: {
	id?: string;
	date?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`日期 ${journalDate} 的日记不存在`);
			}
			targetDocId = journal.id;
		}

		const { doc: wsDoc } = await fetchYDoc(socket, workspaceId, workspaceId);
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		let docTitle = '';
		let createDate: number | undefined;
		let updateDate: number | undefined;

		if (pages) {
			for (let i = 0; i < pages.length; i++) {
				const page = pages.get(i);
				if (page instanceof Y.Map && page.get('id') === targetDocId) {
					docTitle = page.get('title') || '';
					createDate = page.get('createDate');
					updateDate = page.get('updateDate');
					break;
				}
			}
		}

		const journalDate = await getJournalPropertyFromDocProperties(
			socket,
			workspaceId,
			targetDocId
		);

		const { doc: doc, exists: snapExists } = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapExists) {
			throw new Error(`文档 ${targetDocId} 不存在`);
		}

		const collected = collectDocForMarkdown(doc);
		const rendered = renderBlocksToMarkdown({
			rootBlockIds: collected.rootBlockIds,
			blocksById: collected.blocksById
		});

		return {
			id: targetDocId,
			title: docTitle,
			date: journalDate,
			createdAt: createDate ? new Date(createDate).toLocaleString('zh-CN') : undefined,
			updatedAt: updateDate ? new Date(updateDate).toLocaleString('zh-CN') : undefined,
			markdown: rendered.markdown,
			markdownWarnings: rendered.warnings,
			markdownStats: rendered.stats
		};
	} finally {
	}
}

/**
 * journalUpdateHandler: 完整更新日记内容
 * 使用与 createDocFromMarkdownCore 相同的 markdown 处理方式
 */
export async function journalUpdateHandler(params: {
	id?: string;
	date?: string;
	content?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	let content = params.content || '';
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	let targetDocId = params.id;

	try {
		await joinWorkspace(socket, workspaceId);

		if (!targetDocId) {
			const journalDate = formatJournalDate(params.date);
			const journal = await findJournalByDate(socket, workspaceId, journalDate);
			if (!journal) {
				throw new Error(`日期 ${journalDate} 的日记不存在，请先创建`);
			}
			targetDocId = journal.id;
		}

		const {
			doc: doc,
			exists: docExists,
			prevSV
		} = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!docExists) {
			throw new Error(`文档 ${targetDocId} 不存在`);
		}

		const blocks = doc.getMap('blocks');

		let noteBlock: Y.Map<any> | undefined;
		for (const [, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:note') {
				noteBlock = block;
				break;
			}
		}

		if (!noteBlock) {
			throw new Error('文档结构异常：找不到 note block');
		}

		const noteChildren = noteBlock.get('sys:children');
		const childIds: string[] = [];
		if (noteChildren instanceof Y.Array) {
			for (let i = 0; i < noteChildren.length; i++) {
				const child = noteChildren.get(i);
				if (typeof child === 'string') {
					childIds.push(child);
				} else if (Array.isArray(child)) {
					childIds.push(...child.filter((c: any) => typeof c === 'string'));
				}
			}
		}

		for (const childId of childIds) {
			blocks.delete(childId);
		}

		if (noteChildren instanceof Y.Array) {
			noteChildren.delete(0, noteChildren.length);
		}

		const parsedMarkdown = parseMarkdownToOperations(content);
		const operations = parsedMarkdown.operations;

		let lastInsertedBlockId: string | undefined;
		let appendedCount = 0;

		if (operations.length > 0) {
			const noteId = noteBlock.get('sys:id');
			for (const operation of operations) {
				const placement = lastInsertedBlockId
					? { afterBlockId: lastInsertedBlockId }
					: { parentId: noteId };

				// strict: false 跳过 URL 验证
				const input = markdownOperationToAppendInput(
					operation,
					targetDocId,
					workspaceId,
					false,
					placement
				);
				try {
					const normalized = normalizeAppendBlockInput(input);
					const context = resolveInsertContext(blocks, normalized);
					const { blockId, block, extraBlocks } = createBlock(normalized);
					blocks.set(blockId, block);
					if (Array.isArray(extraBlocks)) {
						for (const extra of extraBlocks) blocks.set(extra.blockId, extra.block);
					}
					if (context.insertIndex >= context.children.length) {
						context.children.push([blockId]);
					} else {
						context.children.insert(context.insertIndex, [blockId]);
					}
					lastInsertedBlockId = blockId;
				} catch {
					// 跳过验证失败的 blocks
				}
				appendedCount++;
			}
		}

		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			success: true,
			message: `已更新日记 ${targetDocId}`,
			docId: targetDocId
		};
	} finally {
	}
}
