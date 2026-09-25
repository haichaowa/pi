> 译注：本文是 `packages/coding-agent/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> 来自新贡献者的新 issue 和 PR 默认会被自动关闭。维护者每天都会审查被自动关闭的 issue。参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。

---

Pi 是一个极简的终端 coding harness。让 pi 适配你的工作流，而不是反过来，而且无需 fork 并修改 pi 内部代码。通过 TypeScript [Extensions](#extensions)、[Skills](#skills)、[Prompt Templates](#prompt-templates) 和 [Themes](#themes) 对其进行扩展。把你的 extensions、skills、prompt templates 和 themes 放进 [Pi Packages](#pi-packages)，即可通过 npm 或 git 与他人分享。

Pi 自带强大的默认配置，但不内置 sub agent、plan mode 之类的功能。你可以让 pi 为你构建想要的功能，或安装符合你工作流的第三方 pi package。

Pi 以四种 mode 运行：interactive、print 或 JSON、用于进程集成的 RPC，以及用于嵌入你自己应用的 SDK。

## 分享你的 OSS coding agent session

如果你在开源工作中使用 pi，请分享你的 coding agent session。

公开的 OSS session 数据有助于基于真实的开发工作流改进模型、prompt、tool 和评估。

完整说明参见 [X 上的这篇文章](https://x.com/badlogicgames/status/2037811643774652911)。

要发布 session，请使用 [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf)。阅读其 README.md 了解设置说明。你只需要一个 Hugging Face 账号、Hugging Face CLI 和 `pi-share-hf`。

你也可以观看[这个视频](https://x.com/badlogicgames/status/2041151967695634619)，其中演示了我如何发布自己的 `pi-mono` session。

我会定期在这里发布我自己的 `pi-mono` 工作 session：

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## 目录

- [快速开始](#quick-start)
- [Provider 与模型](#providers--models)
- [Interactive Mode](#interactive-mode)
  - [Editor](#editor)
  - [命令](#commands)
  - [键盘快捷键](#keyboard-shortcuts)
  - [消息队列](#message-queue)
- [Sessions](#sessions)
  - [分支](#branching)
  - [压缩（Compaction）](#compaction)
- [设置](#settings)
- [上下文文件](#context-files)
- [自定义](#customization)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
  - [Themes](#themes)
  - [Pi Packages](#pi-packages)
- [以编程方式使用](#programmatic-usage)
- [设计理念](#philosophy)
- [CLI 参考](#cli-reference)

---

## 快速开始

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` 会在安装期间禁用依赖的生命周期脚本。正常的 npm 安装并不需要 pi 的 install 脚本。

也可以使用安装脚本：

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

