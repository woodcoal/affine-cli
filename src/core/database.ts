/**
 * 数据库核心模块
 * 处理 Affine 数据库的增删改查操作
 *
 * 主要功能：
 * - 数据库行管理（增删改查）
 * - 数据库列定义读取
 * - 数据库视图管理
 * - 筛选条件处理
 * - 数据导入导出
 */

import * as Y from 'yjs';
import { getWorkspaceId } from '../utils/config.js';
import { createWorkspaceSocket, joinWorkspace, loadDoc, fetchYDoc, updateYDoc } from '../utils/wsClient.js';
import { generateId } from '../utils/misc.js';
import { TAG_COLORS } from './constants.js';

/**
 * 数据库列定义类型
 * 用于描述数据库中每个列的结构信息
 */
export interface DatabaseColumnDef {
	id: string; // 列唯一标识符
	name: string; // 列名称
	type: string; // 列类型（title, rich-text, number, select, multi-select, date, checkbox, progress, link）
	options: Array<{ id: string; value: string; color: string }>; // 选项列表（用于 select/multi-select 类型）
	raw?: any; // 原始列定义对象
}

/**
 * 数据库视图列定义类型
 * 描述视图中的列配置信息
 */
export interface DatabaseViewColumnDef {
	id: string; // 列唯一标识符
	name: string | null; // 列名称（可能为 null）
	hidden: boolean; // 是否隐藏
	width: number | null; // 列宽度
}

/**
 * 数据库视图定义类型
 * 描述数据库视图的完整配置
 */
export interface DatabaseViewDef {
	id: string; // 视图唯一标识符
	name: string; // 视图名称
	mode: string; // 视图模式（table, kanban 等）
	columns: DatabaseViewColumnDef[]; // 视图中的列配置列表
	columnIds: string[]; // 列 ID 列表（用于快速访问）
	groupBy: {
		// 分组配置（用于 kanban 视图）
		columnId: string | null;
		name: string | null;
		type: string | null;
	} | null;
	header: {
		// 头部配置
		titleColumn: string | null; // 标题列 ID
		iconColumn: string | null; // 图标列 ID
	};
}

/**
 * 数据库列查询结构
 * 优化列查找效率的索引结构
 */
export interface DatabaseColumnLookup {
	columnDefs: DatabaseColumnDef[]; // 所有列定义列表
	colById: Map<string, DatabaseColumnDef>; // 按 ID 索引的列映射
	colByName: Map<string, DatabaseColumnDef>; // 按名称索引的列映射
	colByNameLower: Map<string, DatabaseColumnDef>; // 按小写名称索引的列映射（用于不区分大小写查找）
	titleCol: DatabaseColumnDef | null; // Title 列定义
}

/**
 * 数据库文档上下文
 * 包含操作数据库所需的所有状态信息
 */
export interface DatabaseDocContext extends DatabaseColumnLookup {
	socket: any; // WebSocket 连接
	doc: Y.Doc; // Yjs 文档对象
	prevSV: Uint8Array; // 之前的状态向量（用于增量更新）
	blocks: Y.Map<any>; // 文档中的所有 block
	dbBlock: Y.Map<any>; // 数据库 block 本身
	cellsMap: Y.Map<any>; // 数据库单元格映射
	rowIds: string[]; // 数据库行 ID 列表
}

/* ============================================================================
 * 可复用辅助函数
 * ============================================================================ */

/**
 * 创建 Affine block 的基本属性
 *
 * @param id - block 唯一 ID
 * @param flavour - block 类型（如 'affine:page', 'affine:note', 'affine:database'）
 * @param parentId - 父 block ID
 * @returns 配置好的 Y.Map 对象
 */
function createBlockBase(id: string, flavour: string, parentId: string | null = null): Y.Map<any> {
	const block = new Y.Map<any>();
	block.set('sys:id', id);
	block.set('sys:flavour', flavour);
	block.set('sys:version', flavour === 'affine:page' ? 2 : 1);
	block.set('sys:parent', parentId);
	block.set('sys:children', new Y.Array<string>());
	return block;
}

/**
 * 创建数据库列定义
 *
 * @param columnId - 列唯一 ID
 * @param name - 列名称
 * @param type - 列类型
 * @param width - 列宽度
 * @param options - 选项列表（用于 select/multi-select 类型）
 * @returns 配置好的列定义 Y.Map
 */
function createColumnDefinition(
	columnId: string,
	name: string,
	type: string,
	width?: number,
	options?: string[]
): Y.Map<any> {
	const colDef = new Y.Map<any>();
	colDef.set('id', columnId);
	colDef.set('name', name);
	colDef.set('type', type);

	// 根据类型设置额外属性
	if (type === 'number') {
		const data = new Y.Map<any>();
		data.set('decimal', 0);
		data.set('format', 'number');
		colDef.set('data', data);
	} else if (type === 'progress') {
		const data = new Y.Map<any>();
		colDef.set('data', data);
	} else if ((type === 'select' || type === 'multi-select') && options?.length) {
		const data = new Y.Map<any>();
		const opts = new Y.Array<any>();
		for (let i = 0; i < options.length; i++) {
			const optMap = new Y.Map<any>();
			const optId = generateId(8, 'opt');
			optMap.set('id', optId);
			optMap.set('value', options[i]);
			optMap.set('color', TAG_COLORS[i % TAG_COLORS.length]);
			opts.push([optMap]);
		}
		data.set('options', opts);
		colDef.set('data', data);
	}

	!width && (width = getDefaultColumnWidth(type));
	colDef.set('width', width);

	return colDef;
}

/**
 * 创建视图列配置
 *
 * @param columnId - 对应的列 ID
 * @param hide - 是否隐藏
 * @param width - 列宽度
 * @returns 配置好的视图列 Y.Map
 */
function createViewColumn(columnId: string, hide: boolean = false, type: string): Y.Map<any> {
	const viewCol = new Y.Map<any>();
	viewCol.set('id', columnId);
	viewCol.set('hide', hide);
	viewCol.set('width', getDefaultColumnWidth(type || 'rich-text'));
	return viewCol;
}

/**
 * 创建数据库行 block
 *
 * @param rowBlockId - 行 block ID
 * @param dbBlockId - 所属数据库 block ID
 * @param title - 行标题文本
 * @param linkedDocId - 可选的关联文档 ID
 * @returns 配置好的行 block Y.Map
 */
function createDatabaseRowBlock(
	rowBlockId: string,
	dbBlockId: string,
	title: string,
	linkedDocId?: string
): Y.Map<any> {
	const rowBlock = new Y.Map<any>();
	rowBlock.set('sys:id', rowBlockId);
	rowBlock.set('sys:flavour', 'affine:paragraph');
	rowBlock.set('sys:version', 1);
	rowBlock.set('sys:parent', dbBlockId);
	rowBlock.set('sys:children', new Y.Array<string>());
	rowBlock.set('prop:type', 'text');

	// 设置标题或关联文档
	if (linkedDocId) {
		rowBlock.set('prop:text', makeLinkedDocText(linkedDocId));
	} else {
		rowBlock.set('prop:text', makeText(title));
	}

	return rowBlock;
}

// /**
//  * 从数据行中推断列类型
//  *
//  * @param key - 列键名
//  * @param values - 该列的所有值
//  * @returns 推断的列类型字符串
//  */
// function inferColumnType(key: string, values: unknown[]): string {
// 	// title 列
// 	if (key.toLowerCase() === 'title') return 'title';

// 	// 过滤空值
// 	const nonEmptyValues = values.filter((v) => v !== undefined && v !== null && v !== '');
// 	if (nonEmptyValues.length === 0) return 'rich-text';

// 	// 检测布尔值
// 	if (nonEmptyValues.every((v) => typeof v === 'boolean')) return 'checkbox';

// 	// 检测数字
// 	if (nonEmptyValues.every((v) => typeof v === 'number' || !isNaN(Number(v)))) return 'number';

// 	// 检测日期
// 	if (nonEmptyValues.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number'))
// 		return 'date';

// 	// 检测 URL
// 	if (
// 		nonEmptyValues.every(
// 			(v) => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
// 		)
// 	)
// 		return 'link';

// 	// 检测进度（0-100 的数字）
// 	if (
// 		nonEmptyValues.every((v) => {
// 			const n = Number(v);
// 			return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
// 		})
// 	)
// 		return 'progress';

// 	// 检测多选（数组）
// 	if (nonEmptyValues.every((v) => Array.isArray(v))) return 'multi-select';

// 	// 检测选项（重复值较少）
// 	const uniqueValues = new Set(nonEmptyValues.map(String));
// 	if (uniqueValues.size <= 20 && uniqueValues.size < nonEmptyValues.length * 0.5) {
// 		return 'select';
// 	}

// 	return 'rich-text';
// }

/**
 * 获取列类型的默认宽度
 *
 * @param type - 列类型
 * @returns 默认宽度值
 */
function getDefaultColumnWidth(type: string): number {
	switch (type) {
		case 'title':
			return 250;
		case 'number':
			return 75;
		case 'date':
			return 100;
		case 'link':
			return 200;
		case 'progress':
			return 150;
		case 'select':
		case 'multi-select':
			return 200;
		case 'checkbox':
			return 50;
		case 'rich-text':
			return 250;
		default:
			return 150;
	}
}

/* ============================================================================
 * 文本处理辅助函数
 * ============================================================================ */

/**
 * 将文本字符串或 delta 数组转换为 Y.Text 对象
 *
 * Affine 中的文本使用 Y.Text 类型存储，支持富文本 delta 格式
 *
 * @param content - 输入内容，可以是：
 *   - 普通字符串：直接插入为纯文本
 *   - delta 数组：用于包含样式属性的富文本
 *     格式：[{ insert: string, attributes?: { ... } }, ...]
 * @returns Y.Text 对象
 *
 * @example
 * // 普通文本
 * makeText("Hello World")
 *
 * // 富文本
 * makeText([{ insert: "Bold", attributes: { bold: true } }])
 */
function makeText(content: string | any[]): Y.Text {
	const yText = new Y.Text();
	if (typeof content === 'string') {
		if (content.length > 0) {
			yText.insert(0, content);
		}
		return yText;
	}
	let offset = 0;
	for (const delta of content) {
		if (!delta.insert) continue;
		yText.insert(offset, delta.insert, delta.attributes ? { ...delta.attributes } : {});
		offset += delta.insert.length;
	}
	return yText;
}

/**
 * 创建关联文档的文本对象
 *
 * 用于在数据库行中创建指向其他文档的链接（Linked Page）
 * 内部使用零宽字符 + reference 属性实现
 *
 * @param docId - 要关联的文档 ID
 * @returns 包含关联引用的 Y.Text 对象
 *
 * @example
 * const text = makeLinkedDocText("abc123def");
 * // 结果文本包含一个指向 "abc123def" 文档的引用
 */
function makeLinkedDocText(docId: string): Y.Text {
	const delta = [
		{
			insert: '\u200B', // 零宽字符，作为链接的可视占位符
			attributes: { reference: { type: 'LinkedPage', pageId: docId } }
		}
	];
	return makeText(delta);
}

/**
 * 从数据库行 block 中读取关联的文档 ID
 *
 * 解析行 block 中的文本，提取 LinkedPage 类型的引用
 *
 * @param rowBlock - 数据库行 block（Y.Map 对象）
 * @returns 关联的文档 ID，如果不存在则返回 null
 *
 * @example
 * const linkedDocId = readLinkedDocId(rowBlock);
 * if (linkedDocId) {
 *   console.log("This row links to:", linkedDocId);
 * }
 */
