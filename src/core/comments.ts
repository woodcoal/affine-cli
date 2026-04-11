/**
 * 评论核心模块
 * 处理评论的增删改查、解决等操作
 */

import { createGraphQLClient } from '../utils/graphqlClient.js';
import { getWorkspaceId } from '../utils/config.js';
import {
	connectWorkspaceSocket,
	joinWorkspace,
	loadDoc,
	pushDocUpdate
} from '../utils/wsClient.js';
import { generateId } from '../utils/misc.js';
import * as Y from 'yjs';

/**
 * listCommentsHandler: 列出文档评论
 *
 * 功能描述：
 * - 通过 GraphQL API 获取指定文档的评论列表
 * - 支持分页、偏移和游标
 * - 支持返回完整数据或简化数据
 *
 * @param params.workspaceId - 工作区 ID，默认使用配置中的工作区
 * @param params.docId - 文档 ID（必需）
 * @param params.first - 返回数量限制
 * @param params.offset - 偏移量
 * @param params.after - 游标
 * @param params.full - 是否返回完整评论数据，默认 false
 * @returns 评论数组或完整评论对象
 */
export async function listCommentsHandler(params: {
	workspaceId?: string;
	docId: string;
	first?: number;
	offset?: number;
	after?: string;
	full?: boolean;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspaceId);

	const { docId, first, offset, after } = params;

	// 完整数据查询
	const fullQuery = `query ListComments($workspaceId:String!,$docId:String!,$first:Int,$offset:Int,$after:String){ workspace(id:$workspaceId){ comments(docId:$docId, pagination:{first:$first, offset:$offset, after:$after}){ totalCount pageInfo{ hasNextPage endCursor } edges{ cursor node{ id content createdAt updatedAt resolved user{ id name avatarUrl } replies{ id content createdAt updatedAt user{ id name avatarUrl } } } } } } }`;

	const data = await gql.request<{ workspace: any }>(fullQuery, {
		workspaceId,
		docId,
		first,
		offset,
		after
	});

	// 如果不是 full 模式，简化返回数据
	if (!params.full) {
		const edges = data.workspace.comments.edges;
		return edges.map((edge: any) => {
			const node = edge.node;
			// 从 snapshot.blocks 中提取评论正文
			const commentContent = extractCommentContent(node.content);
			return {
				id: node.id,
				content: commentContent, // 评论正文
				preview: node.content?.preview || '', // 引用的文档文本
				title: node.content?.snapshot?.meta?.title || '', // 文档标题
				resolved: node.resolved,
				user: node.user ? { name: node.user.name } : null,
				createdAt: node.createdAt,
				updatedAt: node.updatedAt,
				repliesCount: node.replies?.length || 0
			};
		});
	}

	return data.workspace.comments;
}

/**
 * extractCommentContent: 从评论 content 中提取评论正文
 *
 * @param content - 评论的 content 对象
 * @returns 评论正文字符串
 */
function extractCommentContent(content: any): string {
	if (!content?.snapshot?.blocks) return '';
	const blocks = content.snapshot.blocks;
	// 递归查找 paragraph 中的文本
	return extractTextFromSnapshotBlock(blocks);
}

/**
 * extractTextFromSnapshotBlock: 递归从 snapshot block 中提取文本
 *
 * @param block - snapshot block 对象
 * @returns 提取的文本字符串
 */
function extractTextFromSnapshotBlock(block: any): string {
	if (!block) return '';

	// 如果是段落类型，提取文本
	if (block.flavour === 'affine:paragraph') {
		const text = block.props?.text;
		if (text?.delta && Array.isArray(text.delta)) {
			return text.delta.map((d: any) => d.insert || '').join('');
		}
	}

	// 递归搜索子元素
	if (block.children && Array.isArray(block.children)) {
		for (const child of block.children) {
			const text = extractTextFromSnapshotBlock(child);
			if (text) return text;
		}
	}

	return '';
}

// /**
//  * yDocToSnapshot: 将 Y.Doc 转换为 Affine snapshot 格式
//  *
//  * @param doc - Y.Doc 对象
//  * @param docTitle - 文档标题
//  * @param mode - 文档模式（page/edgeless）
//  * @returns snapshot 格式对象
//  */
// function yDocToSnapshot(doc: Y.Doc, docTitle: string, mode: string) {
// 	const meta = doc.getMap('meta');
// 	const blocks = doc.getMap('blocks');

