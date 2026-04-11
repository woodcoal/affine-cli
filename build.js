/**
 * 脚本名称：build.js
 * 构建脚本
 *
 * 功能描述：
 * 1. 清除 dist 目录
 * 2. 使用 esbuild 打包为单个文件
 * 3. 写入版本号
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

// 1. 清除 dist 目录
console.log('🧹 清除 dist 目录...');
try {
	rmSync('dist', { recursive: true, force: true });
} catch {}

// 2. 创建输出目录
mkdirSync('dist', { recursive: true });

// 3. 使用 esbuild 打包
console.log('📦 打包为单文件...');
await esbuild.build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: 'dist/index.js',
	minify: false,
	sourcemap: false,
	target: 'node18',
	external: ['socket.io-client', 'yjs', 'form-data', 'fractional-indexing', 'markdown-it', 'nanoid', 'node-fetch', 'undici']
});

// 4. 写入版本号
console.log('🏷️ 写入版本号...');
const version = pkg.version;
const content = readFileSync('dist/index.js', 'utf-8').replace(
	/%%VERSION%%/g,
	version
);
writeFileSync('dist/index.js', content);

console.log(`✅ 构建完成，版本: ${version}`);
