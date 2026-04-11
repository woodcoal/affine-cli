/**
 * 文档核心模块
 * 处理文档的增删改查、搜索、复制、更新、追加等操作
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceId, getBaseUrl } from '../utils/config.js';
import {
	createDocFromMarkdownCore,
	collectDocForMarkdown,
	getWorkspaceTagOptions
} from '../utils/docsUtil.js';
import {
	getWorkspaceDocs,
	createWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate,
	extractTagNames
} from '../utils/wsClient.js';
import { renderBlocksToMarkdown } from '../markdown/render.js';
import { generateId } from '../utils/misc.js';
import { parseMarkdownToOperations } from '../markdown/parse.js';
import type { MarkdownOperation } from '../markdown/types.js';
import * as fs from 'fs';
import * as Y from 'yjs';

/**
 * docListHandler: 列出工作区中的文档
 *
 * 功能描述：
 * - 通过 GraphQL API 获取文档列表
 * - 通过 WebSocket 获取文档实时标题信息
 * - 返回分页信息和文档元数据
 *
 * @param params.count - 每页返回数量，默认 50
 * @param params.skip - 跳过记录数，用于分页
 * @param params.after - 游标，用于分页
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 返回文档总数、是否有下一页、游标和文档列表
 *
 * 注意事项：
 * - 文档标题优先使用 WebSocket 实时获取的标题，若无则使用 GraphQL 返回的标题
 * - 若两者都没有标题，返回 '未命名文档'
 */
export async function docListHandler(params: {
	count?: number;
	skip?: number;
	after?: string;
	workspace?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspace);

	const first = params.count || 50;
	const offset = params.skip || 0;
	const after = params.after || null;

	const query = `query ListDocs($workspaceId: String!, $first: Int, $offset: Int, $after: String) {
    workspace(id: $workspaceId) {
      docs(pagination: { first: $first, offset: $offset, after: $after }) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            workspaceId
            title
            summary
            public
            defaultRole
            createdAt
            updatedAt
          }
        }
      }
    }
  }`;

	const data = await gql.request<any>(query, {
		workspaceId,
		first,
		offset,
		after
	});

	const docs = data.workspace.docs;
	const pagesInfo = await getWorkspaceDocs(workspaceId);

	const edges = docs.edges.map((edge: any) => {
		const pageInfo = pagesInfo.get(edge.node.id);
		return {
			cursor: edge.cursor,
			node: {
				...edge.node,
				title: pageInfo?.title || edge.node.title || '未命名文档'
			}
		};
	});

	return {
		totalCount: docs.totalCount,
		hasNextPage: docs.pageInfo.hasNextPage,
		endCursor: docs.pageInfo.endCursor,
		documents: edges.map((e: any) => e.node)
	};
}

/**
 * docInfoHandler: 获取单个文档的详细信息
 *
 * 功能描述：
 * - 通过 GraphQL 获取文档元数据（标题、摘要、创建时间等）
 * - 通过 WebSocket 连接获取实时文档内容和标签信息
 * - 支持三种内容输出模式：markdown（默认）、raw、hidden
 *
 * @param params.id - 文档 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @param params.content - 内容输出模式：
 *   - markdown（默认）：输出渲染后的 Markdown 格式
 *   - raw：输出原始 blocks 数据
 *   - hidden：仅输出元数据，不包含内容
 * @returns 包含文档元数据和可选内容的对象
 *
 * 注意事项：
 * - hidden 模式下不建立 WebSocket 连接，直接返回元数据
 * - 标签信息从工作区元数据中提取
 * - raw 模式返回 blocksById 和 blockCount
 * - markdown 模式返回渲染结果、警告、统计和信息丢失标记
 */
export async function docInfoHandler(params: {
	id: string;
	workspace?: string;
	content?: 'markdown' | 'raw' | 'hidden';
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspace);

	const query = `query GetDoc($workspaceId: String!, $docId: String!) {
    workspace(id: $workspaceId) {
      doc(docId: $docId) {
        id
        workspaceId
        title
        summary
        public
        defaultRole
        createdAt
        updatedAt
        mode
      }
    }
  }`;

	const data = await gql.request<any>(query, {
		workspaceId,
		docId: params.id
	});

	const doc = data.workspace.doc;
	if (!doc) {
		throw new Error(`文档 ${params.id} 不存在`);
	}

	const pagesInfo = await getWorkspaceDocs(workspaceId);
	const pageInfo = pagesInfo.get(params.id);

	const result: any = {
		id: doc.id,
		title: pageInfo?.title || doc.title || '未命名文档',
		summary: doc.summary,
		public: doc.public,
		mode: doc.mode,
		tags: pageInfo?.tags || [],
		createdAt: new Date(doc.createdAt).toLocaleString('zh-CN'),
		updatedAt: new Date(doc.updatedAt).toLocaleString('zh-CN')
	};

	// 默认使用 markdown 模式
	const contentMode = params.content || 'markdown';

	// hidden 模式不输出内容
	if (contentMode === 'hidden') {
		return result;
	}

	// 连接 WebSocket 获取文档内容
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// 获取工作区的标签选项
		const wsSnap = await loadDoc(socket, workspaceId, workspaceId);
		const tagOptionsById = new Map<string, any>();

		if (wsSnap.missing) {
			const wsDoc = new Y.Doc();
			Y.applyUpdate(wsDoc, Buffer.from(wsSnap.missing, 'base64'));
			const wsMeta = wsDoc.getMap('meta');
			const tagOptions = getWorkspaceTagOptions(wsMeta);
			for (const opt of tagOptions) {
				tagOptionsById.set(opt.id, opt);
			}
		}

		// 加载文档内容
		const snap = await loadDoc(socket, workspaceId, params.id);

		if (snap.missing) {
			const doc2 = new Y.Doc();
			Y.applyUpdate(doc2, Buffer.from(snap.missing, 'base64'));

			const collected = collectDocForMarkdown(doc2, tagOptionsById);

			if (contentMode === 'raw') {
				// raw 模式：输出原始 blocks 数据
				result.blocks = Object.fromEntries(collected.blocksById);
				result.blockCount = collected.blocksById.size;
			} else {
				// markdown 模式（默认）：输出 Markdown
				const rendered = renderBlocksToMarkdown({
					rootBlockIds: collected.rootBlockIds,
					blocksById: collected.blocksById
				});

				result.markdown = rendered.markdown;
				result.markdownWarnings = rendered.warnings;
				result.markdownStats = rendered.stats;
				result.lossy = rendered.lossy;
			}
		}
	} finally {
		socket.disconnect();
	}

	return result;
}

