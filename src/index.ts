/**
 * 模块名称：index.ts
 * CLI 主入口模块
 *
 * 功能描述：
 * - 提供 Affine Skill 基础版命令行工具的主入口
 * - 注册所有 CLI 模块（auth, workspace, doc, tags, folder, collection, file, comment, database）
 * - 解析命令行参数并执行对应的操作
 * - 提供帮助信息和版本信息
 *
 * 使用方法：
 * - affine-cli <模块> <操作> [选项]  运行模块命令
 * - affine-cli <模块> --help         显示模块帮助
 * - affine-cli help [模块]           显示帮助
 * - affine-cli --version           显示版本
 *
 * 导出：
 * - CLI_MODULES: 所有注册的 CLI 模块集合
 * - runCli: CLI 入口函数，供外部调用
 */

import { CliModule, generateHelp, outputResult, setOutputFormat } from './utils/cliUtils.js';

/**
 * 导入的 CLI 模块（命令映射）
 */
import { runAuthCommands } from './cli/auth.js';
import { runWorkspaceCommands } from './cli/workspace.js';
import { runDocCommands } from './cli/doc.js';
import { runTagsCommands } from './cli/tags.js';
import { runFolderCommands } from './cli/folder.js';
import { runCollectionCommands } from './cli/collection.js';
import { runFileCommands } from './cli/file.js';
import { runCommentCommands } from './cli/comments.js';
import { runDatabaseCommands } from './cli/database.js';

/**
 * CLI_MODULES: CLI 模块注册表
 *
 * 功能描述：
 * - 存储所有注册的 CLI 模块
 * - 包含模块名称、描述和对应的操作映射
 */
const CLI_MODULES: Record<string, CliModule> = {
	auth: {
		name: 'auth',
		description: '授权管理（登录、登出、状态查询）',
		actions: runAuthCommands
	},
	workspace: {
		name: 'workspace',
		description: '工作区管理',
		actions: runWorkspaceCommands
	},
	doc: {
		name: 'doc',
		description: '文档管理（创建、读取、更新、删除、搜索等）',
		actions: runDocCommands
	},
	tags: {
		name: 'tags',
		description: '标签管理',
		actions: runTagsCommands
	},
	folder: {
		name: 'folder',
		description: '文件夹管理',
		actions: runFolderCommands
	},
	collection: {
		name: 'collection',
		description: '收藏夹管理',
		actions: runCollectionCommands
	},
	file: {
		name: 'file',
		description: '文件附件管理',
		actions: runFileCommands
	},
	comment: {
		name: 'comment',
		description: '评论管理（列出、创建、更新、删除、解决评论）',
		actions: runCommentCommands
	},
	database: {
		name: 'database',
		description: '数据库管理（在文档中添加、管理数据表）',
		actions: runDatabaseCommands
	}
};

/* ============================================================================
 * 主帮助信息
 * ============================================================================ */

/**
 * printMainHelp: 打印主帮助信息
 *
 * 功能描述：
 * - 打印所有可用的模块列表
 * - 显示使用示例
 */
function printMainHelp() {
	const lines = [
		`affine-cli ${CLI_VERSION} - Affine 基础版命令行工具`,
		'',
		'用法:',
		'  affine-cli <模块> <操作> [选项]  运行模块命令',
		'  affine-cli <模块> --help         显示模块帮助',
		'  affine-cli help [模块]           显示帮助',
		'',
		'全局选项:',
		'  --text                    输出文本格式（默认 JSON）',
		'',
		'模块:'
	];

	for (const [name, module] of Object.entries(CLI_MODULES)) {
		lines.push(`  ${name.padEnd(14)} ${module.description}`);
	}

	lines.push('');
	lines.push('示例:');
	lines.push('  affine-cli auth login');
	lines.push('  affine-cli auth status');
	lines.push('  affine-cli workspace list');
	lines.push('  affine-cli doc list --workspace <workspace-id>');
	lines.push('  affine-cli doc create --title "My Doc" --content "./content.md"');
	lines.push('  affine-cli tags list');
	lines.push('  affine-cli folder create --name "New Folder"');
	lines.push('  affine-cli collection list');
	lines.push('  affine-cli file upload --file "./image.png"');
	lines.push('  affine-cli comment list --doc-id <id>');
	lines.push('  affine-cli comment create --doc-id <id> --content "评论内容"');
	lines.push('  affine-cli database create --title "任务表"');
	lines.push(
		'  affine-cli database create --title "任务表" --columns "[{\"name\":\"状态\",\"type\":\"select\",\"options\":[\"进行中\",\"已完成\"]}]"'
	);
	lines.push('  affine-cli database create --title "任务表" --data @data.json');
	lines.push('  affine-cli database list --doc-id <id>');
	lines.push('  affine-cli database columns --doc-id <id> --db-id <db-id>');
	lines.push('  affine-cli database import --doc-id <id> --db-id <db-id> --json @data.json');
	lines.push('  affine-cli database export --doc-id <id> --db-id <db-id>');
	lines.push('  affine-cli database delete --doc-id <id> --db-id <db-id>');

	console.log(lines.join('\n'));
}