function readLinkedDocId(rowBlock: Y.Map<any>): string | null {
	const propText = rowBlock.get('prop:text');
	if (!(propText instanceof Y.Text)) return null;
	const delta = propText.toDelta();
	if (!Array.isArray(delta)) return null;
	for (const d of delta) {
		if (d.attributes?.reference?.type === 'LinkedPage' && d.attributes.reference.pageId) {
			return d.attributes.reference.pageId;
		}
	}
	return null;
}

/**
 * 将值转换为字符串
 *
 * 处理 Y.Text 对象和其他类型的值，统一转换为字符串输出
 *
 * @param value - 输入值，支持 Y.Text、字符串或其他类型
 * @returns 字符串表示
 */
function asText(value: unknown): string {
	if (value instanceof Y.Text) return value.toString();
	if (typeof value === 'string') return value;
	return '';
}

/**
 * 从 Y.Array 中提取子元素 ID
 *
 * Y.Array 中的元素可能是字符串或数组，需要统一提取
 * 用于获取 block 的子元素 ID 列表
 *
 * @param value - Y.Array 对象或普通数组
 * @returns 子元素 ID 字符串数组
 *
 * @example
 * // Y.Array: ["child1", "child2"]
 * // 或嵌套数组: [["child1"], ["child2"]]
 * childIdsFrom(children) // ["child1", "child2"]
 */
function childIdsFrom(value: unknown): string[] {
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
 * 检查是否为 title 别名键
 *
 * 用于识别可能表示 title 的键名（如 "title" 的各种变体）
 *
 * @param value - 要检查的键名
 * @returns 是否为 title 别名
 */
function isTitleAliasKey(value: string): boolean {
	return value.trim().toLowerCase() === 'title';
}

/**
 * 读取数据库列定义
 *
 * 从数据库 block 的 prop:columns 属性中解析列定义列表
 * 支持 Y.Map 和普通对象两种格式
 *
 * @param dbBlock - 数据库 block 对象（Y.Map）
 * @returns 数据库列定义数组
 *
 * @example
 * const columns = readColumnDefs(dbBlock);
 * // 返回: [{ id: "col1", name: "标题", type: "title", options: [] }, ...]
 */
function readColumnDefs(dbBlock: Y.Map<any>): DatabaseColumnDef[] {
	const columnsRaw = dbBlock.get('prop:columns');
	const defs: DatabaseColumnDef[] = [];
	if (!(columnsRaw instanceof Y.Array)) return defs;
	columnsRaw.forEach((col: any) => {
		const id = col instanceof Y.Map ? col.get('id') : col?.id;
		const name = col instanceof Y.Map ? col.get('name') : col?.name;
		const type = col instanceof Y.Map ? col.get('type') : col?.type;
		const data = col instanceof Y.Map ? col.get('data') : col?.data;
		let options: Array<{ id: string; value: string; color: string }> = [];
		if (data) {
			const rawOpts = data instanceof Y.Map ? data.get('options') : data?.options;
			if (Array.isArray(rawOpts)) {
				options = rawOpts.map((o: any) => ({
					id: String(o?.id ?? o?.get?.('id') ?? ''),
					value: String(o?.value ?? o?.get?.('value') ?? ''),
					color: String(o?.color ?? o?.get?.('color') ?? '')
				}));
			} else if (rawOpts instanceof Y.Array) {
				rawOpts.forEach((o: any) => {
					options.push({
						id: String(o instanceof Y.Map ? o.get('id') : (o?.id ?? '')),
						value: String(o instanceof Y.Map ? o.get('value') : (o?.value ?? '')),
						color: String(o instanceof Y.Map ? o.get('color') : (o?.color ?? ''))
					});
				});
			}
		}
		if (id) {
			defs.push({
				id: String(id),
				name: String(name || ''),
				type: String(type || 'rich-text'),
				options,
				raw: col
			});
		}
	});
	return defs;
}

/**
 * 读取数据库视图定义列表
 *
 * 从数据库 block 的 prop:views 属性中解析所有视图配置
 * 包括视图名称、模式、列配置、分组设置等
 *
 * @param dbBlock - 数据库 block 对象
 * @param lookup - 列查询结构（包含列 ID 到列定义的映射）
 * @returns 数据库视图定义数组
 *
 * @example
 * const views = readDatabaseViewDefs(dbBlock, lookup);
 * // 返回: [{ id: "view1", name: "Table View", mode: "table", columns: [...], groupBy: null }, ...]
 */
function readDatabaseViewDefs(
	dbBlock: Y.Map<any>,
	lookup: DatabaseColumnLookup
): DatabaseViewDef[] {
	const viewsRaw = dbBlock.get('prop:views');
	const views: DatabaseViewDef[] = [];
	if (!(viewsRaw instanceof Y.Array)) return views;
	viewsRaw.forEach((view: any) => {
		const id = view instanceof Y.Map ? view.get('id') : view?.id;
		if (!id) return;
		const columnsRaw = view instanceof Y.Map ? view.get('columns') : view?.columns;
		const headerRaw = view instanceof Y.Map ? view.get('header') : view?.header;
		const groupByRaw = view instanceof Y.Map ? view.get('groupBy') : view?.groupBy;
		const columns: DatabaseViewColumnDef[] = databaseArrayValues(columnsRaw)
			.map((entry: any) => {
				const columnId = entry instanceof Y.Map ? entry.get('id') : entry?.id;
				if (!columnId || typeof columnId !== 'string') return null;
				const columnDef = lookup.colById.get(columnId) || null;
				const hidden = entry instanceof Y.Map ? entry.get('hide') : entry?.hide;
				const width = entry instanceof Y.Map ? entry.get('width') : entry?.width;
				return {
					id: columnId,
					name: columnDef?.name || null,
					hidden: hidden === true,
					width: typeof width === 'number' ? width : null
				};
			})
			.filter((entry): entry is DatabaseViewColumnDef => entry !== null);
		views.push({
			id: String(id),
			name: String((view instanceof Y.Map ? view.get('name') : view?.name) || ''),
			mode: String((view instanceof Y.Map ? view.get('mode') : view?.mode) || ''),
			columns,
			columnIds: columns.map((column) => column.id),
			groupBy: groupByRaw
				? {
						columnId:
							typeof (groupByRaw as any)?.columnId === 'string'
								? (groupByRaw as any).columnId
								: null,
						name:
							typeof (groupByRaw as any)?.name === 'string'
								? (groupByRaw as any).name
								: null,
						type:
							typeof (groupByRaw as any)?.type === 'string'
								? (groupByRaw as any).type
								: null
					}
				: null,
			header: {
				titleColumn:
					typeof (headerRaw as any)?.titleColumn === 'string'
						? (headerRaw as any).titleColumn
						: null,
				iconColumn:
					typeof (headerRaw as any)?.iconColumn === 'string'
						? (headerRaw as any).iconColumn
						: null
			}
		});
	});
	return views;
}

/**
 * 从数组值中提取元素列表
 *
 * 统一处理 Y.Array 和普通数组的转换
 *
 * @param value - 输入值（Y.Array 或普通数组）
 * @returns 元素数组
 */
function databaseArrayValues(value: unknown): unknown[] {
	if (value instanceof Y.Array) {
		const entries: unknown[] = [];
		value.forEach((entry: unknown) => entries.push(entry));
		return entries;
	}
	if (Array.isArray(value)) return value;
	return [];
}

/**
 * 构建列查询结构
 *
 * 为列定义创建多种索引结构，提高查找效率
 * - colById: 按列 ID 索引
 * - colByName: 按列名称索引（区分大小写）
 * - colByNameLower: 按小写列名称索引（不区分大小写）
 * - titleCol: Title 类型列
 *
 * @param columnDefs - 数据库列定义数组
 * @returns 包含多种索引的查询结构
 */
function buildDatabaseColumnLookup(columnDefs: DatabaseColumnDef[]): DatabaseColumnLookup {
	const colById = new Map<string, DatabaseColumnDef>();
	const colByName = new Map<string, DatabaseColumnDef>();
	const colByNameLower = new Map<string, DatabaseColumnDef>();
	let titleCol: DatabaseColumnDef | null = null;
	for (const col of columnDefs) {
		colById.set(col.id, col);
		if (col.name) {
			colByName.set(col.name, col);
			colByNameLower.set(col.name.trim().toLowerCase(), col);
		}
		if (!titleCol && col.type === 'title') titleCol = col;
	}
	return { columnDefs, colById, colByName, colByNameLower, titleCol };
}

/**
 * 查找数据库列
 *
 * 通过键名查找列定义，支持 ID、名称（区分大小写）、名称（小写不区分大小写）三种方式
 *
 * @param key - 查找键（列名或列 ID）
 * @param lookup - 列查询结构
 * @returns 找到的列定义，未找到则返回 null
 */
function findDatabaseColumn(key: string, lookup: DatabaseColumnLookup): DatabaseColumnDef | null {
	return (
		lookup.colByName.get(key) ||
		lookup.colById.get(key) ||
		lookup.colByNameLower.get(key.trim().toLowerCase()) ||
		null
	);
}

/**
 * 获取可用列名称列表
 *
 * 生成逗号分隔的可用列名称字符串，用于错误提示
 *
 * @param lookup - 列查询结构
 * @returns 可用列名称字符串（如 "title, 名称, 状态"）
 */
function availableDatabaseColumns(lookup: DatabaseColumnLookup): string {
	return ['title', ...lookup.columnDefs.map((col) => col.name || col.id)].join(', ');
}

/**
 * 获取数据库行 ID 列表
 *
 * 从数据库 block 的 sys:children 属性中提取所有行 ID
 *
 * @param dbBlock - 数据库 block 对象
 * @returns 行 ID 字符串数组
 */
export function getDatabaseRowIds(dbBlock: Y.Map<any>): string[] {
	return childIdsFrom(dbBlock.get('sys:children'));
}

/**
 * 读取数据库行标题
 *
 * 从行 block 的 prop:text 属性中提取标题文本
 *
 * @param rowBlock - 行 block 对象
 * @returns 标题文本字符串
 */
function readDatabaseRowTitle(rowBlock: Y.Map<any>): string {
	return asText(rowBlock.get('prop:text'));
}

// /**
//  * 解析数据库标题值
//  *
//  * 从单元格数据中解析出标题值，优先级：
//  * 1. Title 列的值
//  * 2. 键名为 "title" 的值
//  * 3. 列名为 "title" 的列的值
//  *
//  * @param cells - 行单元格数据对象
//  * @param lookup - 列查询结构
//  * @returns 解析出的标题字符串
//  */
// function resolveDatabaseTitleValue(
// 	cells: Record<string, unknown>,
// 	lookup: DatabaseColumnLookup
// ): string {
// 	// 优先使用 Title 列
// 	if (lookup.titleCol) {
// 		const value = cells[lookup.titleCol.name] ?? cells[lookup.titleCol.id];
// 		if (value !== undefined) return String(value ?? '');
// 	}
// 	// 查找 title 别名键
// 	for (const [key, value] of Object.entries(cells)) {
// 		if (isTitleAliasKey(key)) return String(value ?? '');
// 	}
// 	// 查找名为 title 的列
// 	const namedTitleColumn = lookup.colByNameLower.get('title');
// 	if (namedTitleColumn) {
// 		const value = cells[namedTitleColumn.name] ?? cells[namedTitleColumn.id];
// 		if (value !== undefined) return String(value ?? '');
// 	}
// 	return '';
// }

/**
 * 确保数据库行单元格存在
 *
 * 获取指定行的单元格映射，如不存在则创建
 *
 * @param cellsMap - 数据库的单元格映射
 * @param rowBlockId - 行 block ID
 * @returns 行单元格映射（Y.Map）
 */
function ensureDatabaseRowCells(cellsMap: Y.Map<any>, rowBlockId: string): Y.Map<any> {
	const existing = cellsMap.get(rowBlockId);
	if (existing instanceof Y.Map) return existing;
	const rowCells = new Y.Map<any>();
	cellsMap.set(rowBlockId, rowCells);
	return rowCells;
}

/**
 * 获取数据库行 block
 *
 * 验证并获取指定 ID 的行 block，确保它属于当前数据库
 *
 * @param blocks - 文档的 blocks 映射
 * @param dbBlock - 数据库 block 对象
 * @param databaseBlockId - 数据库 block ID
 * @param rowBlockId - 行 block ID
 * @returns 行 block 对象
 * @throws 如果行不存在或不属于数据库
 */
function getDatabaseRowBlock(
	blocks: Y.Map<any>,
	dbBlock: Y.Map<any>,
	databaseBlockId: string,
	rowBlockId: string
): Y.Map<any> {
	const rowBlock = findBlockById(blocks, rowBlockId);
	if (!rowBlock) throw new Error(`Row block '${rowBlockId}' not found`);
	const parentId = rowBlock.get('sys:parent');
	const isDatabaseChild = getDatabaseRowIds(dbBlock).includes(rowBlockId);
	if (parentId !== databaseBlockId && !isDatabaseChild)
		throw new Error(
			`Row block '${rowBlockId}' does not belong to database '${databaseBlockId}'`
		);
	if (rowBlock.get('sys:flavour') !== 'affine:paragraph')
		throw new Error(`Row block '${rowBlockId}' is not a database row paragraph`);
	return rowBlock;
}

/**
 * 通过 ID 查找 block
 *
 * @param blocks - blocks 映射
 * @param blockId - block ID
 * @returns 找到的 block 或 null
 */
function findBlockById(blocks: Y.Map<any>, blockId: string): Y.Map<any> | null {
	const value = blocks.get(blockId);
	return value instanceof Y.Map ? value : null;
}

/**
 * 递归收集所有后代 block ID
 *
 * @param blocks - blocks 映射
 * @param blockIds - 起始 block ID 数组
 * @returns 包含所有后代 block 的 ID 数组
 */
function collectDescendantBlockIds(blocks: Y.Map<any>, blockIds: string[]): string[] {
	const collected: string[] = [];
	for (const blockId of blockIds) {
		const block = findBlockById(blocks, blockId);
		if (!block) continue;
		const children = block.get('sys:children');
		if (children instanceof Y.Array) {
			const childIds = childIdsFrom(children);
			collected.push(...collectDescendantBlockIds(blocks, childIds));
		}
	}
	return [...blockIds, ...collected];
}

/**
 * 获取子元素在数组中的索引位置
 *
 * @param array - Y.Array 对象
 * @param item - 要查找的元素
 * @returns 索引位置，未找到返回 -1
 */
function indexOfChild(array: Y.Array<any>, item: string): number {
	for (let i = 0; i < array.length; i++) {
		const entry = array.get(i);
		if (typeof entry === 'string' && entry === item) return i;
		if (Array.isArray(entry) && entry.includes(item)) return i;
	}
	return -1;
}

/**
 * 解析 select 选项 ID
 *
 * 根据选项值查找对应的 ID，如不存在且 createOption 为 true 则创建新选项
 *
 * @param col - 列定义
 * @param value - 选项值
 * @param createOption - 是否在选项不存在时创建新选项
 * @returns 选项 ID
 * @throws 选项不存在且 createOption 为 false
 */
function resolveSelectOptionId(
	col: DatabaseColumnDef,
	value: string,
	createOption: boolean
): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	for (const opt of col.options) {
		if (opt.value.toLowerCase() === trimmed.toLowerCase()) return opt.id;
	}
	if (!createOption) {
		throw new Error(`Option '${value}' not found in column '${col.name}'`);
	}
	// 创建新选项
	const newId = generateId(8, 'opt');
	const newOption = {
		id: newId,
		value: trimmed,
		color: TAG_COLORS[col.options.length % TAG_COLORS.length]
	};
	const data = col.raw?.get?.('data');
	if (data instanceof Y.Map) {
		const opts = data.get('options');
		if (opts instanceof Y.Array) {
			const optMap = new Y.Map<any>();
			optMap.set('id', newId);
			optMap.set('value', trimmed);
			optMap.set('color', newOption.color);
			opts.push([optMap]);
		}
	}
	col.options.push(newOption);
	return newId;
}

