/**
 * 模块名称：constants.ts
 * 全局常量定义模块
 * 
 * 功能描述：
 * - 定义全局可复用的常量
 * - 包含标签颜色等 UI 相关常量
 * 
 * 导出的常量：
 * - SELECT_COLORS: 标签颜色数组
 */

/**
 * SELECT_COLORS: 标签颜色数组（淡色系）
 * 
 * 功能描述：
 * - 用于 select/multi-select 类型列的选项颜色分配
 * - 复用给 tags、docsUtil 等模块使用
 * - 采用淡雅柔和的颜色方案，适合视觉展示
 */
export const SELECT_COLORS = [
	'#60A5FA', // 淡蓝
	'#34D399', // 淡绿
	'#FBBF24', // 淡黄
	'#F87171', // 淡红
	'#A78BFA', // 淡紫
	'#F472B6', // 淡粉
	'#22D3EE', // 淡青
	'#9CA3AF', // 淡灰

	'#93C5FD', // 浅蓝
	'#6EE7B7', // 浅绿
	'#FCD34D', // 浅黄
	'#FCA5A5', // 浅红
	'#C4B5FD', // 浅紫
	'#F9A8D4', // 浅粉
	'#67E8F9', // 浅青
	'#D1D5DB', // 浅灰

	'#BFDBFE', // 更浅蓝
	'#A7F3D0', // 更浅绿
	'#FDE68A', // 更浅黄
	'#FECACA', // 更浅红
	'#DDD6FE', // 更浅紫
	'#FBCFE8', // 更浅粉
	'#A5F3FC', // 更浅青
	'#E5E7EB' // 更浅灰
];