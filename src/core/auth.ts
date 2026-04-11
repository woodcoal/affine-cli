/**
 * 认证核心模块
 * 处理登录、登出、状态查询等认证相关操作
 *
 * 支持的认证方式：
 * 1. 邮箱/密码登录（自动生成 API Token）
 * 2. API Token 登录（手动获取或粘贴）
 *
 * 配置存储：
 * - 全局配置：~/.affine-cli/affine-cli.env
 * - 本地配置：当前目录 .env
 */

import * as readline from 'readline';
import {
	loadConfigFile,
	writeConfigFile,
	validateBaseUrl,
	redactSecret,
	GLOBAL_CONFIG_FILE
} from '../utils/config.js';
import { loginWithPassword } from '../utils/auth.js';
import { GraphQLClient } from '../utils/graphqlClient.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/* ============================================================================
 * 交互式输入辅助函数
 * ============================================================================ */

/**
 * 通用交互式输入函数
 *
 * 提示用户输入内容，支持可见和隐藏两种模式
 *
 * @param prompt - 提示文本
 * @param hidden - 是否隐藏输入（密码模式）
 * @returns 用户输入的字符串
 *
 * @example
 * const name = await ask('请输入名称: ');
 * const password = await ask('请输入密码: ', true);
 */
function ask(prompt: string, hidden = false): Promise<string> {
	if (hidden && process.stdin.isTTY) {
		return readHidden(prompt);
	}
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stderr,
			terminal: process.stdin.isTTY ?? false
		});
		rl.question(prompt, (answer) => {
			rl.close();
			resolve((answer || '').trim());
		});
	});
}

/**
 * 隐藏输入实现（TTY 模式下的密码输入）
 *
 * 使用原始模式捕获键盘输入，支持退格和 Ctrl+C 取消
 *
 * @param prompt - 提示文本
 * @returns 用户输入的字符串
 * @throws 用户按 Ctrl+C 时抛出错误
 */
function readHidden(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		process.stderr.write(prompt);
		const buf: string[] = [];
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
		const onData = (ch: string) => {
			switch (ch) {
				case '\r':
				case '\n':
					cleanup();
					process.stderr.write('\n');
					resolve(buf.join(''));
					break;
				case '\u0003': // Ctrl+C
					cleanup();
					process.stderr.write('\n');
					reject(new Error('已取消'));
					break;
				case '\u007F':
				case '\b': // 退格
					buf.pop();
					break;
				default:
					buf.push(ch);
			}
		};
		const cleanup = () => {
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdin.removeListener('data', onData);
		};
		process.stdin.on('data', onData);
	});
}

/* ============================================================================
 * GraphQL 请求辅助函数
 * ============================================================================ */

/**
 * 执行 GraphQL 请求（用于登录阶段）
 *
 * 封装 GraphQL POST 请求，支持 Token 和 Cookie 两种认证方式
 *
 * @param baseUrl - Affine 服务器基础 URL
 * @param auth - 认证信息 { token?, cookie? }
 * @param query - GraphQL 查询字符串
 * @param variables - 可选的变量对象
 * @returns 解析后的响应数据
 * @throws 网络错误、超时、GraphQL 错误
 */
async function gql(
	baseUrl: string,
	auth: { token?: string; cookie?: string },
	query: string,
	variables?: Record<string, any>
): Promise<any> {
	const headers: Record<string, string> = {};
	if (auth.token) {
		headers['Authorization'] = `Bearer ${auth.token}`;
	}
	if (auth.cookie) {
		headers['Cookie'] = auth.cookie;
	}

	const client = new GraphQLClient(`${baseUrl}/graphql`, headers);
	return await client.request(query, variables);
}

/**
 * 检查连接并获取用户信息
 *
 * 通过 GraphQL 查询验证认证是否有效，获取当前用户信息
 *
 * @param baseUrl - Affine 服务器基础 URL
 * @param auth - 认证信息
 * @returns 用户信息对象 { userName, userEmail, workspaceCount }
 * @throws 认证失败
 */