// 	const snapshot: any = {
// 		type: 'page',
// 		meta: {
// 			id: meta.get('id') || generateId(),
// 			title: docTitle,
// 			createDate: meta.get('createDate') || Date.now(),
// 			tags: []
// 		},
// 		blocks: convertBlocksToSnapshot(blocks)
// 	};

// 	return snapshot;
// }

// /**
//  * convertBlocksToSnapshot: 转换 blocks 为 snapshot 格式
//  *
//  * @param blocks - Y.Map 包含所有 blocks
//  * @returns snapshot 格式的 blocks 对象
//  */
// function convertBlocksToSnapshot(blocks: Y.Map<any>): any {
// 	const result: any = {
// 		type: 'block',
// 		id: 'root',
// 		flavour: '',
// 		version: 1,
// 		props: {},
// 		children: []
// 	};

// 	// 找到 page block 作为根
// 	for (const [id, block] of blocks) {
// 		if (!(block instanceof Y.Map)) continue;
// 		const flavour = block.get('sys:flavour');
// 		if (flavour === 'affine:page') {
// 			return convertBlockToSnapshot(block, blocks);
// 		}
// 	}

// 	// 如果没有 page block，找第一个 note
// 	for (const [id, block] of blocks) {
// 		if (!(block instanceof Y.Map)) continue;
// 		const flavour = block.get('sys:flavour');
// 		if (flavour === 'affine:note') {
// 			return convertBlockToSnapshot(block, blocks);
// 		}
// 	}

// 	return result;
// }

// /**
//  * convertBlockToSnapshot: 转换单个 block 为 snapshot 格式
//  *
//  * @param block - Y.Map block 对象
//  * @param allBlocks - 文档的所有 blocks
//  * @returns snapshot 格式的 block 对象
//  */
// function convertBlockToSnapshot(block: Y.Map<any>, allBlocks: Y.Map<any>): any {
// 	const result: any = {
// 		type: 'block',
// 		id: block.get('sys:id'),
// 		flavour: block.get('sys:flavour'),
// 		version: block.get('sys:version') || 1,
// 		props: {},
// 		children: []
// 	};

// 	// 复制所有 prop:* 属性
// 	block.forEach((value: any, key: string) => {
// 		if (key.startsWith('prop:')) {
// 			const propKey = key.substring(5);
// 			if (value instanceof Y.Text) {
// 				result.props[propKey] = {
// 					'$blocksuite:internal:text$': true,
// 					delta: yTextToDelta(value)
// 				};
// 			} else if (propKey === 'title' && value instanceof Y.Text) {
// 				result.props[propKey] = {
// 					'$blocksuite:internal:text$': true,
// 					delta: yTextToDelta(value)
// 				};
// 			} else {
// 				result.props[propKey] = value;
// 			}
// 		}
// 	});

// 	// 转换子元素
// 	const children = block.get('sys:children');
// 	if (children instanceof Y.Array) {
// 		children.forEach((childId: any) => {
// 			if (typeof childId === 'string') {
// 				const childBlock = allBlocks.get(childId);
// 				if (childBlock instanceof Y.Map) {
// 					result.children.push(convertBlockToSnapshot(childBlock, allBlocks));
// 				}
// 			} else if (Array.isArray(childId) && typeof childId[0] === 'string') {
// 				const childBlock = allBlocks.get(childId[0]);
// 				if (childBlock instanceof Y.Map) {
// 					result.children.push(convertBlockToSnapshot(childBlock, allBlocks));
// 				}
// 			}
// 		});
// 	}

// 	return result;
// }

// /**
//  * yTextToDelta: 将 Y.Text 转换为 delta 数组
//  *
//  * @param yText - Y.Text 对象
//  * @returns delta 数组
//  */
// function yTextToDelta(yText: Y.Text): any[] {
// 	const delta = yText.toDelta();
// 	return delta.map((d: any) => {
// 		if (d.insert && typeof d.insert === 'string') {
// 			return { insert: d.insert, ...d.attributes };
// 		}
// 		return d;
// 	});
// }

