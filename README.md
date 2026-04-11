# Affine CLI

[**【English】**](./README-en.md) | [**【中文】**](./README.md)

Affine CLI 是一个轻量级的命令行工具，用于管理 Affine 文档、标签、文件夹、收藏夹、文件和数据库。它提供了通过命令行与 Affine（<https://app.affine.pro）API> 交互的简化接口。

## 功能特性

- **认证**: 使用邮箱/密码或 API 令牌登录
- **工作区管理**: 列出和管理工作区
- **文档操作**: 创建、读取、更新、删除、搜索、复制和追加内容
- **标签管理**: 创建标签、向文档添加/移除标签
- **文件夹管理**: 在文件夹中组织文档
- **收藏夹管理**: 创建和管理收藏夹
- **文件管理**: 上传和管理文件附件
- **评论管理**: 添加、更新、删除和解决评论
- **数据库管理**: 创建数据表、管理列和行

## 安装

### 本地安装

```bash
# 克隆仓库
git clone https://github.com/woodcoal/affine-cli.git
cd affine-cli

# 安装依赖
npm install

# 构建项目
npm run build

# 链接 CLI（可选，用于本地开发测试）
npm link
```

### 全局安装（推荐）

```bash
# 从 npm 全局安装（如果已发布）
npm install -g affine-cli

# 或从 GitHub 安装
npm install -g github:woodcoal/affine-cli

# 安装完成后，可在任意目录使用 affine-cli 命令
```

## 配置

在项目目录创建 `.env` 文件，或使用全局配置：

```bash
# 全局配置: ~/.affine-cli/affine-cli.env
# 本地配置: 项目目录中的 .env

AFFINE_BASE_URL=https://app.affine.pro
AFFINE_API_TOKEN=your_api_token
# 或
AFFINE_COOKIE=your_cookie
# 或
AFFINE_EMAIL=your_email
AFFINE_PASSWORD=your_password

AFFINE_WORKSPACE_ID=your_workspace_id
```

配置优先级：环境变量 > 本地 `.env` > 全局 `~/.affine-cli/affine-cli.env`

## 使用方法

```bash
# 认证
affine-cli auth login
affine-cli auth status
affine-cli auth logout

# 工作区
affine-cli workspace list

# 文档
affine-cli doc list --workspace <workspace-id>
affine-cli doc create -t "我的文档" -c "./content.md"
affine-cli doc info --id <doc-id>
affine-cli doc delete --id <doc-id>
affine-cli doc search --query "关键词"

# 标签
affine-cli tags list
affine-cli tags create --tag "重要"
affine-cli tags add --id <doc-id> --tag "重要"
affine-cli tags remove --id <doc-id> --tag "重要"

# 文件夹
affine-cli folder all
affine-cli folder create --name "我的文件夹"
affine-cli folder list --id <folder-id>

# 收藏夹
affine-cli collection list
affine-cli collection create --name "我的收藏夹"

# 文件
affine-cli file upload --file "./image.png"
affine-cli file list

# 评论
affine-cli comment list --doc-id <doc-id>
affine-cli comment create --doc-id <doc-id> --content "好想法！"

# 数据库
affine-cli database create --title "任务表"
affine-cli database list --doc-id <doc-id>
affine-cli database columns --doc-id <doc-id> --db-id <db-id>
```

## 命令详解

### 认证模块 (auth)

| 命令       | 说明                  | 参数                                                                                                                  |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **login**  | 使用账号或 Token 登录 | `--url` 服务器地址 <br>`--token` API Token <br>`--workspace` 工作区ID <br>`--local` 保存到本地 <br>`--force` 强制覆盖 |
| **logout** | 退出登录              | `--local` 删除本地配置                                                                                                |
| **status** | 获取登录状态          | `--json` JSON格式输出                                                                                                 |

### 工作区模块 (workspace)

| 命令     | 说明                   | 参数                           |
| -------- | ---------------------- | ------------------------------ |
| **list** | 获取所有工作区基本信息 | `--format` 输出格式(text/json) |

### 文档模块 (doc)

