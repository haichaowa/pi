# coding-agent 包解析：pi 主产品（CLI）

> 对应包：`packages/coding-agent`（`@earendil-works/pi-coding-agent`，约 251 个源文件 / 7 万行 + 285 个测试文件）。bin 名 `pi`。
> 读完 `docs/03-package-ai.md` 和 `docs/04-package-agent.md` 再看这篇，你会看到三者如何组装。

## 0. 产品哲学：minimal kernel + 自我扩展

pi 是一个「minimal terminal coding harness」：内核刻意保持小巧——**只有 8 个内置工具、没有 MCP、没有内置 sub-agent、没有 plan mode、没有权限弹窗**（`docs/usage.md:309` 明确声明这是刻意设计）。一切扩展能力通过五种资源达成：**TypeScript extensions、skills、prompt templates、themes、pi packages**。口号是 "adapt pi, don't fork pi"。

## 1. 入口与启动流程

**入口链**：
- 发布的 bin：`dist/bundle/cli.js` ← 源码 `src/cli.ts`（6 行）：`setupCli()` 错误兜底 → `main(argv)`
- `src/rpc-entry.ts`：独立 RPC 入口（直接 `main(["--mode","rpc", ...])`）
- `src/experimental/cli.ts`：**超集入口**——先尝试 experimental 子命令（`pi client` / `pi serve` 等），不是则回落到同一个 `main()`。`./pi-test.sh` 跑的就是它，所以开发时默认就带着实验子命令。

**`main()` 时序**（`src/main.ts:562` 起，全程有启动耗时埋点）：

1. `pi auth ...` / `pi install|remove|update|list` / `pi config` 等子命令直接返回
2. `parseArgs`（`src/cli/args.ts`，约 40 个 flag）
3. **模式分叉 `resolveAppMode()`（main.ts:111）**：`--mode rpc|json` → 对应模式；`-p/--print` 或 stdin/stdout 非 TTY → `"print"`；否则 `"interactive"`
4. 非交互模式 `takeOverStdout()`（`core/output-guard.ts`）——劫持 `process.stdout.write`，防止第三方库污染结构化输出
5. `runMigrations()` 迁移旧配置 → `SettingsManager.create()` + 首次启动向导
6. **会话解析**：`--no-session`（内存）→ `--fork` → `--session`（ID 前缀匹配）→ `--resume` → `--continue` → `--session-id`
7. **Project trust**：有 `.pi/` 的项目先以 untrusted 预加载扩展，信任确认后才加载项目级资源（两段式）
8. **运行时组装（核心分层）**：`createAgentSessionServices()`（cwd 绑定服务）→ `createAgentSessionFromServices()` → `createAgentSessionRuntime()`（支持 newSession/fork/switchSession 时整体重建）
9. 最终三路分叉：`runRpcMode(runtime)` / `new InteractiveMode(runtime).run()` / `runPrintMode(runtime)`

## 2. 目录地图

| 目录 | 规模 | 职责 |
|---|---|---|
| `src/core/` | 84 文件 / 29,802 行 | **心脏**：会话、扩展、工具、设置、模型运行时 |
| `src/modes/` | 60 文件 / 20,662 行 | interactive/print/rpc 三种运行模式的 UI 壳 |
| `src/experimental/` | 45 文件 / 9,192 行 | 下一代 client/server 架构试验田（coordinator、session-worker、mini） |
| `src/utils/` | 34 文件 / 3,544 行 | shell/图片/剪贴板/git 纯工具 |
| `src/cli/` | 17 文件 / 1,920 行 | 参数解析、auth、会话选择器 |
| `src/extensions/` | 6 文件 / 1,457 行 | 内置扩展（目前只有 llama.cpp，hidden） |

**最大的文件（也是阅读难点）**：`modes/interactive/interactive-mode.ts`（**6,620 行**，TUI 主控）、`core/agent-session.ts`（3,552）、`core/package-manager.ts`（2,699）、`core/extensions/types.ts`（1,797，**最值得精读**）、`core/session-manager.ts`（1,746）、`core/settings-manager.ts`（1,417）、`core/extensions/runner.ts`（1,286）。

## 3. 内置工具集（8 个，全部在 `src/core/tools/`）