使用 API key 认证：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pi
```

或者使用你已有的订阅：

```bash
pi
/login  # Then select provider
```

然后直接和 pi 对话即可。默认情况下，pi 提供给模型四个 tool：`read`、`write`、`edit` 和 `bash`。模型会利用它们来完成你的请求。可以通过 [skills](#skills)、[prompt templates](#prompt-templates)、[extensions](#extensions) 或 [pi packages](#pi-packages) 增加能力。

**平台说明：** [Windows](docs/windows.md) | [Termux (Android)](docs/termux.md) | [tmux](docs/tmux.md) | [终端设置](docs/terminal-setup.md) | [Shell 别名](docs/shell-aliases.md)

---

## Provider 与模型

对每个内置 provider，pi 都维护一份支持 tool 的模型列表。已配置的 provider 目录会自动刷新；运行 `pi update --models` 可强制立即刷新。通过订阅（`/login`）或 API key 完成认证，然后通过 `/model`（或 Ctrl+L）选择该 provider 的任意模型。在模型选择器中按 Ctrl+S 可将高亮的模型保存为启动默认值。

**订阅：**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot

**API key：**
- Anthropic
- Ant Ling
- OpenAI
- Azure OpenAI
- DeepSeek
- NVIDIA NIM
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- ZAI Coding Plan (Global)
- ZAI Coding Plan (China)
- OpenCode Zen
- OpenCode Go
- Hugging Face
- Fireworks
- Together AI
- Baseten
- Kimi For Coding
- MiniMax
- Xiaomi MiMo
- Xiaomi MiMo Token Plan (China)
- Xiaomi MiMo Token Plan (Amsterdam)
- Xiaomi MiMo Token Plan (Singapore)

Pi 还支持 llama.cpp router server。用 `/login llama.cpp` 完成配置，用 `/llama` 管理下载和已加载的模型，然后用 `/model` 选择一个已加载的模型。设置和使用详见 [docs/llama-cpp.md](docs/llama-cpp.md)。

其他 provider 的设置说明参见 [docs/providers.md](docs/providers.md)。

**自定义 provider 与模型：** 如果 provider 使用受支持的 API（OpenAI、Anthropic、Google），可通过 `~/.pi/agent/models.json` 添加。对于自定义 API 或 OAuth，请使用 extensions。参见 [docs/models.md](docs/models.md) 和 [docs/custom-provider.md](docs/custom-provider.md)。

---

## Interactive Mode

<p align="center"><img src="docs/images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

界面自上而下依次为：

- **启动头部** - 显示快捷键提示（`/hotkeys` 查看全部）、已加载的 AGENTS.md 文件、prompt templates、skills 和 extensions
- **消息区** - 你的消息、assistant 回复、tool 调用及其结果、通知、错误以及 extension UI
- **Editor** - 你输入内容的地方；边框颜色指示 thinking level，边框上还会显示流式工作指示器
- **Footer** - 工作目录、session 名称、总 token/缓存用量（`↑` 输入、`↓` 输出、`R` 缓存读取、`W` 缓存写入、`CH` 最近缓存命中率）、费用、上下文用量、当前模型。总量包括 assistant 回复、tool 上报的用量以及摘要生成。

Editor 可以被其他 UI 临时替换，比如内置的 `/settings` 或来自 extensions 的自定义 UI（例如让用户以结构化格式回答模型问题的问答 tool）。[Extensions](#extensions) 还可以替换 editor、在其上方/下方添加 widget，或添加 status line、自定义 footer 和 overlay。

### Editor

| 功能 | 操作方式 |
|---------|-----|
| 文件引用 | 输入 `@` 模糊搜索项目文件 |
| 路径补全 | 按 Tab 补全路径 |
| 多行输入 | Shift+Enter（在 Windows Terminal 上为 Ctrl+Enter） |
| 外部 editor | Ctrl+G 会打开 `externalEditor`、`$VISUAL`、`$EDITOR`、Windows 上的记事本，或其他平台上的 `nano` |
| 剪贴板 | Ctrl+V 粘贴图片或文本（Windows 上为 Alt+V），也可以把图片拖进终端 |
| Bash 命令 | `!command` 运行并把输出发送给 LLM，`!!command` 运行但不发送 |

标准编辑 keybinding：删除单词、撤销等。参见 [docs/keybindings.md](docs/keybindings.md)。

### 命令

在 editor 中输入 `/` 触发命令。[Extensions](#extensions) 可以注册自定义命令，[skills](#skills) 以 `/skill:name` 的形式提供，[prompt templates](#prompt-templates) 则通过 `/templatename` 展开。

| 命令 | 说明 |
|---------|-------------|
| `/login`, `/logout` | 管理 provider 凭据 |
| [`/llama`](docs/llama-cpp.md) | 下载、加载和卸载 llama.cpp router 模型 |
| `/model` | 切换模型；在选择器中按 Ctrl+S 保存为启动默认值 |
| `/thinking` | 切换 thinking level；在选择器中按 Ctrl+S 保存为启动默认值 |
| `/scoped-models` | 启用/禁用参与 Ctrl+P 轮换的模型 |
| `/settings` | Theme、消息投递、transport 及其他偏好设置 |
| `/resume` | 从以往的 session 中选择 |
| `/new` | 开始一个新 session |
| `/name <name>` | 设置 session 显示名称 |
| `/session` | 显示 session 信息（文件、ID、消息、token、费用） |
| `/tree` | 跳转到 session 中的任意位置并从那里继续 |
| `/trust` | 保存项目信任决定供后续 session 使用（需重启） |
| `/fork` | 从之前的某条用户消息创建新 session |
| `/clone` | 把当前活动分支复制为一个新 session |
| `/compact [prompt]` | 手动压缩上下文，可附带自定义指令 |
| `/copy` | 复制最后一条 assistant 消息到剪贴板 |
| `/export [file]` | 将 session 导出为 HTML 或 JSONL 文件 |
| `/import <file>` | 从 JSONL 文件导入并恢复 session |
| `/share` | 上传为私有 GitHub gist，并生成可分享的 HTML 链接 |
| `/reload` | 重新加载 keybinding、extensions、skills、prompt、theme 和上下文文件 |
| `/hotkeys` | 显示所有键盘快捷键 |
| `/changelog` | 显示版本历史 |
| `/quit` | 退出 pi |

### 键盘快捷键

完整列表见 `/hotkeys`。可通过 `~/.pi/agent/keybindings.json` 自定义。参见 [docs/keybindings.md](docs/keybindings.md)。

**常用快捷键：**

| 按键 | 操作 |
|-----|--------|
| Ctrl+C | 清空 editor |
| Ctrl+C 两次 | 退出 |
| Escape | 取消/中止 |
| Escape 两次 | 打开 `/tree` |
| Ctrl+L | 打开模型选择器 |
| Ctrl+P / Shift+Ctrl+P | 在 scoped model 之间向前/向后轮换 |
| Shift+Tab | 轮换 thinking level |
| Ctrl+O | 折叠/展开 tool 输出 |
| Ctrl+T | 折叠/展开 thinking 块 |
| Ctrl+X | 复制最后一条 assistant 消息；在 fullscreen mode 下禁用 copy-on-select 时，改为复制当前选中的文本 |

### 消息队列

在 agent 工作期间提交消息：

- **Enter** 将一条 *steering* 消息加入队列，在当前 assistant 回合执行完其 tool 调用后送达
- **Alt+Enter** 将一条 *follow-up* 消息加入队列，仅在 agent 完成全部工作后送达
- **Escape** 中止并把排队的消息恢复到 editor 中
- **Alt+Up** 把排队的消息取回到 editor 中

在 Windows Terminal 上，`Alt+Enter` 默认用于全屏切换。请在 [docs/terminal-setup.md](docs/terminal-setup.md) 中重新映射它，以便 pi 能接收到这个 follow-up 快捷键。

在 [settings](docs/settings.md) 中配置投递方式：`steeringMode` 和 `followUpMode` 可设为 `"one-at-a-time"`（默认，等待响应）或 `"all"`（一次性送达所有排队的消息）。`transport` 用于为支持多种 transport 的 provider 选择偏好的 transport（`"sse"`、`"websocket"` 或 `"auto"`）。

---

## Sessions

Session 以树形结构的 JSONL 文件存储。每条记录都有 `id` 和 `parentId`，无需创建新文件即可原地分支。文件格式参见 [docs/session-format.md](docs/session-format.md)。

### 管理

Session 自动保存到 `~/.pi/agent/sessions/`，按工作目录组织。

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse and select from past sessions
pi --no-session        # Ephemeral mode (don't save)
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Use specific session file or ID
pi --fork <path|id>    # Fork specific session file or ID into a new session
```

