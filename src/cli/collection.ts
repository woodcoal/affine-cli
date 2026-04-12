/**
 * 收藏夹 CLI 模块
 * 提供收藏夹管理的命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	collectionListHandler,
	collectionInfoHandler,
	collectionCreateHandler,
	collectionUpdateHandler,
	collectionDeleteHandler,
	collectionAddHandler,
	collectionRemoveHandler
} from '../core/collection.js';

/**
 * collectionCommands: 收藏夹命令配置
 *
 * 定义了所有收藏夹相关的 CLI 命令：
 * - list: 获取所有收藏夹列表
 * - info: 获取指定收藏夹下的文档列表
 * - create: 创建新收藏夹
 * - update: 更新收藏夹名称
 * - delete: 删除收藏夹
 * - add: 添加文档到收藏夹
 * - remove: 从收藏夹移除文档
 */
const collectionCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: '所有收藏夹列表',
		usage: 'list [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: collectionListHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	info: {
		name: 'info',
		description: '指定收藏夹下文档列表',
		usage: 'info --id <collection-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '收藏夹 ID',
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
		handler: collectionInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: '新建收藏夹',
		usage: 'create --name <name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'name',
				short: 'n',
				description: '收藏夹名称',
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
		handler: collectionCreateHandler,
		paramsMapper: (parsed) => ({
			name: parsed.name,
			workspace: parsed.workspace
		})
	},
	update: {
		name: 'update',
		description: '更新收藏夹',
		usage: 'update --id <collection-id> --name <new-name> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '收藏夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'name',
				short: 'n',
				description: '新收藏夹名称',
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
		handler: collectionUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			name: parsed.name,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: '删除收藏夹',
		usage: 'delete --id <collection-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '收藏夹 ID',
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
		handler: collectionDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: '添加文档到收藏夹',
		usage: 'add --id <collection-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '收藏夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: '添加的文档 ID',
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
		handler: collectionAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: '从收藏夹移除文档',
		usage: 'remove --id <collection-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '收藏夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: '移除的文档 ID',
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
		handler: collectionRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	}
};

/**
 * 收藏夹 CLI 操作映射
 */
export const runCollectionCommands = generateCommandMap(collectionCommands);
