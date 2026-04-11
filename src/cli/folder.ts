/**
 * 文件夹 CLI 模块
 * 提供文件夹管理的命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import {
	folderAllHandler,
	folderListHandler,
	folderCreateHandler,
	folderDeleteHandler,
	folderAddHandler,
	folderMoveHandler,
	folderRemoveHandler,
	folderUpdateHandler,
	folderClearHandler
} from '../core/folder.js';

/**
 * folderCommands: 文件夹命令配置
 *
 * 定义了所有文件夹相关的 CLI 命令：
 * - all: 获取所有文件夹列表
 * - list: 获取指定文件夹下的子项列表
 * - create: 创建新文件夹
 * - delete: 删除文件夹
 * - update: 更新文件夹属性
 * - clear: 清除所有空文件夹
 * - add: 将文档添加到文件夹
 * - move: 将文档移动到目标文件夹
 * - remove: 从文件夹移除文档
 */
const folderCommands: Record<string, CommandConfig> = {
	all: {
		name: 'all',
		description: '所有文件夹列表',
		usage: 'all [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderAllHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	list: {
		name: 'list',
		description: '指定文件夹下文件夹/文档列表',
		usage: 'list --id <folder-id> [--folder] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '文件夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'folder',
				description: '仅返回文件夹列表，不设置默认返回文档列表',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderListHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			folder: parsed.folder,
			workspace: parsed.workspace
		})
	},
	create: {
		name: 'create',
		description: '创建文件夹',
		usage: 'create --name <name> [--parent <parent-id>] [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'name',
				short: 'n',
				description: '文件夹名称',
				required: true,
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: '父文件夹 ID',
				type: 'string'
			},
			{
				name: 'index',
				description: '排序索引',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderCreateHandler,
		paramsMapper: (parsed) => ({
			name: parsed.name,
			parent: parsed.parent,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	delete: {
		name: 'delete',
		description: '删除文件夹',
		usage: 'delete --id <folder-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '文件夹 ID',
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
		handler: folderDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},
	update: {
		name: 'update',
		description: '更新文件夹属性（如 name、parentId、index）',
		usage: 'update --id <folder-id> [--name <name>] [--parent <parent-id>] [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '文件夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'name',
				short: 'n',
				description: '文件夹名称',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: '新的父文件夹 ID（置空设为顶层）',
				type: 'string',
				allowEmpty: true
			},
			{
				name: 'index',
				description: '排序索引',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			name: parsed.name,
			parent: parsed.parent,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	clear: {
		name: 'clear',
		description: '清除所有空文件夹（没有任何子文件夹或文档关联）',
		usage: 'clear [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderClearHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	},
	add: {
		name: 'add',
		description: '文件夹添加文档',
		usage: 'add --id <folder-id> --doc <doc-id> [--index <idx>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '文件夹 ID',
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
				name: 'index',
				description: '排序索引',
				type: 'number'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID',
				type: 'string'
			}
		],
		handler: folderAddHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			index: parsed.index,
			workspace: parsed.workspace
		})
	},
	move: {
		name: 'move',
		description: '将文档从源文件夹移到目标文件夹',
		usage: 'move --id <folder-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '目标文件夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: '要移动的文档 ID',
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
		handler: folderMoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			target: parsed.doc,
			workspace: parsed.workspace
		})
	},
	remove: {
		name: 'remove',
		description: '从文件夹移除文档（不是删除文档）',
		usage: 'remove --id <folder-id> --doc <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '文件夹 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'doc',
				short: 'd',
				description: '要移除的文档 ID（支持链接 ID 或文档 ID）',
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
		handler: folderRemoveHandler,
		paramsMapper: (parsed) => ({
			id: parsed.doc,
			folder: parsed.id,
			workspace: parsed.workspace
		})
	}
};

/**
 * 文件夹 CLI 操作映射
 */
export const runFolderCommands = generateCommandMap(folderCommands);