async function inspectConnection(
	baseUrl: string,
	auth: { token?: string; cookie?: string }
): Promise<{ userName: string; userEmail: string; workspaceCount: number }> {
	const data = await gql(baseUrl, auth, 'query { currentUser { name email } workspaces { id } }');
	return {
		userName: data.currentUser.name,
		userEmail: data.currentUser.email,
		workspaceCount: data.workspaces.length
	};
}

/**
 * 检测并选择工作区
 *
 * 如果指定了首选工作区 ID 则直接使用，否则列出所有工作区供用户选择
 *
 * @param baseUrl - Affine 服务器基础 URL
 * @param auth - 认证信息
 * @param preferredWorkspaceId - 首选工作区 ID（可选）
 * @returns 选择的工作区 ID
 * @throws 没有可用工作区或选择无效
 */
async function detectWorkspace(
	baseUrl: string,
	auth: { token?: string; cookie?: string },
	preferredWorkspaceId?: string
): Promise<string> {
	if (preferredWorkspaceId) {
		console.error(`使用指定的工作区: ${preferredWorkspaceId}`);
		return preferredWorkspaceId;
	}

	console.error('检测工作区...');
	const data = await gql(baseUrl, auth, `query {workspaces {id createdAt}}`);

	const workspaces: any[] = data.workspaces;
	if (workspaces.length === 0) {
		console.error('  未找到工作区');
		throw new Error('没有可用工作区，请先创建工作区');
	}

	const formatWs = (w: any) => {
		const date = w.createdAt ? new Date(w.createdAt).toLocaleDateString() : '';
		return `${w.id}  (${date})`;
	};

	if (workspaces.length === 1) {
		console.error(`  找到 1 个工作区: ${formatWs(workspaces[0])}`);
		console.error('  自动选择');
		return workspaces[0].id;
	}

	console.error(`  找到 ${workspaces.length} 个工作区:`);
	workspaces.forEach((w, i) => console.error(`    ${i + 1}) ${formatWs(w)}`));
	const choice = (await ask(`\n选择 [1]: `)) || '1';
	const idx = parseInt(choice, 10) - 1;
	if (idx < 0 || idx >= workspaces.length) {
		throw new Error('无效的选择');
	}
	return workspaces[idx].id;
}

/* ============================================================================
 * 登录处理器
 * ============================================================================ */

/**
 * 登录处理器
 *
 * 主登录入口，支持多种登录方式：
 * 1. 直接使用 API Token（--token 参数）
 * 2. 交互式选择：邮箱/密码登录或粘贴 Token
 *
 * 配置保存位置：
 * - --local: 当前目录 .env
 * - 默认: ~/.affine-cli/affine-cli.env
 *
 * @param params - 参数对象
 * @param params.url - Affine 服务器 URL（默认 https://app.affine.pro）
 * @param params.token - API Token（可选）
 * @param params.workspaceId - 首选工作区 ID（可选）
 * @param params.local - 是否保存到本地配置
 * @param params.force - 是否强制覆盖现有配置
 * @returns 登录结果 { success, message, baseUrl, workspaceId }
 *
 * @example
 * // 使用 Token 登录
 * await authLoginHandler({ token: 'xxx', workspaceId: 'ws123' });
 *
 * // 交互式登录
 * await authLoginHandler({});
 */
