/**
 * 模块名称：graphqlClient.ts
 * GraphQL 客户端模块
 *
 * 功能描述：
 * - 提供与 Affine GraphQL API 交互的功能
 * - 支持 Cookie 和 Bearer Token 认证
 * - 处理请求超时和错误
 *
 * 导出的类和函数：
 * - GraphQLClient: GraphQL 客户端类
 * - createGraphQLClient: 创建 GraphQL 客户端实例
 */

import { fetch } from 'undici';
import { loadConfig } from './config.js';

const GRAPHQL_FETCH_TIMEOUT_MS = 30_000;

/**
 * GraphQL 客户端类
 */
export class GraphQLClient {
	private _headers: Record<string, string>;
	private authenticated: boolean = false;

	constructor(
		private _endpoint: string,
		headers?: Record<string, string>,
		bearer?: string
	) {
		this._headers = { ...(headers || {}) };

		// 设置认证（优先级：Bearer Token > Cookie）
		if (bearer) {
			this._headers['Authorization'] = `Bearer ${bearer}`;
			this.authenticated = true;
		} else if (this._headers.Cookie) {
			this.authenticated = true;
		}
	}

	/** GraphQL 端点 URL */
	get endpoint(): string {
		return this._endpoint;
	}

	/** 获取当前请求头 */
	get headers(): Record<string, string> {
		return { ...this._headers };
	}

	/** 获取 Cookie 值 */
	get cookie(): string {
		return this._headers['Cookie'] || '';
	}

	/** 获取 Bearer Token */
	get bearer(): string {
		const auth = this._headers['Authorization'] || '';
		return auth.startsWith('Bearer ') ? auth.slice(7) : '';
	}

	/** 检查是否已认证 */
	isAuthenticated(): boolean {
		return this.authenticated;
	}

	/**
	 * 执行 GraphQL 请求
	 * @param query 查询语句
	 * @param variables 查询变量
	 * @returns 查询结果
	 */
	async request<T>(query: string, variables?: Record<string, any>): Promise<T> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'User-Agent': 'affine-cli/1.26.411',
			...this._headers
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), GRAPHQL_FETCH_TIMEOUT_MS);
		let res;
		try {
			res = await fetch(this.endpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify({ query, variables }),
				signal: controller.signal
			});
		} catch (err: any) {
			if (err.name === 'AbortError')
				throw new Error(`请求超时 (${GRAPHQL_FETCH_TIMEOUT_MS / 1000}s)`);
			throw err;
		} finally {
			clearTimeout(timer);
		}

		if (!res.ok) {
			let body: string;
			try {
				const json = (await res.json()) as any;
				body = json.errors?.map((e: any) => e.message).join('; ') || JSON.stringify(json);
			} catch {
				body = await res.text().catch(() => '(无法读取响应体)');
			}
			throw new Error(`GraphQL HTTP ${res.status}: ${body}`);
		}

		const json = (await res.json()) as any;
		if (json.errors) {
			const msg = json.errors.map((e: any) => e.message).join('; ');
			throw new Error(`GraphQL 错误: ${msg}`);
		}
		return json.data as T;
	}
}

/**
 * 创建 GraphQL 客户端实例
 * @returns GraphQL 客户端
 */
export async function createGraphQLClient(): Promise<GraphQLClient> {
	const config = loadConfig();
	const headers: Record<string, string> = {};
	if (config.cookie) {
		headers.Cookie = config.cookie;
	}

	const gql = new GraphQLClient(`${config.baseUrl}/graphql`, headers, config.apiToken);

	if (!gql.isAuthenticated()) {
		throw new Error(
			'未配置认证信息。请运行 affine-skill auth login 或设置 AFFINE_API_TOKEN 环境变量'
		);
	}

	return gql;
}
