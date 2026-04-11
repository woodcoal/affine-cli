/**
 * 模块名称：cliUtils.ts
 * CLI 工具函数模块
 *
 * 功能描述：
 * - 提供命令行参数解析功能
 * - 生成帮助信息和结果格式化
 * - 定义 CLI 相关的类型和接口
 *
 * 导出的类型：
 * - CommandResult: CLI 命令执行结果
 * - CommandHandler: CLI 命令处理器
 * - ArgDef: 参数定义
 * - CommandConfig: 命令配置
 * - CliAction: CLI 操作定义
 * - CliModule: CLI 模块定义
 *
 * 导出的函数：
 * - parseArgs: 解析命令行参数
 * - createCommandHandler: 创建命令处理器
 * - convertToCliAction: 转换为 CLI 操作
 * - generateCommandMap: 生成命令映射
 * - formatOutput: 格式化输出
 * - outputResult: 输出结果并退出
 * - generateHelp: 生成帮助文本
 */

/**
 * CommandResult: CLI 命令执行结果类型
 *
 * @property success - 是否成功
 * @property output - 输出文本
 * @property error - 错误信息
 * @property data - 返回数据
 */
export type CommandResult = {
	success: boolean;
	output?: string;
	error?: string;
	data?: any;
};

/**
 * CommandHandler: CLI 命令处理器类型
 *
 * @param args - 命令行参数数组
 * @returns CommandResult
 */
export type CommandHandler = (args: string[]) => Promise<CommandResult>;

/**
 * ArgDef: 参数定义类型
 *
 * @property name - 参数名称
 * @property short - 短名称（如 -w）
 * @property description - 参数描述
 * @property required - 是否必需
 * @property default - 默认值
 * @property type - 参数类型（string/number/boolean）
 * @property allowEmpty - 是否允许空字符串值
 */
export type ArgDef = {
	name: string;
	short?: string;
	description: string;
	required?: boolean;
	default?: string;
	type: 'string' | 'number' | 'boolean';
	allowEmpty?: boolean; // 是否允许空字符串值
};

/**
 * CommandConfig: 命令配置接口
 *
 * @property name - 命令名称
 * @property description - 命令描述
 * @property usage - 使用示例
 * @property args - 参数定义数组
 * @property handler - 命令处理器
 * @property paramsMapper - 参数映射函数（可选）
 */
export interface CommandConfig {
	name: string;
	description: string;
	usage: string;
	args: ArgDef[];
	handler: (params: any) => Promise<any>;
	paramsMapper?: (parsed: any) => any;
}

/**
 * CliAction: CLI 操作定义类型
 *
 * @property name - 操作名称
 * @property description - 操作描述
 * @property usage - 使用示例
 * @property handler - 命令处理器
 * @property args - 参数定义数组（可选）
 */
export type CliAction = {
	name: string;
	description: string;
	usage: string;
	handler: CommandHandler;
	args?: ArgDef[];
};

/**
 * CliModule: CLI 模块定义类型
 *
 * @property name - 模块名称
 * @property description - 模块描述
 * @property actions - 操作映射
 */
export type CliModule = {
	name: string;
	description: string;
	actions: Record<string, CliAction>;
};

/* ============================================================================
 * 全局输出格式控制
 * ============================================================================ */

/**
 * 全局输出格式变量
 * 默认为 json 格式输出
 */
let outputFormat: 'text' | 'json' = 'json';

/**
 * setOutputFormat: 设置全局输出格式
 *
 * @param format - 输出格式（text/json）
 */
export function setOutputFormat(format: 'text' | 'json'): void {
	outputFormat = format;
}

/**
 * getOutputFormat: 获取全局输出格式
 *
 * @returns 当前输出格式
 */
export function getOutputFormat(): 'text' | 'json' {
	return outputFormat;
}

/**
 * parseArgs: 解析命令行参数
 *
 * @param args - 原始参数数组
 * @param argDefs - 参数定义数组
 * @returns 包含 parsed（解析后的参数）、positional（位置参数）、errors（错误信息）的对象
 *
 * 支持的格式：
 * - --name value
 * - --name=value
 * - -n value（短名称）
 * - --boolean（布尔值 true）
 * - --boolean false（显式布尔值）
 */