在 interactive mode 中使用 `/session` 查看当前 session ID，之后即可用 `--session <id>` 或 `--fork <id>` 复用它。

### 分支

**`/tree`** - 在 session 树中原地导航。选择任意历史节点，从该处继续，并在分支之间切换。全部历史都保存在单个文件中。当模型正在响应时选择某个节点会取消该次响应。当 compaction 或另一次树导航仍在进行时，导航无法继续；请等待其完成后重试。

<p align="center"><img src="docs/images/tree-view.png" alt="Tree View" width="600"></p>

- 输入即可搜索，用 Ctrl+←/Ctrl+→ 或 Alt+←/Alt+→ 折叠/展开并在分支之间跳转，用 ←/→ 翻页
- 过滤模式（Ctrl+O）：default → no-tools → user-only → labeled-only → all
- 按 Ctrl+X 复制选中的消息
- 按 Shift+L 给条目添加书签标签，按 Shift+T 切换是否显示标签时间戳

**`/fork`** - 从活动分支上之前的某条用户消息创建新 session 文件。会打开一个选择器，复制到该节点为止的活动路径，并把选中的 prompt 放入 editor 供修改。

**`/clone`** - 在当前位置把当前活动分支复制为一个新 session 文件。新 session 保留完整的活动路径历史，并以空的 editor 打开。