/**
 * 解码数据库单元格值
 *
 * 将 Affine 内部存储格式转换为可读的 JavaScript 值
 *
 * @param col - 列定义
 * @param cellEntry - 单元格条目（Y.Map）
 * @returns 解码后的值
 *
 * @example
 * // rich-text: 返回字符串
 * // number: 返回数字
 * // checkbox: 返回布尔值
 * // select: 返回选项文本
 * // multi-select: 返回选项文本数组
 * // date: 返回 ISO 日期字符串
 * // progress: 返回 0-100 数字
 * // link: 返回 URL 字符串
 */
function decodeDatabaseCellValue(col: DatabaseColumnDef, cellEntry: Y.Map<any>): any {
	if (!cellEntry) return null;
	const value = cellEntry.get('value');
	if (value === undefined) return null;
	switch (col.type) {
		case 'rich-text':
		case 'title':
			if (value instanceof Y.Text) return value.toString();
			if (Array.isArray(value)) {
				return value.map((d: any) => d.insert || '').join('');
			}
			return String(value ?? '');
		case 'number':
			return typeof value === 'number' ? value : Number(value) || 0;
		case 'checkbox':
			return Boolean(value);
		case 'select':
			if (typeof value === 'string') {
				const opt = col.options.find((o) => o.id === value);
				return opt?.value || value;
			}
			return value;
		case 'multi-select':
			if (value instanceof Y.Array) {
				const ids: string[] = [];
				value.forEach((id: string) => ids.push(id));
				return ids.map((id) => {
					const opt = col.options.find((o) => o.id === id);
					return opt?.value || id;
				});
			}
			return [];
		case 'date':
			return typeof value === 'number' ? new Date(value).toISOString() : null;
		case 'progress':
			return typeof value === 'number' ? value : Number(value) || 0;
		case 'link':
			return String(value ?? '');
		default:
			return value;
	}
}

/**
 * 写入数据库单元格值
 *
 * 将 JavaScript 值转换为 Affine 内部存储格式并写入单元格
 *
 * @param rowCells - 行单元格映射（Y.Map）
 * @param col - 列定义
 * @param value - 要写入的值
 * @param createOption - 是否为 select/multi-select 类型自动创建新选项
 *
 * @throws 当值格式不符合列类型要求时抛出错误
 *
 * @example
 * // 写入文本
 * writeDatabaseCellValue(rowCells, textColumn, "Hello", false);
 *
 * // 写入数字
 * writeDatabaseCellValue(rowCells, numberColumn, 42, false);
 *
 * // 写入选项（自动创建选项）
 * writeDatabaseCellValue(rowCells, selectColumn, "进行中", true);
 */
function writeDatabaseCellValue(
	rowCells: Y.Map<any>,
	col: DatabaseColumnDef,
	value: unknown,
	createOption: boolean
) {
	const cellValue = new Y.Map<any>();
	cellValue.set('columnId', col.id);
	switch (col.type) {
		case 'rich-text':
		case 'title':
			cellValue.set('value', makeText(String(value ?? '')));
			break;
		case 'number': {
			const num = Number(value);
			if (Number.isNaN(num))
				throw new Error(
					`Column "${col.name}": expected a number, got ${JSON.stringify(value)}`
				);
			cellValue.set('value', num);
			break;
		}
		case 'progress': {
			const num = Number(value);
			if (!Number.isNaN(num)) {
				const clamped = Math.max(0, Math.min(100, Math.floor(num)));
				cellValue.set('value', clamped);
			}
			break;
		}
		case 'checkbox': {
			let bool: boolean;
			if (typeof value === 'boolean') bool = value;
			else if (typeof value === 'string') {
				const lower = value.toLowerCase().trim();
				bool = lower === 'true' || lower === '1' || lower === 'yes';
			} else bool = !!value;
			cellValue.set('value', bool);
			break;
		}
		case 'select':
			cellValue.set('value', resolveSelectOptionId(col, String(value ?? ''), createOption));
			break;
		case 'multi-select': {
			const labels = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
			const optionIds = new Y.Array<string>();
			optionIds.push(labels.map((label) => resolveSelectOptionId(col, label, createOption)));
			cellValue.set('value', optionIds);
			break;
		}
		case 'date': {
			const numericValue =
				typeof value === 'number'
					? value
					: Number.isNaN(Number(value))
						? Date.parse(String(value))
						: Number(value);
			if (!Number.isFinite(numericValue))
				throw new Error(
					`Column "${col.name}": expected a timestamp-compatible value, got ${JSON.stringify(value)}`
				);
			cellValue.set('value', numericValue);
			break;
		}
		case 'link':
			cellValue.set('value', String(value ?? ''));
			break;
		default:
			if (typeof value === 'string') cellValue.set('value', makeText(value));
			else cellValue.set('value', value);
	}
	rowCells.set(col.id, cellValue);
}

/**
 * 加载数据库文档上下文
 *
 * 初始化操作数据库所需的所有状态：
 * 1. 建立 WebSocket 连接
 * 2. 加载文档快照
 * 3. 构建列查询索引
 * 4. 获取行 ID 列表
 *
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @param databaseBlockId - 数据库 block ID
 * @returns 数据库文档上下文
 * @throws 连接失败、文档/数据库不存在等错误
 */
async function loadDatabaseDocContext(
	workspaceId: string,
	docId: string,
	databaseBlockId: string
): Promise<DatabaseDocContext> {
	const socket = await createWorkspaceSocket();
	await joinWorkspace(socket, workspaceId);
	const doc = new Y.Doc();
	const snapshot = await loadDoc(socket, workspaceId, docId);
	if (!snapshot.missing) {
		throw new Error('Document not found');
	}
	Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
	const prevSV = Y.encodeStateVector(doc);
	const blocks = doc.getMap('blocks') as Y.Map<any>;
	const dbBlock = findBlockById(blocks, databaseBlockId);
	if (!dbBlock) {
		throw new Error(`Database block '${databaseBlockId}' not found`);
	}
	const dbFlavour = dbBlock.get('sys:flavour');
	if (dbFlavour !== 'affine:database') {
		throw new Error(`Block '${databaseBlockId}' is not a database (flavour: ${dbFlavour})`);
	}
	const cellsMap = dbBlock.get('prop:cells') as Y.Map<any>;
	if (!(cellsMap instanceof Y.Map)) {
		throw new Error('Database block has no cells map');
	}
	const lookup = buildDatabaseColumnLookup(readColumnDefs(dbBlock));
	const rowIds = getDatabaseRowIds(dbBlock);
	return { socket, doc, prevSV, blocks, dbBlock, cellsMap, rowIds, ...lookup };
}

export type FilterCondition = { column: string; operator: string; value: string };
export type FilterGroup = { mode: 'and' | 'or'; filters: FilterCondition[] };
export type FilterParams = FilterCondition[] | FilterGroup;