/**
 * createCommentHandler: 创建评论
 *
 * 功能描述：
 * - 在指定文档中创建新评论
 * - 支持设置评论内容和引用的文档文本
 * - 会在文档中创建评论标记（如果有 selection 参数）
 *
 * @param params.workspaceId - 工作区 ID，默认使用配置中的工作区
 * @param params.docId - 文档 ID（必需）
 * @param params.docTitle - 文档标题（可选，默认从文档获取）
 * @param params.docMode - 文档模式（page/edgeless）
 * @param params.content - 评论内容（必需）
 * @param params.selection - 引用的文档文本（可选）
 * @param params.mentions - 提及的用户（可选）
 * @returns 创建的评论对象
 */
export async function createCommentHandler(params: {
	workspaceId?: string;
	docId: string;
	docTitle?: string;
	docMode?: 'Page' | 'Edgeless' | 'page' | 'edgeless';
	content?: string;
	selection?: string;
	mentions?: string[];
}): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId(params.workspaceId);

	if (!params.content) {
		throw new Error('评论内容不能为空');
	}

	// 获取文档信息
	const docQuery = `query GetDoc($workspaceId: String!, $docId: String!) {
		workspace(id: $workspaceId) {
			doc(docId: $docId) {
				title
				mode
			}
		}
	}`;
	const docData = await gql.request<any>(docQuery, { workspaceId, docId: params.docId });
	const docInfo = docData?.workspace?.doc || { title: '', mode: 'page' };
	const docTitle = params.docTitle || docInfo.title || '';
	const docMode = params.docMode || docInfo.mode || 'page';

	const normalizedDocMode = docMode.toLowerCase() === 'edgeless' ? 'edgeless' : 'page';

	// 生成随机 ID
	const pageId = generateId(12, 'page');
	const surfaceId = generateId(12, 'surf');
	const noteId = generateId(12, 'note');
	const paragraphId = generateId(12, 'para');

	// preview: 如果有 selection 则使用 selection，否则使用文档标题
	const preview = params.selection || docTitle || '无标题';

	// 构建评论内容 - 使用 DocCommentContent 格式
	const commentContent = {
		preview: preview,
		mode: normalizedDocMode,
		attachments: [],
		snapshot: {
			type: 'page',
			meta: {
				id: pageId,
				title: docTitle || '无标题',
				createDate: Date.now(),
				tags: []
			},
			blocks: {
				type: 'block',
				id: pageId,
				flavour: 'affine:page',
				version: 2,
				props: {
					title: {
						'$blocksuite:internal:text$': true,
						delta: []
					}
				},
				children: [
					{
						type: 'block',
						id: surfaceId,
						flavour: 'affine:surface',
						version: 5,
						props: {
							elements: {
								type: '$blocksuite:internal:native$',
								value: {}
							}
						},
						children: []
					},
					{
						type: 'block',
						id: noteId,
						flavour: 'affine:note',
						version: 1,
						props: {
							xywh: '[0,0,800,95]',
							background: {
								dark: '#252525',
								light: '#ffffff'
							},
							index: 'a0',
							lockedBySelf: false,
							hidden: false,
							displayMode: 'both',
							edgeless: {
								style: {
									borderRadius: 8,
									borderSize: 4,
									borderStyle: 'solid',
									shadowType: '--affine-note-shadow-box'
								}
							}
						},
						children: [
							{
								type: 'block',
								id: paragraphId,
								flavour: 'affine:paragraph',
								version: 1,
								props: {
									type: 'text',
									text: {
										'$blocksuite:internal:text$': true,
										delta: [{ insert: params.content }]
									},
									collapsed: false
								},
								children: []
							}
						]
					}
				]
			}
		}
	};

	// 先创建评论
	const mutation = `mutation CreateComment($input: CommentCreateInput!){ createComment(input:$input){ id content createdAt updatedAt resolved } }`;
	const input = {
		content: commentContent,
		docId: params.docId,
		workspaceId,
		docTitle: docTitle,
		docMode: normalizedDocMode,
		mentions: params.mentions || []
	};

	const data = await gql.request<{ createComment: any }>(mutation, { input });
	const comment = data.createComment;

	// 如果有 selection 参数，需要在文档中添加评论标记
	if (params.selection && comment.id) {
		try {
			await addCommentMarkToDocument(workspaceId, params.docId, params.selection, comment.id);
		} catch (err) {
			console.error('添加评论标记失败:', err);
		}
	}

	return comment;
}