export async function authLoginHandler(params: {
	url?: string;
	token?: string;
	workspaceId?: string;
	local?: boolean;
	force?: boolean;
}): Promise<any> {
	console.error('Affine Skill CLI — 登录\n');

	const configFile = params.local
		? path.join(process.cwd(), '.env')
		: path.join(os.homedir(), '.affine-cli', 'affine-cli.env');

	const existing = loadConfigFile();
	if (existing.AFFINE_API_TOKEN && !params.force) {
		console.error(`现有配置: ${configFile}`);
		console.error(`  URL:       ${existing.AFFINE_BASE_URL || '(默认)'}`);
		console.error('  Token:     (已设置)');
		console.error(`  工作区: ${existing.AFFINE_WORKSPACE_ID || '(无)'}\n`);
		const overwrite = await ask('是否覆盖? [y/N] ');
		if (!/^[yY]$/.test(overwrite)) {
			console.error('保留现有配置');
			return { success: false, message: '已取消' };
		}
		console.error('');
	}

	const defaultUrl = existing.AFFINE_BASE_URL || 'https://app.affine.pro';
	const rawUrl = params.url ?? ((await ask(`Affine URL [${defaultUrl}]: `)) || defaultUrl);
	const baseUrl = validateBaseUrl(rawUrl);

	let result: { token: string; workspaceId: string };

	if (params.token) {
		console.error('测试提供的 Token...');
		try {
			const info = await inspectConnection(baseUrl, { token: params.token });
			console.error(`✓ 认证为: ${info.userName} <${info.userEmail}>\n`);
		} catch (err: any) {
			throw new Error(`认证失败: ${err.message}`);
		}
		result = {
			token: params.token,
			workspaceId: await detectWorkspace(baseUrl, { token: params.token }, params.workspaceId)
		};
	} else {
		const method = await ask('\n登录方式 — [1] 邮箱/密码 (推荐)  [2] 粘贴 API Token: ');
		if (method === '2') {
			result = await loginWithToken(baseUrl, params.workspaceId);
		} else {
			result = await loginWithEmail(baseUrl, params.workspaceId);
		}
	}

	writeConfigFile(
		{
			AFFINE_BASE_URL: baseUrl,
			AFFINE_API_TOKEN: result.token,
			AFFINE_WORKSPACE_ID: result.workspaceId
		},
		params.local
	);

	console.error(`\n✓ 已保存到 ${configFile}`);
	return {
		success: true,
		message: '登录成功',
		baseUrl,
		workspaceId: result.workspaceId
	};
}

/**
 * 邮箱密码登录
 *
 * 使用邮箱和密码登录，自动创建 API Token 供后续使用
 *
 * @param baseUrl - Affine 服务器基础 URL
 * @param preferredWorkspaceId - 首选工作区 ID（可选）
 * @returns 登录结果 { token, workspaceId }
 * @throws 登录失败、会话验证失败、Token 创建失败
 */
async function loginWithEmail(
	baseUrl: string,
	preferredWorkspaceId?: string
): Promise<{ token: string; workspaceId: string }> {
	const email = await ask('邮箱: ');
	const password = await ask('密码: ', true);
	if (!email || !password) {
		throw new Error('邮箱和密码不能为空');
	}

	console.error('正在登录...');
	let cookieHeader: string;
	try {
		({ cookieHeader } = await loginWithPassword(baseUrl, email, password));
	} catch (err: any) {
		throw new Error(`登录失败: ${err.message}`);
	}

	const auth = { cookie: cookieHeader };
	try {
		const data = await gql(baseUrl, auth, 'query { currentUser { name email } }');
		console.error(`✓ 已登录为: ${data.currentUser.name} <${data.currentUser.email}>\n`);
	} catch (err: any) {
		throw new Error(`会话验证失败: ${err.message}`);
	}

	console.error('生成 API Token...');
	let token: string;
	try {
		const data = await gql(
			baseUrl,
			auth,
			`mutation($input: GenerateAccessTokenInput!) { generateUserAccessToken(input: $input) { id name token } }`,
			{ input: { name: `affine-cli-${new Date().toISOString().slice(0, 10)}` } }
		);
		token = data.generateUserAccessToken.token;
		console.error(`✓ Token 已创建 (名称: ${data.generateUserAccessToken.name})\n`);
	} catch (err: any) {
		throw new Error(
			`创建 Token 失败: ${err.message}\n` +
				'你可以在 Affine 设置 → 集成 → MCP Server 中手动创建'
		);
	}

	const workspaceId = await detectWorkspace(baseUrl, { token }, preferredWorkspaceId);
	return { token, workspaceId };
}

/**
 * Token 登录
 *
 * 用户手动获取 API Token 后粘贴登录
 *
 * @param baseUrl - Affine 服务器基础 URL
 * @param preferredWorkspaceId - 首选工作区 ID（可选）
 * @returns 登录结果 { token, workspaceId }
 * @throws 未提供 Token、认证失败
 */