| 工具 | 文件 | 备注 |
|---|---|---|
| read | tools/read.ts（197 行） | 截断策略在 tools/truncate.ts |
| bash | tools/bash.ts（400 行） | `BashOperations` 可插拔（可替换成 SSH/远程执行）；Windows 用 powershell.ts |
| edit | tools/edit.ts + edit-diff.ts（776 行） | 字符串替换 + diff 渲染 |
| write | tools/write.ts（97 行） | |
| grep | tools/grep.ts（323 行） | 基于 rg（首次启动自动下载到 `~/.pi/agent/bin`） |
| find | tools/find.ts（318 行） | 基于 fd |
| ls | tools/ls.ts（175 行） | |

**关键设计——工具双轨制**（tools/index.ts）：
- `createReadTool()` 等返回 `AgentTool`（pi-agent-core 的接口，给 Agent 循环调）
- `createReadToolDefinition()` 等返回 `ToolDefinition`（本包定义，**多了 `renderCall`/`renderResult` TUI 渲染钩子、`promptSnippet`/`promptGuidelines` 系统提示词注入、`executionMode`**），两者通过 `tool-definition-wrapper.ts` 互转。扩展注册的工具天然就是 ToolDefinition——**扩展工具与内置工具完全同权**
- 默认只启用 read/bash/edit/write 四个；grep/find/ls 是"只读组"，需 `defaultTools` 设置或 `--tools` 开启
- `file-mutation-queue.ts`：edit/write 串行化，防并发写坏文件

## 4. 扩展系统（self-extensible 的核心，重点）

### 4.1 形态与加载
扩展 = 一个 default export 的 TS 工厂函数：`export default function (pi: ExtensionAPI) { ... }`。**不需要编译、不需要 node_modules**：
- 用 **jiti** 在运行时直接 import `.ts` 文件（`core/extensions/loader.ts:501`）
- 通过 `virtualModules` 把 `@earendil-works/pi-coding-agent`、`pi-ai`、`pi-tui`、`pi-agent-core`、`typebox` 映射到宿主已打包的副本——**扩展 import 这些包零安装**
- 发现位置：`~/.pi/agent/extensions/*.ts`（全局）、`.pi/extensions/*.ts`（项目级，需 trust）、npm 包的 `"pi": { "extensions": [...] }` manifest；临时 `pi -e ./x.ts`；`/reload` 清缓存重载

### 4.2 ExtensionAPI 能做什么（`core/extensions/types.ts:1252-1506`）
- **`on(event, handler)`：约 40 种事件**——`tool_call`（**可拦截**：返回 `{block, reason, terminate}`，可原地改参数）、`tool_result`（可改写结果）、`input`（改写/吞掉用户输入）、`context`（LLM 调用前改消息数组）、`before_provider_request`/`after_provider_response`（HTTP 层）、`before_agent_start`（可替换本轮 systemPrompt）、`session_before_compact`（可接管压缩）、`session_before_tree`/`session_before_switch`/`session_before_fork`、`user_bash`（可替换执行器）、`project_trust`、`resources_discover`（动态供给资源）…
- **注册能力**：`registerTool`（自定义工具）、`registerCommand`（斜杠命令）、`registerShortcut`（快捷键）、`registerFlag`（**自定义 CLI flag**）、`registerMessageRenderer` / `registerMarkdownTransformer` / `registerEntryRenderer`（渲染定制）、`registerProvider`（注册/覆盖模型 provider，可带自定义 models、`$ENV_VAR` 插值、**完整 OAuth 流**、甚至自定义 `streamSimple` 接任意 API）
- **动作**：`sendMessage`（注入消息）、`appendEntry`（持久化状态，不进 LLM 上下文）、`setActiveTools`、`setModel`、`setThinkingLevel`、`exec`…
- **`ctx.ui`（UI 全家桶）**：select/confirm/input/notify；`custom()` 拿到 TUI+theme+keybindings 造**任意交互组件**（examples 里的 snake / space-invaders 就这么写的）；`setWidget`/`setFooter`/`setHeader`；**`setEditorComponent` 整体替换输入编辑器**（文档里有 VimEditor 示例）；`setTheme`；`onTerminalInput` 原始终端输入
- RPC 模式下扩展的 UI 请求自动变成 `extension_ui_request` 远程协议调用——**扩展写的 UI 天然跨进程**

### 4.3 生命周期与保护
两阶段：加载期只能注册（throwing stub），会话就绪后 `bindCore()`（`core/extensions/runner.ts`）换成真实现。reload/newSession/fork 后旧 `pi`/`ctx` 失效即抛错——后续逻辑必须放进 `withSession` 回调拿新 ctx。