/**
 * addCommentMarkToDocument: 在文档的文本中添加评论标记
 *
 * 功能描述：
 * - 在文档中搜索包含 selection 的文本
 * - 在找到的文本位置添加评论标记
 * - 通过 WebSocket + Yjs 实时更新文档
 *
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @param endpoint - GraphQL endpoint
 * @param cookie - 认证 cookie
 * @param bearer - 认证 bearer token
 * @param selection - 要标记的文本
 * @param commentId - 评论 ID
 */
async function addCommentMarkToDocument(
	workspaceId: string,
	docId: string,
	selection: string,
	commentId: string
): Promise<void> {
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// 获取文档状态
		const snapshot = await loadDoc(socket, workspaceId, docId);

		// 应用状态到 Y.Doc
		const yDoc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.missing, 'base64'));
		} else if (snapshot.state) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.state, 'base64'));
		}

		// 如果既没有 missing 也没有 state，需要重新获取完整状态
		if (!snapshot.missing && !snapshot.state) {
			return;
		}

		// 查找并标记匹配的文本
		const blocks = yDoc.getMap('blocks');
		const markKey = `comment-${commentId}`;
		let modified = false;

		for (const [_, block] of blocks) {
			if (!(block instanceof Y.Map)) continue;

			// const flavour = block.get('sys:flavour');

			// 检查所有可能的文本属性
			const textKeys: string[] = [];
			block.forEach((_: any, key: string) => {
				if (key.startsWith('prop:text') || key === 'prop:title') {
					textKeys.push(key);
				}
			});

			for (const key of textKeys) {
				const yText = block.get(key) as Y.Text | undefined;
				if (!yText || !(yText instanceof Y.Text)) continue;

				const text = yText.toString();
				if (text.includes(selection)) {
					// 在找到的文本位置添加评论标记
					const index = text.indexOf(selection);
					const commentAttr: any = {};
					commentAttr[markKey] = true;

					yText.format(index, selection.length, commentAttr);
					modified = true;
				}
			}
		}

		if (modified) {
			// 发送更新到服务器
			const update = Y.encodeStateAsUpdate(yDoc);
			await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));
		}
	} finally {
		socket.disconnect();
	}
}

/**
 * updateCommentHandler: 更新评论内容
 *
 * 功能描述：
 * - 更新指定评论的内容
 * - 支持字符串或 BlockSuite 节点格式
 * - 如果是字符串，会保留原有 snapshot 结构，只更新文本
 *
 * @param params.id - 评论 ID（必需）
 * @param params.content - 新评论内容（必需）
 * @returns 更新结果对象
 */
export async function updateCommentHandler(params: { id: string; content: any }): Promise<any> {
	const gql = await createGraphQLClient();
	const workspaceId = getWorkspaceId();

	// 获取评论的完整信息
	const commentQuery = `query GetComment($workspaceId: String!, $docId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			comments(docId: $docId, pagination: { first: $first }) {
				edges {
					node {
						id
						content
						resolved
					}
				}
			}
		}
	}`;

	// 获取所有文档，找到该评论
	const docsQuery = `query ListDocs($workspaceId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			docs(pagination: { first: $first }) {
				edges {
					node {
						id
					}
				}
			}
		}
	}`;

	let docId: string | null = null;
	let existingContent: any = null;

	try {
		const docsData = await gql.request<any>(docsQuery, { workspaceId, first: 100 });
		const docIds: string[] = docsData.workspace?.docs?.edges?.map((e: any) => e.node.id) || [];

		for (const id of docIds) {
			const commentData = await gql.request<any>(commentQuery, {
				workspaceId,
				docId: id,
				first: 100
			});
			const comments = commentData.workspace?.comments?.edges || [];
			for (const edge of comments) {
				if (edge.node.id === params.id) {
					docId = id;
					existingContent = edge.node.content;
					break;
				}
			}
			if (docId) break;
		}
	} catch (err) {
		// 忽略错误
	}

	// 将字符串内容转换为 BlockSuite 节点格式
	let commentContent: any;
	if (typeof params.content === 'string') {
		// 保留原有的 snapshot 结构，只更新 paragraph 中的文本
		commentContent = existingContent ? { ...existingContent } : null;

		if (commentContent?.snapshot?.blocks) {
			// 找到 paragraph 并更新文本
			const blocks = commentContent.snapshot.blocks;
			updateParagraphText(blocks, params.content);
		} else {
			// 创建新的 paragraph 结构
			commentContent = {
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: params.content
					}
				]
			};
		}
	} else {
		commentContent = params.content;
	}

	const mutation = `mutation UpdateComment($input: CommentUpdateInput!){ updateComment(input:$input) }`;
	const data = await gql.request<{ updateComment: boolean }>(mutation, {
		input: { id: params.id, content: commentContent }
	});
	return { success: data.updateComment };
}