**`--fork <path|id>`** - 直接从 CLI fork 一个已有的 session 文件或部分 session UUID。这会把完整的源 session 复制到当前项目中的一个新 session 文件里。

### 压缩（Compaction）

长时间的 session 可能耗尽上下文窗口。Compaction 会对较旧的消息做摘要，同时保留近期消息。

**手动：** `/compact` 或 `/compact <custom instructions>`

**自动：** 默认启用。在上下文溢出时触发（恢复并重试），或在接近上限时主动触发。通过 `/settings` 或 `settings.json` 配置。

Compaction 是有损的。完整历史仍保留在 JSONL 文件中，可用 `/tree` 回看。可通过 [extensions](#extensions) 自定义 compaction 行为。内部机制参见 [docs/compaction.md](docs/compaction.md)。

---

## 设置

使用 `/settings` 修改常用选项，或直接编辑 JSON 文件：

| 位置 | 作用范围 |
|----------|-------|
| `~/.pi/agent/settings.json` | 全局（所有项目） |
| `.pi/settings.json` | 项目（覆盖全局） |

全部选项参见 [docs/settings.md](docs/settings.md)。

### 项目信任

在 interactive 启动时，如果一个项目文件夹包含项目本地设置、资源或项目 `.agents/skills`，并且 `~/.pi/agent/trust.json` 中没有针对该文件夹或其父文件夹的已保存决定，pi 会先询问是否信任该项目。信任项目后，pi 才会加载 `.pi/settings.json` 和 `.pi` 资源、安装缺失的项目 package，并执行项目 extensions。

在做出信任决定之前，pi 只加载上下文文件、用户/全局 extensions 和通过 CLI `-e` 指定的 extensions，让它们能够处理 `project_trust` 事件。项目本地 extensions、由项目 package 管理的 extensions 以及项目设置，只有在项目被信任之后才会加载。当切换到来自不同 cwd、且其信任状态在当前进程中尚未确定的 session 时，同样适用这一划分。

Non-interactive mode（`-p`、`--mode json` 和 `--mode rpc`）不会显示信任询问。在没有适用的已保存信任决定时，它们使用全局设置中的 `defaultProjectTrust`：`ask`（默认）和 `never` 会忽略这些项目资源，`always` 则信任它们。可传入 `--approve`/`-a` 或 `--no-approve`/`-na` 为单次运行覆盖项目信任。

如果没有 extension 或已保存的决定适用，则由 `defaultProjectTrust` 控制回退行为。可在 `~/.pi/agent/settings.json` 中将其设为 `"ask"`、`"always"` 或 `"never"`，或通过 `/settings` 修改。

`pi config` 和 package 命令使用同样的项目信任流程，但 `pi update` 从不询问。传入 `--approve` 可在单条命令中信任项目本地设置，传入 `--no-approve` 则忽略它们。

在 interactive mode 中使用 `/trust` 可为后续 session 保存项目信任决定，包括对直接父文件夹的信任。它只写入 `~/.pi/agent/trust.json`；当前 session 不会重新加载，因此需重启 pi 才能生效。

### 遥测与更新检查

Pi 有两个相互独立的启动功能：

- **更新检查：** 请求 `https://pi.dev/api/latest-version` 检查是否存在更新版本的 Pi。通过 `PI_SKIP_VERSION_CHECK=1` 禁用。禁用更新检查只会关闭这一项检查。
- **安装/更新遥测：** 在首次安装或通过 changelog 检测到更新后，向 `https://pi.dev/api/report-install` 发送匿名版本 ping。该设置同时控制 OpenRouter、Cloudflare 以及直连 NVIDIA NIM 请求的可选 provider 归因 header。可在 `settings.json` 中把 `enableInstallTelemetry` 设为 `false`，或设置 `PI_TELEMETRY=0` 来退出。这不会禁用更新检查；除非禁用了更新检查或启用了 offline mode，Pi 仍可能访问 `pi.dev` 获取最新版本。

使用 `--offline` 或 `PI_OFFLINE=1` 可禁用上述所有启动时的网络操作，包括更新检查、package 更新检查以及安装/更新遥测。

---

## 上下文文件

Pi 在启动时从以下位置加载 `AGENTS.md`（或 `CLAUDE.md`）：
- `~/.pi/agent/AGENTS.md`（全局）
- 父目录（从 cwd 向上遍历）
- 当前目录

如果某个目录包含 `AGENTS.override.md`，Pi 会加载它而不是该目录中的 `AGENTS.md` 或 `CLAUDE.md`。来自其他目录的上下文文件仍会被拼接进来。

用于放置项目说明（`AGENTS.md`/`CLAUDE.md`）、约定和常用命令。所有匹配的文件都会被拼接。

使用 `--no-context-files`（或 `-nc`）禁用上下文文件加载。

### System Prompt

使用 `.pi/SYSTEM.md`（项目）或 `~/.pi/agent/SYSTEM.md`（全局）替换默认 system prompt。通过 `APPEND_SYSTEM.md` 追加而不替换。

---

## 自定义

### Prompt Templates

以 Markdown 文件形式保存的可复用 prompt。输入 `/name` 即可展开。

```markdown
<!-- ~/.pi/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
```

放在 `~/.pi/agent/prompts/`、`.pi/prompts/` 或某个 [pi package](#pi-packages) 中即可与他人分享。参见 [docs/prompt-templates.md](docs/prompt-templates.md)。

### Skills

遵循 [Agent Skills 标准](https://agentskills.io)的按需能力包。通过 `/skill:name` 调用，或让 agent 自动加载。

```markdown
<!-- ~/.pi/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

放在 `~/.pi/agent/skills/`、`~/.agents/skills/`、`.pi/skills/` 或 `.agents/skills/`（从 `cwd` 向上遍历各级父目录），或某个 [pi package](#pi-packages) 中即可与他人分享。参见 [docs/skills.md](docs/skills.md)。

### Extensions

<p align="center"><img src="docs/images/doom-extension.png" alt="Doom Extension" width="600"></p>

TypeScript 模块，通过自定义 tool、命令、键盘快捷键、事件处理器和 UI 组件来扩展 pi。

```typescript
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "deploy", ... });
  pi.registerCommand("stats", { ... });
  pi.on("tool_call", async (event, ctx) => { ... });
}
```

default export 也可以是 `async` 的。pi 会等待异步的 extension 工厂函数完成后再继续启动，这对一次性初始化很有用，例如在调用 `pi.registerProvider()` 之前先获取远程模型列表。

**可以实现：**
- 自定义 tool（或完全替换内置 tool）
- Sub agent 和 plan mode
- 自定义 compaction 和摘要
- 权限门控和路径保护
- 自定义 editor 和 UI 组件
- Status line、header、footer
- Git checkpoint 和自动提交
- SSH 和沙箱执行
- MCP server 集成
- 让 pi 看起来像 Claude Code
- 等待时玩游戏（没错，Doom 能跑）
- ……任何你能想到的东西

放在 `~/.pi/agent/extensions/`、`.pi/extensions/` 或某个 [pi package](#pi-packages) 中即可与他人分享。参见 [docs/extensions.md](docs/extensions.md) 和 [examples/extensions/](examples/extensions/)。

### Themes

内置主题：`dark`、`light`。Theme 支持热重载：修改当前生效的 theme 文件后，pi 会立即应用更改。

放在 `~/.pi/agent/themes/`、`.pi/themes/` 或某个 [pi package](#pi-packages) 中即可与他人分享。参见 [docs/themes.md](docs/themes.md)。

### Pi Packages

通过 npm 或 git 打包并分享 extensions、skills、prompt 和 theme。可以在 [npmjs.com](https://www.npmjs.com/search?q=keywords%3Api-package) 或 [Discord](https://discord.com/channels/1456806362351669492/1457744485428629628) 上查找 package。

> **安全提示：** Pi package 以完整的系统权限运行。Extension 会执行任意代码，skill 也可能指示模型执行任何操作，包括运行可执行文件。安装第三方 package 前请先审查其源代码。

```bash
pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3      # pinned version
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1  # tag or commit
pi install git:git@github.com:user/repo
pi install git:git@github.com:user/repo@v1  # tag or commit
pi install https://github.com/user/repo
pi install https://github.com/user/repo@v1      # tag or commit
pi install ssh://git@github.com/user/repo
pi install ssh://git@github.com/user/repo@v1    # tag or commit
pi remove npm:@foo/pi-tools
pi uninstall npm:@foo/pi-tools          # alias for remove
pi list
pi update                               # update pi only
pi update --all                         # update pi and packages
pi update --extensions                  # update packages only
pi update --models                      # refresh model catalogs only
pi update --self                        # update pi only
pi update --self --force                # reinstall pi even if current
pi update npm:@foo/pi-tools             # update one package
pi config                               # enable/disable extensions, skills, prompts, themes
```

Package 安装到 `~/.pi/agent/git/`（git）或 `~/.pi/agent/npm/`（npm）。使用 `-l` 可安装到项目本地（`.pi/git/`、`.pi/npm/`）。Git 的 `@ref` 值是被固定的 tag 或 commit；被固定的 package 会被 `pi update --extensions` 和 `pi update --all` 跳过，因此要把已有的 package 移动到新 ref，请使用 `pi install git:host/user/repo@new-ref`。Git package 默认使用 `npm install --omit=dev` 安装依赖，因此运行时依赖必须列在 `dependencies` 下；配置了 `npmCommand` 时，git package 会改用普通的 `install` 以兼容各种封装器。如果你使用 Node 版本管理器，并希望 package 安装复用稳定的 npm 环境，请在 `settings.json` 中设置 `npmCommand`，例如 `["mise", "exec", "node@20", "--", "npm"]`。

在 `package.json` 中添加 `pi` 键即可创建 package：

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

如果没有 `pi` manifest，pi 会从约定目录（`extensions/`、`skills/`、`prompts/`、`themes/`）自动发现。

参见 [docs/packages.md](docs/packages.md)。

---

## 以编程方式使用

### SDK

```typescript
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