### 4.4 示例（`examples/extensions/`，79 个单文件 + 9 个目录项目）
代表性示例：`permission-gate.ts`（危险命令确认）、`git-checkpoint.ts`、`modal-editor.ts`（替换编辑器）、`snake.ts`（游戏）、`todo.ts`、`pirate.ts`（改系统提示词）、`custom-compaction.ts`；目录项目：`plan-mode/`、`subagent/`、`gondolin/`（容器沙箱）、`custom-provider-anthropic/`。另有 `examples/sdk/` 13 个递进 SDK 示例（01-minimal 仅 10 行）。**改 pi 的第一步就是抄这些示例。**

## 5. 配置体系

| 位置 | 内容 |
|---|---|
| `~/.pi/agent/`（全局） | `settings.json`、`auth.json`（OAuth 凭据）、`models.json`（自定义模型）、`keybindings.json`、`AGENTS.md`（全局上下文）、`SYSTEM.md`（**整体替换**系统提示词）、`APPEND_SYSTEM.md`（追加）、`extensions/`、`skills/`、`prompts/`、`themes/`、`bin/`（自动下载的 fd/rg）、`sessions/`、`packages/` |
| 项目 `.pi/`（需 trust） | `settings.json`（深度覆盖全局）、`extensions/`、`skills/`、`SYSTEM.md`、`APPEND_SYSTEM.md` |

**AGENTS.md 加载逻辑**（`core/resource-loader.ts:71`）：文件名优先级 `AGENTS.override.md > AGENTS.md > CLAUDE.md`；取全局 agentDir 一份 + **从 cwd 逐级向上遍历到根**的祖先目录各一份。

**系统提示词组装**（`core/system-prompt.ts`）：身份段 → Available tools（按 toolSnippets 动态）→ Guidelines（按启用工具动态）→ **pi 自身文档路径段（让 agent 能读自己的 docs 回答"怎么扩展 pi"）** → APPEND_SYSTEM → `<project_context>`（各 AGENTS.md）→ skills 列表 → cwd。

**注意 "modes" 的语义**：本包的 modes 指**运行模式**（interactive/print/rpc/json），**没有 Claude Code 式的 custom modes**；plan mode、subagent 等都是扩展实现的。

## 6. 会话管理与 UI

**SessionManager**（`core/session-manager.ts`）：会话 = **JSONL 文件，条目构成树**（id/parentId，原地分叉不建新文件）。`buildSessionContext()` 从当前 leaf 回溯构建 LLM 消息。内置斜杠命令（`core/slash-commands.ts`）：`/settings /model /tree /thinking /export /share /fork /new /compact /resume /reload /quit` 等 + 扩展命令。

**Compaction**（`core/compaction/`，1,012 行）：阈值自动触发 + `/compact` 手动 + overflow 恢复；可被 `session_before_compact` 事件整体接管。

**InteractiveMode**（6,620 行）：持 `AgentSessionRuntime`；init 顺序 = 信号处理 → chat viewport（regular/fullscreen 两种渲染器）→ `ui.start()` → 绑扩展 → 自动下载 fd/rg → 键盘绑定 → 渲染历史 → watcher。消息流：AgentSession 事件 → 组件树（`modes/interactive/components/` 43 个组件）。编辑器 `CustomEditor` 可被扩展整体替换；autocomplete 组合 @file、/command、skill、文件名补全。

**Print mode**（单轮问答）/ **JSON mode**（事件流）：`modes/print-mode.ts`、`modes/json-event.ts`。**RPC mode**（`modes/rpc/rpc-mode.ts`，821 行）：stdin/stdout JSONL 协议，命令带 id 关联响应。

## 7. 官方文档地图（`packages/coding-agent/docs/`，33 篇）

| 分组 | 文档 | 中文翻译 |
|---|---|---|
| 入门 | quickstart、usage、providers、llama-cpp、security、containerization、settings、keybindings、sessions、compaction | 已译：quickstart/index/sessions/compaction/usage/settings 等（见 `docs/translations/packages/coding-agent/docs/`） |
| 定制 | **extensions（权威文档）**、skills、prompt-templates、themes、packages、models、custom-provider | 已译：extensions、models、skills 等 |
| 编程接口 | sdk、rpc、json、tui | 待译 |
| 参考 | environment-variables、session-format | 已译：session-format |
| 平台/开发 | windows、termux、tmux、terminal-setup、shell-aliases、development | 待译 |