export function parseArgs(
	args: string[],
	argDefs: ArgDef[]
): {
	parsed: Record<string, any>;
	positional: string[];
	errors: string[];
} {
	const parsed: Record<string, any> = {};
	const errors: string[] = [];
	const positional: string[] = [];

	// 初始化默认值
	for (const def of argDefs) {
		if (def.default !== undefined) {
			if (def.type === 'number') {
				parsed[def.name] = Number(def.default);
			} else {
				parsed[def.name] = def.default;
			}
		}
	}

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		// 帮助参数
		if (arg === '-h' || arg === '--help') {
			parsed['__help__'] = true;
			i++;
			continue;
		}

		// 位置参数
		if (!arg.startsWith('-')) {
			positional.push(arg);
			i++;
			continue;
		}

		// 解析命名参数
		let argName = arg.replace(/^-+/, '');
		let value: string | undefined;

		// 处理 --key=value 格式
		if (argName.includes('=')) {
			const parts = argName.split('=');
			argName = parts[0];
			value = parts.slice(1).join('=');
		}

		// 查找参数定义
		const def = argDefs.find((d) => d.name === argName || d.short === argName);
		if (!def) {
			errors.push(`未知选项: ${arg}`);
			i++;
			continue;
		}

		// 布尔类型
		if (def.type === 'boolean') {
			// 检查下一个参数是否是布尔值（如 --resolved false）
			const nextArg = args[i + 1];
			if (nextArg !== undefined && (nextArg === 'false' || nextArg === 'true')) {
				parsed[def.name] = nextArg === 'true';
				i += 2;
				continue;
			}
			// 检查是否使用 --key=value 格式
			if (value !== undefined) {
				parsed[def.name] = value === 'true';
				i++;
				continue;
			}
			// 默认为 true
			parsed[def.name] = true;
			i++;
			continue;
		}

		// 获取值
		if (value === undefined) {
			i++;
			if (i >= args.length) {
				// 如果允许空值，则使用空字符串
				if (def.allowEmpty) {
					parsed[def.name] = '';
					continue;
				}
				errors.push(`选项缺少值: ${arg}`);
				break;
			}
			// 如果下一个参数是选项标志且允许空值，则使用空字符串
			if (def.allowEmpty && args[i].startsWith('-')) {
				parsed[def.name] = '';
				continue;
			}
			value = args[i];
		}

		// 类型转换
		if (def.type === 'number') {
			const num = Number(value);
			if (isNaN(num)) {
				errors.push(`无效的数字 ${arg}: ${value}`);
				i++;
				continue;
			}
			parsed[def.name] = num;
		} else {
			parsed[def.name] = value;
		}

		i++;
	}

	// 检查必需参数
	for (const def of argDefs) {
		if (def.required && parsed[def.name] === undefined && parsed[def.name] !== false) {
			errors.push(`缺少必需选项: --${def.name}`);
		}
	}

	return { parsed, positional, errors };
}

/**
 * createCommandHandler: 创建 CLI 命令处理器
 *
 * @param config - 命令配置对象
 * @returns 命令处理器函数
 *
 * 注意事项：
 * - 自动解析参数并检查必需参数
 * - 错误时返回包含 error 的 CommandResult
 * - 成功时返回包含 data 的 CommandResult
 */
export function createCommandHandler(config: CommandConfig): CommandHandler {
	return async (args: string[]): Promise<CommandResult> => {
		const { parsed, errors } = parseArgs(args, config.args);

		if (errors.length > 0) {
			return { success: false, error: errors.join('\n') };
		}

		try {
			const params = config.paramsMapper ? config.paramsMapper(parsed) : parsed;
			const result = await config.handler(params);

			return {
				success: true,
				data: result
			};
		} catch (error: any) {
			return { success: false, error: error.message };
		}
	};
}

/**
 * convertToCliAction: 转换命令配置为 CLI 操作
 *
 * @param config - 命令配置对象
 * @returns CLI 操作对象
 */
export function convertToCliAction(config: CommandConfig): CliAction {
	return {
		name: config.name,
		description: config.description,
		usage: config.usage,
		args: config.args,
		handler: createCommandHandler(config)
	};
}

/**
 * generateCommandMap: 生成命令映射
 *
 * @param commands - 命令配置对象映射
 * @returns CLI 操作映射
 */
export function generateCommandMap(
	commands: Record<string, CommandConfig>
): Record<string, CliAction> {
	return Object.fromEntries(
		Object.entries(commands).map(([key, config]) => [key, convertToCliAction(config)])
	);
}

/**
 * formatOutput: 格式化输出
 *
 * @param data - 要格式化的数据
 * @param format - 输出格式（text/json），默认为全局设置或 text
 * @returns 格式化后的字符串
 */
export function formatOutput(data: any, format?: 'text' | 'json'): string {
	const fmt = format || getOutputFormat();
	if (fmt === 'json') {
		return JSON.stringify(data, null, 2);
	}

	if (typeof data === 'string') {
		return data;
	}

	if (Array.isArray(data)) {
		if (data.length === 0) return '(空)';
		const lines: string[] = [];
		data.forEach((item, idx) => {
			if (typeof item === 'object' && item !== null) {
				lines.push(`[${idx + 1}]`);
				lines.push(formatObject(item, 1));
				if (idx < data.length - 1) {
					lines.push('');
				}
			} else {
				lines.push(`[${idx + 1}]: ${item}`);
			}
		});
		return lines.join('\n');
	}

	if (typeof data === 'object' && data !== null) {
		return formatObject(data);
	}

	return String(data);
}