/* ============================================================================
 * CLI 主入口
 * ============================================================================ */

import { CLI_VERSION } from './utils/version.js';

/**
 * runCli: CLI 主入口函数
 *
 * 功能描述：
 * - 解析命令行参数
 * - 查找并执行对应的模块操作
 * - 处理帮助信息和版本信息
 *
 * @param args - 命令行参数数组
 * @returns 执行是否成功
 *
 * 使用示例：
 * - runCli(['doc', 'list', '--workspace', 'xxx'])
 * - runCli(['--version'])
 */
export async function runCli(args: string[]): Promise<boolean> {
	// 解析全局选项
	const globalArgs = [...args];
	let command: string | undefined;
	let remainingArgs: string[] = [];

	// 提取全局选项并过滤
	const filteredArgs = globalArgs.filter((arg) => {
		if (arg === '--text') {
			setOutputFormat('text');
			return false;
		}
		return true;
	});

	// 解析命令和参数
	if (filteredArgs.length > 0) {
		command = filteredArgs[0];
		remainingArgs = filteredArgs.slice(1);
	}

// 版本信息
	if (command === '--version' || command === '-v' || command === 'version') {
		console.log(CLI_VERSION);
		return true;
	}

	// 帮助信息
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		if (remainingArgs.length > 0) {
			const target = remainingArgs[0];
			if (CLI_MODULES[target]) {
				console.log(generateHelp(CLI_MODULES[target]));
				return true;
			}
		}
		printMainHelp();
		return true;
	}

	// 检查模块
	const module = CLI_MODULES[command];
	if (module) {
		let [actionName, ...moduleArgs] = remainingArgs;

		// 检查 actionName 是否为 --help 或 -h
		if (actionName === '--help' || actionName === '-h') {
			console.log(generateHelp(module));
			return true;
		}

		// 无 action 或请求帮助
		if (
			!actionName ||
			actionName === 'help' ||
			moduleArgs.includes('--help') ||
			moduleArgs.includes('-h')
		) {
			console.log(generateHelp(module, actionName));
			return true;
		}

		// 查找动作
		const action = module.actions[actionName];
		if (!action) {
			console.error(`未知操作: ${actionName}`);
			console.error(`运行 'affine-cli ${command} --help' 查看可用操作`);
			return false;
		}

		// 执行动作
		try {
			const result = await action.handler(moduleArgs);
			outputResult(result, result.success ? 0 : 1);
			return result.success;
		} catch (err: any) {
			console.error(`错误: ${err.message}`);
			return false;
		}
	}

	console.error(`未知命令: ${command}`);
	printMainHelp();
	return false;
}

/* ============================================================================
 * 入口点
 * ============================================================================ */

/**
 * CLI 入口点
 *
 * 功能描述：
 * - 从 process.argv 获取命令行参数
 * - 执行 CLI 并根据结果退出进程
 * - 成功退出码为 0，失败退出码为 1
 */
const rawArgs = process.argv.slice(2);
const cliArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

import { closeWorkspaceSocket } from './utils/wsClient.js';

runCli(cliArgs)
	.then((success) => {
		closeWorkspaceSocket();
		process.exit(success ? 0 : 1);
	})
	.catch((err) => {
		console.error(`致命错误: ${err.message}`);
		closeWorkspaceSocket();
		process.exit(1);
	});

// 导出模块供外部使用
export { CLI_MODULES };
