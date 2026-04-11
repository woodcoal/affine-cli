/**
 * 工作区 CLI 模块
 * 提供工作区列表查询等命令
 */

import { CommandConfig, generateCommandMap } from '../utils/cliUtils.js';
import { workspaceListHandler } from '../core/workspace.js';

/**
 * 工作区命令配置
 * 定义所有工作区相关命令的参数和处理器映射
 */
const workspaceCommands: Record<string, CommandConfig> = {
	/**
	 * list 命令：获取工作区列表
	 * 用法：list [--format text|json]
	 */
	list: {
		name: 'list',
		description: '获取当前用户所有工作区的基本信息',
		usage: 'list [--format text|json]',
		args: [],
		handler: workspaceListHandler
	}
};

/**
 * 工作区 CLI 操作映射
 * 将命令配置转换为命令映射，供 CLI 入口使用
 */
export const runWorkspaceCommands = generateCommandMap(workspaceCommands);