## 8. 与其他包的关系

- **agent（pi-agent-core）**：`core/sdk.ts:306` `new Agent({...})` 时注入 `streamFn`（包装 `modelRuntime.streamSimple`）+ `onPayload`/`onResponse`（桥接扩展的 before/after_provider 事件）——**AgentSession 是 Agent 的全功能外壳**
- **ai（pi-ai）**：`core/model-runtime.ts`（ModelRuntime）包装 `Models` 管理 catalog 刷新/凭据；`core/provider-composer.ts` 组合自定义 provider
- **tui（pi-tui)**：InteractiveMode 的全部渲染层（见 `docs/06-package-tui.md`）
- **client/protocol/server + chord**：仅 `src/experimental/` 用（devDependencies）——见 `docs/07-supporting-packages.md`

## 9. 推荐阅读顺序（18 项，从入口往下）

| # | 文件 | 说明 |
|---|---|---|
| 1 | `packages/coding-agent/README.md` | 产品全景与哲学 |
| 2 | `src/cli.ts` | 6 行 bin 入口 |
| 3 | `src/main.ts` | 启动编排：先读 `resolveAppMode` 和末尾三路分叉 |
| 4 | `src/cli/args.ts` | 全部 CLI flag |
| 5 | `src/config.ts` | 所有路径约定（agentDir、`.pi`、资产定位） |
| 6 | `src/core/sdk.ts` | `createAgentSession()`：Agent 注入点、默认工具装配（SDK 视角组装线） |
| 7 | `src/core/agent-session-services.ts` + `agent-session-runtime.ts` | cwd 绑定服务的创建与重建分层 |
| 8 | `src/core/agent-session.ts` | AgentSession 中枢（重点读 `prompt()`/`steer()`/`compact()`/`bindExtensions()`） |
| 9 | `src/core/tools/index.ts` → `bash.ts` → `edit.ts` | 工具双轨制 |
| 10 | `src/core/extensions/types.ts` | **扩展系统全部契约，最值得精读的单文件** |
| 11 | `src/core/extensions/loader.ts` | jiti 加载 + virtualModules 免安装机制 |
| 12 | `src/core/extensions/runner.ts` | 事件派发与 bindCore 两阶段 |
| 13 | `src/core/resource-loader.ts` | 五类资源发现/信任/重载总调度 |
| 14 | `src/core/settings-manager.ts` | Settings schema 与合并 |
| 15 | `src/core/session-manager.ts` | JSONL 会话树 |
| 16 | `src/core/system-prompt.ts` | 提示词组装 |
| 17 | `src/modes/print-mode.ts` → `src/modes/rpc/rpc-mode.ts` | 两个小模式先读，做铺垫 |
| 18 | `src/modes/interactive/interactive-mode.ts` | 6,620 行 TUI 主控，按 section 注释分块读 |

配套样例：`examples/sdk/01-minimal.ts`、`examples/extensions/hello.ts`、`permission-gate.ts`、`tools.ts`。

## 10. 设计决策与坑

**设计决策**：
1. **CLI 即 SDK**：main.ts 只做参数翻译，真正组装在 `createAgentSession()`；`pi` 二进制和 npm 库是同一套代码
2. **TypeScript 扩展取代 MCP**：扩展与内核同进程、同语言、拿全套类型
3. **jiti + virtualModules 免安装**：单个 .ts 文件即完整扩展
4. **两阶段扩展生命周期** + stale-invalidate 防旧 ctx 逃逸
5. **Project trust 门控**：`.pi/` 下一切先 untrusted 预加载，确认后才生效
6. **会话是树不是列表**：`/tree` 可回到任意节点
7. **stdout 劫持**：结构化输出模式不被库日志污染

**坑**：
1. `interactive-mode.ts` 6,620 行单体，靠 section 注释导航
2. 默认工具只有 4 个（read/bash/edit/write），grep/find/ls 要手动开
3. 扩展异常导致启动失败，用 `pi -ne` 排障
4. `tool_call` 拦截器改参数是**原地 mutate 且不再过 schema 校验**
5. 扩展的 `pi`/`ctx` 在 reload/newSession/fork 后失效即抛错，必须迁到 `withSession`
6. `src/experimental/`（9k 行）不是稳定 API，读核心时可先跳过
