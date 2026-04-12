/**
 * 评论 CLI 模块
 * 提供评论管理的命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';

import {
	listCommentsHandler,
	createCommentHandler,
	updateCommentHandler,
	deleteCommentHandler,
	resolveCommentHandler
} from '../core/comments.js';

/**
 * commentsCommands: 评论命令配置
 *
 * 定义了所有评论相关的 CLI 命令：
 * - list: 列出文档评论
 * - create: 创建评论
 * - update: 更新评论内容
 * - delete: 删除评论
 * - resolve: 解决/取消解决评论
 */
const commentsCommands: Record<string, CommandConfig> = {
	list: {
		name: 'list',
		description: '列出文档评论',
		usage: 'list --doc-id <id> [--workspace <workspace-id>] [--first <n>] [--offset <n>] [--full]',
		args: [
			{
				name: 'doc-id',
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
			},
			{
				name: 'first',
				short: 'n',
				description: '返回数量',
				type: 'number'
			},
			{
				name: 'offset',
				short: 'o',
				description: '偏移量',
				type: 'number'
			},
			{
				name: 'full',
				short: 'f',
				description: '返回完整评论数据',
				type: 'boolean'
			}
		],
		handler: listCommentsHandler,
		paramsMapper: (parsed) => {
			const params: any = { docId: parsed['doc-id'] };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed.first) params.first = parsed.first;
			if (parsed.offset) params.offset = parsed.offset;
			if (parsed.full) params.full = parsed.full;
			return params;
		}
	},
	create: {
		name: 'create',
		description: '创建评论',
		usage: 'create --doc-id <id> --content <text> [--workspace <workspace-id>] [--selection <text>] [--doc-title <title>] [--doc-mode <mode>]',
		args: [
			{
				name: 'doc-id',
				short: 'd',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '评论内容',
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
				name: 'selection',
				short: 's',
				description: '引用的文本片段（会在文档中搜索并关联）',
				type: 'string'
			},
			{
				name: 'doc-title',
				description: '文档标题',
				type: 'string'
			},
			{
				name: 'doc-mode',
				short: 'm',
				description: '文档模式 (page/edgeless)',
				type: 'string'
			}
		],
		handler: createCommentHandler,
		paramsMapper: (parsed) => {
			const params: any = { docId: parsed['doc-id'], content: parsed.content };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed.selection) params.selection = parsed.selection;
			if (parsed['doc-title']) params.docTitle = parsed['doc-title'];
			if (parsed['doc-mode']) params.docMode = parsed['doc-mode'];
			return params;
		}
	},
	update: {
		name: 'update',
		description: '更新评论',
		usage: 'update --id <id> --content <text>',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '评论 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '新评论内容',
				required: true,
				type: 'string'
			}
		],
		handler: updateCommentHandler,
		paramsMapper: (parsed) => {
			return { id: parsed.id, content: parsed.content };
		}
	},
	delete: {
		name: 'delete',
		description: '删除评论（同时移除文档中的关联标记）',
		usage: 'delete --id <id> [--workspace <workspace-id>] [--doc-id <id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '评论 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（可选，自动从评论获取）',
				type: 'string'
			},
			{
				name: 'doc-id',
				short: 'd',
				description: '文档 ID（可选，自动从评论获取）',
				type: 'string'
			}
		],
		handler: deleteCommentHandler,
		paramsMapper: (parsed) => {
			const params: any = { id: parsed.id };
			if (parsed.workspace) params.workspaceId = parsed.workspace;
			if (parsed['doc-id']) params.docId = parsed['doc-id'];
			return params;
		}
	},
	resolve: {
		name: 'resolve',
		description: '解决/取消解决评论',
		usage: 'resolve --id <id> --resolved <true|false>',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '评论 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'resolved',
				short: 'r',
				description: '是否已解决 (true/false)',
				required: true,
				type: 'boolean'
			}
		],
		handler: resolveCommentHandler,
		paramsMapper: (parsed) => {
			// 处理布尔值解析：--resolved false 需要正确解析为 false
			const resolved = parsed.resolved === true || String(parsed.resolved) === 'true';
			return { id: parsed.id, resolved };
		}
	}
};

/**
 * 评论 CLI 操作映射
 */
export const runCommentCommands = generateCommandMap(commentsCommands);