/**
 * 查找匹配筛选条件的行 IDs
 *
 * 根据指定的筛选条件在数据库中查找匹配的行
 * 支持两种筛选格式：
 * - 简单格式：数组形式 [{ column, operator, value }, ...]，默认 AND 逻辑
 * - 高级格式：{ mode: "and"|"or", filters: [...] }
 *
 * 支持的操作符：
 * - eq: 等于
 * - neq: 不等于
 * - contains: 包含
 * - startsWith: 开头匹配
 * - endsWith: 结尾匹配
 * - gt: 大于（仅数字/日期）
 * - gte: 大于等于
 * - lt: 小于
 * - lte: 小于等于
 *
 * @param cellsMap - 数据库的单元格映射（Y.Map）
 * @param columnDefs - 数据库列定义数组
 * @param filters - 筛选条件（数组或对象格式）
 * @param rowIds - 可选的行 ID 列表，默认搜索所有行
 * @returns 匹配的行 ID 数组
 *
 * @example
 * // 简单格式（AND 逻辑）
 * findRowsByFilters(cellsMap, columns, [
 *   { column: '状态', operator: 'eq', value: '进行中' },
 *   { column: '优先级', operator: 'eq', value: '高' }
 * ]);
 *
 * // 高级格式（OR 逻辑）
 * findRowsByFilters(cellsMap, columns, {
 *   mode: 'or',
 *   filters: [
 *     { column: '状态', operator: 'eq', value: '已完成' },
 *     { column: '状态', operator: 'eq', value: '已取消' }
 *   ]
 * });
 */
export function findRowsByFilters(
	cellsMap: Y.Map<any>,
	columnDefs: DatabaseColumnDef[],
	filters: FilterParams,
	rowIds: string[] = []
): string[] {
	// 解析 filters 格式
	let mode: 'and' | 'or' = 'and';
	let filterList: FilterCondition[];

	if ('mode' in filters && 'filters' in filters) {
		mode = filters.mode?.toLowerCase() === 'or' ? 'or' : 'and';
		filterList = filters.filters;
	} else {
		filterList = filters as FilterCondition[];
	}

	// 构建列查找映射（支持列名和列 ID）
	const colByName = new Map<string, DatabaseColumnDef>();
	const colById = new Map<string, DatabaseColumnDef>();
	const colByNameLower = new Map<string, DatabaseColumnDef>();
	for (const col of columnDefs) {
		if (col.name) {
			colByName.set(col.name, col);
			colByNameLower.set(col.name.toLowerCase(), col);
		}
		colById.set(col.id, col);
	}

	/**
	 * 检查单个条件是否匹配
	 * 根据列类型进行正确的值比较
	 */
	function matchCondition(
		filter: { column: string; operator: string; value: string },
		rowCells: Y.Map<any>
	): boolean {
		// 防御性检查
		if (!filter.column) return false;

		const titleCol = columnDefs.find((c) => c.type === 'title');
		const isTitleFilter = titleCol && filter.column.toLowerCase() === 'title';

		// title 筛选从 rowBlock 的 prop:text 中获取（暂不支持）
		if (isTitleFilter) {
			return false;
		}

		// 支持按列名（大小写敏感）、列名小写或列 ID 查找
		const col =
			colByName.get(filter.column) ||
			colByNameLower.get(filter.column.toLowerCase()) ||
			colById.get(filter.column);
		if (!col) return false;

		const cellEntry = rowCells.get(col.id);
		const cellValue = cellEntry ? decodeDatabaseCellValue(col, cellEntry) : null;
		const filterValue = filter.value;

		// 根据列类型进行正确的比较
		switch (col.type) {
			case 'number':
			case 'progress': {
				// 数值类型比较
				const numCell = Number(cellValue);
				const numFilter = Number(filterValue);
				if (Number.isNaN(numFilter)) return false;
				switch (filter.operator) {
					case 'eq':
						return numCell === numFilter;
					case 'neq':
						return numCell !== numFilter;
					case 'gt':
						return numCell > numFilter;
					case 'gte':
						return numCell >= numFilter;
					case 'lt':
						return numCell < numFilter;
					case 'lte':
						return numCell <= numFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return numCell === numFilter;
				}
			}
			case 'checkbox': {
				// 布尔类型比较
				const boolCell = Boolean(cellValue);
				const boolFilter = filterValue.toLowerCase() === 'true' || filterValue === '1';
				switch (filter.operator) {
					case 'eq':
						return boolCell === boolFilter;
					case 'neq':
						return boolCell !== boolFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return boolCell === boolFilter;
				}
			}
			case 'date': {
				// 日期类型比较（使用时间戳）
				const dateCell = cellValue ? new Date(cellValue).getTime() : null;
				const dateFilter = new Date(filterValue).getTime();
				if (Number.isNaN(dateFilter)) {
					// 如果筛选值不是有效日期，尝试作为时间戳
					const tsFilter = Number(filterValue);
					if (!Number.isNaN(tsFilter)) {
						switch (filter.operator) {
							case 'eq':
								return dateCell === tsFilter;
							case 'neq':
								return dateCell !== tsFilter;
							case 'gt':
								return dateCell !== null && dateCell > tsFilter;
							case 'gte':
								return dateCell !== null && dateCell >= tsFilter;
							case 'lt':
								return dateCell !== null && dateCell < tsFilter;
							case 'lte':
								return dateCell !== null && dateCell <= tsFilter;
							default:
								return false;
						}
					}
					return false;
				}
				switch (filter.operator) {
					case 'eq':
						return dateCell === dateFilter;
					case 'neq':
						return dateCell !== dateFilter;
					case 'gt':
						return dateCell !== null && dateCell > dateFilter;
					case 'gte':
						return dateCell !== null && dateCell >= dateFilter;
					case 'lt':
						return dateCell !== null && dateCell < dateFilter;
					case 'lte':
						return dateCell !== null && dateCell <= dateFilter;
					case 'isempty':
						return cellValue === null || cellValue === undefined;
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined;
					default:
						return dateCell === dateFilter;
				}
			}
			case 'select': {
				// select 类型比较（比较选项 ID）
				const selectCell = cellValue as string;
				// 查找选项 ID
				const option = col.options.find((o) => o.value === filterValue);
				const filterOptionId = option?.id || filterValue;
				switch (filter.operator) {
					case 'eq':
						return selectCell === filterOptionId;
					case 'neq':
						return selectCell !== filterOptionId;
					case 'contains':
						return selectCell?.includes(filterValue);
					case 'notcontains':
						return !selectCell?.includes(filterValue);
					case 'isempty':
						return cellValue === null || cellValue === undefined || cellValue === '';
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined && cellValue !== '';
					default:
						return selectCell === filterOptionId;
				}
			}
			case 'multi-select': {
				// multi-select 类型比较
				const multiCell = Array.isArray(cellValue) ? cellValue : [];
				// 查找选项 ID
				const option = col.options.find((o) => o.value === filterValue);
				const filterOptionId = option?.id || filterValue;
				switch (filter.operator) {
					case 'eq':
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
					case 'neq':
						return (
							!multiCell.includes(filterOptionId) && !multiCell.includes(filterValue)
						);
					case 'contains':
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
					case 'notcontains':
						return (
							!multiCell.includes(filterOptionId) && !multiCell.includes(filterValue)
						);
					case 'isempty':
						return multiCell.length === 0;
					case 'isnotempty':
						return multiCell.length > 0;
					default:
						return (
							multiCell.includes(filterOptionId) || multiCell.includes(filterValue)
						);
				}
			}
			default: {
				// 文本类型比较（rich-text, title, link 等）
				const strCell = String(cellValue ?? '');
				switch (filter.operator) {
					case 'eq':
						return strCell === filterValue;
					case 'neq':
						return strCell !== filterValue;
					case 'contains':
						return strCell.includes(filterValue);
					case 'notcontains':
						return !strCell.includes(filterValue);
					case 'gt':
						return strCell > filterValue;
					case 'gte':
						return strCell >= filterValue;
					case 'lt':
						return strCell < filterValue;
					case 'lte':
						return strCell <= filterValue;
					case 'isempty':
						return cellValue === null || cellValue === undefined || cellValue === '';
					case 'isnotempty':
						return cellValue !== null && cellValue !== undefined && cellValue !== '';
					default:
						return strCell === filterValue;
				}
			}
		}
	}

	const matchingRowIds: string[] = [];

	// 如果传入了 rowIds，遍历这些行；否则遍历 cellsMap 的所有 key
	const targetRowIds = rowIds.length > 0 ? rowIds : Array.from(cellsMap.keys());

	for (const rowBlockId of targetRowIds) {
		const rowCells = cellsMap.get(rowBlockId);
		if (!(rowCells instanceof Y.Map)) continue;

		if (mode === 'and') {
			// AND: 所有条件都满足
			const allMatch = filterList.every((f) => matchCondition(f, rowCells));
			if (allMatch) matchingRowIds.push(rowBlockId);
		} else {
			// OR: 任一条件满足
			const anyMatch = filterList.some((f) => matchCondition(f, rowCells));
			if (anyMatch) matchingRowIds.push(rowBlockId);
		}
	}

	return matchingRowIds;
}

// /**
//  * 添加数据库行
//  *
//  * 在指定数据库中添加一个新行，可选择关联到某个文档
//  *
//  * @param params - 参数对象
//  * @param params.workspace - 工作区 ID（可选，默认使用配置中的工作区）
//  * @param params.docId - 文档 ID
//  * @param params.databaseBlockId - 数据库 block ID
//  * @param params.cells - 行单元格数据，键为列名或列 ID，值为单元格值
//  * @param params.linkedDocId - 可选的关联文档 ID（创建指向其他文档的链接行）
//  * @returns 添加结果对象，包含：
//  *   - added: 是否成功添加
//  *   - rowBlockId: 新增行的 block ID
//  *   - databaseBlockId: 数据库 ID
//  *   - cellCount: 写入的单元格数量
//  *   - linkedDocId: 关联的文档 ID（如有）
//  *
//  * @throws 工作区 ID 缺失、文档/数据库不存在、列不存在等错误
//  *
//  * @example
//  * // 添加普通行
//  * await addDatabaseRowHandler({
//  *   docId: 'abc123',
//  *   databaseBlockId: 'db456',
//  *   cells: { '名称': '新产品', '状态': '进行中', '优先级': '高' }
//  * });
//  *
//  * // 添加关联文档的行
//  * await addDatabaseRowHandler({
//  *   docId: 'abc123',
//  *   databaseBlockId: 'db456',
//  *   linkedDocId: 'doc789'
//  * });
//  */
// export async function addDatabaseRowHandler(params: {
// 	workspace?: string;
// 	docId: string;
// 	databaseBlockId: string;
// 	cells: Record<string, unknown>;
// 	linkedDocId?: string;
// }): Promise<any> {
// 	const workspaceId = getWorkspaceId(params.workspace);
// 	if (!workspaceId) throw new Error('workspaceId is required');
// 	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
// 	try {
// 		const rowBlockId = generateId();
// 		const rowBlock = new Y.Map<any>();
// 		rowBlock.set('sys:id', rowBlockId);
// 		rowBlock.set('sys:flavour', 'affine:paragraph');
// 		rowBlock.set('sys:version', 1);
// 		rowBlock.set('sys:parent', params.databaseBlockId);
// 		rowBlock.set('sys:children', new Y.Array<string>());
// 		rowBlock.set('prop:type', 'text');
// 		if (params.linkedDocId) {
// 			rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
// 		} else {
// 			const titleValue = resolveDatabaseTitleValue(params.cells, ctx);
// 			rowBlock.set('prop:text', makeText(String(titleValue)));
// 		}
// 		ctx.blocks.set(rowBlockId, rowBlock);

