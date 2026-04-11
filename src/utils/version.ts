/**
 * 模块名称：version.ts
 * 版本信息模块
 *
 * 功能描述：
 * - 从 package.json 导入版本号
 * - 供其他模块使用
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CLI_VERSION: 版本号
 *
 * 从当前工作目录向上查找 package.json
 */
export const CLI_VERSION = (() => {
	try {
		// 从当前工作目录向上查找
		let dir = process.cwd();
		let lastDir = '';
		while (dir !== lastDir) {
			const pkgPath = resolve(dir, 'package.json');
			if (existsSync(pkgPath)) {
				const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
				if (pkg.version) return pkg.version;
			}
			lastDir = dir;
			dir = resolve(dir, '..');
			if (dir === lastDir) break;
		}
	} catch {
		// 忽略错误
	}
	return '1.0.0';
})();
