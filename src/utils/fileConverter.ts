/**
 * 模块名称：fileConverter.ts
 * 文件转换工具模块
 *
 * 功能描述：
 * - 提供文档格式检测和转换功能
 * - 支持 Markdown、HTML、TXT 等格式转换为 Markdown
 * - 处理 UTF-8 BOM 标记
 *
 * 导出的函数：
 * - convertToMarkdown: 自动检测并转换文档格式为 Markdown
 * - removeBom: 移除 UTF-8 BOM 标记
 * - hasBom: 检测文件是否带有 BOM
 */

import * as fs from 'fs';

/**
 * convertToMarkdown: 自动检测并转换文档格式为 Markdown
 *
 * 功能描述：
 * - 根据文件扩展名或内容自动检测格式
 * - 支持：Markdown、HTML、TXT
 * - 自动移除 UTF-8 BOM 标记
 *
 * @param filePath - 文件路径
 * @param content - 文件内容（可选，如果提供则直接使用，不读取文件）
 * @returns 转换后的 Markdown 内容
 *
 * 支持的格式：
 * - .md, .markdown → 直接返回
 * - .html, .htm → 转换为 Markdown
 * - .txt, .text → 直接返回
 * - 其他格式 → 尝试检测是否为 HTML
 */
export function convertToMarkdown(filePath: string, content?: string): string {
	// 如果没有提供内容，从文件读取
	let fileContent = content;
	if (fileContent === undefined) {
		if (!fs.existsSync(filePath)) {
			throw new Error(`文件不存在: ${filePath}`);
		}
		fileContent = fs.readFileSync(filePath, 'utf-8');
	}

	// 移除 UTF-8 BOM 标记（\uFEFF 或 0xFEFF）
	if (fileContent.charCodeAt(0) === 0xfeff) {
		fileContent = fileContent.slice(1);
	}

	// 去除首尾空白
	const trimmed = fileContent.trim();

	// 获取文件扩展名（小写）
	const ext = filePath.split('.').pop()?.toLowerCase() || '';

	// 根据扩展名转换
	switch (ext) {
		case 'md':
		case 'markdown':
			// Markdown 文件直接返回
			return trimmed;

		case 'html':
		case 'htm':
			// HTML 文件转换为 Markdown
			return htmlToMarkdown(trimmed);

		case 'txt':
		case 'text':
			// 纯文本文件保留原样
			return trimmed;

		default:
			// 未知格式，尝试检测是否为 HTML
			if (
				trimmed.startsWith('<!DOCTYPE') ||
				trimmed.startsWith('<html') ||
				trimmed.startsWith('<div')
			) {
				return htmlToMarkdown(trimmed);
			}
			// 否则按纯文本处理
			return trimmed;
	}
}

/**
 * htmlToMarkdown: 简单的 HTML 转 Markdown 转换器
 *
 * 功能描述：
 * - 处理常见的 HTML 标签转换为 Markdown 语法
 * - 支持 h1-h6、p、br、strong、b、em、i、del、s、code、pre、a、img、ul、ol、li、blockquote、hr、table 等
 *
 * @param html - HTML 内容
 * @returns 转换后的 Markdown
 *
 * 转换规则：
 * - h1-h6 → # 到 ###### 标题
 * - strong/b → **粗体**
 * - em/i → *斜体*
 * - del/s → ~~删除线~~
 * - code → `行内代码`
 * - pre/code → ```代码块```
 * - a → [文本](链接)
 * - img → ![ Alt ](图片链接)
 * - ul/ol → - / 1. 列表
 * - blockquote → > 引用
 * - hr → ---
 * - table → Markdown 表格
 */