async function loginWithToken(
	baseUrl: string,
	preferredWorkspaceId?: string
): Promise<{ token: string; workspaceId: string }> {
	console.error('\n生成 Token 的方法:');
	console.error(`  1. 在浏览器中打开 ${baseUrl}/settings`);
	console.error('  2. 账户设置 → 集成 → MCP Server');
	console.error('  3. 复制 Personal access token\n');

	const token = await ask('API Token: ', true);
	if (!token) {
		throw new Error('未提供 Token');
	}

	console.error('测试连接...');
	try {
		const data = await gql(baseUrl, { token }, 'query { currentUser { name email } }');
		console.error(`✓ 认证为: ${data.currentUser.name} <${data.currentUser.email}>\n`);
	} catch (err: any) {
		throw new Error(`认证失败: ${err.message}`);
	}

	const workspaceId = await detectWorkspace(baseUrl, { token }, preferredWorkspaceId);
	return { token, workspaceId };
}

/**
 * 登出处理器
 *
 * 删除配置文件，支持本地和全局配置
 *
 * @param params - 参数对象
 * @param params.local - 是否删除本地配置（默认删除全局配置）
 * @returns 登出结果 { success, message }
 *
 * @example
 * // 退出全局登录
 * await authLogoutHandler({});
 *
 * // 退出本地登录
 * await authLogoutHandler({ local: true });
 */
export async function authLogoutHandler(params: { local?: boolean }): Promise<any> {
	const configFile = params.local ? process.cwd() + '/.env' : GLOBAL_CONFIG_FILE;
	if (fs.existsSync(configFile)) {
		fs.unlinkSync(configFile);
		console.error(`已移除 ${configFile}`);
		return { success: true, message: '已登出' };
	} else {
		console.error('未找到配置文件');
		return { success: false, message: '未找到配置文件' };
	}
}

/**
 * 状态查询处理器
 *
 * 检查当前登录状态，显示用户信息和配置详情
 *
 * @param params - 参数对象
 * @param params.json - 是否以 JSON 格式输出（默认 false）
 * @returns 状态信息对象，包含配置详情和用户信息
 * @throws 未登录、连接失败
 *
 * @example
 * // 简单输出
 * await authStatusHandler({});
 *
 * // JSON 输出
 * await authStatusHandler({ json: true });
 */
export async function authStatusHandler(params: { json?: boolean }): Promise<any> {
	const config = loadConfigFile();
	if (!config.AFFINE_API_TOKEN) {
		throw new Error('未登录。请运行: affine-cli auth login');
	}

	try {
		const inspection = await inspectConnection(
			config.AFFINE_BASE_URL || 'https://app.affine.pro',
			{ token: config.AFFINE_API_TOKEN }
		);

		if (params.json) {
			return {
				configFile: GLOBAL_CONFIG_FILE,
				baseUrl: config.AFFINE_BASE_URL || 'https://app.affine.pro',
				workspaceId: config.AFFINE_WORKSPACE_ID || null,
				userName: inspection.userName,
				userEmail: inspection.userEmail,
				workspaceCount: inspection.workspaceCount,
				token: redactSecret(config.AFFINE_API_TOKEN)
			};
		}

		console.error(`全局配置: ${GLOBAL_CONFIG_FILE}`);
		console.error(`URL:       ${config.AFFINE_BASE_URL || '(默认)'}`);
		console.error(`Token:     ${redactSecret(config.AFFINE_API_TOKEN)}`);
		console.error(`工作区: ${config.AFFINE_WORKSPACE_ID || '(无)'}\n`);
		console.error(`用户: ${inspection.userName} <${inspection.userEmail}>`);
		console.error(`工作区数量: ${inspection.workspaceCount}`);

		return {
			success: true,
			userName: inspection.userName,
			userEmail: inspection.userEmail,
			workspaceCount: inspection.workspaceCount
		};
	} catch (err: any) {
		throw new Error(`连接失败: ${err.message}`);
	}
}
