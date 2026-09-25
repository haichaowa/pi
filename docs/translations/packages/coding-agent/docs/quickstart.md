> 译注：本文是 `packages/coding-agent/docs/quickstart.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# 快速开始

本页带你从安装走向第一次实用的 pi session。

## 安装

Pi 以 npm package 的形式分发：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` 会在安装期间禁用依赖的生命周期脚本。正常的 npm 安装并不需要 pi 的 install 脚本。

### 卸载

使用安装 pi 时所用的包管理器。curl 安装脚本通过 npm 全局安装，因此 curl 和 npm 安装都用 npm 移除：

```bash
# curl installer or npm install -g
npm uninstall -g @earendil-works/pi-coding-agent

# pnpm
pnpm remove -g @earendil-works/pi-coding-agent

# Yarn
yarn global remove @earendil-works/pi-coding-agent

# Bun
bun uninstall -g @earendil-works/pi-coding-agent
```

卸载 pi 后，设置、凭据、session 和已安装的 pi package 会保留在 `~/.pi/agent/` 中。

然后在你希望 pi 处理的项目目录中启动它：

```bash
cd /path/to/project
pi
```

## 认证

Pi 可以通过 `/login` 使用订阅类 provider，或通过环境变量或 auth 文件使用 API key 类 provider。

### 方式 1：订阅登录

启动 pi 并运行：

```text
/login
```

然后选择一个 provider。内置的订阅登录包括 Claude Pro/Max、ChatGPT Plus/Pro（Codex）和 GitHub Copilot。

### 方式 2：API key

在启动 pi 之前设置 API key：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

你也可以运行 `/login` 并选择一个 API key 类 provider，把 key 保存到 `~/.pi/agent/auth.json`。

所有受支持的 provider、环境变量以及云 provider 的设置参见 [Providers](providers.md)。

## 第一个 session

pi 启动后，输入一个请求并按 Enter：

```text
Summarize this repository and tell me how to run its checks.
```

默认情况下，pi 提供给模型四个 tool：

- `read` - 读取文件
- `write` - 创建或覆盖文件
- `edit` - 修补文件
- `bash` - 运行 shell 命令

其他内置只读 tool（`grep`、`find`、`ls`）可通过 tool 选项启用。Pi 在你当前的工作目录中运行，并且可以修改其中的文件。如果希望方便回滚，请使用 git 或其他 checkpoint 工作流。

## 给 pi 提供项目说明

Pi 会在启动时加载上下文文件。添加一个 `AGENTS.md` 文件，告诉它在项目中如何工作：

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Pi 会加载：

- `~/.pi/agent/AGENTS.md`（全局说明）
- 父目录和当前目录中的 `AGENTS.md` 或 `CLAUDE.md`

如果某个目录包含 `AGENTS.override.md`，Pi 会加载它而不是该目录中的 `AGENTS.md` 或 `CLAUDE.md`。

修改上下文文件后，请重启 pi 或运行 `/reload`。

## 常见用法

### 引用文件

在 editor 中输入 `@` 模糊搜索文件，或在命令行中传入文件：

```bash
pi @README.md "Summarize this"
pi @src/app.ts @src/app.test.ts "Review these together"
```

图片或文本可以用 Ctrl+V 粘贴（Windows 上为 Alt+V）；在支持的终端中也可以把图片拖入。

### 运行 shell 命令

在 interactive mode 中：

```text
!npm run lint
```

命令输出会发送给模型。使用 `!!command` 可以运行命令而不把其输出加入模型上下文。

### 切换模型

使用 `/model` 或 Ctrl+L 为当前 session 选择模型。在模型选择器中按 Ctrl+S 可将高亮的模型保存为启动默认值。使用 `/thinking` 为当前 session 选择 thinking level，或在该选择器中按 Ctrl+S 保存启动默认 thinking level。使用 Shift+Tab 轮换 thinking level。使用 Ctrl+P / Shift+Ctrl+P 在 scoped model 之间轮换。

### 之后继续

Session 会自动保存：

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse previous sessions
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Open a specific session
```

在 pi 内部，使用 `/resume`、`/new`、`/tree`、`/fork` 和 `/clone` 管理 session。

### Non-interactive mode

对于一次性 prompt：

```bash
pi -p "Summarize this codebase"
cat README.md | pi -p "Summarize this text"
pi -p @screenshot.png "What's in this image?"
```

使用 `--mode json` 获得 JSON 事件输出，或使用 `--mode rpc` 进行进程集成。

## 下一步

- [Using Pi](usage.md) - interactive mode、slash 命令、session、上下文文件和 CLI 参考。
- [Providers](providers.md) - 认证与模型设置。
- [Settings](settings.md) - 全局与项目配置。
- [Keybindings](keybindings.md) - 快捷键与自定义。
- [Pi Packages](packages.md) - 安装共享的 extensions、skills、prompt 和 theme。

平台说明：[Windows](windows.md)、[Termux](termux.md)、[tmux](tmux.md)、[Terminal setup](terminal-setup.md)、[Shell aliases](shell-aliases.md)。