| 命令        | 说明                       | 参数                                                                                                                                          |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **list**    | 列出工作区文档（支持分页） | `--count` 每页数量 <br>`--skip` 偏移量 <br>`--after` 游标 <br>`--workspace` 工作区ID                                                          |
| **info**    | 获取文档详情               | `--id` 文档ID <br>`--workspace` 工作区ID <br>`--content` 内容模式(markdown/raw/hidden)                                                        |
| **create**  | 创建新文档                 | `--title` 标题 <br>`--content` 内容 <br>`--file` 从文件导入 <br>`--folder` 文件夹ID <br>`--tags` 标签列表 <br>`--workspace` 工作区ID          |
| **search**  | 搜索文档                   | `--query` 关键词 <br>`--workspace` 工作区ID <br>`--count` 返回数量 <br>`--match-mode` 匹配模式 <br>`--tag` 标签过滤                           |
| **delete**  | 删除文档                   | `--id` 文档ID <br>`--workspace` 工作区ID                                                                                                      |
| **copy**    | 复制文档                   | `--id` 源文档ID <br>`--title` 新标题 <br>`--parent` 父文档ID <br>`--folder` 目标文件夹 <br>`--workspace` 工作区ID                             |
| **update**  | 更新文档属性               | `--id` 文档ID <br>`--title` 标题 <br>`--parent` 父文档 <br>`--folder` 文件夹 <br>`--workspace` 工作区ID                                       |
| **replace** | 替换文档内容               | `--id` 文档ID <br>`--search` 搜索文本 <br>`--replace` 替换文本 <br>`--workspace` 工作区ID <br>`--match-all` 替换所有 <br>`--preview` 预览模式 |
| **append**  | 追加文档内容               | `--id` 文档ID <br>`--content` 内容 <br>`--file` 从文件导入 <br>`--workspace` 工作区ID                                                         |

### 标签模块 (tags)

| 命令       | 说明               | 参数                                                                     |
| ---------- | ------------------ | ------------------------------------------------------------------------ |
| **list**   | 列出所有标签       | `--workspace` 工作区ID                                                   |
| **create** | 创建标签           | `--tag` 标签名 <br>`--color` 颜色 <br>`--workspace` 工作区ID             |
| **add**    | 添加标签到文档     | `-d` 文档ID <br>`--tag` 标签名 <br>`--workspace` 工作区ID                |
| **remove** | 从文档移除标签     | `-d` 文档ID <br>`--tag` 标签名 <br>`--workspace` 工作区ID                |
| **delete** | 删除标签           | `--tag` 标签名 <br>`--workspace` 工作区ID                                |
| **info**   | 获取标签关联的文档 | `--tag` 标签名 <br>`--workspace` 工作区ID <br>`--ignore-case` 忽略大小写 |

### 文件夹模块 (folder)

| 命令       | 说明                 | 参数                                                                                                    |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| **all**    | 所有文件夹列表       | `--workspace` 工作区ID                                                                                  |
| **list**   | 文件夹内容列表       | `--id` 文件夹ID <br>`--folder` 仅文件夹 <br>`--workspace` 工作区ID                                      |
| **create** | 创建文件夹           | `--name` 文件夹名 <br>`--parent` 父文件夹ID <br>`--index` 排序索引 <br>`--workspace` 工作区ID           |
| **delete** | 删除文件夹           | `--id` 文件夹ID <br>`--workspace` 工作区ID                                                              |
| **update** | 更新文件夹属性       | `--id` 文件夹ID <br>`--name` 名称 <br>`--parent` 父文件夹 <br>`--index` 排序 <br>`--workspace` 工作区ID |
| **clear**  | 清除空文件夹         | `--workspace` 工作区ID                                                                                  |
| **add**    | 添加文档到文件夹     | `--id` 文件夹ID <br>`--doc` 文档ID <br>`--index` 排序 <br>`--workspace` 工作区ID                        |
| **move**   | 移动文档到目标文件夹 | `--id` 目标文件夹ID <br>`--doc` 文档ID <br>`--workspace` 工作区ID                                       |
| **remove** | 从文件夹移除文档     | `--id` 文件夹ID <br>`--doc` 文档ID <br>`--workspace` 工作区ID                                           |

### 收藏夹模块 (collection)

| 命令       | 说明             | 参数                                                           |
| ---------- | ---------------- | -------------------------------------------------------------- |
| **list**   | 所有收藏夹列表   | `--workspace` 工作区ID                                         |
| **info**   | 收藏夹内文档列表 | `--id` 收藏夹ID <br>`--workspace` 工作区ID                     |
| **create** | 创建收藏夹       | `--name` 收藏夹名 <br>`--workspace` 工作区ID                   |
| **update** | 更新收藏夹名称   | `--id` 收藏夹ID <br>`--name` 新名称 <br>`--workspace` 工作区ID |
| **delete** | 删除收藏夹       | `--id` 收藏夹ID <br>`--workspace` 工作区ID                     |
| **add**    | 添加文档到收藏夹 | `--id` 收藏夹ID <br>`--doc` 文档ID <br>`--workspace` 工作区ID  |
| **remove** | 从收藏夹移除文档 | `--id` 收藏夹ID <br>`--doc` 文档ID <br>`--workspace` 工作区ID  |

### 文件模块 (file)