/**
 * updateParagraphText: 递归更新 paragraph 块中的文本
 *
 * @param block - block 对象
 * @param newText - 新文本内容
 * @returns 是否成功更新
 */
function updateParagraphText(block: any, newText: string): boolean {
	if (!block) return false;

	// 如果是段落类型，更新文本
	if (block.flavour === 'affine:paragraph') {
		block.props = block.props || {};
		block.props.text = {
			'$blocksuite:internal:text$': true,
			delta: [{ insert: newText }]
		};
		return true;
	}

	// 递归搜索子元素
	if (block.children && Array.isArray(block.children)) {
		for (const child of block.children) {
			if (updateParagraphText(child, newText)) {
				return true;
			}
		}
	}

	return false;
}

/**
 * deleteCommentHandler: 删除评论
 *
 * 功能描述：
 * - 删除指定评论
 * - 如果没有提供 docId，会在工作区文档中自动查找
 * - 删除前会先移除文档中的评论标记
 *
 * @param params.id - 评论 ID（必需）
 * @param params.workspaceId - 工作区 ID（可选，默认使用配置中的工作区）
 * @param params.docId - 文档 ID（可选，自动查找）
 * @returns 删除结果对象
 */
export async function deleteCommentHandler(params: {
	id: string;
	workspaceId?: string;
	docId?: string;
}): Promise<any> {
	const gql = await createGraphQLClient();

	const workspaceId = params.workspaceId || getWorkspaceId();
	let docId: string | null = params.docId || null;

	// 如果没有提供 docId，尝试在工作区的文档中查找该评论
	if (!docId) {
		docId = await findCommentDocId(gql, workspaceId, params.id);
	}

	// 如果找到了 docId，先移除文档中的评论标记
	if (docId) {
		try {
			await removeCommentMarkFromDocument(workspaceId, docId, params.id);
		} catch (err) {
			console.error('移除评论标记失败:', err);
		}
	}

	// 删除评论
	const mutation = `mutation DeleteComment($id:String!){ deleteComment(id:$id) }`;
	const data: any = await gql.request(mutation, {
		id: params.id
	});
	return { success: data.deleteComment };
}

/**
 * findCommentDocId: 在工作区的文档中查找评论所属的文档 ID
 *
 * 功能描述：
 * - 遍历工作区的所有文档
 * - 在每个文档的评论中查找指定评论 ID
 * - 返回找到的文档 ID
 *
 * @param gql - GraphQL 客户端
 * @param workspaceId - 工作区 ID
 * @param commentId - 评论 ID
 * @returns 文档 ID，未找到返回 null
 */