/**
 * docCreateHandler: 创建新文档
 *
 * 功能描述：
 * - 使用 Markdown 导入方式创建新文档
 * - 支持设置标题、内容、所属文件夹和标签
 * - 内部调用 createDocFromMarkdownCore 核心函数完成创建
 *
 * @param params.title - 文档标题（可选）
 * @param params.content - 文档内容，支持 Markdown 格式（可选）
 * @param params.folder - 所属文件夹 ID（可选）
 * @param params.tags - 标签，多个用逗号分隔（可选）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含创建结果的对象，包括文档 ID、标题、标签等
 *
 * 注意事项：
 * - 若未提供标题，使用默认空标题创建文档
 * - 若未提供内容，创建空文档
 * - 返回结果包含 warnings 和 lossy 标记，用于提示潜在的内容丢失
 */
export async function docCreateHandler(params: {
	title?: string;
	content?: string;
	folder?: string;
	tags?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);

	let markdown = params.content || '';

	const result = await createDocFromMarkdownCore({
		workspaceId,
		title: params.title,
		markdown,
		tags: params.tags,
		folder: params.folder
	});

	return {
		success: true,
		workspaceId: result.workspaceId,
		docId: result.docId,
		title: result.title,
		tags: result.tags,
		linkedToParent: result.linkedToParent,
		warnings: result.warnings,
		lossy: result.lossy,
		stats: result.stats
	};
}

/**
 * docDeleteHandler: 删除指定文档
 *
 * 功能描述：
 * - 通过 WebSocket 连接操作 Yjs 文档
 * - 从工作区的 pages 列表中移除指定文档的引用
 * - 实际删除操作会标记该文档为已删除
 *
 * @param params.id - 要删除的文档 ID（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 删除结果对象
 *
 * 注意事项：
 * - 该操作仅从工作区页面列表中移除文档引用
 * - 实际的文档数据可能仍然存在于服务器上
 * - 需要建立 WebSocket 连接才能执行删除操作
 */
export async function docDeleteHandler(params: { id: string; workspace?: string }): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const wsDoc = new Y.Doc();
		const snapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (!snapshot.missing) {
			throw new Error('工作区根文档不存在');
		}

		Y.applyUpdate(wsDoc, Buffer.from(snapshot.missing, 'base64'));
		const prevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (pages) {
			let foundIndex = -1;
			pages.forEach((page: Y.Map<any>, index: number) => {
				if (page.get('id') === params.id) {
					foundIndex = index;
				}
			});

			if (foundIndex !== -1) {
				pages.delete(foundIndex, 1);
			}
		}

		const wsDelta = Y.encodeStateAsUpdate(wsDoc, prevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(wsDelta).toString('base64')
		);

		return {
			success: true,
			message: `文档 ${params.id} 已删除`
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * docCopyHandler: 复制文档
 *
 * 功能描述：
 * - 复制源文档的内容到一个新文档
 * - 保留源文档的标签和父文档信息
 * - 支持自定义新文档的标题、目标父文档和文件夹
 * - 内部通过 WebSocket + Yjs 完成复制操作
 *
 * @param params.id - 源文档 ID（必需）
 * @param params.title - 新文档标题，默认 '复制文档'
 * @param params.parent - 父文档 ID，新文档将作为其子文档（可选）
 * @param params.folder - 文件夹 ID，新文档将放入该文件夹（可选）
 *   - 若未指定，默认继承源文档的文件夹
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含新文档 ID 和标题的结果对象
 *
 * 注意事项：
 * - 复制操作会为新文档生成新的唯一 ID
 * - 源文档的标签会被复制到新文档
 * - 源文档的父文档信息可以被继承或覆盖
 * - 源文档的文件夹可以被继承或指定新的文件夹
 */
export async function docCopyHandler(params: {
	id: string;
	title?: string;
	parent?: string;
	folder?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const newDocId = generateId(12, 'doc');
	const newTitle = params.title || '复制文档';

	try {
		await joinWorkspace(socket, workspaceId);

		// 获取源文档信息（标签和父文档）
		const sourceDocInfo = await getSourceDocInfo(socket, workspaceId, params.id);
		const sourceTags = sourceDocInfo.tags || [];
		const sourceParent = sourceDocInfo.parentId;

		// 获取源文档所在文件夹
		let sourceFolderId: string | null = null;
		if (!params.folder) {
			sourceFolderId = await getDocFolderId(socket, workspaceId, params.id);
		}

		const sourceSnapshot = await loadDoc(socket, workspaceId, params.id);
		if (!sourceSnapshot.missing) {
			throw new Error('源文档不存在');
		}

		const sourceDoc = new Y.Doc();
		Y.applyUpdate(sourceDoc, Buffer.from(sourceSnapshot.missing, 'base64'));
		const sourceUpdate = Y.encodeStateAsUpdate(sourceDoc);

		const newDoc = new Y.Doc();
		Y.applyUpdate(newDoc, sourceUpdate);

		const blocks = newDoc.getMap('blocks');
		let foundPage = false;
		blocks.forEach((value: unknown, _: string) => {
			if (foundPage) return;
			if (value instanceof Y.Map) {
				const flavour = value.get('sys:flavour');
				if (flavour === 'affine:page') {
					const titleText = new Y.Text();
					titleText.insert(0, newTitle);
					value.set('prop:title', titleText);
					foundPage = true;
				}
			}
		});

		const meta = newDoc.getMap('meta');
		meta.set('id', newDocId);
		meta.set('title', newTitle);
		meta.set('createDate', Date.now());

		const updateFull = Y.encodeStateAsUpdate(newDoc);
		await pushDocUpdate(
			socket,
			workspaceId,
			newDocId,
			Buffer.from(updateFull).toString('base64')
		);

		const wsDoc = new Y.Doc();
		const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
		if (wsSnapshot.missing) {
			Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, 'base64'));
		}
		const prevSV = Y.encodeStateVector(wsDoc);
		const wsMeta = wsDoc.getMap('meta');

		let pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;
		if (!pages) {
			pages = new Y.Array<Y.Map<any>>();
			wsMeta.set('pages', pages);
		}

		// 复制源文档的标签
		const newTags = new Y.Array<any>();
		sourceTags.forEach((tagId: string) => {
			newTags.push([tagId]);
		});

		const entry = new Y.Map<any>();
		entry.set('id', newDocId);
		entry.set('title', newTitle);
		entry.set('createDate', Date.now());
		entry.set('tags', newTags);
		// 复制父文档 ID（如果有）
		if (params.parent) {
			entry.set('parentId', params.parent);
		} else if (sourceParent) {
			entry.set('parentId', sourceParent);
		}
		pages.push([entry as any]);

		const wsDelta = Y.encodeStateAsUpdate(wsDoc, prevSV);
		await pushDocUpdate(
			socket,
			workspaceId,
			workspaceId,
			Buffer.from(wsDelta).toString('base64')
		);

		// 如果没有指定 folder，则继承源文档的文件夹；否则添加到指定文件夹
		const targetFolderId = params.folder || sourceFolderId;
		if (targetFolderId) {
			await addDocToFolder(socket, workspaceId, newDocId, targetFolderId);
		}

		return {
			success: true,
			id: newDocId,
			title: newTitle
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * getSourceDocInfo: 获取源文档的信息（标签和父文档 ID）
 *
 * 功能描述：
 * - 从工作区元数据中查找指定文档的信息
 * - 提取该文档关联的标签 ID 列表
 * - 获取该文档的父文档 ID（如果有）
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 要查询的文档 ID
 * @returns 包含 tags（标签 ID 数组）和 parentId（父文档 ID）的对象
 *
 * 注意事项：
 * - 返回的 tags 是标签 ID，不是标签名称
 * - 若文档没有标签或父文档，返回空数组和 null
 */
async function getSourceDocInfo(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<{
	tags: string[];
	parentId: string | null;
}> {
	const wsDoc = new Y.Doc();
	const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
	if (!wsSnapshot.missing) {
		return { tags: [], parentId: null };
	}

	Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, 'base64'));
	const wsMeta = wsDoc.getMap('meta');
	const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

	if (!pages) {
		return { tags: [], parentId: null };
	}

	for (let i = 0; i < pages.length; i++) {
		const entry = pages.get(i);
		if (entry.get('id') === docId) {
			const tagsArray = entry.get('tags') as Y.Array<any> | undefined;
			const tags: string[] = [];
			if (tagsArray) {
				for (let j = 0; j < tagsArray.length; j++) {
					const tagId = tagsArray.get(j);
					if (typeof tagId === 'string') {
						tags.push(tagId);
					}
				}
			}
			const parentId = entry.get('parentId') || null;
			return { tags, parentId };
		}
	}

	return { tags: [], parentId: null };
}

/**
 * getDocFolderId: 获取文档所在的文件夹 ID
 *
 * 功能描述：
 * - 查询工作区的文件夹结构
 * - 遍历所有文件夹链接，找到指向目标文档的文件夹
 * - 返回该文档的父文件夹 ID
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @returns 文件夹 ID，若文档不在任何文件夹中则返回 null
 *
 * 注意事项：
 * - 使用特殊的文档 ID（db${workspaceId}$folders）访问文件夹数据
 * - 遍历文件夹链接记录，查找 type='doc' 且 data=docId 的记录
 * - 返回记录的 parentId，即为文档所在的文件夹
 */
async function getDocFolderId(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<string | null> {
	const docId_special = `db$${workspaceId}$folders`;
	const snapshot = await loadDoc(socket, workspaceId, docId_special);

	const doc = new Y.Doc();
	if (snapshot.missing) {
		Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
	}

	// const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) continue;
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map)) continue;
		if (record.get('$$DELETED') === true || record.size === 0) continue;

		const type = record.get('type');
		const data = record.get('data');
		const parentId = record.get('parentId');

		if (type === 'doc' && data === docId) {
			const pid = parentId as string | null;
			return pid || null;
		}
	}

	return null;
}

