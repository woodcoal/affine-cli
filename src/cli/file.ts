/**
 * 文件附件 CLI 模块
 * 提供文件上传、删除、清理等命令行接口
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { fileUploadHandler, fileDeleteHandler, fileCleanHandler } from '../core/file.js';

/**
 * 文件命令配置
 * 定义所有文件相关命令的参数和处理器映射
 */
const fileCommands: Record<string, CommandConfig> = {
	/**
	 * upload 命令：上传附件
	 * 用法：upload [--file <path>] [--content <base64>] [--filename <name>] [--content-type <mime>] [--workspace <workspace-id>]
	 */
	upload: {
		name: 'upload',
		description: '上传附件到工作区',
		usage: 'upload [--file <path>] [--content <base64>] [--filename <name>] [--content-type <mime>] [--workspace <workspace-id>]',
		args: [
			{
				name: 'file',
				short: 'p',
				description: '要上传的文件路径',
				type: 'string'
			},
			{
				name: 'content',
				short: 'c',
				description: 'Base64 编码的内容或直接文本内容',
				type: 'string'
			},
			{
				name: 'filename',
				short: 'n',
				description: '文件名（不指定则使用原文件名或 "content"）',
				type: 'string'
			},
			{
				name: 'content-type',
				description: 'MIME 类型（不指定则自动检测或使用 application/octet-stream）',
				type: 'string'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: fileUploadHandler,
		paramsMapper: (parsed) => ({
			file: parsed.file,
			content: parsed.content,
			filename: parsed.filename,
			contentType: parsed['content-type'],
			workspace: parsed.workspace
		})
	},

	/**
	 * delete 命令：删除附件
	 * 用法：delete --id <blob-id> [--permanently] [--workspace <workspace-id>]
	 */
	delete: {
		name: 'delete',
		description: '删除指定的附件',
		usage: 'delete --id <blob-id> [--permanently] [--workspace <workspace-id>]',
		args: [
			{
				name: 'id',
				description: '要删除的附件 ID（Blob key）',
				required: true,
				type: 'string'
			},
			{
				name: 'permanently',
				short: 'p',
				description: '是否永久删除（默认仅标记为已删除）',
				type: 'boolean'
			},
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: fileDeleteHandler,
		paramsMapper: (parsed) => ({
			id: parsed.id,
			permanently: parsed.permanently,
			workspace: parsed.workspace
		})
	},

	/**
	 * clean 命令：清理已删除的附件
	 * 用法：clean [--workspace <workspace-id>]
	 */
	clean: {
		name: 'clean',
		description: '清理已标记为删除的附件，释放存储空间',
		usage: 'clean [--workspace <workspace-id>]',
		args: [
			{
				name: 'workspace',
				short: 'w',
				description: '工作区 ID（默认使用配置中的工作区）',
				type: 'string'
			}
		],
		handler: fileCleanHandler,
		paramsMapper: (parsed) => ({
			workspace: parsed.workspace
		})
	}
};

/**
 * 文件 CLI 操作映射
 * 将命令配置转换为命令映射，供 CLI 入口使用
 */
export const runFileCommands = generateCommandMap(fileCommands);
