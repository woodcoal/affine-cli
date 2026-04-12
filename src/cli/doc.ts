/**
 * 文档 CLI 模块
 * 提供文档管理的命令行接口，包括列表、详情、创建、删除、复制、更新、搜索、替换、追加等功能
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { convertToMarkdown } from '../utils/fileConverter.js';
import { isFilePath } from '../utils/misc.js';

import {
	docAllHandler,
	docInfoHandler,
	docCreateHandler,
	docDeleteHandler,
	docCopyHandler,
	docUpdateHandler,
	docSearchHandler,
	docReplaceHandler,
	docAppendHandler,
	docPublishHandler,
	docUnpublishHandler
} from '../core/docs.js';

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

	// 检查是否为有效的文件路径格式
	if (isFilePath(contentValue)) {
		const filePath = contentValue.slice(1);
		return convertToMarkdown(filePath);
	}

	return contentValue;
}

/**
 * 文档命令配置
 * 定义所有文档相关命令的参数和处理器映射
 */
const docCommands: Record<string, CommandConfig> = {
	/**
	 * all 命令：列出工作区所有文档，包含已删除的文档记录
	 * 用法：all [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]
	 */
	all: {
		name: 'all',
		description: '列出工作区所有文档，包含已删除的文档记录（支持分页）',
		usage: 'all [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'count',
				short: 'c',
				description: '每页返回数量（默认 50）',
				type: 'number'
			},
			{
				name: 'skip',
				short: 's',
				description: '偏移量（用于跳过前面的文档）',
				type: 'number'
			},
			{
				name: 'after',
				short: 'a',
				description: '游标值（用于分页，获取下一页）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docAllHandler,
		paramsMapper: (parsed) => ({
			count: parsed.count,
			skip: parsed.skip,
			after: parsed.after,
			workspace: parsed.workspace
		})
	},
	/**
	 * list 命令：列出工作区所有文档
	 * 用法：list [--count <n>] [--skip <n>] [--after <cursor>] [--workspace <workspace-id>]
	 */
	list: {
		name: 'list',
		description: '列出工作区所有文档（支持分页）',
		usage: 'list [--workspace <workspace-id>]',
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
			},
			{
				name: 'tag',
				short: 't',
				description: '标签',
				type: 'string'
			}
		],
		handler: docSearchHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace,
			count: parsed.count,
			tag: parsed.tag
		})
	},

	/**
	 * info 命令：获取文档详情
	 * 用法：info --id <doc-id> [--workspace <workspace-id>] [--content <mode>]
	 */
	info: {
		name: 'info',
		description: '获取指定文档的详细信息（包含内容与元数据）',
		usage: 'info --id <doc-id> [--workspace <workspace-id>] [--content <mode>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '内容输出模式：markdown(默认)/raw/hidden',
				type: 'string'
			}
		],
		handler: docInfoHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace,
			content: parsed.content || 'markdown'
		})
	},

	/**
	 * create 命令：创建文档
	 * 用法：create --title <title> [--content <markdown|@file>] [--folder <folder-id>] [--tags <tag1,tag2>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	create: {
		name: 'create',
		description: '创建新文档（支持从 Markdown 文件导入）',
		usage: 'create --title <title> [--content <markdown|@file>] [--folder <folder-id>] [--tags <tag1,tag2>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'title',
				short: 't',
				description: '文档标题（必填）',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: '文档内容（Markdown 格式；以 @ 开头表示文件路径）',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: '文档所在文件夹 ID（可选）',
				type: 'string'
			},
			{
				name: 'tags',
				description: '标签列表（逗号分隔，如 "tag1,tag2"）',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'i',
				description: '文档图标（emoji 字符，如 🎯、📝、💡）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docCreateHandler,
		paramsMapper: (parsed) => ({
			title: parsed.title,
			content: parseContentParam(parsed.content),
			folder: parsed.folder,
			tags: parsed.tags,
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	},

	/**
	 * search 命令：文档搜索
	 * 用法：search [--query <keyword>] [--workspace <workspace-id>] [--count <n>] [--match-mode <mode>] [--tag <tag>]
	 */
	search: {
		name: 'search',
		description: '在文档中搜索关键词（支持标签过滤）',
		usage: 'search [--query <keyword>] [--workspace <workspace-id>] [--count <n>] [--match-mode <mode>] [--tag <tag>]',
		args: [
			{
				name: 'query',
				short: 'q',
				description: '搜索关键词（可与 --tag 组合使用）',
				type: 'string'
			},
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
			},
			{
				name: 'match-mode',
				short: 'm',
				description: '匹配模式：substring(包含)/prefix(前缀)/suffix(后缀)/exact(完全)',
				default: 'substring',
				type: 'string'
			},
			{
				name: 'tag',
				description: '按标签过滤（可与 --query 组合）',
				type: 'string'
			}
		],
		handler: docSearchHandler,
		paramsMapper: (parsed) => ({
			query: parsed.query,
			workspace: parsed.workspace,
			count: parsed.count,
			matchMode: parsed['match-mode'],
			tag: parsed.tag
		})
	},

	/**
	 * delete 命令：删除文档
	 * 用法：delete --id <doc-id> [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: '删除指定的文档',
		usage: 'delete --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '要删除的文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			workspace: parsed.workspace
		})
	},

	/**
	 * copy 命令：复制文档
	 * 用法：copy --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--workspace <workspace-id>]
	 */
	copy: {
		name: 'copy',
		description: '复制现有文档为新文档',
		usage: 'copy --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '源文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: '新文档的标题（不指定则使用原标题）',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: '父文档 ID（创建为子文档）',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: '目标文件夹 ID',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docCopyHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			title: parsed.title,
			parent: parsed.parent,
			folder: parsed.folder,
			workspace: parsed.workspace
		})
	},

	/**
	 * update 命令：更新文档属性
	 * 用法：update --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--icon <emoji>] [--workspace <workspace-id>]
	 */
	update: {
		name: 'update',
		description: '更新文档属性（标题、父子关系、文件夹、图标）',
		usage: 'update --id <doc-id> [--title <title>] [--parent <parent-id>] [--folder <folder-id>] [--icon <emoji>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '要更新的文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'title',
				short: 't',
				description: '新的文档标题',
				type: 'string'
			},
			{
				name: 'parent',
				short: 'p',
				description: '新的父文档 ID（可移除父子关系）',
				type: 'string'
			},
			{
				name: 'folder',
				short: 'f',
				description: '文档新的目标文件夹',
				type: 'string'
			},
			{
				name: 'icon',
				short: 'I',
				description: '文档图标（emoji 字符，如 🎯、📝、💡）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docUpdateHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			title: parsed.title,
			parent: parsed.parent,
			folder: parsed.folder,
			icon: parsed.icon,
			workspace: parsed.workspace
		})
	},

	/**
	 * replace 命令：替换文档内容
	 * 用法：replace --id <doc-id> --search <text> --replace <text> [--workspace <workspace-id>] [--match-all] [--preview]
	 */
	replace: {
		name: 'replace',
		description: '替换文档中的指定文本',
		usage: 'replace --id <doc-id> --search <text> --replace <text> [--workspace <workspace-id>] [--match-all] [--preview]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'search',
				short: 's',
				description: '要搜索替换的文本',
				required: true,
				type: 'string'
			},
			{
				name: 'replace',
				short: 'r',
				description: '替换后的文本',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			},
			{
				name: 'match-all',
				short: 'a',
				description: '替换所有匹配项（默认 true）',
				type: 'boolean'
			},
			{
				name: 'preview',
				short: 'p',
				description: '预览模式（仅显示替换结果，不实际修改）',
				type: 'boolean'
			}
		],
		handler: docReplaceHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			search: parsed.search,
			replace: parsed.replace,
			workspace: parsed.workspace,
			matchAll: parsed['match-all'],
			preview: parsed.preview
		})
	},

	/**
	 * append 命令：追加文档内容
	 * 用法：append --id <doc-id> [--content <markdown|@file>] [--workspace <workspace-id>]
	 */
	append: {
		name: 'append',
		description: '在文档末尾追加 Markdown 内容',
		usage: 'append --id <doc-id> [--content <markdown|@file>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '目标文档 ID',
				required: true,
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
		handler: docAppendHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			content: parseContentParam(parsed.content),
			workspace: parsed.workspace
		})
	},

	/**
	 * publish 命令：发布文档（公开访问）
	 * 用法：publish --id <doc-id> [--mode <Page|Edgeless>] [--workspace <workspace-id>]
	 */
	publish: {
		name: 'publish',
		description: '发布文档（公开访问）',
		usage: 'publish --id <doc-id> [--mode <Page|Edgeless>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '要发布的文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'mode',
				short: 'm',
				description: '公开模式：Page 或 Edgeless',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docPublishHandler,
		paramsMapper: (parsed) => ({
			docId: parsed.id,
			mode: parsed.mode as 'Page' | 'Edgeless' | undefined,
			workspace: parsed.workspace
		})
	},

	/**
	 * unpublish 命令：取消发布文档
	 * 用法：unpublish --id <doc-id> [--workspace <workspace-id>]
	 */
	unpublish: {
		name: 'unpublish',
		description: '取消发布文档',
		usage: 'unpublish --id <doc-id> [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				short: 'i',
				description: '要取消发布的文档 ID',
				required: true,
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: docUnpublishHandler,
		paramsMapper: (parsed) => ({
			docId: parsed.id,
			workspace: parsed.workspace
		})
	}
};

/**
 * 文档 CLI 操作映射
 * 将命令配置转换为命令映射，供 CLI 入口使用
 */
export const runDocCommands = generateCommandMap(docCommands);
