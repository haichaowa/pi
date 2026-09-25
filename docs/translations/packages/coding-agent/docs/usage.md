> 译注：本文是 `packages/coding-agent/docs/usage.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# 使用 Pi

本页汇总了快速入门页面未涵盖的日常使用细节。

## 交互模式

<p align="center"><img src="images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

界面分为四个主要区域：

- **启动页头** - 快捷键、已加载的上下文文件、prompt 模板、skill 和扩展
- **消息区** - 用户消息、assistant 回复、工具调用、工具结果、通知、错误以及扩展 UI
- **编辑器** - 你输入内容的地方；边框颜色表示当前 thinking 级别
- **页脚** - 工作目录、session 名称、token/缓存用量、费用、上下文用量以及当前模型。总量包括 assistant 回复、工具报告的用量以及总结生成。

编辑器可以被 `/settings` 等内置 UI 或自定义扩展 UI 临时替换。

### 编辑器功能

| 功能 | 操作方式 |
|---------|-----|
| 文件引用 | 输入 `@` 模糊搜索项目文件 |
| 路径补全 | 按 Tab 补全路径 |
| 多行输入 | Shift+Enter；Windows Terminal 上为 Ctrl+Enter |
| 复制回复 | Ctrl+X 在 `/tree` 中复制选中的消息；否则复制最后一条 assistant 消息，或在 `fullscreenCopyOnSelect` 被禁用时复制当前全屏选中的文本 |
| 图片 | 用 Ctrl+V（Windows 上为 Alt+V）粘贴，或直接拖入终端 |
| Shell 命令 | `!command` 会执行并把输出发给模型 |
| 隐藏 shell 命令 | `!!command` 会执行但不把输出发给模型 |
| 外部编辑器 | Ctrl+G 会打开 `externalEditor`、`$VISUAL`、`$EDITOR`，Windows 上为记事本（Notepad），其他平台为 `nano` |

所有快捷键与自定义方式参见 [Keybindings](keybindings.md)。

## 斜杠命令

在编辑器中输入 `/` 即可打开命令补全。扩展可以注册自定义命令，skill 以 `/skill:name` 的形式提供，prompt 模板则通过 `/templatename` 展开。

| 命令 | 描述 |
|---------|-------------|
| `/login`, `/logout` | 管理 OAuth 或 API key 凭据 |
| [`/llama`](llama-cpp.md) | 下载、加载和卸载 llama.cpp router 模型 |
| `/model` | 切换模型；在选择器中按 Ctrl+S 可保存为启动默认值 |
| `/thinking` | 切换 thinking 级别；在选择器中按 Ctrl+S 可保存为启动默认值 |
| `/scoped-models` | 启用/禁用参与 Ctrl+P 轮换的模型 |
| `/settings` | 主题、消息投递、传输方式及其他偏好设置 |
| `/resume` | 从过去的 session 中选择 |
| `/new` | 开始一个新 session |
| `/name <name>` | 设置 session 显示名称 |
| `/session` | 显示 session 文件、ID、消息数、token 数和费用 |
| `/tree` | 跳转到 session 中的任意位置并从那里继续 |
| `/trust` | 保存项目信任决定，供以后的 session 使用 |
| `/fork` | 从之前的某条用户消息创建新 session |
| `/clone` | 把当前活动分支复制到一个新 session |
| `/compact [prompt]` | 手动 compact 上下文，可选附加自定义指示 |
| `/copy` | 把最后一条 assistant 消息复制到剪贴板 |
| `/export [file]` | 将 session 导出为 HTML 或 JSONL |
| `/import <file>` | 从 JSONL 文件导入并恢复 session |
| `/share` | 上传为私有 GitHub gist，并附可分享的 HTML 链接 |
| `/reload` | 重新加载快捷键、扩展、skill、prompt、主题和上下文文件 |
| `/hotkeys` | 显示所有键盘快捷键 |
| `/changelog` | 显示版本历史 |
| `/quit` | 退出 pi |

## 消息队列

在 agent 仍在工作时你也可以提交消息：

- **Enter** 会把消息作为 steering（转向）消息排队，在当前 assistant 轮次执行完其工具调用后投递。
- **Alt+Enter** 会把消息作为 follow-up（后续）消息排队，在 agent 完成全部工作后投递。
- **Escape** 会中止当前操作，并把排队的消息恢复到编辑器。
- **Alt+Up** 会把排队的消息取回编辑器。

在 Windows Terminal 上，Alt+Enter 默认用于全屏。如果想让 pi 接收这个快捷键，请按照 [Terminal setup](terminal-setup.md) 中的说明重新映射。

可在[设置](settings.md)中通过 `steeringMode` 和 `followUpMode` 配置投递行为。

## Sessions

session 自动保存到 `~/.pi/agent/sessions/`，按工作目录组织。

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse and select a session
pi --no-session        # Ephemeral mode; do not save
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Use a specific session file or session ID
pi --fork <path|id>    # Fork a session into a new session file
```