// 		const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
// 		if (!(dbChildren instanceof Y.Array)) {
// 			const newChildren = new Y.Array<string>();
// 			ctx.dbBlock.set('sys:children', newChildren);
// 			newChildren.push([rowBlockId]);
// 		} else {
// 			dbChildren.push([rowBlockId]);
// 		}

// 		const rowCells = ensureDatabaseRowCells(ctx.cellsMap, rowBlockId);
// 		for (const [key, value] of Object.entries(params.cells)) {
// 			const col = findDatabaseColumn(key, ctx);
// 			if (!col) {
// 				if (isTitleAliasKey(key)) continue;
// 				throw new Error(
// 					`Column '${key}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
// 				);
// 			}
// 			writeDatabaseCellValue(rowCells, col, value, true);
// 		}

// 		const delta = Y.encodeStateAsUpdate(ctx.doc, ctx.prevSV);
// 		await pushDocUpdate(
// 			ctx.socket,
// 			workspaceId,
// 			params.docId,
// 			Buffer.from(delta).toString('base64')
// 		);

// 		return {
// 			added: true,
// 			rowBlockId,
// 			databaseBlockId: params.databaseBlockId,
// 			cellCount: Object.keys(params.cells).length,
// 			linkedDocId: params.linkedDocId || null
// 		};
// 	} finally {
// 	}
// }

// /**
//  * 删除数据库行
//  *
//  * 从数据库中删除指定的行及其所有后代 block
//  *
//  * @param params - 参数对象
//  * @param params.workspace - 工作区 ID（可选）
//  * @param params.docId - 文档 ID
//  * @param params.databaseBlockId - 数据库 block ID
//  * @param params.rowBlockId - 要删除的行 block ID
//  * @returns 删除结果对象，包含：
//  *   - deleted: 是否成功删除
//  *   - rowBlockId: 被删除的行 ID
//  *   - descendantCount: 删除的后代 block 数量
//  *
//  * @throws 行不存在或不属于数据库
//  */
// export async function deleteDatabaseRowHandler(params: {
// 	workspace?: string;
// 	docId: string;
// 	databaseBlockId: string;
// 	rowBlockId: string;
// }): Promise<any> {
// 	const workspaceId = getWorkspaceId(params.workspace);
// 	if (!workspaceId) throw new Error('workspaceId is required');
// 	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
// 	try {
// 		const rowBlock = getDatabaseRowBlock(
// 			ctx.blocks,
// 			ctx.dbBlock,
// 			params.databaseBlockId,
// 			params.rowBlockId
// 		);
// 		const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
// 			params.rowBlockId,
// 			...childIdsFrom(rowBlock.get('sys:children'))
// 		]);
// 		const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
// 		const rowIndex = indexOfChild(dbChildren, params.rowBlockId);
// 		if (rowIndex < 0) {
// 			throw new Error(
// 				`Row block '${params.rowBlockId}' is not present in database '${params.databaseBlockId}' children`
// 			);
// 		}

// 		dbChildren.delete(rowIndex, 1);
// 		ctx.cellsMap.delete(params.rowBlockId);
// 		for (const blockId of descendantBlockIds) {
// 			ctx.blocks.delete(blockId);
// 		}

// 		const delta = Y.encodeStateAsUpdate(ctx.doc, ctx.prevSV);
// 		await pushDocUpdate(
// 			ctx.socket,
// 			workspaceId,
// 			params.docId,
// 			Buffer.from(delta).toString('base64')
// 		);

// 		return {
// 			deleted: true,
// 			rowBlockId: params.rowBlockId,
// 			databaseBlockId: params.databaseBlockId
// 		};
// 	} finally {
// 	}
// }

/**
 * 移除数据库行（支持筛选匹配批量删除）
 *
 * 根据指定条件删除数据库中的行，支持单行删除或批量筛选删除
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @param params.rowBlockId - 要删除的单个行 block ID（与 filters 二选一）
 * @param params.filters - 筛选条件数组，用于批量匹配删除
 *   - 格式：[{ column: string, operator: string, value: string }]
 *   - operator 支持：eq（等于）、neq（不等于）、contains（包含）、startsWith（开头）、endsWith（结尾）
 * @returns 删除结果对象，包含：
 *   - deleted: 是否成功删除
 *   - deletedIds: 被删除的行 ID 数组
 *   - deletedCount: 删除的行数量
 *
 * @throws 无效的筛选条件或删除失败
 *
 * @example
 * // 删除单个行
 * await removeDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   rowBlockId: 'row789'
 * });
 *
 * // 批量删除匹配的行
 * await removeDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: '状态', operator: 'eq', value: '已完成' }]
 * });
 */
export async function removeDatabaseRowHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockId?: string;
	filters?: Array<{ column: string; operator: string; value: string }>;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let deletedCount = 0;
		let deletedIds: string[] = [];

		// 如果有筛选条件，找出匹配的行并删除
		if (params.filters) {
			const matchingRowIds = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);

			for (const rowId of matchingRowIds) {
				try {
					const rowBlock = getDatabaseRowBlock(
						ctx.blocks,
						ctx.dbBlock,
						params.databaseBlockId,
						rowId
					);
					const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
						rowId,
						...childIdsFrom(rowBlock.get('sys:children'))
					]);
					const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
					const rowIndex = indexOfChild(dbChildren, rowId);
					if (rowIndex >= 0) {
						dbChildren.delete(rowIndex, 1);
					}
					ctx.cellsMap.delete(rowId);
					for (const blockId of descendantBlockIds) {
						ctx.blocks.delete(blockId);
					}
					deletedIds.push(rowId);
					deletedCount++;
				} catch {
					// 忽略单个删除错误
				}
			}
		} else if (params.rowBlockId) {
			// 没有筛选条件，删除单行
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				params.rowBlockId
			);
			const descendantBlockIds = collectDescendantBlockIds(ctx.blocks, [
				params.rowBlockId,
				...childIdsFrom(rowBlock.get('sys:children'))
			]);
			const dbChildren = ctx.dbBlock.get('sys:children') as Y.Array<any>;
			const rowIndex = indexOfChild(dbChildren, params.rowBlockId);
			if (rowIndex < 0) {
				throw new Error(
					`Row block '${params.rowBlockId}' is not present in database '${params.databaseBlockId}' children`
				);
			}
			dbChildren.delete(rowIndex, 1);
			ctx.cellsMap.delete(params.rowBlockId);
			for (const blockId of descendantBlockIds) {
				ctx.blocks.delete(blockId);
			}
			deletedIds = [params.rowBlockId];
			deletedCount = 1;
		} else {
			throw new Error('必须指定 row-id 或 filter 参数');
		}

		await updateYDoc(ctx.socket, workspaceId, params.docId, ctx.doc, ctx.prevSV);

		return {
			deleted: deletedCount,
			rowBlockIds: deletedIds,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * 查询数据库
 *
 * 查询数据库中的行数据，支持两种输出格式：
 * - rows 格式：简单的行数据数组
 * - full/export 格式：完整的数据库结构（包含标题、列定义、数据）
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @param params.rowBlockIds - 要查询的行 ID 数组（可选，默认查询所有行）
 * @param params.columns - 要返回的列名数组（可选，默认返回所有列）
 * @param params.filters - 筛选条件数组，用于过滤行
 * @param params.full - 是否返回完整格式（包含列定义等元数据）
 * @returns 查询结果
 *   - rows 格式：{ rows: [{ id, title, cells: {...}}, ...] }
 *   - full 格式：{ title, columns: [{name, type, options}], data: [{title, col1, col2}, ...] }
 *
 * @example
 * // 查询所有行（简单格式）
 * await queryDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 *
 * // 筛选并返回完整格式
 * await queryDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: '状态', operator: 'eq', value: '进行中' }],
 *   full: true
 * });
 */
export async function queryDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockIds?: string[];
	columns?: string[];
	filters?: Array<{ column: string; operator: string; value: string }>;
	full?: boolean;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		// 处理 output 格式
		if (params.full) {
			// 导出格式
			const titleText = ctx.dbBlock.get('prop:title');
			let title = '';
			if (titleText instanceof Y.Text) {
				title = titleText.toString();
			} else if (Array.isArray(titleText)) {
				title = titleText.map((d: any) => d.insert || '').join('');
			}

			let rowIds = params.rowBlockIds?.length ? params.rowBlockIds : ctx.rowIds;
			if (params.filters) {
				rowIds = findRowsByFilters(
					ctx.cellsMap,
					ctx.columnDefs,
					params.filters,
					ctx.rowIds
				);
			}

			const data: Record<string, any>[] = [];
			for (const rowId of rowIds) {
				const rowBlock = ctx.blocks.get(rowId);
				if (!rowBlock || !(rowBlock instanceof Y.Map)) continue;

				const rowTitle = readDatabaseRowTitle(rowBlock);
				const rowCells = ctx.cellsMap.get(rowId);
				const rowData: Record<string, any> = {};

				if (rowTitle) rowData['title'] = rowTitle;

				if (rowCells instanceof Y.Map) {
					for (const col of ctx.columnDefs) {
						if (col.type === 'title') continue;
						if (params.columns?.length && !params.columns.includes(col.name || ''))
							continue;
						const cellEntry = rowCells.get(col.id);
						if (cellEntry !== undefined) {
							rowData[col.name] = decodeDatabaseCellValue(col, cellEntry);
						}
					}
				}
				data.push(rowData);
			}

			return {
				title,
				columns: ctx.columnDefs.map((col) => ({
					name: col.name,
					type: col.type,
					options: col.options?.map((o) => o.value)
				})),
				data
			};
		}

		// 默认 rows 格式
		return readDatabaseCellsHandler(params);
	} finally {
	}
}

/**
 * 读取数据库单元格
 *
 * 读取指定数据库中的单元格数据，返回行和列的详细信息
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @param params.rowBlockIds - 要读取的行 ID 数组（可选，默认读取所有行）
 * @param params.columns - 要读取的列名数组（可选，默认读取所有列）
 * @param params.filters - 筛选条件数组
 * @returns 读取结果，格式：{ rows: [{ id, title, cells: { colId: { value, type } } }] }
 *
 * @example
 * await readDatabaseCellsHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   columns: ['名称', '状态']
 * });
 */