async function findCommentDocId(
	gql: any,
	workspaceId: string,
	commentId: string
): Promise<string | null> {
	// 获取工作区的文档列表
	const docsQuery = `query ListDocs($workspaceId: String!, $first: Int) {
		workspace(id: $workspaceId) {
			docs(pagination: { first: $first }) {
				edges {
					node {
						id
					}
				}
			}
		}
	}`;

	try {
		const docsData = await gql.request(docsQuery, { workspaceId, first: 100 });
		const docIds: string[] = docsData.workspace?.docs?.edges?.map((e: any) => e.node.id) || [];

		// 并行在每个文档中查找该评论
		const promises = docIds.map(async (docId: string) => {
			const commentQuery = `query CheckComment($workspaceId: String!, $docId: String!) {
				workspace(id: $workspaceId) {
					comments(docId: $docId, pagination: { first: 100 }) {
						edges {
							node {
								id
							}
						}
					}
				}
			}`;
			const data = await gql.request(commentQuery, { workspaceId, docId });
			const comments = data.workspace?.comments?.edges || [];
			for (const edge of comments) {
				if (edge.node.id === commentId) {
					return docId;
				}
			}
			return null;
		});

		const results = await Promise.all(promises);
		return results.find((id) => id !== null) || null;
	} catch (err) {
		// 忽略错误
	}

	return null;
}

/**
 * removeCommentMarkFromDocument: 从文档中移除评论标记
 *
 * 功能描述：
 * - 遍历文档中的所有文本块
 * - 查找并移除指定评论的标记
 * - 通过 WebSocket + Yjs 实时更新文档
 *
 * @param workspaceId - 工作区 ID
 * @param docId - 文档 ID
 * @param endpoint - GraphQL endpoint
 * @param cookie - 认证 cookie
 * @param bearer - 认证 bearer token
 * @param commentId - 评论 ID
 */
async function removeCommentMarkFromDocument(
	workspaceId: string,
	docId: string,
	commentId: string
): Promise<void> {
	const socket = await connectWorkspaceSocket();

	try {
		await joinWorkspace(socket, workspaceId);

		// 获取文档状态
		const snapshot = await loadDoc(socket, workspaceId, docId);

		// 应用状态到 Y.Doc
		const yDoc = new Y.Doc();
		if (snapshot.missing) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.missing, 'base64'));
		} else if (snapshot.state) {
			Y.applyUpdate(yDoc, Buffer.from(snapshot.state, 'base64'));
		}

		if (!snapshot.missing && !snapshot.state) {
			return;
		}

		// 查找并移除评论标记
		const blocks = yDoc.getMap('blocks');
		const markKey = `comment-${commentId}`;
		let modified = false;

		for (const [_, block] of blocks) {
			if (!(block instanceof Y.Map)) continue;

			// 检查所有可能的文本属性
			const textKeys: string[] = [];
			block.forEach((_: any, key: string) => {
				if (key.startsWith('prop:text') || key === 'prop:title') {
					textKeys.push(key);
				}
			});

			for (const key of textKeys) {
				const yText = block.get(key) as Y.Text | undefined;
				if (!yText || !(yText instanceof Y.Text)) continue;

				// 先获取 delta 的快照
				const delta = yText.toDelta();
				for (let i = 0; i < delta.length; i++) {
					const d = delta[i];
					if (d.attributes && markKey in d.attributes) {
						// 找到评论标记，计算位置
						let pos = 0;
						for (let j = 0; j < i; j++) {
							if (delta[j].insert) {
								pos +=
									typeof delta[j].insert === 'string'
										? delta[j].insert.length
										: 1;
							}
						}
						const len = typeof d.insert === 'string' ? d.insert.length : 1;

						// 移除该评论标记 - 使用 null 清除属性
						yText.format(pos, len, { [markKey]: null });
						modified = true;
					}
				}
			}
		}

		if (modified) {
			// 发送更新到服务器
			const update = Y.encodeStateAsUpdate(yDoc);
			await pushDocUpdate(socket, workspaceId, docId, Buffer.from(update).toString('base64'));
		}
	} finally {
		socket.disconnect();
	}
}

/**
 * resolveCommentHandler: 解决/取消解决评论
 *
 * 功能描述：
 * - 设置评论的解决状态
 * - true 表示已解决，false 表示未解决
 *
 * @param params.id - 评论 ID（必需）
 * @param params.resolved - 是否已解决（必需）
 * @returns 操作结果对象
 */
export async function resolveCommentHandler(params: {
	id: string;
	resolved: boolean;
}): Promise<any> {
	const gql = await createGraphQLClient();
	const mutation = `mutation ResolveComment($input: CommentResolveInput!){ resolveComment(input:$input) }`;
	const data = await gql.request<{ resolveComment: boolean }>(mutation, {
		input: params
	});
	return { success: data.resolveComment };
}
