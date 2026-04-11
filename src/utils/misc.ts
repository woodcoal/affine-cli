/**
 * 模块名称：misc.ts
 * 通用工具模块
 *
 * 功能描述：
 * - 提供随机标识符生成
 * - 解析 JSON 内容或文件路径
 * - 其他通用工具函数
 *
 * 导出的函数：
 * - generateId: 生成唯一标识符
 * - parseJsonContent: 解析 JSON 或文件路径
 */

import { customAlphabet } from 'nanoid';
import * as fs from 'fs';

/**
 * 默认字母表：Affine 兼容的字符集
 */
const ALPHABET = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/**
 * 生成随机标识符
 * 使用 nanoid（安全、URL 友好）
 *
 * @param length - ID 总长度，默认 24
 * @param prefix - 前缀（可选），如有值则返回 prefix-id 格式，id 长度 = length - prefix.length - 1
 * @returns 返回唯一标识符
 */
export function generateId(length: number = 24, prefix?: string): string {
	const idLength = prefix ? length - prefix.length - 1 : length;
	const id = customAlphabet(ALPHABET, idLength)();
	return prefix ? `${prefix}-${id}` : id;
}

/**
 * 解析 JSON 内容或文件路径
 * 支持直接 JSON 字符串或 @file 格式的文件路径
 *
 * @param input - 输入字符串，支持：
 *   - JSON 字符串（如 '[{"a":1},{"b":2}]' 或 '{"data":[]}）
 *   - @file 格式（如 '@data.json' 表示读取 data.json 文件内容）
 * @param options - 可选配置
 *   - allowArray: 是否允许数组格式，默认 true
 *   - allowObject: 是否允许对象格式，默认 true
 *   - fieldName: 错误信息中使用的字段名，默认 'content'
 * @returns 解析后的数据（可以是数组或对象）
 * @throws 当格式无效时抛出错误
 */
export function parseJsonContent(
	input: string,
	options?: {
		allowArray?: boolean;
		allowObject?: boolean;
		fieldName?: string;
	}
): unknown {
	const { allowArray = true, allowObject = true, fieldName = 'content' } = options || {};

	if (!input || typeof input !== 'string') {
		throw new Error(`${fieldName} 参数不能为空`);
	}

	let jsonString: string;

	// 检查是否为有效的文件路径格式
	if (isFilePath(input)) {
		const filePath = input.slice(1);
		try {
			jsonString = fs.readFileSync(filePath, 'utf-8');
		} catch (err: any) {
			throw new Error(`读取文件失败: ${err.message}`);
		}
	} else {
		jsonString = input;
	}

	// 解析 JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonString);
	} catch (err: any) {
		throw new Error(`${fieldName} 必须是有效的 JSON 格式: ${err.message}`);
	}

	// 验证格式
	if (allowArray && Array.isArray(parsed)) {
		return parsed;
	}

	if (allowObject && parsed !== null && typeof parsed === 'object') {
		return parsed;
	}

	// 格式无效
	const validTypes: string[] = [];
	if (allowArray) validTypes.push('数组');
	if (allowObject) validTypes.push('对象');

	throw new Error(`${fieldName} 格式无效，必须是 ${validTypes.join('或')}格式`);
}

/**
 * 检查字符串是否为有效的文件路径格式
 *
 * 验证规则：
 * - 必须以 @ 开头
 * - @ 后面不能为空
 * - @ 后面必须是单行（不包含换行符）
 * - 不能是特殊符号如 @# @? @等后跟特殊字符开头
 *
 * @param value - 要检查的字符串
 * @returns 如果是有效的文件路径格式返回 true，否则返回 false
 */
export function isFilePath(value: string): boolean {
	if (!value || typeof value !== 'string') {
		return false;
	}

	// 必须以 @ 开头且长度大于 1
	if (!value.startsWith('@') || value.length <= 1) {
		return false;
	}

	// 检查是否包含换行符，制表符等特殊字符（多行不是有效路径）
	if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
		return false;
	}

	// 获取 @ 后面的内容
	const pathPart = value.slice(1).trim();

	// 检查是否以特殊字符开头（@# @? @! 等不是有效路径）
	const firstChar = pathPart.charAt(0);
	if (/^[#?!\-*]/.test(firstChar)) {
		return false;
	}

	return true;
}