await session.prompt("What files are in the current directory?");
```

对于高级的多 session runtime 替换，请使用 `createAgentSessionRuntime()` 和 `AgentSessionRuntime`。

参见 [docs/sdk.md](docs/sdk.md) 和 [examples/sdk/](examples/sdk/)。

### RPC Mode

对于非 Node.js 的集成，可使用基于 stdin/stdout 的 RPC mode：

```bash
pi --mode rpc
```

RPC mode 使用严格的以 LF 分隔的 JSONL 帧。客户端必须只按 `\n` 切分记录。不要使用 Node `readline` 之类的通用按行读取器，它们还会按 JSON 负载内部的 Unicode 分隔符切分。

协议详情参见 [docs/rpc.md](docs/rpc.md)。

---

## 设计理念

Pi 把可扩展性做到了极致，因此它不必规定你的工作流。其他工具内置的功能，你可以用 [extensions](#extensions)、[skills](#skills) 自行构建，或从第三方 [pi packages](#pi-packages) 安装。这让核心保持极简，同时让你可以把 pi 塑造成符合自己工作方式的样子。

**不做 MCP。** 构建带 README 的 CLI 工具（见 [Skills](#skills)），或者编写一个添加 MCP 支持的 extension。[为什么？](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**不做 sub agent。** 实现方式有很多。通过 tmux 启动多个 pi 实例，或用 [extensions](#extensions) 构建自己的方案，或安装一个按你的方式实现的 package。

**不做权限弹窗。** 在容器中运行，或用 [extensions](#extensions) 构建符合你环境与安全要求的自定义确认流程。

**不做 plan mode。** 把计划写进文件，或用 [extensions](#extensions) 构建，或安装一个 package。

**不内置 to-do。** 它们会干扰模型。使用 TODO.md 文件，或用 [extensions](#extensions) 构建自己的方案。

**不做后台 bash。** 使用 tmux。完全可观测，可直接交互。

完整的设计考量请阅读这篇[博客文章](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)。

---

## CLI 参考

```bash
pi [options] [--] [@files...] [messages...]
```

### Package 命令

```bash
pi install <source> [-l]     # Install package, -l for project-local
pi remove <source> [-l]      # Remove package
pi uninstall <source> [-l]   # Alias for remove
pi update [source|self|pi]   # Update pi only, or one package source
pi update --all              # Update pi and packages
pi update --extensions       # Update packages only
pi update --models           # Refresh model catalogs only
pi update --self             # Update pi only
pi update --self --force     # Reinstall pi even if current
pi update --extension <src>  # Update one package
pi list                      # List installed packages
pi config                    # Enable/disable package resources
```

`pi config` 和项目 package 命令接受 `--approve`/`--no-approve`，用于在单条命令中信任或忽略项目本地设置。`pi update` 从不询问项目信任。

### Modes

| 参数 | 说明 |
|------|-------------|
| （默认） | Interactive mode |
| `-p`, `--print` | 输出响应后退出 |
| `--mode json` | 以 JSON 行输出所有事件（见 [docs/json.md](docs/json.md)） |
| `--mode rpc` | 用于进程集成的 RPC mode（见 [docs/rpc.md](docs/rpc.md)） |
| `--export <in> [out]` | 将 session 导出为 HTML |

在 print mode 下，pi 还会读取管道传入的 stdin，并将其合并进初始 prompt：

```bash
cat README.md | pi -p "Summarize this text"
```

### 模型选项

| 选项 | 说明 |
|--------|-------------|
| `--provider <name>` | Provider（anthropic、openai、google 等） |
| `--model <pattern>` | 模型 pattern 或 ID（支持 `provider/id` 和可选的 `:<thinking>`） |
| `--api-key <key>` | API key（覆盖环境变量） |
| `--thinking <level>` | `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` |
| `--models <patterns>` | 逗号分隔的 pattern，用于 Ctrl+P 轮换 |
| `--list-models [search]` | 列出可用模型 |

### Session 选项

| 选项 | 说明 |
|--------|-------------|
| `-c`, `--continue` | 继续最近的 session |
| `-r`, `--resume` | 浏览并选择 session |
| `--session <path\|id>` | 使用指定的 session 文件或部分 UUID |
| `--fork <path\|id>` | 将指定的 session 文件或部分 UUID fork 为新 session |
| `--session-dir <dir>` | 自定义 session 存储目录 |
| `--no-session` | Ephemeral mode（不保存） |
| `--name <name>`, `-n <name>` | 启动时设置 session 显示名称 |

### Tool 选项

| 选项 | 说明 |
|--------|-------------|
| `--tools <list>`, `-t <list>` | 将指定的 tool 名称加入允许列表，涵盖内置、extension 和自定义 tool |
| `--exclude-tools <list>`, `-xt <list>` | 禁用指定的 tool 名称，涵盖内置、extension 和自定义 tool |
| `--no-builtin-tools`, `-nbt` | 默认禁用内置 tool，但保持 extension/自定义 tool 启用 |
| `--no-tools`, `-nt` | 默认禁用所有 tool |

可用的内置 tool：`read`、`bash`、`powershell`（Windows）、`edit`、`write`、`grep`、`find`、`ls`

### 资源选项

| 选项 | 说明 |
|--------|-------------|
| `-e`, `--extension <source>` | 从路径、npm 或 git 加载 extension（可重复） |
| `--no-extensions` | 禁用 extension 发现 |
| `--skill <path>` | 加载 skill（可重复） |
| `--no-skills` | 禁用 skill 发现 |
| `--prompt-template <path>` | 加载 prompt template（可重复） |
| `--no-prompt-templates` | 禁用 prompt template 发现 |
| `--theme <path>` | 加载 theme（可重复） |
| `--no-themes` | 禁用 theme 发现 |
| `--no-context-files`, `-nc` | 禁用 AGENTS.md 和 CLAUDE.md 上下文文件发现 |

将 `--no-*` 与显式参数组合使用，可以只加载你确切需要的内容并忽略 settings.json（例如 `--no-extensions -e ./my-ext.ts`）。

### 其他选项

| 选项 | 说明 |
|--------|-------------|
| `--system-prompt <text>` | 替换默认 prompt（仍会追加上下文文件和 skills） |
| `--append-system-prompt <text>` | 追加到 system prompt |
| `--tui-mode <mode>` | TUI mode：`regular`（默认）或实验性的 `fullscreen` |
| `--use-theme <name[/name]>` | 为本次运行设置初始 interactive theme，而不更改设置 |
| `--verbose` | 强制输出详细的启动信息 |
| `-a`, `--approve` | 本次运行信任项目本地文件 |
| `-na`, `--no-approve` | 本次运行忽略项目本地文件 |
| `--` | 停止解析选项；其余参数作为 prompt 或 `@file` 输入 |
| `-h`, `--help` | 显示帮助 |
| `-v`, `--version` | 显示版本 |

### 文件参数

给文件加上 `@` 前缀，即可将其包含进消息：

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

# Model with provider prefix (no --provider needed)
pi --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
pi --model sonnet:high "Solve this complex problem"

# Limit model cycling
pi --models "claude-*,gpt-4o"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
pi --exclude-tools ask_question

# High thinking level
pi --thinking high "Solve this complex problem"
```

