/**
 * 标签 CLI 模块
 * 提供标签管理的命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	tagsListHandler,
	tagsCreateHandler,
	tagsDocAddHandler,
	tagsDocRemoveHandler,
	tagsDocListHandler,
	tagsDeleteHandler
} from '../core/tags.js';

/**
 * tagsCommands: 标签命令配置
 *
 * 定义了所有标签相关的 CLI 命令：
 * - list: 列出所有标签
 * - create: 创建标签
 * - add: 添加标签到文档
 * - remove: 从文档移除标签
 * - delete: 删除标签
 * - info: 获取指定标签关联的文档列表
 */
const tagsCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: '列出所有标签',
		usage: 'list [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: tagsListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: '创建标签',
		usage: 'create --tag <name> [--color <color>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'tag',
				description: '标签名称',
				required: true,
				type: 'string'
			},
			{
				name: 'color',
				description: '标签颜色（如 #3B82F6）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: tagsCreateHandler,
		paramsMapper: (parsed) => ({
			tag: parsed.tag,
			color: parsed.color,
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: '添加标签到文档',
		usage: 'add -d <doc-id> --tag <name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'tag',
				description: '标签名称',
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
		handler: tagsDocAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: '从文档移除标签',
		usage: 'remove -d <doc-id> --tag <name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'doc',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'tag',
				description: '标签名称',
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
		handler: tagsDocRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: '删除标签',
		usage: 'delete --tag <name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'tag',
				description: '标签名称',
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
		handler: tagsDeleteHandler,
		paramsMapper: (parsed) => ({
			tag: parsed.tag,
			workspace: parsed.workspace
		})
	},
	info: {
		name: 'info',
		description: '获取指定标签的文档列表',
		usage: 'info --tag <name> [--workspace <workspace-id>] [--ignore-case]',
		args: [
			{
				name: 'tag',
				description: '标签名称',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			},
			{
				name: 'ignore-case',
				description: '忽略大小写',
				type: 'boolean'
			}
		],
		handler: tagsDocListHandler,
		paramsMapper: (parsed) => ({
			tag: parsed.tag,
			workspace: parsed.workspace,
			ignoreCase: parsed['ignore-case']
		})
	}
};

/**
 * 标签 CLI 操作映射
 */
export const runTagsCommands = generateCommandMap(tagsCommands);