export async function readDatabaseCellsHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	rowBlockIds?: string[];
	columns?: string[];
	filters?: Array<{ column: string; operator: string; value: string }>;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let requestedRows = params.rowBlockIds?.length
			? params.rowBlockIds
			: getDatabaseRowIds(ctx.dbBlock);

		const requestedColumns = params.columns?.length
			? params.columns.map((columnKey) => {
					const col = findDatabaseColumn(columnKey, ctx);
					if (!col) {
						throw new Error(
							`Column '${columnKey}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
						);
					}
					return col;
				})
			: ctx.columnDefs;
		const requestedColumnIds = new Set(requestedColumns.map((col) => col.id));

		// 应用筛选
		if (params.filters) {
			requestedRows = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);
		}

		const rows = requestedRows.map((rowBlockId) => {
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				rowBlockId
			);
			const title = readDatabaseRowTitle(rowBlock) || null;
			const rowCells = ctx.cellsMap.get(rowBlockId);
			const cells: Record<string, Record<string, unknown>> = {};

			if (rowCells instanceof Y.Map) {
				for (const col of ctx.columnDefs) {
					if (ctx.titleCol && col.id === ctx.titleCol.id) continue;
					if (!requestedColumnIds.has(col.id)) continue;
					const cellEntry = rowCells.get(col.id);
					if (cellEntry === undefined) continue;
					cells[col.name || col.id] = decodeDatabaseCellValue(col, cellEntry);
				}
			}

			return {
				rowBlockId,
				title,
				linkedDocId: readLinkedDocId(rowBlock),
				cells
			};
		});

		return { rows };
	} finally {
	}
}

/**
 * 读取数据库列定义
 *
 * 获取数据库的完整结构信息，包括列定义、视图配置等
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @returns 列定义结果，包含：
 *   - databaseBlockId: 数据库 ID
 *   - title: 数据库标题
 *   - rowCount: 行数量
 *   - columnCount: 列数量
 *   - titleColumnId: Title 列 ID
 *   - columns: 列定义数组 [{ id, name, type, options }]
 *   - views: 视图定义数组
 *
 * @example
 * await readDatabaseColumnsHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 */
export async function readDatabaseColumnsHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		const columns = ctx.columnDefs.map((col) => ({
			id: col.id,
			name: col.name || null,
			type: col.type,
			options: col.options
		}));

		const titleText = ctx.dbBlock.get('prop:title');
		let title = '';
		if (titleText instanceof Y.Text) {
			title = titleText.toString();
		} else if (Array.isArray(titleText)) {
			title = titleText.map((d: any) => d.insert || '').join('');
		}

		return {
			databaseBlockId: params.databaseBlockId,
			title: title || null,
			rowCount: getDatabaseRowIds(ctx.dbBlock).length,
			columnCount: columns.length,
			titleColumnId: ctx.titleCol?.id || null,
			columns,
			views: readDatabaseViewDefs(ctx.dbBlock, ctx)
		};
	} finally {
	}
}

/**
 * 批量更新数据库行
 *
 * 更新数据库中的行数据，支持单行更新或批量筛选更新
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @param params.cells - 要更新的单元格数据，键为列名或列 ID
 * @param params.rowBlockId - 要更新的单个行 ID（与 filters 二选一）
 * @param params.filters - 筛选条件数组，用于批量匹配更新
 * @param params.createOption - 是否为 select 类型自动创建新选项，默认 true
 * @param params.linkedDocId - 可选的关联文档 ID（将行转换为指向文档的链接）
 * @returns 更新结果，包含：
 *   - updated: 是否成功更新
 *   - updatedIds: 被更新的行 ID 数组
 *   - updatedCount: 更新的行数量
 *
 * @example
 * // 更新单个行
 * await updateDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   rowBlockId: 'row789',
 *   cells: { '状态': '已完成', '进度': 100 }
 * });
 *
 * // 批量更新匹配的行
 * await updateDatabaseRowHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   filters: [{ column: '状态', operator: 'eq', value: '进行中' }],
 *   cells: { '状态': '已完成' }
 * });
 */
export async function updateDatabaseRowHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	cells: Record<string, unknown>;
	rowBlockId?: string;
	filters?: Array<{ column: string; operator: string; value: string }>;
	createOption?: boolean;
	linkedDocId?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const ctx = await loadDatabaseDocContext(workspaceId, params.docId, params.databaseBlockId);
	try {
		let updatedCount = 0;
		let updatedIds: string[] = [];

		// 如果有筛选条件，找出匹配的行并更新
		if (params.filters) {
			const matchingRowIds = findRowsByFilters(
				ctx.cellsMap,
				ctx.columnDefs,
				params.filters,
				ctx.rowIds
			);

			for (const rowId of matchingRowIds) {
				try {
					const rowBlock = getDatabaseRowBlock(
						ctx.blocks,
						ctx.dbBlock,
						params.databaseBlockId,
						rowId
					);
					const rowCells = ensureDatabaseRowCells(ctx.cellsMap, rowId);
					let titleValue: string | null = null;

					for (const [key, value] of Object.entries(params.cells)) {
						const col = findDatabaseColumn(key, ctx);
						if (!col) {
							if (isTitleAliasKey(key)) {
								titleValue = String(value ?? '');
								continue;
							}
							continue;
						}

						writeDatabaseCellValue(rowCells, col, value, params.createOption ?? true);
						if (col.type === 'title' || isTitleAliasKey(col.name)) {
							titleValue = String(value ?? '');
						}
					}

					if (params.linkedDocId) {
						rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
					} else if (titleValue !== null) {
						rowBlock.set('prop:text', makeText(titleValue));
					}

					updatedIds.push(rowId);
					updatedCount++;
				} catch {
					// 忽略单个更新错误
				}
			}
		} else if (params.rowBlockId) {
			// 没有筛选条件，更新单行
			const rowBlock = getDatabaseRowBlock(
				ctx.blocks,
				ctx.dbBlock,
				params.databaseBlockId,
				params.rowBlockId
			);
			const rowCells = ensureDatabaseRowCells(ctx.cellsMap, params.rowBlockId);
			let titleValue: string | null = null;

			for (const [key, value] of Object.entries(params.cells)) {
				const col = findDatabaseColumn(key, ctx);
				if (!col) {
					if (isTitleAliasKey(key)) {
						titleValue = String(value ?? '');
						continue;
					}
					throw new Error(
						`Column '${key}' not found. Available columns: ${availableDatabaseColumns(ctx)}`
					);
				}

				writeDatabaseCellValue(rowCells, col, value, params.createOption ?? true);
				if (col.type === 'title' || isTitleAliasKey(col.name)) {
					titleValue = String(value ?? '');
				}
			}

			if (params.linkedDocId) {
				rowBlock.set('prop:text', makeLinkedDocText(params.linkedDocId));
			} else if (titleValue !== null) {
				rowBlock.set('prop:text', makeText(titleValue));
			}

			updatedIds = [params.rowBlockId];
			updatedCount = 1;
		} else {
			throw new Error('必须指定 row-id 或 filter 参数');
		}

		await updateYDoc(ctx.socket, workspaceId, params.docId, ctx.doc, ctx.prevSV);

		return {
			updated: updatedCount,
			rowBlockIds: updatedIds,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * 列出文档中的数据库
 *
 * 获取指定文档中所有数据库的基本信息
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @returns 列出结果，包含：
 *   - databases: 数据库数组
 *     - id: 数据库 block ID
 *     - title: 数据库标题
 *     - rowCount: 行数量
 *     - columnCount: 列数量
 *
 * @example
 * await listDatabasesHandler({
 *   docId: 'abc123'
 * });
 */
export async function listDatabasesHandler(params: {
	workspace?: string;
	docId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		const databases: Array<{
			id: string;
			title: string;
			rowCount: number;
			columnCount: number;
		}> = [];

		for (const [blockId, block] of blocks.entries()) {
			if (!(block instanceof Y.Map)) continue;
			const flavour = block.get('sys:flavour');
			if (flavour !== 'affine:database') continue;

			// 读取数据库标题
			const titleText = block.get('prop:title');
			let title = '';
			if (titleText instanceof Y.Text) {
				title = titleText.toString();
			} else if (Array.isArray(titleText)) {
				title = titleText.map((d: any) => d.insert || '').join('');
			}

			// 读取行列数
			const columns = readColumnDefs(block);
			const children = block.get('sys:children');
			const rowCount = childIdsFrom(children).length;

			databases.push({
				id: blockId,
				title: title || '未命名数据库',
				rowCount,
				columnCount: columns.length
			});
		}

		return { databases };
	} finally {
	}
}

/**
 * 创建数据库
 *
 * 在指定文档中创建新数据库，或创建包含数据库的新文档
 * 支持从数据推断列定义并导入初始数据
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 目标文档 ID（不传则创建新文档）
 * @param params.title - 数据库/文档标题
 * @param params.columns - 预定义的列数组（可选）
 *   - 格式：[{ name: string, type: string, width?: number, options?: string[] }]
 * @param params.viewMode - 视图模式：'table' 或 'kanban'（默认 'table'）
 * @param params.data - 初始数据（可选）
 *   - 支持数组格式：[{col1: val1}, ...]
 *   - 支持对象格式：{title, data: [], columns: []}
 *   - 数据中的列类型会自动推断
 * @returns 创建结果，包含：
 *   - created: 是否成功创建
 *   - docId: 文档 ID
 *   - databaseBlockId: 数据库 block ID
 *   - title: 数据库标题
 *   - importedRows: 导入的行数
 *
 * @throws 工作区 ID 缺失等错误
 *
 * @example
 * // 在现有文档中创建数据库
 * await createDatabaseHandler({
 *   docId: 'abc123',
 *   title: '项目列表',
 *   columns: [{ name: '名称', type: 'rich-text' }, { name: '状态', type: 'select', options: ['进行中', '已完成'] }]
 * });
 *
 * // 创建新文档并包含数据库（带数据）
 * await createDatabaseHandler({
 *   title: '销售数据',
 *   viewMode: 'table',
 *   data: [{ product: '产品A', sales: 100 }, { product: '产品B', sales: 200 }]
 * });
 */
export async function createDatabaseHandler(params: {
	workspace?: string;
	docId?: string;
	title?: string;
	columns?: Array<{ name: string; type: string; width?: number; options?: string[] }>;
	viewMode?: string;
	data?: any;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');

	const socket = await createWorkspaceSocket();

	let targetDocId = params.docId;

	const isKanban = params.viewMode === 'kanban';
	if (isKanban) {
		throw new Error('暂不支持看板模式');
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// 如果没有指定 docId，创建新文档
		if (!targetDocId) {
			const newDocId = generateId(12, 'doc');
			const newDoc = new Y.Doc();
			const prevSV = Y.encodeStateVector(newDoc);

			// 创建 page block
			const pageBlockId = generateId(12, 'page');
			const pageBlock = new Y.Map<any>();
			pageBlock.set('sys:id', pageBlockId);
			pageBlock.set('sys:flavour', 'affine:page');
			pageBlock.set('sys:version', 2);
			pageBlock.set('sys:parent', null);
			pageBlock.set('sys:children', new Y.Array<string>());

			// 设置文档标题
			const titleText = new Y.Text();
			titleText.insert(0, params.title || '未命名数据库');
			pageBlock.set('prop:title', titleText);

			// 添加 note block
			const noteId = generateId(12, 'note');
			const noteBlock = new Y.Map<any>();
			noteBlock.set('sys:id', noteId);
			noteBlock.set('sys:flavour', 'affine:note');
			noteBlock.set('sys:version', 1);
			noteBlock.set('sys:parent', pageBlockId);
			noteBlock.set('sys:children', new Y.Array<string>());
			noteBlock.set('prop:xywh', '[0,0,800,95]');
			noteBlock.set('prop:index', 'a0');
			noteBlock.set('prop:hidden', false);
			noteBlock.set('prop:displayMode', 'both');
			const background = new Y.Map<any>();
			background.set('light', '#ffffff');
			background.set('dark', '#252525');
			noteBlock.set('prop:background', background);

			// 添加 surface block
			const surfaceId = generateId(12, 'surf');
			const surfaceBlock = new Y.Map<any>();
			surfaceBlock.set('sys:id', surfaceId);
			surfaceBlock.set('sys:flavour', 'affine:surface');
			surfaceBlock.set('sys:version', 1);
			surfaceBlock.set('sys:parent', null);
			surfaceBlock.set('sys:children', new Y.Array<string>());
			const elements = new Y.Map<any>();
			elements.set('type', '$blocksuite:internal:native$');
			elements.set('value', new Y.Map<any>());
			surfaceBlock.set('prop:elements', elements);

			const blocks = newDoc.getMap('blocks');
			blocks.set(pageBlockId, pageBlock);
			blocks.set(noteId, noteBlock);
			blocks.set(surfaceId, surfaceBlock);

			const pageChildren = pageBlock.get('sys:children') as Y.Array<string>;
			pageChildren.push([surfaceId]);
			pageChildren.push([noteId]);

			// 添加到 workspace meta（这样 Affine UI 才能看到文档）
			const meta = newDoc.getMap('meta');
			meta.set('id', newDocId);
			meta.set('title', params.title || '未命名数据库');
			meta.set('createDate', Date.now());
			meta.set('tags', new Y.Array<string>());

			await updateYDoc(socket, workspaceId, newDocId, newDoc, prevSV);

			// 更新 workspace 的 pages 列表
			const { doc: wsDoc, prevSV: wsPrevSV } = await fetchYDoc(socket, workspaceId, workspaceId);
			const wsMeta = wsDoc.getMap('meta');
			let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
			if (!pages) {
				pages = new Y.Array();
				wsMeta.set('pages', pages);
			}
			const entry = new Y.Map();
			entry.set('id', newDocId);
			entry.set('title', params.title || '未命名数据库');
			entry.set('createDate', Date.now());
			entry.set('tags', new Y.Array<string>());
			pages.push([entry as any]);
			await updateYDoc(socket, workspaceId, workspaceId, wsDoc, wsPrevSV);

			targetDocId = newDocId;
		}

		// 获取目标文档
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, targetDocId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// 生成数据库 block
		const dbBlockId = generateId(12, 'db');
		const dbBlock = createBlockBase(dbBlockId, 'affine:database', null);
		dbBlock.set('prop:title', makeText(params.title || '未命名数据库'));
		dbBlock.set('prop:cells', new Y.Map<any>());
		dbBlock.set('prop:comments', undefined);

		// 创建列定义
		const columns = new Y.Array<any>();
		const titleColumnId = generateId(8, 'col');
		const titleColDef = createColumnDefinition(titleColumnId, 'Title', 'title', 250);
		columns.push([titleColDef]);

		// 记录包含字段的属性
		const colIdMap: Map<string, string> = new Map();

		// 添加自定义列
		if (params.columns) {
			for (const col of params.columns) {
				const colId = generateId(8, 'col');
				colIdMap.set(col.name, colId);
				const colWidth = col.width || getDefaultColumnWidth(col.type || 'rich-text');
				const colDef = createColumnDefinition(
					colId,
					col.name,
					col.type || 'rich-text',
					colWidth,
					col.options
				);
				columns.push([colDef]);
			}
		}

		// 创建视图列
		const viewColumns = new Y.Array<any>();
		viewColumns.push([createViewColumn(titleColumnId, false, 'title')]);

		// 为自定义列添加视图列
		for (const col of params.columns || []) {
			const colId = colIdMap.get(col.name);
			if (colId) {
				viewColumns.push([createViewColumn(colId, false, col.type), col.name]);
			}
		}

		const header = {
			titleColumn: titleColumnId,
			iconColumn: 'type'
		};

		const view = new Y.Map<any>();
		view.set('id', generateId(8, 'view'));
		view.set('name', params.viewMode === 'kanban' ? 'Kanban View' : 'Table View');
		view.set('mode', params.viewMode || 'table');
		view.set('columns', viewColumns);
		view.set('filter', { type: 'group', op: 'and', conditions: [] });
		view.set('groupBy', null);
		view.set('sort', null);
		view.set('header', header);

		const views = new Y.Array<any>();
		views.push([view]);

		dbBlock.set('prop:columns', columns);
		dbBlock.set('prop:views', views);

		// 如果有数据，从数据中推断列类型并创建列，然后导入数据
		let importedRows = 0;

		if (params.data) {
			let dataToImport: any[] = [];
			try {
				const parsedData =
					typeof params.data === 'string' ? JSON.parse(params.data) : params.data;
				if (Array.isArray(parsedData)) {
					dataToImport = parsedData;
				} else if (parsedData && parsedData.data && Array.isArray(parsedData.data)) {
					dataToImport = parsedData.data;
				}
			} catch {
				// 忽略解析错误
			}

			if (dataToImport.length > 0) {
				// 检查数据中是否存在 title 字段
				const hasTitleField = dataToImport.some(
					(row) => row && typeof row === 'object' && 'Title' in row
				);

				// 从数据中推断列类型
				const allKeys = new Set<string>();
				for (const row of dataToImport) {
					if (row && typeof row === 'object') {
						Object.keys(row).forEach((k) => allKeys.add(k));
					}
				}

				// 只有当数据中没有 title 字段时，才排除 title（稍后会将第一列作为 title）
				// 如果有 title 字段，保留所有列

				// 推断每列的类型
				const inferredColumns: Array<{
					name: string;
					type: string;
					options?: Array<{ id?: string; value: string; color?: string }>;
				}> = [];
				for (const key of allKeys) {
					const values = dataToImport
						.filter(
							(r) => r && r[key] !== undefined && r[key] !== null && r[key] !== ''
						)
						.map((r) => r[key]);

					let inferredType = 'rich-text';
					let options: Array<{ id?: string; value: string; color?: string }> | undefined;

					// 检测数组（多选）
					if (values.length > 0 && values.every((v) => Array.isArray(v))) {
						inferredType = 'multi-select';
						// 收集所有唯一选项
						const allOptions = new Set<string>();
						values.forEach((v: any) => {
							if (Array.isArray(v)) {
								v.forEach((item: string) => allOptions.add(String(item)));
							}
						});
						options = Array.from(allOptions).map((v) => ({ value: v }));
					}
					// 检测布尔值
					else if (values.length > 0 && values.every((v) => typeof v === 'boolean')) {
						inferredType = 'checkbox';
					}
					// 检测数字
					else if (
						values.length > 0 &&
						values.every((v) => typeof v === 'number' || !isNaN(Number(v)))
					) {
						inferredType = 'number';
					}
					// 检测日期
					else if (
						values.length > 0 &&
						values.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number')
					) {
						inferredType = 'date';
					}
					// 检测进度（0-100 的数字）
					else if (
						values.length > 0 &&
						values.every((v) => {
							const n = Number(v);
							return (
								typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
							);
						})
					) {
						inferredType = 'progress';
					}
					// 检测 URL
					else if (
						values.length > 0 &&
						values.every(
							(v) =>
								typeof v === 'string' &&
								(v.startsWith('http://') || v.startsWith('https://'))
						)
					) {
						inferredType = 'link';
					}
					// 检测选项
					else if (values.length > 0) {
						const uniqueValues = new Set(values.map(String));
						if (uniqueValues.size <= 20 && uniqueValues.size < values.length * 0.5) {
							inferredType = 'select';
							// 转换为对象数组
							options = Array.from(uniqueValues).map((v) => ({ value: v }));
						}
					}

					inferredColumns.push({ name: key, type: inferredType, options });
				}

				// 确定 title 列：如果数据中没有 title 字段，则使用第一列作为 title
				let titleKey: string | null = null;
				if (!hasTitleField && inferredColumns.length > 0) {
					titleKey = inferredColumns[0].name;
				}

				// 创建推断出的列定义
				for (const col of inferredColumns) {
					// 跳过 title 列
					if (titleKey && col.name === titleKey) continue;
					if (colIdMap.has(col.name)) continue;

					const colId = generateId(8, 'col');
					colIdMap.set(col.name, colId);

					// 提取选项值数组
					const optionValues = col.options?.map((o) => (o as any)?.value || String(o));

					const colDef = createColumnDefinition(
						colId,
						col.name,
						col.type,
						getDefaultColumnWidth(col.type),
						optionValues
					);
					columns.push([colDef]);

					// 添加视图列
					viewColumns.push([createViewColumn(colId, false, col.type)]);

					// 更新选项为对象格式（包含 id）
					if (col.options?.length && optionValues) {
						const colDefData = colDef.get('data');
						if (colDefData instanceof Y.Map) {
							const opts = colDefData.get('options');
							if (opts instanceof Y.Array) {
								opts.forEach((opt: any, idx: number) => {
									if (opt instanceof Y.Map) {
										col.options![idx] = {
											id: opt.get('id'),
											value: opt.get('value'),
											color: opt.get('color')
										};
									}
								});
							}
						}
					}
				}

				let dbChildren = dbBlock.get('sys:children') as Y.Array<any>;
				if (!(dbChildren instanceof Y.Array)) {
					dbChildren = new Y.Array<string>();
					dbBlock.set('sys:children', dbChildren);
				}

				// 获取 cells map（如果不存在则创建）
				let cells = dbBlock.get('prop:cells') as Y.Map<any>;
				if (!(cells instanceof Y.Map)) {
					cells = new Y.Map<any>();
					dbBlock.set('prop:cells', cells);
				}

				// 创建行并填充数据
				for (const rowData of dataToImport) {
					if (!rowData || typeof rowData !== 'object') continue;

					const rowBlockId = generateId(12, 'row');
					const rowBlock = new Y.Map<any>();
					rowBlock.set('sys:id', rowBlockId);
					rowBlock.set('sys:flavour', 'affine:paragraph');
					rowBlock.set('sys:version', 1);
					rowBlock.set('sys:parent', dbBlockId);
					rowBlock.set('sys:children', new Y.Array<string>());
					rowBlock.set('prop:type', 'text');

					// 从行数据中提取 title
					// 如果数据中有 title 字段，使用 title 字段值
					// 如果没有 title 字段，使用第一列的值作为 title
					let titleValue = '';
					if ('title' in rowData && rowData.title !== undefined) {
						titleValue = String(rowData.title);
					} else if (titleKey && rowData[titleKey] !== undefined) {
						titleValue = String(rowData[titleKey]);
					}
					rowBlock.set('prop:text', makeText(titleValue));

					// 先把 rowBlock 添加到 blocks
					blocks.set(rowBlockId, rowBlock);

					// 添加到 db 的 children
					dbChildren.push([rowBlockId]);

					// 创建行单元格
					const rowCells = new Y.Map<any>();

					// 为每个推断列设置单元格值（跳过 title 列）
					for (const colInfo of inferredColumns) {
						// 跳过 title 列
						if (titleKey && colInfo.name === titleKey) continue;

						const colId = colIdMap.get(colInfo.name);
						if (!colId) continue;
						const cellData = new Y.Map<any>();
						cellData.set('columnId', colId);
						const value = rowData[colInfo.name];
						if (value !== undefined && value !== null) {
							// 根据类型设置值
							if (colInfo.type === 'checkbox') {
								cellData.set('value', value ? true : false);
							} else if (colInfo.type === 'number') {
								const num = Number(value);
								if (!Number.isNaN(num)) {
									cellData.set('value', num);
								}
							} else if (colInfo.type === 'progress') {
								const num = Number(value);
								if (!Number.isNaN(num)) {
									cellData.set(
										'value',
										Math.max(0, Math.min(100, Math.floor(num)))
									);
								}
							} else if (colInfo.type === 'select' && colInfo.options?.length) {
								// 找到对应的 option ID，如果不存在则创建新选项
								const strValue = String(value);
								let opt = colInfo.options.find(
									(o) => (o as any).value === strValue
								);
								if (!opt) {
									// 创建新选项
									const optId = generateId(8, 'opt');
									opt = {
										id: optId,
										value: strValue,
										color: TAG_COLORS[
											colInfo.options.length % TAG_COLORS.length
										]
									};
									colInfo.options.push(opt);
								}
								cellData.set('value', (opt as any).id);
							} else if (colInfo.type === 'multi-select' && colInfo.options?.length) {
								// 多选：值为数组
								const values = Array.isArray(value) ? value : [value];
								const optionIds = new Y.Array<string>();
								for (const v of values) {
									const strValue = String(v);
									let opt = colInfo.options.find(
										(o) => (o as any).value === strValue
									);
									if (!opt) {
										const optId = generateId(8, 'opt');
										opt = {
											id: optId,
											value: strValue,
											color: TAG_COLORS[
												colInfo.options.length % TAG_COLORS.length
											]
										};
										colInfo.options.push(opt);
									}
									optionIds.push([(opt as any).id]);
								}
								cellData.set('value', optionIds);
							} else if (colInfo.type === 'date') {
								const ts = Date.parse(String(value));
								cellData.set('value', isNaN(ts) ? String(value) : ts);
							} else if (colInfo.type === 'progress') {
								const n = Number(value);
								if (Number.isFinite(n)) {
									const clamped = Math.max(0, Math.min(100, Math.floor(n)));
									cellData.set('value', clamped);
								}
							} else {
								// rich-text, link 等类型使用 makeText
								cellData.set('value', makeText(String(value)));
							}
						}
						rowCells.set(colId, cellData);
					}

					// 添加到 cells map
					cells.set(rowBlockId, rowCells);

					importedRows++;
				}
			}
		}

		// 添加到文档
		blocks.set(dbBlockId, dbBlock);

		// 找到 page block 并添加子元素
		let pageBlockId: string | null = null;
		for (const [id, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:page') {
				pageBlockId = id;
				break;
			}
		}

		if (pageBlockId) {
			const pageBlock = blocks.get(pageBlockId) as Y.Map<any>;
			let pageChildren = pageBlock.get('sys:children') as Y.Array<string> | undefined;
			if (!(pageChildren instanceof Y.Array)) {
				pageChildren = new Y.Array<string>();
				pageBlock.set('sys:children', pageChildren);
			}
			pageChildren.push([dbBlockId]);
		}

		// 推送更新
		await updateYDoc(socket, workspaceId, targetDocId, doc, prevSV);

		return {
			created: true,
			docId: targetDocId,
			databaseBlockId: dbBlockId,
			title: params.title || '未命名数据库',
			importedRows
		};
	} finally {
	}
}

/**
 * 删除数据库
 *
 * 从文档中删除指定的数据库块及其所有关联的行数据
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 要删除的数据库 block ID
 * @returns 删除结果，包含：
 *   - deleted: 是否成功删除
 *   - databaseBlockId: 被删除的数据库 ID
 *   - deletedBlockCount: 删除的 block 数量
 *
 * @example
 * await deleteDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456'
 * });
 */
export async function deleteDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// 检查数据库是否存在
		const dbBlock = blocks.get(params.databaseBlockId);
		if (!dbBlock || !(dbBlock instanceof Y.Map)) {
			throw new Error(`Database block '${params.databaseBlockId}' not found`);
		}
		if (dbBlock.get('sys:flavour') !== 'affine:database') {
			throw new Error(`Block '${params.databaseBlockId}' is not a database`);
		}

		// 收集所有需要删除的 block ID（包括行和子块）
		const blocksToDelete: string[] = [params.databaseBlockId];

		// 获取数据库的所有子元素（行）
		const dbChildren = dbBlock.get('sys:children');
		if (dbChildren instanceof Y.Array) {
			for (const entry of dbChildren) {
				if (typeof entry === 'string') {
					blocksToDelete.push(entry);
				} else if (Array.isArray(entry)) {
					blocksToDelete.push(...entry.filter((e: any) => typeof e === 'string'));
				}
			}
		}

		// 删除所有相关 block
		for (const blockId of blocksToDelete) {
			blocks.delete(blockId);
		}

		// 从 page block 中移除数据库引用
		let pageBlockId: string | null = null;
		for (const [id, block] of blocks.entries()) {
			if (block instanceof Y.Map && block.get('sys:flavour') === 'affine:page') {
				pageBlockId = id;
				break;
			}
		}

		if (pageBlockId) {
			const pageBlock = blocks.get(pageBlockId) as Y.Map<any>;
			const pageChildren = pageBlock.get('sys:children') as Y.Array<any>;
			if (pageChildren instanceof Y.Array) {
				for (let i = 0; i < pageChildren.length; i++) {
					const entry = pageChildren.get(i);
					if (typeof entry === 'string' && entry === params.databaseBlockId) {
						pageChildren.delete(i, 1);
						break;
					}
					if (Array.isArray(entry) && entry.includes(params.databaseBlockId)) {
						pageChildren.delete(i, 1);
						break;
					}
				}
			}
		}

		// 推送更新
		await updateYDoc(socket, workspaceId, params.docId, doc, prevSV);

		return {
			deleted: true,
			databaseBlockId: params.databaseBlockId
		};
	} finally {
	}
}

/**
 * 插入数据到数据库
 *
 * 向现有数据库添加新行数据，支持自动推断新列并创建
 *
 * @param params - 参数对象
 * @param params.workspace - 工作区 ID（可选）
 * @param params.docId - 文档 ID
 * @param params.databaseBlockId - 数据库 block ID
 * @param params.json - 要插入的数据
 *   - 简单格式：[{col1: val1, col2: val2}, ...]
 *   - 标准格式：{title: string, data: [], columns: []}
 * @returns 插入结果，包含：
 *   - imported: 实际导入的行数
 *   - newColumns: 新推断并创建的列数
 *
 * @example
 * await insertDatabaseHandler({
 *   docId: 'abc123',
 *   databaseBlockId: 'db456',
 *   json: [
 *     { title: '新任务1', status: '进行中', priority: '高' },
 *     { title: '新任务2', status: '已完成', priority: '低' }
 *   ]
 * });
 */
export async function insertDatabaseHandler(params: {
	workspace?: string;
	docId: string;
	databaseBlockId: string;
	json: any;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) throw new Error('workspaceId is required');

	// 解析 JSON
	let importData: any;
	try {
		importData = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
	} catch {
		throw new Error('JSON 格式无效');
	}

	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);
		const { doc: doc, exists: snapshotExists, prevSV: prevSV } = await fetchYDoc(socket, workspaceId, params.docId);
		if (!snapshotExists) {
			throw new Error('Document not found');
		}
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// 获取数据库
		const dbBlock = blocks.get(params.databaseBlockId);
		if (!dbBlock || !(dbBlock instanceof Y.Map)) {
			throw new Error(`Database block '${params.databaseBlockId}' not found`);
		}
		if (dbBlock.get('sys:flavour') !== 'affine:database') {
			throw new Error(`Block '${params.databaseBlockId}' is not a database`);
		}

		// 检测格式并获取数据
		let rowsToImport: Record<string, any>[];

		// 简单格式: 数组
		if (Array.isArray(importData)) {
			rowsToImport = importData;
		}
		// 标准格式: 对象
		else if (typeof importData === 'object' && importData !== null) {
			rowsToImport = importData.data || [];
		} else {
			throw new Error('不支持的 JSON 格式');
		}

		if (rowsToImport.length === 0) {
			return { imported: 0, message: '没有数据需要导入' };
		}

		// 获取现有的列定义
		const existingColumns = readColumnDefs(dbBlock);
		const existingColNames = new Set(existingColumns.map((c) => c.name));

		// 从数据中推断需要的新列
		const inferredColumns: Array<{ name: string; type: string; options?: string[] }> = [];
		const allKeys = new Set<string>();

		for (const row of rowsToImport) {
			if (row && typeof row === 'object') {
				Object.keys(row).forEach((k) => allKeys.add(k));
			}
		}

		// 排除 title 列
		allKeys.delete('title');

		// 推断每列的类型
		for (const key of allKeys) {
			const values = rowsToImport
				.filter((r) => r && r[key] !== undefined && r[key] !== null && r[key] !== '')
				.map((r) => r[key]);

			let inferredType = 'rich-text';
			let options: string[] | undefined;

			// 检测是否为布尔值
			if (values.every((v) => typeof v === 'boolean')) {
				inferredType = 'checkbox';
			}
			// 检测是否为数字
			else if (values.every((v) => typeof v === 'number' || !isNaN(Number(v)))) {
				inferredType = 'number';
			}
			// 检测是否为日期
			else if (values.every((v) => !isNaN(Date.parse(String(v))) || typeof v === 'number')) {
				inferredType = 'date';
			}
			// 检测 URL
			else if (
				values.every(
					(v) =>
						typeof v === 'string' &&
						(v.startsWith('http://') || v.startsWith('https://'))
				)
			) {
				inferredType = 'link';
			}
			// 检测选项（重复值较少，可能是选项）
			else {
				const uniqueValues = new Set(values.map(String));
				if (uniqueValues.size <= 20 && uniqueValues.size < values.length * 0.5) {
					inferredType = 'select';
					options = Array.from(uniqueValues);
				}
			}

			inferredColumns.push({ name: key, type: inferredType, options });
		}

		// 添加新列到数据库
		const columns = dbBlock.get('prop:columns') as Y.Array<any>;
		const newColumnIds: Map<string, string> = new Map();

		for (const col of inferredColumns) {
			if (!existingColNames.has(col.name)) {
				const columnId = generateId(8, 'col');
				const colDef = createColumnDefinition(
					columnId,
					col.name,
					col.type,
					getDefaultColumnWidth(col.type),
					col.options
				);
				columns.push([colDef]);
				newColumnIds.set(col.name, columnId);

				// 更新视图列
				const views = dbBlock.get('prop:views') as Y.Array<any>;
				if (views instanceof Y.Array) {
					views.forEach((view: any) => {
						if (view instanceof Y.Map) {
							const viewColumns = view.get('columns');
							if (viewColumns instanceof Y.Array) {
								const viewCol = new Y.Map<any>();
								viewCol.set('id', columnId);
								viewCol.set('hide', false);
								viewCol.set('width', 200);
								viewColumns.push([viewCol]);
							}
						}
					});
				}
			}
		}

		// 重新获取列定义（包含新增的列）
		const allColumns = readColumnDefs(dbBlock);
		const colByName = new Map<string, any>();
		for (const col of allColumns) {
			colByName.set(col.name, col);
		}

		// 添加行
		let importedCount = 0;
		const cellsMap = dbBlock.get('prop:cells') as Y.Map<any>;
		const dbChildren = dbBlock.get('sys:children') as Y.Array<any>;

		for (const rowData of rowsToImport) {
			if (!rowData || typeof rowData !== 'object') continue;

			const rowBlockId = generateId(12, 'row');
			const titleValue = rowData.title || '';
			const rowBlock = createDatabaseRowBlock(rowBlockId, params.databaseBlockId, titleValue);

			blocks.set(rowBlockId, rowBlock);
			dbChildren.push([rowBlockId]);

			const rowCells = ensureDatabaseRowCells(cellsMap, rowBlockId);

			// 处理每个字段
			for (const [key, value] of Object.entries(rowData)) {
				if (key === 'title') continue;

				const col = colByName.get(key);
				if (col) {
					writeDatabaseCellValue(rowCells, col, value, true);
				}
			}

			importedCount++;
		}

		// 推送更新
		await updateYDoc(socket, workspaceId, params.docId, doc, prevSV);

		return {
			imported: importedCount,
			newColumns: inferredColumns.length
		};
	} finally {
	}
}
