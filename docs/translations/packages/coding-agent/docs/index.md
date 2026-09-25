> 译注：本文是 `packages/coding-agent/docs/index.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# Pi 文档

Pi 是一个极简的终端 coding harness。它的设计是核心保持小巧，同时通过 TypeScript extensions、skills、prompt templates、themes 和 pi packages 进行扩展。

## 快速开始

使用 npm 安装 Pi：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` 会在安装期间禁用依赖的生命周期脚本。正常的 npm 安装并不需要 pi 的 install 脚本。

在 Linux 或 macOS 上，也可以使用安装脚本：

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

要卸载 pi 本身，对于 curl 和 npm 安装方式请使用 npm：

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

对于 pnpm、Yarn 或 Bun 安装，请使用对应的全局移除命令：`pnpm remove -g @earendil-works/pi-coding-agent`、`yarn global remove @earendil-works/pi-coding-agent` 或 `bun uninstall -g @earendil-works/pi-coding-agent`。

然后在项目目录中运行：

```bash
pi
```

订阅类 provider 通过 `/login` 认证，或在启动 pi 前设置诸如 `ANTHROPIC_API_KEY` 之类的 API key。

完整的首次运行流程参见 [Quickstart](quickstart.md)。

## 从这里开始

- [Quickstart](quickstart.md) - 安装、认证并运行第一个 session。
- [Using Pi](usage.md) - interactive mode、slash 命令、上下文文件和 CLI 参考。
- [Providers](providers.md) - 内置 provider 的订阅与 API key 设置。
- [llama.cpp](llama-cpp.md) - 运行本地 router，并用 `/llama` 管理模型。
- [Security](security.md) - 项目信任、沙箱边界和漏洞报告。
- [Containerization](containerization.md) - 用 Gondolin、Docker 或 OpenShell 将 pi 沙箱化。
- [Settings](settings.md) - 全局设置与项目设置。
- [Keybindings](keybindings.md) - 默认快捷键与自定义 keybinding。
- [Sessions](sessions.md) - session 管理、分支与树形导航。
- [Compaction](compaction.md) - 上下文 compaction 与分支摘要。

## 自定义

- [Extensions](extensions.md) - 用于 tool、命令、事件和自定义 UI 的 TypeScript 模块。
- [Skills](skills.md) - 提供可复用按需能力的 Agent Skills。
- [Prompt templates](prompt-templates.md) - 可通过 slash 命令展开的可复用 prompt。
- [Themes](themes.md) - 内置与自定义终端主题。
- [Pi packages](packages.md) - 打包并分享 extensions、skills、prompt 和 theme。
- [Custom models](models.md) - 为受支持的 provider API 添加模型条目。
- [Custom providers](custom-provider.md) - 实现自定义 API 与 OAuth 流程。

## 以编程方式使用

- [SDK](sdk.md) - 将 pi 嵌入 Node.js 应用。
- [RPC mode](rpc.md) - 通过 stdin/stdout JSONL 集成。
- [JSON event stream mode](json.md) - 带结构化事件的 print mode。
- [TUI components](tui.md) - 为 extension 构建自定义终端 UI。

## 参考

- [Environment variables](environment-variables.md) - Pi 进程配置以及可供 bash tool 使用的 session 元数据。
- [Session format](session-format.md) - JSONL session 文件格式、记录类型与 SessionManager API。

## 平台设置

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## 开发

- [Development](development.md) - 本地搭建、项目结构与调试。