/**
 * addDocToFolder: 将文档添加到指定文件夹
 *
 * 功能描述：
 * - 在文件夹的子项中添加一个新的文档链接记录
 * - 自动计算并分配正确的排序索引
 * - 通过 WebSocket + Yjs 更新文件夹数据
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 要添加的文档 ID
 * @param folderId - 目标文件夹 ID
 *
 * 注意事项：
 * - 使用特殊的文档 ID（db${workspaceId}$folders）访问文件夹数据
 * - 找到目标文件夹中子项的最大 index，新链接的 index 设为 maxIndex + 1
 * - 创建新链接记录，包含 id、type、data、parentId、index 字段
 */
async function addDocToFolder(
	socket: any,
	workspaceId: string,
	docId: string,
	folderId: string
): Promise<void> {
	const docId_special = `db$${workspaceId}$folders`;
	const snapshot = await loadDoc(socket, workspaceId, docId_special);

	const doc = new Y.Doc();
	if (snapshot.missing) {
		Y.applyUpdate(doc, Buffer.from(snapshot.missing, 'base64'));
	}

	const nodes: any[] = [];
	for (const key of doc.share.keys()) {
		if (!doc.share.has(key)) continue;
		const record = doc.getMap(key);
		if (!(record instanceof Y.Map)) continue;
		if (record.get('$$DELETED') === true || record.size === 0) continue;

		nodes.push({
			id: key,
			type: record.get('type'),
			data: record.get('data'),
			parentId: record.get('parentId'),
			index: record.get('index')
		});
	}

	// 找到文件夹的子项中最大的 index
	let maxIndex = 0;
	const folderChildren = nodes.filter((n: any) => n.parentId === folderId && n.type === 'doc');
	folderChildren.forEach((n: any) => {
		if (n.index && parseInt(n.index) > maxIndex) {
			maxIndex = parseInt(n.index);
		}
	});

	const linkId = generateId(12, 'link');
	const record = doc.getMap(linkId);
	record.set('id', linkId);
	record.set('type', 'doc');
	record.set('data', docId);
	record.set('parentId', folderId);
	record.set('index', String(maxIndex + 1));

	const update = Y.encodeStateAsUpdate(doc);
	await pushDocUpdate(socket, workspaceId, docId_special, Buffer.from(update).toString('base64'));
}

/**
 * docUpdateHandler: 更新文档属性
 *
 * 功能描述：
 * - 支持更新文档的标题、文件夹和父文档
 * - 通过 WebSocket + Yjs 进行实时更新
 * - 标题更新会同时更新工作区元数据和文档本身
 * - 文件夹更新会先从原文件夹移除，再添加到新文件夹
 *
 * @param params.id - 要更新的文档 ID（必需）
 * @param params.title - 新标题（可选）
 * @param params.parent - 父文档 ID（可选，目前未实现）
 * @param params.folder - 文件夹 ID（可选）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含更新结果的对象
 *
 * 注意事项：
 * - 标题不能为空，否则抛出异常
 * - 文件夹更新会先清除所有现有文件夹关联
 * - 父文档更新功能目前尚未实现
 * - 返回消息列出了所有成功的更新操作
 */
