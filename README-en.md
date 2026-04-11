# Affine CLI

[**【English】**](./README-en.md) | [**【中文】**](./README.md)

Affine CLI is a lightweight command-line tool for managing Affine documents, tags, folders, collections, files, comments, and databases. It provides a streamlined interface for interacting with the Affine (https://app.affine.pro) API through the command line.

## Features

- **Authentication**: Login with email/password or API token
- **Workspace Management**: List and manage workspaces
- **Document Operations**: Create, read, update, delete, search, copy, and append content
- **Tag Management**: Create tags, add/remove tags from documents
- **Folder Management**: Organize documents in folders
- **Collection Management**: Create and manage favorite collections
- **File Management**: Upload and manage file attachments
- **Comment Management**: Add, update, delete, and resolve comments
- **Database Management**: Create data tables, manage columns and rows

## Installation

### Local Installation

```bash
# Clone the repository
git clone https://github.com/woodcoal/affine-cli.git
cd affine-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link the CLI (optional, for local development testing)
npm link
```

### Global Installation (Recommended)

```bash
# Install globally from npm (if published)
npm install -g affine-cli

# Or install from GitHub
npm install -g github:woodcoal/affine-cli

# After installation, you can use affine-cli command from any directory
```

## Configuration

Create a `.env` file in your project directory or use global configuration:

```bash
# Global config: ~/.affine-cli/affine-cli.env
# Local config: .env in project directory

AFFINE_BASE_URL=https://app.affine.pro
AFFINE_API_TOKEN=your_api_token
# or
AFFINE_COOKIE=your_cookie
# or
AFFINE_EMAIL=your_email
AFFINE_PASSWORD=your_password

AFFINE_WORKSPACE_ID=your_workspace_id
```

Configuration priority: Environment variables > Local `.env` > Global `~/.affine-cli/affine-cli.env`

## Usage

```bash
# Authentication
affine-cli auth login
affine-cli auth status
affine-cli auth logout

# Workspace
affine-cli workspace list

# Documents
affine-cli doc list --workspace <workspace-id>
affine-cli doc create -t "My Document" -c "./content.md"
affine-cli doc info --id <doc-id>
affine-cli doc delete --id <doc-id>
affine-cli doc search --query "keyword"

# Tags
affine-cli tags list
affine-cli tags create --tag "Important"
affine-cli tags add --id <doc-id> --tag "Important"
affine-cli tags remove --id <doc-id> --tag "Important"

# Folders
affine-cli folder all
affine-cli folder create --name "My Folder"
affine-cli folder list --id <folder-id>

# Collections
affine-cli collection list
affine-cli collection create --name "My Collection"

# Files
affine-cli file upload --file "./image.png"
affine-cli file list

# Comments
affine-cli comment list --doc-id <doc-id>
affine-cli comment create --doc-id <doc-id> --content "Great idea!"

# Databases
affine-cli database create --title "Tasks"
affine-cli database list --doc-id <doc-id>
affine-cli database columns --doc-id <doc-id> --db-id <db-id>
```

## Command Help

```bash
# Show main help
affine-cli help

# Show module help
affine-cli doc --help

# Show specific command help
affine-cli doc create --help
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── cli/                # CLI command modules
│   ├── auth.ts
│   ├── workspace.ts
│   ├── doc.ts
│   ├── tags.ts
│   ├── folder.ts
│   ├── collection.ts
│   ├── file.ts
│   ├── comments.ts
│   └── database.ts
├── core/               # Core business logic
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
└── utils/              # Utility functions
    ├── config.ts
    ├── auth.ts
    ├── graphqlClient.ts
    ├── wsClient.ts
    ├── cliUtils.ts
    ├── docsUtil.ts
    ├── fileConverter.ts
    └── misc.ts
```

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **GraphQL Client**: undici
- **WebSocket**: socket.io-client
- **CRDT**: Yjs

## Acknowledgments

This project references the implementation of [dawncr0w/affine-mcp-server](https://github.com/dawncr0w/affine-mcp-server). We thank the original contributors for their foundational work.

## License

MIT © [The AFFiNE CLI Contributors](LICENSE) & [木炭 <woodcoal@qq.com>](https://github.com/woodcoal/affine-cli)

## Author

- **Author**: 木炭
- **Email**: woodcoal@qq.com
- **GitHub**: https://github.com/woodcoal/affine-cli
