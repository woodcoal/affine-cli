/**
 * 工作区核心模块
 * 处理工作区相关操作，如获取工作区列表等
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';

/**
 * 工作区基本信息接口
 */
export interface WorkspaceInfo {
	id: string;           // 工作区 ID
	public: boolean;     // 是否公开
	enableAi: boolean;    // 是否启用 AI
	createdAt: string;   // 创建时间（本地化字符串）
}

/**
 * 获取工作区列表处理器
 * 
 * 通过 GraphQL 查询获取当前用户的所有工作区基本信息
 * 
 * @returns 工作区信息数组，包含：
 *   - id: 工作区 ID
 *   - public: 是否公开
 *   - enableAi: 是否启用 AI
 *   - createdAt: 创建时间（本地化格式）
 * 
 * @example
 * const workspaces = await workspaceListHandler();
 * // 返回: [{ id: 'ws123', public: false, enableAi: true, createdAt: '2024/1/1' }, ...]
 */
export async function workspaceListHandler(): Promise<WorkspaceInfo[]> {
	const gql = await createGraphQLClient();

	const query = `query { workspaces { id public enableAi createdAt } }`;
	const data = await gql.request<{ workspaces: any[] }>(query);

	return (data.workspaces || []).map((ws: any) => ({
		id: ws.id,
		public: ws.public,
		enableAi: ws.enableAi,
		createdAt: new Date(ws.createdAt).toLocaleString('zh-CN')
	}));
}