### 环境变量

| 变量 | 说明 |
|----------|-------------|
| `AI_AGENT` | 由 CLI 和 RPC 入口设为 `pi`，让通用工具能把子进程归因到 Pi |
| `PI_CODING_AGENT` | 由 CLI 和 RPC 入口设为 `true`，让子进程能检测到自己运行在 Pi 中 |
| `PI_CODING_AGENT_DIR` | 覆盖配置目录（默认：`~/.pi/agent`） |
| `PI_CODING_AGENT_SESSION_DIR` | 覆盖 session 存储目录（会被 `--session-dir` 覆盖） |
| `PI_PACKAGE_DIR` | 覆盖 package 目录（对 Nix/Guix 这类 store path 容易被错误分词的环境很有用） |
| `PI_OFFLINE` | 禁用启动时的网络操作，包括更新检查、package 更新检查以及安装/更新遥测 |
| `PI_SKIP_VERSION_CHECK` | 跳过启动时的 Pi 版本更新检查。这会阻止对 `pi.dev` 的最新版本请求 |
| `PI_TELEMETRY` | 覆盖安装/更新遥测及 provider 归因 header。设为 `1`/`true`/`yes` 启用，设为 `0`/`false`/`no` 禁用。这不会禁用更新检查 |
| `PI_CACHE_RETENTION` | 设为 `long` 以使用扩展 prompt cache（Anthropic：1 小时，OpenAI：24 小时） |
| `VISUAL`, `EDITOR` | `externalEditor` 未设置时 Ctrl+G 的备用外部 editor；Windows 上默认为记事本，其他平台默认为 `nano` |