/**
 * formatObject: 格式化对象为文本
 *
 * @param obj - 要格式化的对象
 * @param indent - 缩进级别
 * @param isLast - 是否为最后一个元素
 * @returns 格式化后的文本
 */
function formatObject(obj: any, indent = 0): string {
	if (obj === null || obj === undefined) {
		return '(无)';
	}

	if (typeof obj !== 'object') {
		return String(obj);
	}

	const prefix = '  '.repeat(indent);
	const lines: string[] = [];

	if (Array.isArray(obj)) {
		if (obj.length === 0) {
			return '(空)';
		}
		obj.forEach((item, idx) => {
			if (typeof item === 'object' && item !== null) {
				lines.push(`${prefix}[${idx + 1}]`);
				lines.push(formatObject(item, indent + 1));
				if (idx < obj.length - 1) {
					lines.push('');
				}
			} else {
				lines.push(`${prefix}[${idx + 1}]: ${item}`);
			}
		});
	} else {
		const entries = Object.entries(obj).filter(([, value]) => value !== null && value !== undefined);
		entries.forEach(([key, value]) => {
			if (typeof value === 'object' && value !== null) {
				if (Array.isArray(value)) {
					if (value.length === 0) {
						lines.push(`${prefix}${key}: (空)`);
					} else {
						lines.push(`${prefix}${key}:`);
						lines.push(formatObject(value, indent + 1));
					}
				} else {
					lines.push(`${prefix}${key}:`);
					lines.push(formatObject(value, indent + 1));
				}
			} else {
				lines.push(`${prefix}${key}: ${value}`);
			}
		});
	}

	return lines.join('\n');
}

/**
 * outputResult: 输出结果并退出进程
 *
 * @param result - CommandResult 对象
 * @param exitCode - 退出码，默认 0
 * @param forceFormat - 强制输出格式（可选，覆盖全局设置）
 *
 * 注意事项：
 * - 错误输出到 console.error
 * - 成功时根据全局设置输出 JSON 或文本格式
 * - 使用 process.exit 退出进程
 */
export function outputResult(result: CommandResult, exitCode = 0, forceFormat?: 'text' | 'json'): void {
	const format = forceFormat || getOutputFormat();

	if (!result.success && result.error) {
		console.error(result.error);
	} else if (result.data !== undefined) {
		if (format === 'json') {
			console.log(JSON.stringify(result.data, null, 2));
		} else {
			console.log(formatOutput(result.data, 'text'));
		}
	} else if (result.output) {
		console.log(result.output);
	}

	process.exit(exitCode);
}

/**
 * generateHelp: 生成帮助文本
 *
 * @param module - CLI 模块对象
 * @param actionName - 可选的操作名称
 * @returns 格式化的帮助文本
 *
 * 如果指定 actionName，返回该操作的详细帮助
 * 否则返回模块的总体帮助
 */
export function generateHelp(module: CliModule, actionName?: string): string {
	const lines: string[] = [];

	if (actionName && module.actions[actionName]) {
		const action = module.actions[actionName];
		lines.push(`${module.name} ${action.name}`);
		lines.push('');
		lines.push(action.description);
		lines.push('');
		lines.push('用法:');
		lines.push(`  affine-cli ${module.name} ${action.usage}`);
		lines.push('');

		if (action.args && action.args.length > 0) {
			lines.push('选项:');
			for (const arg of action.args) {
				const required = arg.required ? '(必需)' : '(可选)';
				const short = arg.short ? `-${arg.short}, ` : '    ';
				const defaultVal = arg.default !== undefined ? ` [默认: ${arg.default}]` : '';
				lines.push(
					`  ${short}--${arg.name} <值>  ${arg.description} ${required}${defaultVal}`
				);
			}
			lines.push('');
		}

		lines.push('示例:');
		lines.push(`  affine-cli ${module.name} ${action.name} --help`);
	} else {
		lines.push(`${module.name} - ${module.description}`);
		lines.push('');
		lines.push('用法:');
		lines.push(`  affine-cli ${module.name} <操作> [选项]`);
		lines.push('');
		lines.push('操作:');

		for (const [name, action] of Object.entries(module.actions)) {
			lines.push(`  ${name.padEnd(16)} ${action.description}`);
		}
		lines.push('');
		lines.push(`运行 'affine-cli ${module.name} <操作> --help' 查看特定操作的详细信息`);
	}

	return lines.join('\n');
}
