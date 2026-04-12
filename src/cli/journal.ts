/**
 * 日记 CLI 模块
 * 提供日记管理的命令行接口，包括列表、创建、追加等功能
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { convertToMarkdown } from '../utils/fileConverter.js';
import { isFilePath } from '../utils/misc.js';

import {
	journalListHandler,
	journalCreateHandler,
	journalAppendHandler,
	journalInfoHandler,
	journalUpdateHandler
} from '../core/journal.js';

/**
 * 解析内容参数
 * 支持 --content 直接输入或 @ 开头的文件路径
 *
 * @param contentValue - --content 参数值（支持 @filePath 格式）
 * @returns 解析后的内容字符串
 */
function parseContentParam(contentValue?: string): string {
	if (!contentValue) {
		return '';
	}

	if (isFilePath(contentValue)) {
		const filePath = contentValue.slice(1);
		return convertToMarkdown(filePath);
	}

	return contentValue;
}

/**
 * 日记命令配置
 * 定义所有日记相关命令的参数和处理器映射
 */
const journalCommands: Record<string, CommandConfig> = {
	/**
	 * list 命令：列出工作区所有日记
	 * 用法：list [--count <n>] [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: '列出工作区所有日记（支持分页）',
		usage: 'list [--count <n>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			},
			{
				name: 'count',
				short: 'c',
				description: '返回结果数量（默认 20）',
				type: 'number'
			}
		],
		handler: journalListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace,
			count: parsed.count
		})
	},

	/**
	 * create 命令：创建日记
	 * 用法：create [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	create: {
		name: 'create',
		description: '创建新日记（默认创建今天的日记）',
		usage: 'create [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'date',
				short: 'd',
				description: '日记日期（默认今天，格式 YYYY-MM-DD）',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '日记内容（Markdown 格式；以 @ 开头表示文件路径）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: journalCreateHandler,
		paramsMapper: (parsed) => ({
			date: parsed.date,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	},

	/**
	 * append 命令：追加内容到日记
	 * 用法：append [--id <doc-id>] [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	append: {
		name: 'append',
		description: '在日记末尾追加 Markdown 内容',
		usage: 'append [--id <doc-id>] [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '日记文档 ID（与 date 参数二选一）',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: '日记日期（默认今天，格式 YYYY-MM-DD，与 id 参数二选一）',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '要追加的 Markdown 内容（以 @ 开头表示文件路径）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: journalAppendHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	},

	/**
	 * info 命令：获取日记详情
	 * 用法：info --id <doc-id> [--workspace <workspace-id>]
	 */
	info: {
		name: 'info',
		description: '获取日记详情（包含 Markdown 内容）',
		usage: 'info --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '日记文档 ID（与 date 参数二选一）',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: '日记日期（格式 YYYY-MM-DD，与 id 参数二选一）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: journalInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			workspace: parsed.workspace
		})
	},

	/**
	 * update 命令：更新日记内容（完整替换）
	 * 用法：update --id <doc-id> [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: '完整更新日记内容（替换整个文档）',
		usage: 'update --id <doc-id> [--date <YYYY-MM-DD>] [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '日记文档 ID（与 date 参数二选一）',
				type: 'string'
			},
			{
				name: 'date',
				short: 'd',
				description: '日记日期（格式 YYYY-MM-DD，与 id 参数二选一）',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '新的日记内容（Markdown 格式；以 @ 开头表示文件路径）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: journalUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			date: parsed.date,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	}
};

/**
 * 日记 CLI 操作映射
 * 将命令配置转换为命令映射，供 CLI 入口使用
 */
export const runJournalCommands = generateCommandMap(journalCommands);