由可供 LLM 调用的 `bash` 和 `powershell` tool 运行的命令，还会收到当前 session 的元数据：

| 变量 | 说明 |
|----------|-------------|
| `PI_SESSION_ID` | 当前 session ID |
| `PI_SESSION_FILE` | session JSONL 文件的绝对路径；ephemeral session 不设置该变量 |
| `PI_PROVIDER` | 当前选中的模型 provider |
| `PI_MODEL` | 当前选中的模型 ID |
| `PI_REASONING_LEVEL` | 当前生效的 reasoning level |

这些值在每条命令启动时解析。语义、示例以及自定义 tool 的 opt-out 方式参见 [Environment Variables](docs/environment-variables.md#shell-tool-session-environment)。

---

## 贡献与开发

贡献指南参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)，环境搭建、fork 和调试参见 [docs/development.md](docs/development.md)。

## 许可证

MIT

## 另见

- [@earendil-works/pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)：核心 LLM 工具包
- [@earendil-works/pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)：Agent 框架
- [@earendil-works/pi-tui](https://www.npmjs.com/package/@earendil-works/pi-tui)：终端 UI 组件

<p align="center">
  <a href="https://pi.dev">pi.dev</a> 域名由以下方慷慨捐赠
  <br /><br />
  <a href="https://exe.dev"><img src="docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