常用的 session 命令：

- `/session` 显示当前 session 文件和 ID。
- `/tree` 浏览文件内的 session 树，并可为被放弃的分支生成总结。
- `/fork` 从更早的用户消息创建新 session。
- `/clone` 把当前活动分支复制到一个新 session 文件。
- `/compact` 总结较旧的消息以释放上下文。

详情参见 [Sessions](sessions.md) 和 [Compaction](compaction.md)。

## 上下文文件

Pi 在启动时会从以下位置加载 `AGENTS.md` 或 `CLAUDE.md`：

- `~/.pi/agent/AGENTS.md` 用于全局指示
- 父目录，从当前工作目录向上逐级查找
- 当前目录

如果某个目录包含 `AGENTS.override.md`，Pi 会加载它，而不是该目录中的 `AGENTS.md` 或 `CLAUDE.md`。来自其他目录的上下文文件仍会正常叠加。

上下文文件可用于记录项目约定、命令、安全规则和偏好。使用 `--no-context-files` 或 `-nc` 可禁用加载。

### 系统 prompt 文件

用以下文件替换默认系统 prompt：

- `.pi/SYSTEM.md` 用于项目
- `~/.pi/agent/SYSTEM.md` 用于全局

在上述任一位置放置 `APPEND_SYSTEM.md`，即可在不替换默认 prompt 的情况下向其追加内容。

### 项目信任

在交互式启动时，如果某个项目文件夹包含项目本地设置、资源或项目 `.agents/skills`，且 `~/.pi/agent/trust.json` 中没有针对该文件夹或其某个父文件夹的已保存决定，pi 会在信任它之前先询问。信任一个项目后，pi 可以加载 `.pi/settings.json` 和 `.pi` 资源、安装缺失的项目包，并执行项目扩展。

在信任决定做出之前，pi 只加载上下文文件、用户/全局扩展以及 CLI `-e` 扩展，让它们能够处理 `project_trust` 事件。项目本地扩展、由项目包管理的扩展以及项目设置只会在项目受信任之后加载。当切换到来自不同 cwd、且其信任在当前进程中尚未确定的 session 时，也适用同样的区分。

非交互模式（`-p`、`--mode json` 和 `--mode rpc`）不会显示信任提示。在没有适用的已保存信任决定时，它们会使用全局设置中的 `defaultProjectTrust`：`ask`（默认值）和 `never` 会忽略这些项目资源，`always` 则信任它们。传入 `--approve`/`-a` 或 `--no-approve`/`-na` 可为单次运行覆盖项目信任。

如果没有任何扩展或已保存决定适用，则由 `defaultProjectTrust` 决定回退行为。可以在 `~/.pi/agent/settings.json` 中把它设为 `"ask"`、`"always"` 或 `"never"`，也可以通过 `/settings` 修改。

`pi config` 和包相关命令使用同样的项目信任流程，只有 `pi update` 从不提示。传入 `--approve` 可为单条命令信任项目本地设置，传入 `--no-approve` 则忽略它们。