export async function docUpdateHandler(params: {
	id: string;
	title?: string;
	parent?: string;
	folder?: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		const results: string[] = [];

		// 更新文档标题
		if (params.title) {
			const newTitle = params.title.trim();
			if (!newTitle) {
				throw new Error('标题不能为空');
			}

			// 更新工作区元数据中的文档标题
			const wsSnap = await loadDoc(socket, workspaceId, workspaceId);
			if (wsSnap.missing) {
				const wsDoc = new Y.Doc();
				Y.applyUpdate(wsDoc, Buffer.from(wsSnap.missing, 'base64'));
				const prevSV = Y.encodeStateVector(wsDoc);
				const pages = wsDoc.getMap('meta').get('pages') as Y.Array<any> | undefined;
				if (pages) {
					pages.forEach((page: Y.Map<any>) => {
						if (page instanceof Y.Map && page.get('id') === params.id) {
							page.set('title', newTitle);
						}
					});
				}
				const delta = Y.encodeStateAsUpdate(wsDoc, prevSV);
				await pushDocUpdate(
					socket,
					workspaceId,
					workspaceId,
					Buffer.from(delta).toString('base64')
				);
			}

			// 更新文档本身的标题
			const snap = await loadDoc(socket, workspaceId, params.id);
			if (snap.missing) {
				const doc = new Y.Doc();
				Y.applyUpdate(doc, Buffer.from(snap.missing, 'base64'));
				const prevSV = Y.encodeStateVector(doc);
				const blocks = doc.getMap('blocks') as Y.Map<any>;
				for (const [, raw] of blocks) {
					if (!(raw instanceof Y.Map)) continue;
					if (raw.get('sys:flavour') === 'affine:page') {
						const titleText = new Y.Text();
						titleText.insert(0, newTitle);
						raw.set('prop:title', titleText);
						break;
					}
				}
				const delta = Y.encodeStateAsUpdate(doc, prevSV);
				await pushDocUpdate(
					socket,
					workspaceId,
					params.id,
					Buffer.from(delta).toString('base64')
				);
			}

			results.push('标题已更新');
		}

		// 更新文件夹
		if (params.folder) {
			// 先从原文件夹移除
			await removeDocFromAllFolders(socket, workspaceId, params.id);

			// 添加到新文件夹
			const foldersDocId = `db$${workspaceId}$folders`;
			const foldersDoc = new Y.Doc();
			const foldersSnap = await loadDoc(socket, workspaceId, foldersDocId);

			if (foldersSnap.missing) {
				Y.applyUpdate(foldersDoc, Buffer.from(foldersSnap.missing, 'base64'));
			}

			const nodes: any[] = [];
			for (const key of foldersDoc.share.keys()) {
				if (!foldersDoc.share.has(key)) continue;
				const record = foldersDoc.getMap(key);
				if (!(record instanceof Y.Map)) continue;
				if (record.get('$$DELETED') === true || record.size === 0) continue;
				nodes.push({
					id: key,
					type: record.get('type'),
					data: record.get('data'),
					parentId: record.get('parentId'),
					index: record.get('index')
				});
			}

			// 找到文件夹的子项中最大的 index
			let maxIndex = 0;
			const folderChildren = nodes.filter(
				(n) => n.parentId === params.folder && n.type === 'doc'
			);
			folderChildren.forEach((n) => {
				if (n.index && parseInt(n.index) > maxIndex) {
					maxIndex = parseInt(n.index);
				}
			});

			// 创建新的链接记录
			const linkId = generateId(12, 'link');
			const record = foldersDoc.getMap(linkId);
			record.set('id', linkId);
			record.set('type', 'doc');
			record.set('data', params.id);
			record.set('parentId', params.folder);
			record.set('index', String(maxIndex + 1));

			const update = Y.encodeStateAsUpdate(foldersDoc);
			await pushDocUpdate(
				socket,
				workspaceId,
				foldersDocId,
				Buffer.from(update).toString('base64')
			);

			results.push('文件夹已更新');
		}

		// 更新父文档
		if (params.parent) {
			// 这里需要通过 embed-linked-doc 来实现
			results.push('父文档更新功能待实现');
		}

		return {
			success: true,
			message: results.length > 0 ? results.join(', ') : '无更新内容'
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * removeDocFromAllFolders: 从所有文件夹中移除指定文档
 *
 * 功能描述：
 * - 遍历工作区的所有文件夹链接
 * - 找到所有指向目标文档的记录
 * - 将这些记录的 $$DELETED 标记设为 true，实现软删除
 *
 * @param socket - WebSocket 连接对象
 * @param workspaceId - 工作区 ID
 * @param docId - 要移除的文档 ID
 *
 * 注意事项：
 * - 使用软删除方式，通过设置 $$DELETED 标记
 * - 只有当有实际需要删除的链接时才推送更新
 * - 使用特殊的文档 ID（db${workspaceId}$folders）访问文件夹数据
 */
async function removeDocFromAllFolders(
	socket: any,
	workspaceId: string,
	docId: string
): Promise<void> {
	const foldersDocId = `db$${workspaceId}$folders`;
	const foldersDoc = new Y.Doc();
	const foldersSnap = await loadDoc(socket, workspaceId, foldersDocId);

	if (foldersSnap.missing) {
		Y.applyUpdate(foldersDoc, Buffer.from(foldersSnap.missing, 'base64'));
	}

	let hasChanges = false;

	for (const key of foldersDoc.share.keys()) {
		if (!foldersDoc.share.has(key)) continue;
		const record = foldersDoc.getMap(key);
		if (!(record instanceof Y.Map)) continue;

		const type = record.get('type');
		const data = record.get('data');

		// 找到所有指向该文档的记录
		if (type === 'doc' && data === docId) {
			record.set('$$DELETED', true);
			hasChanges = true;
		}
	}

	if (hasChanges) {
		const update = Y.encodeStateAsUpdate(foldersDoc);
		await pushDocUpdate(
			socket,
			workspaceId,
			foldersDocId,
			Buffer.from(update).toString('base64')
		);
	}
}

/**
 * docSearchHandler: 搜索文档
 *
 * 功能描述：
 * - 通过 WebSocket 获取工作区中的所有文档
 * - 支持按标题、ID 进行关键词搜索
 * - 支持按标签进行过滤
 * - 支持多种匹配模式：substring（子串）、prefix（前缀）、suffix（后缀）、exact（精确）
 *
 * @param params.query - 搜索关键词（可选）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @param params.count - 返回结果数量限制，默认 20
 * @param params.matchMode - 匹配模式：substring/prefix/suffix/exact，默认 substring
 * @param params.tag - 按标签过滤（可选，始终使用包含匹配）
 * @returns 包含匹配结果数量和文档列表的对象
 *
 * 注意事项：
 * - 标签过滤始终使用包含匹配（忽略大小写）
 * - 关键词搜索支持配置匹配模式，默认使用子串匹配
 * - 搜索会在标题和文档 ID 两个字段上进行
 * - 返回结果按文档创建时间降序排列（先创建的在前）
 */
export async function docSearchHandler(params: {
	query?: string;
	workspace?: string;
	count?: number;
	matchMode?: string;
	tag?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const limit = params.count || 20;
	const query = (params.query || '').trim();
	const matchMode = params.matchMode || 'substring';

	/**
	 * matches: 根据匹配模式判断文本是否匹配
	 *
	 * @param text - 要检查的文本
	 * @param pattern - 匹配模式
	 * @returns 是否匹配
	 *
	 * 支持的匹配模式：
	 * - substring: 子字符串包含匹配（默认）
	 * - prefix: 前缀匹配
	 * - suffix: 后缀匹配
	 * - exact: 完全匹配（忽略大小写）
	 */
	function matches(text: string, pattern: string): boolean {
		const t = text.toLowerCase();
		const p = pattern.toLowerCase();

		switch (matchMode) {
			case 'prefix':
				return t.startsWith(p);
			case 'suffix':
				return t.endsWith(p);
			case 'exact':
				return t === p;
			case 'substring':
			default:
				return t.includes(p);
		}
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// 获取工作区元数据
		const wsSnap = await loadDoc(socket, workspaceId, workspaceId);
		if (!wsSnap.missing) {
			return {
				totalCount: 0,
				documents: []
			};
		}

		const wsDoc = new Y.Doc();
		Y.applyUpdate(wsDoc, Buffer.from(wsSnap.missing, 'base64'));
		const wsMeta = wsDoc.getMap('meta');
		const pages = wsMeta.get('pages') as Y.Array<Y.Map<any>> | undefined;

		if (!pages) {
			return {
				totalCount: 0,
				documents: []
			};
		}

		// 收集文档信息
		const allDocs: any[] = [];
		const tagOptions = getWorkspaceTagOptions(wsMeta);

		pages.forEach((page: Y.Map<any>) => {
			const docId = page.get('id');
			const title = page.get('title') || '';
			const tagsArray = page.get('tags');
			const createDate = page.get('createDate');
			const updateDate = page.get('updateDate');

			// 提取标签名称
			const tagNames: string[] = [];
			if (tagsArray) {
				extractTagNames(tagsArray, tagOptions).forEach((name) => tagNames.push(name));
			}

			allDocs.push({
				id: docId,
				title,
				tags: tagNames,
				createDate,
				updateDate
			});
		});

		// 过滤匹配的结果
		let results = allDocs;

		// 按标签过滤（标签始终使用包含匹配）
		if (params.tag) {
			results = results.filter((doc) =>
				doc.tags.some((t: string) => t.toLowerCase().includes(params.tag!.toLowerCase()))
			);
		}

		// 按关键词搜索（支持匹配模式）
		if (query) {
			results = results.filter((doc) => {
				const titleMatch = matches(doc.title, query);
				const idMatch = matches(doc.id, query);
				return titleMatch || idMatch;
			});
		}

		// 限制返回数量
		results = results.slice(0, limit);

		return {
			totalCount: results.length,
			documents: results
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * docReplaceHandler: 替换文档内容
 *
 * 功能描述：
 * - 在文档的所有文本块中搜索并替换指定内容
 * - 支持处理 Y.Text 类型和数组格式（deltas）的文本
 * - 支持预览模式和全部替换/仅替换第一个
 * - 替换操作会保留原始文本的属性信息
 *
 * @param params.id - 要操作的文档 ID（必需）
 * @param params.search - 要搜索替换的文本（必需）
 * @param params.replace - 替换后的文本（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @param params.matchAll - 是否替换所有匹配项，默认 true
 * @param params.preview - 是否仅预览不实际执行替换，默认 false
 * @returns 包含替换结果的对象
 *
 * 注意事项：
 * - search 文本不能为空
 * - matchAll 默认为 true，即替换所有匹配项
 * - 预览模式下返回受影响的 block 列表，但不执行实际替换
 * - 非预览模式下返回受影响的 block 数量
 * - 仅处理文本类型的块（paragraph、list、code、page、note、callout）
 */
export async function docReplaceHandler(params: {
	id: string;
	search: string;
	replace: string;
	workspace?: string;
	matchAll?: boolean;
	preview?: boolean;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	const socket = await createWorkspaceSocket();

	const searchText = params.search;
	const replaceText = params.replace;
	// 默认为 true，处理布尔值或字符串形式的 false
	const matchAllValue = params.matchAll;
	const matchAll = matchAllValue !== false && String(matchAllValue) !== 'false';

	if (!searchText) {
		throw new Error('搜索文本不能为空');
	}

	try {
		await joinWorkspace(socket, workspaceId);

		// 加载文档
		const snap = await loadDoc(socket, workspaceId, params.id);
		if (!snap.missing) {
			throw new Error(`文档 ${params.id} 不存在`);
		}

		const doc = new Y.Doc();
		Y.applyUpdate(doc, Buffer.from(snap.missing, 'base64'));
		const prevSV = Y.encodeStateVector(doc);
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		let replaceCount = 0;
		const affectedBlocks: string[] = [];

		// 遍历所有块
		for (const [blockId, blockRaw] of blocks.entries()) {
			if (!(blockRaw instanceof Y.Map)) continue;

			const flavour = blockRaw.get('sys:flavour');
			// 只处理文本类型的块
			if (
				![
					'affine:paragraph',
					'affine:list',
					'affine:code',
					'affine:page',
					'affine:note',
					'affine:callout'
				].includes(flavour)
			) {
				continue;
			}

			const textProp = blockRaw.get('prop:text');
			if (!textProp) continue;

			// 处理 Y.Text 类型
			if (textProp instanceof Y.Text) {
				const fullText = textProp.toString();
				const occurrences = matchAll
					? countOccurrences(fullText, searchText)
					: fullText.includes(searchText)
						? 1
						: 0;

				if (occurrences > 0) {
					replaceCount += occurrences;
					affectedBlocks.push(blockId);

					if (!params.preview) {
						// 执行替换
						let newText = fullText;
						if (matchAll) {
							newText = replaceAll(newText, searchText, replaceText);
						} else {
							newText = newText.replace(searchText, replaceText);
						}

						// 替换 Y.Text 内容
						textProp.delete(0, textProp.length);
						textProp.insert(0, newText);
					}
				}
			}
			// 处理数组格式的 deltas
			else if (Array.isArray(textProp)) {
				let fullText = '';
				for (const delta of textProp) {
					if (typeof delta === 'object' && delta.insert) {
						fullText += delta.insert;
					} else if (typeof delta === 'string') {
						fullText += delta;
					}
				}

				const occurrences = matchAll
					? countOccurrences(fullText, searchText)
					: fullText.includes(searchText)
						? 1
						: 0;

				if (occurrences > 0) {
					replaceCount += occurrences;
					affectedBlocks.push(blockId);

					if (!params.preview) {
						// 需要重建 deltas
						let newText = fullText;
						if (matchAll) {
							newText = replaceAll(newText, searchText, replaceText);
						} else {
							newText = newText.replace(searchText, replaceText);
						}

						// 转换为 deltas 格式
						const newDeltas: any[] = [];
						if (newText.length > 0) {
							// 尝试保留原始属性
							const firstDelta = textProp.find(
								(d: any) => typeof d === 'object' && d.attributes
							);
							newDeltas.push({
								insert: newText,
								...(firstDelta?.attributes
									? { attributes: { ...firstDelta.attributes } }
									: {})
							});
						}

						blockRaw.set('prop:text', newDeltas);
						replaceCount += occurrences;
						affectedBlocks.push(blockId);
					}
				}
			}
		}

		// 如果不是预览模式，推送更新
		if (!params.preview && replaceCount > 0) {
			const delta = Y.encodeStateAsUpdate(doc, prevSV);
			await pushDocUpdate(
				socket,
				workspaceId,
				params.id,
				Buffer.from(delta).toString('base64')
			);
		}

		return {
			success: true,
			replaceCount,
			affectedBlocks: params.preview ? affectedBlocks : affectedBlocks.length,
			mode: params.preview ? 'preview' : 'applied',
			preview: params.preview || false
		};
	} finally {
		socket.disconnect();
	}
}

/**
 * countOccurrences: 计算字符串中子串出现的次数
 *
 * @param str - 原始字符串
 * @param search - 要查找的子串
 * @returns 子串在字符串中出现的次数
 */
function countOccurrences(str: string, search: string): number {
	if (!search) return 0;
	let count = 0;
	let pos = 0;
	while ((pos = str.indexOf(search, pos)) !== -1) {
		count++;
		pos += search.length;
	}
	return count;
}

/**
 * 替换所有匹配项
 */
function replaceAll(str: string, search: string, replace: string): string {
	if (!search) return str;
	return str.split(search).join(replace);
}

/**
 * docAppendHandler: 追加 Markdown 内容到文档
 *
 * 功能描述：
 * - 将 Markdown 内容追加到现有文档的末尾
 * - 支持从文件路径读取内容或直接传入内容字符串
 * - 解析 Markdown 为 Yjs 操作，然后应用到文档
 * - 自动处理 note block 的创建（如不存在）
 *
 * @param params.id - 目标文档 ID（必需）
 * @param params.content - 要追加的内容，可以是 Markdown 文本或文件路径（必需）
 * @param params.workspace - 工作区 ID，默认使用配置中的工作区
 * @returns 包含追加结果的对象
 *
 * 注意事项：
 * - 如果 content 是文件路径，会自动读取文件内容
 * - 空内容或仅有空白字符的内容不会执行追加
 * - 返回结果包含解析的 block 数量和实际追加的 block 数量
 * - 警告信息会在 stats.warnings 中返回
 */
export async function docAppendHandler(params: {
	id: string;
	content: string;
	workspace?: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);

	let content = params.content;
	if (content && fs.existsSync(content)) {
		content = fs.readFileSync(content, 'utf-8');
	}

	// 如果没有内容，直接返回
	if (!content || !content.trim()) {
		return {
			success: true,
			message: '无内容追加'
		};
	}

	const socket = await createWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// 解析 Markdown
		const parsedMarkdown = parseMarkdownToOperations(content);
		const operations = parsedMarkdown.operations;

		if (operations.length === 0) {
			return {
				success: true,
				message: '无有效内容可追加',
				stats: {
					parsedBlocks: 0,
					appendedBlocks: 0
				}
			};
		}

		// 加载文档
		const snap = await loadDoc(socket, workspaceId, params.id);
		if (!snap.missing) {
			throw new Error(`文档 ${params.id} 不存在`);
		}

		const doc = new Y.Doc();
		Y.applyUpdate(doc, Buffer.from(snap.missing, 'base64'));
		const prevSV = Y.encodeStateVector(doc);
		const blocks = doc.getMap('blocks') as Y.Map<any>;

		// 找到 note block 或 page block
		const noteId = ensureNoteBlock(blocks);
		const noteBlock = findBlockById(blocks, noteId);
		if (!noteBlock) {
			throw new Error('无法解析 note block');
		}

		const noteChildren = ensureChildrenArray(noteBlock);

		let appendedCount = 0;
		// const lastBlockId = getLastTextBlockId(noteChildren, blocks);

		for (const operation of operations) {
			const result = createBlockFromOperation(operation);
			if (result) {
				blocks.set(result.blockId, result.block);
				noteChildren.push([result.blockId]);
				appendedCount++;
			}
		}

		// 推送更新
		const delta = Y.encodeStateAsUpdate(doc, prevSV);
		await pushDocUpdate(socket, workspaceId, params.id, Buffer.from(delta).toString('base64'));

		return {
			success: true,
			message: `已追加 ${appendedCount} 个内容块到文档 ${params.id}`,
			stats: {
				parsedBlocks: operations.length,
				appendedBlocks: appendedCount,
				warnings: parsedMarkdown.warnings
			}
		};
	} finally {
		socket.disconnect();
	}
}

// /**
//  * getLastTextBlockId: 获取最后一个文本类型的 block ID
//  *
//  * 功能描述：
//  * - 从 note block 的子元素中查找最后一个文本类型的 block
//  * - 文本类型包括：affine:paragraph、affine:list、affine:code
//  * - 用于确定追加内容的位置
//  *
//  * @param children - note block 的子元素数组
//  * @param blocks - 文档的所有 blocks 映射
//  * @returns 最后一个文本类型 block 的 ID，若不存在则返回 undefined
//  */
// function getLastTextBlockId(children: Y.Array<any>, blocks: Y.Map<any>): string | undefined {
// 	const childIds = childIdsFromArray(children);
// 	for (let i = childIds.length - 1; i >= 0; i--) {
// 		const block = blocks.get(childIds[i]);
// 		if (block instanceof Y.Map) {
// 			const flavour = block.get('sys:flavour');
// 			if (['affine:paragraph', 'affine:list', 'affine:code'].includes(flavour)) {
// 				return childIds[i];
// 			}
// 		}
// 	}
// 	return undefined;
// }

// /**
//  * childIdsFromArray: 从 Y.Array 中提取 ID 列表
//  *
//  * @param arr - Y.Array 对象
//  * @returns ID 字符串数组
//  */
// function childIdsFromArray(arr: Y.Array<any>): string[] {
// 	const ids: string[] = [];
// 	arr.forEach((item: any) => {
// 		if (typeof item === 'string') {
// 			ids.push(item);
// 		} else if (Array.isArray(item)) {
// 			ids.push(...item.filter((i: any) => typeof i === 'string'));
// 		}
// 	});
// 	return ids;
// }

/**
 * ensureNoteBlock: 确保文档中存在 note block
 *
 * 功能描述：
 * - 检查文档中是否已存在 affine:note 类型的 block
 * - 若不存在，则创建一个新的 note block
 * - 将新 note block 添加到 page block 的子元素中
 *
 * @param blocks - 文档的所有 blocks 映射
 * @returns note block 的 ID
 *
 * 注意事项：
 * - 如果文档中没有 page block，抛出异常
 * - 新创建的 note block 包含默认属性：xywh、index、hidden、displayMode、background
 */
function ensureNoteBlock(blocks: Y.Map<any>): string {
	const existingNoteId = findBlockIdByFlavour(blocks, 'affine:note');
	if (existingNoteId) {
		return existingNoteId;
	}

	const pageId = findBlockIdByFlavour(blocks, 'affine:page');
	if (!pageId) {
		throw new Error('Document has no page block');
	}

	const noteId = generateId(12, 'note');
	const note = new Y.Map<any>();
	setSysFields(note, noteId, 'affine:note');
	note.set('sys:parent', null);
	note.set('sys:children', new Y.Array<string>());
	note.set('prop:xywh', '[0,0,800,95]');
	note.set('prop:index', 'a0');
	note.set('prop:hidden', false);
	note.set('prop:displayMode', 'both');
	const background = new Y.Map<any>();
	background.set('light', '#ffffff');
	background.set('dark', '#252525');
	note.set('prop:background', background);
	blocks.set(noteId, note);

	const page = blocks.get(pageId) as Y.Map<any>;
	let pageChildren = page.get('sys:children') as Y.Array<string> | undefined;
	if (!(pageChildren instanceof Y.Array)) {
		pageChildren = new Y.Array<string>();
		page.set('sys:children', pageChildren);
	}
	pageChildren.push([noteId]);
	return noteId;
}

/**
 * findBlockIdByFlavour: 根据 flavour 查找 block ID
 *
 * @param blocks - 文档的所有 blocks 映射
 * @param flavour - block 类型（如 'affine:page', 'affine:note'）
 * @returns 找到的 block ID，若不存在则返回 null
 */
function findBlockIdByFlavour(blocks: Y.Map<any>, flavour: string): string | null {
	for (const [id, value] of blocks) {
		if (value instanceof Y.Map && value.get('sys:flavour') === flavour) {
			return String(id);
		}
	}
	return null;
}

/**
 * findBlockById: 根据 ID 查找 block
 *
 * @param blocks - 文档的所有 blocks 映射
 * @param blockId - block 的 ID
 * @returns 找到的 Y.Map 对象，若不存在则返回 null
 */
function findBlockById(blocks: Y.Map<any>, blockId: string): Y.Map<any> | null {
	const value = blocks.get(blockId);
	return value instanceof Y.Map ? value : null;
}

/**
 * ensureChildrenArray: 确保 block 拥有 children 数组
 *
 * @param block - 要检查的 block
 * @returns children Y.Array 对象
 *
 * 注意事项：
 * - 如果 block 已有 sys:children 且为 Y.Array，直接返回
 * - 否则创建新的 Y.Array 并设置到 block
 */
function ensureChildrenArray(block: Y.Map<any>): Y.Array<any> {
	const current = block.get('sys:children');
	if (current instanceof Y.Array) return current;
	const created = new Y.Array<any>();
	block.set('sys:children', created);
	return created;
}

/**
 * setSysFields: 设置 block 的系统字段
 *
 * @param block - 要设置的 block
 * @param blockId - block 的唯一 ID
 * @param flavour - block 的类型
 *
 * 注意事项：
 * - sys:id: block 的唯一标识
 * - sys:flavour: block 的类型（如 affine:page、affine:note）
 * - sys:version: block 版本，page 类型为 2，其他为 1
 */
function setSysFields(block: Y.Map<any>, blockId: string, flavour: string): void {
	block.set('sys:id', blockId);
	block.set('sys:flavour', flavour);
	block.set('sys:version', flavour === 'affine:page' ? 2 : 1);
}

/**
 * makeText: 创建 Y.Text 对象
 *
 * 功能描述：
 * - 将字符串或 deltas 数组转换为 Y.Text 对象
 * - 支持保留原始文本的属性信息
 *
 * @param content - 文本内容，可以是字符串或 deltas 数组
 * @returns 配置好的 Y.Text 对象
 */
function makeText(content: string | any[]): Y.Text {
	const yText = new Y.Text();
	if (typeof content === 'string') {
		if (content.length > 0) {
			yText.insert(0, content);
		}
		return yText;
	}
	let offset = 0;
	for (const delta of content) {
		if (!delta.insert) continue;
		yText.insert(offset, delta.insert, delta.attributes ? { ...delta.attributes } : {});
		offset += delta.insert.length;
	}
	return yText;
}

/**
 * createBlockFromOperation: 根据 Markdown 操作创建 Yjs block
 *
 * 功能描述：
 * - 将 Markdown 解析操作转换为对应的 Y.Map block
 * - 支持多种 block 类型：heading、paragraph、quote、list、code、divider、callout、table、bookmark
 * - 每个 block 都会设置系统字段（id、flavour、version）和必要的属性
 *
 * @param operation - Markdown 操作对象，包含类型和内容信息
 * @param docId - 文档 ID
 * @param workspaceId - 工作区 ID
 * @param afterBlockId - 在哪个 block 之后插入（可选）
 * @returns 包含 blockId 和 block 的对象，若不支持该类型则返回 null
 *
 * 支持的 operation.type：
 * - heading: 标题块，包含层级（h1-h6）
 * - paragraph: 段落块
 * - quote: 引用块
 * - list: 列表块，支持有序/无序/任务列表
 * - code: 代码块，包含语言信息
 * - divider: 分割线
 * - callout: 提示块（带图标和背景色）
 * - table: 表格块，包含行列数和单元格数据
 * - bookmark: 书签块，包含 URL 和标题
 */
function createBlockFromOperation(
	operation: MarkdownOperation
): { blockId: string; block: Y.Map<any> } | null {
	const blockId = generateId(12, 'block');
	const block = new Y.Map<any>();

	switch (operation.type) {
		case 'heading':
		case 'paragraph': {
			const flavour = 'affine:paragraph';
			setSysFields(block, blockId, flavour);
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', operation.type === 'heading' ? `h${operation.level}` : 'text');
			block.set('prop:text', makeText(operation.text));
			return { blockId, block };
		}

		case 'quote': {
			setSysFields(block, blockId, 'affine:paragraph');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', 'quote');
			block.set('prop:text', makeText(operation.text));
			return { blockId, block };
		}

		case 'list': {
			setSysFields(block, blockId, 'affine:list');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:type', operation.style);
			block.set('prop:checked', operation.checked || false);
			block.set('prop:text', makeText(operation.deltas || operation.text));
			return { blockId, block };
		}

		case 'code': {
			setSysFields(block, blockId, 'affine:code');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:language', operation.language || 'txt');
			block.set('prop:text', makeText(operation.text));
			return { blockId, block };
		}

		case 'divider': {
			setSysFields(block, blockId, 'affine:divider');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			return { blockId, block };
		}

		case 'callout': {
			setSysFields(block, blockId, 'affine:callout');
			block.set('sys:parent', null);
			const calloutChildren = new Y.Array<string>();
			const textBlockId = generateId(12, 'para');
			const textBlock = new Y.Map<any>();
			setSysFields(textBlock, textBlockId, 'affine:paragraph');
			textBlock.set('sys:parent', null);
			textBlock.set('sys:children', new Y.Array<string>());
			textBlock.set('prop:type', 'text');
			textBlock.set('prop:text', makeText(operation.text));
			calloutChildren.push([textBlockId]);
			block.set('sys:children', calloutChildren);
			block.set('prop:icon', { type: 'emoji', unicode: '💡' });
			block.set('prop:backgroundColorName', 'grey');
			// 还需要将 textBlock 添加到 blocks
			// 但这里只能返回一个 block，所以 callout 需要特殊处理
			return { blockId, block };
		}

		case 'table': {
			setSysFields(block, blockId, 'affine:table');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			const rows = operation.rows || 2;
			const cols = operation.columns || 2;
			const tableData = operation.tableData || [];

			const rowIds: string[] = [];
			for (let i = 0; i < rows; i++) {
				const rowId = generateId(12, 'row');
				block.set(`prop:rows.${rowId}.rowId`, rowId);
				block.set(`prop:rows.${rowId}.order`, `r${String(i).padStart(4, '0')}`);
				rowIds.push(rowId);
			}

			const columnIds: string[] = [];
			for (let i = 0; i < cols; i++) {
				const columnId = generateId(12, 'col');
				block.set(`prop:columns.${columnId}.columnId`, columnId);
				block.set(`prop:columns.${columnId}.order`, `c${String(i).padStart(4, '0')}`);
				columnIds.push(columnId);
			}

			for (let rowIndex = 0; rowIndex < rowIds.length; rowIndex += 1) {
				const rowId = rowIds[rowIndex];
				for (let colIndex = 0; colIndex < columnIds.length; colIndex += 1) {
					const columnId = columnIds[colIndex];
					const cellText = tableData[rowIndex]?.[colIndex] ?? '';
					block.set(`prop:cells.${rowId}:${columnId}.text`, makeText(cellText));
				}
			}
			return { blockId, block };
		}

		case 'bookmark': {
			setSysFields(block, blockId, 'affine:bookmark');
			block.set('sys:parent', null);
			block.set('sys:children', new Y.Array<string>());
			block.set('prop:style', 'horizontal');
			block.set('prop:url', operation.url);
			block.set('prop:caption', operation.caption || null);
			block.set('prop:description', null);
			block.set('prop:icon', null);
			block.set('prop:image', null);
			block.set('prop:title', null);
			block.set('prop:xywh', '[0,0,0,0]');
			block.set('prop:index', 'a0');
			return { blockId, block };
		}

		default:
			return null;
	}
}

/**
 * docPublishHandler: 发布文档（公开访问）
 *
 * 功能描述：
 * - 通过 GraphQL API 将文档设置为公开访问
 * - 返回公开的文档信息
 *
 * @param params.workspace - 工作区 ID（默认使用配置中的工作区）
 * @param params.docId - 文档 ID（必需）
 * @param params.mode - 公开模式，'Page' 或 'Edgeless'（默认 'Page'）
 * @returns 公开的文档信息
 */
export async function docPublishHandler(params: {
	workspace?: string;
	docId: string;
	mode?: 'Page' | 'Edgeless';
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) {
		throw new Error(
			'workspaceId is required. Provide it as a parameter or set AFFINE_WORKSPACE_ID in environment.'
		);
	}

	const gql = await createGraphQLClient();
	const mutation = `mutation PublishDoc($workspaceId:String!,$docId:String!,$mode:PublicDocMode){ publishDoc(workspaceId:$workspaceId, docId:$docId, mode:$mode){ id workspaceId public mode } }`;

	const data = await gql.request<{ publishDoc: any }>(mutation, {
		workspaceId,
		docId: params.docId,
		mode: params.mode || 'Page'
	});

	const result = data.publishDoc;
	const baseUrl = getBaseUrl();
	const publicMode = params.mode || 'Page';
	result.publicUrl = `${baseUrl}/workspace/${workspaceId}/${params.docId}?mode=${publicMode}`;

	return result;
}

/**
 * docUnpublishHandler: 取消发布文档（取消公开访问）
 *
 * 功能描述：
 * - 通过 GraphQL API 撤销文档的公开访问权限
 * - 返回取消公开后的文档信息
 *
 * @param params.workspace - 工作区 ID（默认使用配置中的工作区）
 * @param params.docId - 文档 ID（必需）
 * @returns 取消公开后的文档信息
 */
export async function docUnpublishHandler(params: {
	workspace?: string;
	docId: string;
}): Promise<any> {
	const workspaceId = getWorkspaceId(params.workspace);
	if (!workspaceId) {
		throw new Error(
			'workspaceId is required. Provide it as a parameter or set AFFINE_WORKSPACE_ID in environment.'
		);
	}

	const gql = await createGraphQLClient();
	const mutation = `mutation RevokeDoc($workspaceId:String!,$docId:String!){ revokePublicDoc(workspaceId:$workspaceId, docId:$docId){ id workspaceId public } }`;

	const data = await gql.request<{ revokePublicDoc: any }>(mutation, {
		workspaceId,
		docId: params.docId
	});

	return data.revokePublicDoc;
}
