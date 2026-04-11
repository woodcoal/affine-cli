/**
 * 数据库 CLI 模块
 * 提供数据库管理的命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { parseJsonContent } from '../utils/misc.js';

import {
	queryDatabaseHandler,
	readDatabaseColumnsHandler,
	updateDatabaseRowHandler,
	listDatabasesHandler,
	createDatabaseHandler,
	deleteDatabaseHandler,
	insertDatabaseHandler,
	removeDatabaseRowHandler
} from '../core/database.js';

/**
 * 解析筛选条件参数
 * 将用户输入的筛选条件字符串解析为可用的数组格式
 * 支持 JSON 字符串和 @file 格式的文件路径
 *
 * @param filterValue - 筛选条件字符串，支持：
 *   - JSON 数组格式（如 '[{"column":"名称","operator":"eq","value":"测试"}]'）
 *   - 高级筛选格式（如 '{"mode":"and","filters":[...]}'）
 *   - @file 格式（如 '@filter.json' 表示读取文件内容）
 * @returns 解析后的筛选条件数组，未输入时返回 undefined
 * @throws 格式无效时抛出错误
 */
function parseFilter(filterValue: string | undefined) {
	// 无输入时返回 undefined
	if (!filterValue) return undefined;

	// 使用通用 JSON 解析函数处理字符串或文件
	const parsed = parseJsonContent(filterValue, {
		allowArray: true,
		allowObject: true,
		fieldName: 'filter'
	});

	// 处理数组格式（标准筛选条件）
	if (Array.isArray(parsed)) {
		return parsed.length > 0 ? parsed : undefined;
	}

	// 处理对象格式（带 mode 字段的高级筛选）
	const data = parsed as Record<string, any>;
	if (data && 'mode' in data && Array.isArray(data['filters'])) {
		return data;
	}

	// 格式无效
	throw new Error('filter 参数必须是有效的 JSON 数组格式');
}

/**
 * 解析 JSON 内容参数（对象格式）
 * 专用辅助函数，用于解析 cells、values 等需要对象格式的参数
 *
 * @param value - 输入字符串，支持 JSON 字符串或 @file 格式
 * @param fieldName - 参数名称，用于错误信息
 * @returns 解析后的对象
 * @throws 格式无效时抛出错误
 */
function parseObjectContent(value: string | undefined, fieldName: string): Record<string, unknown> {
	if (!value) return {};

	const parsed = parseJsonContent(value, {
		allowArray: false,
		allowObject: true,
		fieldName
	});

	return parsed as Record<string, unknown>;
}

/**
 * 解析 JSON 内容参数（数组或对象格式）
 * 通用辅助函数，用于解析 content 等需要灵活格式的参数
 *
 * @param value - 输入字符串，支持 JSON 字符串或 @file 格式
 * @param fieldName - 参数名称，用于错误信息
 * @returns 解析后的数据（数组或对象）
 * @throws 格式无效时抛出错误
 */
function parseDataContent(value: string | undefined, fieldName: string): unknown {
	if (!value) return undefined;

	return parseJsonContent(value, {
		allowArray: true,
		allowObject: true,
		fieldName
	});
}

/**
 * 数据库命令配置
 * 定义所有数据库相关命令的参数和处理器映射
 */
