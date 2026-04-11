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