在交互模式中使用 `/trust` 可保存针对以后 session 的项目信任决定，包括对直接父文件夹的信任。它只写入 `~/.pi/agent/trust.json`；当前 session 不会重新加载，因此需要重启 pi 才能让更改生效。


## 导出与分享 session

使用 `/export [file]` 可将 session 写出为 HTML。

使用 `/share` 可上传为私有 GitHub gist，并获得可分享的 HTML 链接。

如果你在开源工作中使用 pi，并希望发布 session 用于模型、prompt、工具和评估研究，参见 [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf)。它会把 session 发布到 Hugging Face 数据集。

## CLI 参考

```bash
pi [options] [--] [@files...] [messages...]
```

### 包命令

```bash
pi install <source> [-l]     # Install package, -l for project-local
pi remove <source> [-l]      # Remove package
pi uninstall <source> [-l]   # Alias for remove
pi update [source|self|pi]   # Update pi only, or one package source
pi update --all              # Update pi and packages; reconcile pinned git refs
pi update --extensions       # Update packages only; reconcile pinned git refs
pi update --models           # Refresh model catalogs only
pi update --self             # Update pi only
pi update --extension <src>  # Update one package
pi list                      # List installed packages
pi config                    # Enable/disable package resources
```

这些命令用于管理 pi 包，`pi update` 还可以更新 pi CLI 安装本身。要卸载 pi 本身，参见 [Quickstart](quickstart.md#uninstall)。`pi config` 和项目包命令接受 `--approve`/`--no-approve`，以便为单条命令信任或忽略项目本地设置。`pi update` 从不就项目信任进行提示。

包来源和安全说明参见 [Pi Packages](packages.md)。

### 模式

| 标志 | 描述 |
|------|-------------|
| default | 交互模式 |
| `-p`, `--print` | 打印回复后退出 |
| `--mode json` | 以 JSON 行输出所有事件；参见 [JSON mode](json.md) |
| `--mode rpc` | 基于 stdin/stdout 的 RPC 模式；参见 [RPC mode](rpc.md) |
| `--export <in> [out]` | 将 session 导出为 HTML |

在 print 模式下，pi 还会读取管道传入的 stdin，并将其合并到初始 prompt 中：

```bash
cat README.md | pi -p "Summarize this text"
```

### 模型选项

| 选项 | 描述 |
|--------|-------------|
| `--provider <name>` | 提供商，如 `anthropic`、`openai` 或 `google` |
| `--model <pattern>` | 模型模式或 ID；支持 `provider/id` 和可选的 `:<thinking>` |
| `--api-key <key>` | API key，会覆盖环境变量 |
| `--thinking <level>` | `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` |
| `--models <patterns>` | 逗号分隔的模式列表，用于 Ctrl+P 轮换 |
| `--list-models [search]` | 列出可用模型 |

### session 选项

| 选项 | 描述 |
|--------|-------------|
| `-c`, `--continue` | 继续最近的 session |
| `-r`, `--resume` | 浏览并选择一个 session |
| `--session <path\|id>` | 使用指定的 session 文件或部分 UUID |
| `--fork <path\|id>` | 将某个 session 文件或部分 UUID fork 为新 session |
| `--session-dir <dir>` | 自定义 session 存储目录 |
| `--no-session` | 临时模式；不保存 |
| `--name <name>`, `-n <name>` | 在启动时设置 session 显示名称 |

### 工具选项

| 选项 | 描述 |
|--------|-------------|
| `--tools <list>`, `-t <list>` | 只允许指定的内置、扩展和自定义工具 |
| `--exclude-tools <list>`, `-xt <list>` | 禁用指定的内置、扩展和自定义工具 |
| `--no-builtin-tools`, `-nbt` | 禁用内置工具，但保留扩展/自定义工具 |
| `--no-tools`, `-nt` | 禁用所有工具 |

内置工具：`read`、`bash`、`powershell`（Windows）、`edit`、`write`、`grep`、`find`、`ls`。

### 资源选项

| 选项 | 描述 |
|--------|-------------|
| `-e`, `--extension <source>` | 从路径、npm 或 git 加载扩展；可重复 |
| `--no-extensions` | 禁用扩展发现 |
| `--skill <path>` | 加载一个 skill；可重复 |
| `--no-skills` | 禁用 skill 发现 |
| `--prompt-template <path>` | 加载一个 prompt 模板；可重复 |
| `--no-prompt-templates` | 禁用 prompt 模板发现 |
| `--theme <path>` | 加载一个主题；可重复 |
| `--no-themes` | 禁用主题发现 |
| `--no-context-files`, `-nc` | 禁用 `AGENTS.md` 和 `CLAUDE.md` 发现 |

将 `--no-*` 与显式加载标志结合使用，可以忽略设置、只加载你确切需要的内容。例如：

```bash
pi --no-extensions -e ./my-extension.ts
```

### 其他选项

| 选项 | 描述 |
|--------|-------------|
| `--system-prompt <text>` | 替换默认 prompt；上下文文件和 skill 仍会附加 |
| `--append-system-prompt <text>` | 向系统 prompt 追加内容 |
| `--tui-mode <mode>` | TUI 模式：`regular`（默认）或实验性的 `fullscreen` |
| `--use-theme <name[/name]>` | 为本次运行设置初始交互主题，不更改设置 |
| `--verbose` | 强制输出详细的启动信息 |
| `-a`, `--approve` | 本次运行信任项目本地文件 |
| `-na`, `--no-approve` | 本次运行忽略项目本地文件 |
| `--` | 停止解析选项；其余参数视为 prompt 或 `@file` 输入 |
| `-h`, `--help` | 显示帮助 |
| `-v`, `--version` | 显示版本 |

在 `fullscreen` 模式下，transcript 会在终端视口内滚动，而排队的消息、工作状态、扩展小部件、编辑器和页脚固定在底部。鼠标/触控板输入可滚动指针下的区域；键盘视口操作始终可用。内嵌图片在支持 Kitty graphics protocol 的终端中可用，包括 Kitty 和 Ghostty。在 iTerm2 中它们会渲染为文本占位符，因为其内嵌图片协议在应用掌控的滚动过程中无法删除或裁剪已放置的图片。在 `regular` 模式下，pi 使用主屏幕和终端自有的回滚缓冲区，iTerm2 的内嵌图片也能继续正常渲染。终端相关的设置和变通方法参见 [Terminal setup](terminal-setup.md)。

在 `/settings` 中设置 **TUI mode** 可以立即在 `regular` 和 `fullscreen` 之间切换，并选择以后 session 的默认值。**Fullscreen exit output** 控制退出全屏时是打印最终 transcript，还是恢复之前的屏幕并只打印 session 恢复提示。

### 文件参数

在文件名前加 `@` 前缀即可将其包含在消息中：

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### 示例

```bash
# Interactive with initial prompt
pi "List all .ts files in src/"

# Non-interactive
pi -p "Summarize this codebase"

# Prompt beginning with a dash
pi -p -- "- Summarize these points"

# Non-interactive with piped stdin
cat README.md | pi -p "Summarize this text"

# Named one-shot session
pi --name "release audit" -p "Audit this repository"

# Different model
pi --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix
pi --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
pi --model sonnet:high "Solve this complex problem"

# Limit model cycling
pi --models "claude-*,gpt-4o"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
pi --exclude-tools ask_question
```

## 设计原则

Pi 保持核心精简，把工作流特定的行为推到扩展、skill、prompt 模板和包中。

它有意不内置 MCP、sub-agent、权限弹窗、plan 模式、待办事项或后台 bash。你可以把这些工作流构建或安装为扩展或包，也可以使用容器和 tmux 等外部工具。

完整的设计理由请阅读这篇[博客文章](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)。