const databaseCommands: Record<string, CommandConfig> = {
	/**
	 * list 命令：列出文档中的所有数据库
	 * 用法：list --doc <doc-id> [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: '列出文档中的所有数据库',
		usage: 'list --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: listDatabasesHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			workspace: parsed.workspace
		})
	},

	/**
	 * columns 命令：读取数据库列定义
	 * 用法：columns --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]
	 */
	columns: {
		name: 'columns',
		description: '读取数据库列定义',
		usage: 'columns --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: readDatabaseColumnsHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			workspace: parsed.workspace
		})
	},

	/**
	 * query 命令：查询数据库行数据
	 * 用法：query --doc <doc-id> --id <database-block-id> [--rows <ids>] [--columns <names>] [--query <json>] [--full] [--workspace <workspace-id>]
	 */
	query: {
		name: 'query',
		description: '查询数据库行数据',
		usage: 'query --doc <doc-id> --id <database-block-id> [--rows <ids>] [--columns <names>] [--query <json>] [--full] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'columns',
				description: '用于查询输出的列名（逗号分隔）',
				type: 'string'
			},
			{
				name: 'rows',
				description: '用于查询输出的行 ID（逗号分隔）',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description:
					'筛选条件（JSON 数组，如：[{ column: string; operator: string; value: string }] 或者 { mode: "and" | "or"; filters: FilterCondition[] }）',
				type: 'string'
			},
			{
				name: 'full',
				short: 'f',
				description: '是否完整输出',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: queryDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			rowBlockIds: parsed.rows ? parsed.rows.split(',') : undefined,
			columns: parsed.columns ? parsed.columns.split(',') : undefined,
			filters: parseFilter(parsed.query || parsed.q),
			full: parsed.full,
			workspace: parsed.workspace
		})
	},

	/**
	 * remove 命令：删除数据库行
	 * 用法：remove --doc <doc-id> --id <database-block-id> [--row <row-id>] [--query <json>] [--workspace <workspace-id>]
	 */
	remove: {
		name: 'remove',
		description: '删除数据库行',
		usage: 'remove --doc <doc-id> --id <database-block-id> [--row <row-id>] [--query <json>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'row',
				short: 'r',
				description: '行 block ID（单独指定行）',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description: '筛选条件（JSON 数组，匹配多行删除）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: removeDatabaseRowHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			rowBlockId: parsed['row'],
			filters: parseFilter(parsed.query || parsed.q),
			workspace: parsed.workspace
		})
	},

	/**
	 * update 命令：更新数据库行
	 * 用法：update --doc <doc-id> --id <database-block-id> --values <json|@file> [--row <id>] [--query <json>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: '更新数据库行',
		usage: 'update --doc <doc-id> --id <database-block-id> --values <json|@file> [--row <id>] [--query <json>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'values',
				short: 'v',
				description: '单元格数据（JSON 格式；以 @ 开头表示文件路径）',
				required: true,
				type: 'string'
			},
			{
				name: 'row',
				short: 'r',
				description: '行 block ID（单独指定行）',
				type: 'string'
			},
			{
				name: 'query',
				short: 'q',
				description: '筛选条件（JSON 数组，匹配多行更新）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: updateDatabaseRowHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			cells: parseObjectContent(parsed.values || parsed.v, 'values'),
			rowBlockId: parsed['row'],
			filters: parseFilter(parsed.query || parsed.q),
			workspace: parsed.workspace
		})
	},

	/**
	 * create 命令：创建数据库
	 * 用法：create --content <json|@file> [--doc <doc-id>] [--title <name>] [--view-mode <mode>] [--workspace <workspace-id>]
	 *
	 * content 格式支持：
	 *   - 数组格式：如 [{"title":"行1","状态":"进行中"},...]
	 *   - 对象格式：如 {"title":"数据库标题","data":[...],"columns":[...]}
	 */
	create: {
		name: 'create',
		description: '创建数据库（可指定文档或创建新文档）',
		usage: 'create --content <json|@file> [--doc <doc-id>] [--title <name>] [--view-mode <mode>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID（不指定则创建新文档）',
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: '新建文档的标题，数据表的标题',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description:
					'数据（JSON 格式，支持数组或 {title:"",data:[],columns:[]} 格式；以 @ 开头表示文件路径）',
				required: true,
				type: 'string'
			},
			{
				name: 'view-mode',
				short: 'vm',
				description: '视图模式（table/kanban）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: createDatabaseHandler,
		paramsMapper: (parsed) => {
			// 解析内容数据
			const data = parseDataContent(parsed.content || parsed.c, 'content');

			// 提取列定义（如果有）
			let columns: Array<{ name: string; type: string; options?: string[] }> = [];
			let title = parsed.title || '';

			// 从对象格式中提取 columns 和 title
			if (data && typeof data === 'object' && !Array.isArray(data)) {
				const content = data as Record<string, unknown>;

				// 提取列定义
				if (Array.isArray(content.columns)) {
					columns = content.columns;
				}

				// 提取标题
				if (!title && content.title) {
					title = String(content.title);
				}
			}

			return {
				docId: parsed['doc'] || undefined,
				title,
				columns,
				data,
				viewMode: parsed['view-mode'],
				workspace: parsed.workspace
			};
		}
	},

	/**
	 * delete 命令：删除数据库
	 * 用法：delete --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: '删除数据库',
		usage: 'delete --doc <doc-id> --id <database-block-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: deleteDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			workspace: parsed.workspace
		})
	},

	/**
	 * insert 命令：插入数据到数据库
	 * 用法：insert --doc <doc-id> --id <database-block-id> --content <json|@file> [--workspace <workspace-id>]
	 */
	insert: {
		name: 'insert',
		description: '插入数据到数据库',
		usage: 'insert --doc <doc-id> --id <database-block-id> --content <json|@file> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'id',
				short: 'i',
				description: '数据库 block ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '数据（JSON 格式，支持数组或 {data:[]} 格式；以 @ 开头表示文件路径）',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: insertDatabaseHandler,
		paramsMapper: (parsed) => ({
			docId: parsed['doc'],
			databaseBlockId: parsed['id'],
			json: parseDataContent(parsed.content || parsed.c, 'content'),
			workspace: parsed.workspace
		})
	}
};

/**
 * 数据库 CLI 操作映射
 * 将命令配置转换为命令映射，供 CLI 入口使用
 */
export const runDatabaseCommands = generateCommandMap(databaseCommands);