| 命令       | 说明           | 参数                                                                                                                          |
| ---------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **upload** | 上传附件       | `--file` 文件路径 <br>`--content` Base64内容 <br>`--filename` 文件名 <br>`--content-type` MIME类型 <br>`--workspace` 工作区ID |
| **delete** | 删除附件       | `--id` 附件ID <br>`--permanently` 永久删除 <br>`--workspace` 工作区ID                                                         |
| **clean**  | 清理已删除附件 | `--workspace` 工作区ID                                                                                                        |

### 评论模块 (comment)

| 命令        | 说明          | 参数                                                                                                                                                  |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **list**    | 列出文档评论  | `--doc-id` 文档ID <br>`--workspace` 工作区ID <br>`--first` 返回数量 <br>`--offset` 偏移量 <br>`--full` 完整数据                                       |
| **create**  | 创建评论      | `--doc-id` 文档ID <br>`--content` 评论内容 <br>`--workspace` 工作区ID <br>`--selection` 引用文本 <br>`--doc-title` 文档标题 <br>`--doc-mode` 文档模式 |
| **update**  | 更新评论      | `--id` 评论ID <br>`--content` 新内容                                                                                                                  |
| **delete**  | 删除评论      | `--id` 评论ID <br>`--workspace` 工作区ID <br>`--doc-id` 文档ID                                                                                        |
| **resolve** | 解决/取消解决 | `--id` 评论ID <br>`--resolved` true/false                                                                                                             |

### 数据库模块 (database)

| 命令        | 说明             | 参数                                                                                                                                                      |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **list**    | 列出文档中数据库 | `--doc` 文档ID <br>`--workspace` 工作区ID                                                                                                                 |
| **columns** | 读取列定义       | `--doc` 文档ID <br>`--id` 数据库ID <br>`--workspace` 工作区ID                                                                                             |
| **query**   | 查询数据         | `--doc` 文档ID <br>`--id` 数据库ID <br>`--rows` 行ID列表 <br>`--columns` 列名列表 <br>`--query` 筛选条件 <br>`--full` 完整输出 <br>`--workspace` 工作区ID |
| **remove**  | 删除行           | `--doc` 文档ID <br>`--id` 数据库ID <br>`--row` 行ID <br>`--query` 筛选条件 <br>`--workspace` 工作区ID                                                     |
| **update**  | 更新行           | `--doc` 文档ID <br>`--id` 数据库ID <br>`--values` 单元格数据 <br>`--row` 行ID <br>`--query` 筛选条件 <br>`--workspace` 工作区ID                           |
| **create**  | 创建数据库       | `--content` 数据(JSON) <br>`--doc` 文档ID <br>`--title` 标题 <br>`--view-mode` 视图模式 <br>`--workspace` 工作区ID                                        |
| **delete**  | 删除数据库       | `--doc` 文档ID <br>`--id` 数据库ID <br>`--workspace` 工作区ID                                                                                             |
| **insert**  | 插入数据         | `--doc` 文档ID <br>`--id` 数据库ID <br>`--content` 数据 <br>`--workspace` 工作区ID                                                                        |

## 命令帮助

```bash
# 显示主帮助
affine-cli help

# 显示模块帮助
affine-cli doc --help

# 显示特定命令帮助
affine-cli doc create --help
```

## 项目结构

```
src/
├── index.ts              # CLI 入口点
├── cli/                # CLI 命令模块
│   ├── auth.ts
│   ├── workspace.ts
│   ├── doc.ts
│   ├── tags.ts
│   ├── folder.ts
│   ├── collection.ts
│   ├── file.ts
│   ├── comments.ts
│   └── database.ts
├── core/               # 核心业务逻辑
│   ├── auth.ts
│   ├── workspace.ts
│   ├── docs.ts
│   ├── tags.ts
│   ├── folder.ts
│   ├── collection.ts
│   ├── file.ts
│   ├── comments.ts
│   ├── database.ts
│   └── constants.ts
└── utils/              # 工具函数
    ├── config.ts
    ├── auth.ts
    ├── graphqlClient.ts
    ├── wsClient.ts
    ├── cliUtils.ts
    ├── docsUtil.ts
    ├── fileConverter.ts
    └── misc.ts
```

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js
- **GraphQL 客户端**: undici
- **WebSocket**: socket.io-client
- **CRDT**: Yjs

## 致谢

本项目参考了 [dawncr0w/affine-mcp-server](https://github.com/dawncr0w/affine-mcp-server) 的实现。我们感谢原作者奠定的基础。

## 许可证

MIT © [The AFFiNE CLI Contributors](LICENSE) & [木炭](https://github.com/woodcoal/affine-cli) <woodcoal@qq.com>

## 作者

- **作者**: 木炭
- **邮箱**: <woodcoal@qq.com>
- **GitHub**: <https://github.com/woodcoal/affine-cli>