function htmlToMarkdown(html: string): string {
	let markdown = html;

	// 移除 doctype 和 html/body 标签
	markdown = markdown.replace(/<!DOCTYPE[^>]*>/gi, '');
	markdown = markdown.replace(/<html[^>]*>/gi, '');
	markdown = markdown.replace(/<\/html>/gi, '');
	markdown = markdown.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
	markdown = markdown.replace(/<body[^>]*>/gi, '');
	markdown = markdown.replace(/<\/body>/gi, '');

	// 标题转换
	markdown = markdown.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
	markdown = markdown.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
	markdown = markdown.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
	markdown = markdown.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
	markdown = markdown.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
	markdown = markdown.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

	// 段落转换（p 标签）
	markdown = markdown.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

	// 换行转换
	markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

	// 粗体转换
	markdown = markdown.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
	markdown = markdown.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');

	// 斜体转换
	markdown = markdown.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
	markdown = markdown.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

	// 删除线转换
	markdown = markdown.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
	markdown = markdown.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');

	// 行内代码转换
	markdown = markdown.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

	// 代码块转换
	markdown = markdown.replace(
		/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
		'```\n$1\n```\n\n'
	);

	// 链接转换
	markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

	// 图片转换
	markdown = markdown.replace(
		/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
		'![$2]($1)'
	);
	markdown = markdown.replace(
		/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi,
		'![$1]($2)'
	);
	markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, '![]($1)');

	// 无序列表转换
	markdown = markdown.replace(
		/<ul[^>]*>([\s\S]*?)<\/ul>/gi,
		(_match: string, listContent: string): string => {
			return listContent.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n';
		}
	);

	// 有序列表转换
	markdown = markdown.replace(
		/<ol[^>]*>([\s\S]*?)<\/ol>/gi,
		(_match: string, listContent: string): string => {
			let index = 1;
			return (
				listContent.replace(
					/<li[^>]*>([\s\S]*?)<\/li>/gi,
					(): string => `${index++}. $1\n`
				) + '\n'
			);
		}
	);

	// 引用转换
	markdown = markdown.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n');

	// 分隔线转换
	markdown = markdown.replace(/<hr\s*\/?>/gi, '\n---\n\n');

	// 表格转换（基本支持）
	markdown = markdown.replace(
		/<table[^>]*>([\s\S]*?)<\/table>/gi,
		(_match: string, tableContent: string): string => {
			let result = '';
			// 表头
			const headerMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
			if (headerMatch) {
				const headers = headerMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];
				result += '| ' + headers.map((h: string) => stripTags(h)).join(' | ') + ' |\n';
				result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
			}
			// 表格内容
			const bodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || [
				0,
				tableContent
			];
			const rows = bodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
			for (const row of rows) {
				const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
				result += '| ' + cells.map((c: string) => stripTags(c)).join(' | ') + ' |\n';
			}
			return result + '\n';
		}
	);

	// 移除剩余的 HTML 标签
	markdown = markdown.replace(/<[^>]+>/g, '');

	// 解码 HTML 实体
	markdown = decodeHtmlEntities(markdown);

	// 清理多余的空行
	markdown = markdown.replace(/\n{3,}/g, '\n\n');

	return markdown.trim();
}

/**
 * stripTags: 移除 HTML 标签内容
 *
 * @param html - 包含 HTML 标签的字符串
 * @returns 去除标签后的纯文本
 */
function stripTags(html: string): string {
	return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * decodeHtmlEntities: 解码 HTML 实体
 *
 * 功能描述：
 * - 将 HTML 实体转换为对应的字符
 * - 支持命名实体和数字实体（十进制/十六进制）
 *
 * @param text - 包含 HTML 实体的文本
 * @returns 解码后的文本
 *
 * 支持的实体：
 * - &nbsp; → 空格
 * - &amp; → &
 * - &lt; → <
 * - &gt; → >
 * - &quot; → "
 * - &#39; → '
 * - &mdash; → —
 * - &ndash; → –
 * - &hellip; → …
 * - &#数字; → 十进制字符
 * - &#x数字; → 十六进制字符
 */
function decodeHtmlEntities(text: string): string {
	// 常见 HTML 实体映射
	const entities: Record<string, string> = {
		'&nbsp;': ' ',
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#39;': "'",
		'&apos;': "'",
		'&mdash;': '\u2014',
		'&ndash;': '\u2013',
		'&hellip;': '\u2026',
		'&copy;': '\u00A9',
		'&reg;': '\u00AE',
		'&trade;': '\u2122',
		'&lsquo;': '\u2018',
		'&rsquo;': '\u2019',
		'&ldquo;': '\u201C',
		'&rdquo;': '\u201D'
	};

	let result = text;

	// 替换命名实体
	for (const [entity, char] of Object.entries(entities)) {
		result = result.replace(new RegExp(entity, 'gi'), char);
	}

	// 处理数字形式的 HTML 实体（十进制）
	result = result.replace(/&#(\d+);/g, (_: string, code: string): string => {
		return String.fromCharCode(parseInt(code, 10));
	});

	// 处理数字形式的 HTML 实体（十六进制）
	result = result.replace(/&#x([0-9a-f]+);/gi, (_: string, code: string): string => {
		return String.fromCharCode(parseInt(code, 16));
	});

	return result;
}

/**
 * 移除 UTF-8 BOM 标记
 */
export function removeBom(content: string): string {
	if (content.charCodeAt(0) === 0xfeff) {
		return content.slice(1);
	}
	return content;
}

/**
 * 检测文件是否带有 BOM
 */
export function hasBom(content: string): boolean {
	return content.charCodeAt(0) === 0xfeff;
}
