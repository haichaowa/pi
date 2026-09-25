# 项目架构总览

> 本文是全套文档的骨架：先看懂分层，再记住一条端到端主线，之后读任何文件都能对号入座。

## 1. 这是什么项目

**Pi Agent Harness**——一个自扩展（self-extensible）的终端编码智能体（对标 Claude Code / Codex CLI），作者 Mario Zechner（badlogic）。npm 包 `@earendil-works/pi-coding-agent`，命令名 `pi`。核心哲学：**内核刻意最小**（8 个内置工具，无 MCP / 无内置 sub-agent / 无 plan mode），一切通过 TypeScript 扩展自我定制——"adapt pi, don't fork pi"。

## 2. 分层架构

```
┌────────────────────────────────────────────────────────────────┐
│ coding-agent（pi 主产品，7 万行）                                │
│   main.ts → InteractiveMode / print / rpc 三种运行模式          │
│   扩展系统(jiti 免安装加载) · 8 内置工具 · SessionManager ·       │
│   系统提示词组装 · Settings · 包管理                             │
├───────────────────────────────┬────────────────────────────────┤
│ agent（pi-agent-core，2.5 万行）│ tui（pi-tui，1.8 万行）         │
│   Agent 循环 · 工具执行 ·       │   Component 模型 · 差分渲染 ·   │
│   steering · compaction ·      │   Editor · 键盘协议 · 布局引擎  │
│   AgentHarness（二代，实验）    │                                │
├───────────────────────────────┴────────────────────────────────┤
│ ai（pi-ai，2.4 万行）：Models.streamSimple → 10 协议适配器 →     │
│   40 厂商；统一事件流 / 认证 / 用量成本核算                       │
├────────────────────────────────────────────────────────────────┤
│ chord（Go 风格 Context、插件机制）· telemetry（遥测契约）         │
│ protocol / client / server（仅 experimental client/server 架构） │
└────────────────────────────────────────────────────────────────┘
```

依赖方向自上而下单向：coding-agent → {agent, ai, tui}；agent → {ai, chord, telemetry}；ai → telemetry。**构建顺序（根 package.json 的 build 脚本）就是依赖顺序反着读**：chord → tui → telemetry → ai → agent → sqlite-node → protocol → client → server → coding-agent。

## 3. 端到端主线：一次对话的完整旅程

**这是理解整个项目最有效的一条线**。你在 TUI 里输入"帮我改个 bug"并回车之后：

```
① 终端 stdin
   └→ tui: StdinBuffer 重组转义序列 → TuiBase.handleTerminalInput
      → Editor.handleInput（keybindings 匹配语义键位）→ onSubmit 回调

② coding-agent: InteractiveMode（interactive-mode.ts，6620 行的 TUI 主控）
   └→ AgentSession.prompt(text)（core/agent-session.ts，3552 行的中枢类）
      触发扩展事件（before_agent_start 可替换本轮 systemPrompt…）

③ agent: Agent.prompt()（agent.ts:348）→ runWithLifecycle → runAgentLoop
   （agent-loop.ts:96，双层 while 循环——整个项目的心脏）
   └→ transformContext（应用级修剪）→ convertToLlm（AgentMessage→LLM Message）

④ ai: Models.streamSimple(model, context, opts)（models.ts:695）
   └→ lazyStream 同步返回空流（lazy.ts:46，认证等异步准备背后跑）
      → applyAuth 合并凭据 → dispatch 按 model.api 路由
      → lazyApi 动态 import 适配器（如 anthropic-messages.ts）
      → retryProviderRequest 发请求（SDK 内建重试关闭，pi 统一管）
      → 手写 SSE 解码器 → 翻译成统一事件流

⑤ 事件回流（逐层上抛，每层翻译一次）
   ai: AssistantMessageEvent（text_delta/toolcall_delta…，带共享可变 partial）
   └→ agent: for await 消费 → emit AgentEvent（message_update…）
         Agent.processEvents 按订阅顺序 await 每个 listener（背压设计：
         listener 完成 = coding-agent 的会话持久化完成）
      └→ coding-agent: AgentSession 监听器 → 写 JSONL 会话文件
            + 触发约 40 种扩展事件 + 通知 InteractiveMode
         └→ tui: 组件树更新 → requestRender（16ms 帧合并）
               → doRender 逐行 diff → 转义序列 → 终端屏幕

⑥ 工具调用回路（LLM 返回 stopReason: "toolUse"）
   agent-loop: executeToolCalls
   → prepareToolCall: typebox 校验 + beforeToolCall hook（= 扩展的
     tool_call 事件，可拦截/改参/block）
   → tool.execute()（coding-agent 的 core/tools/*.ts，如 bash.ts 的
     BashOperations——可被扩展替换成 SSH 执行）
   → afterToolCall hook → toolResult 消息进 context
   → 回到 ③ 下一轮流式调用；如此循环直到无工具调用且无插话

⑦ 收尾
   agent_end → Agent.waitForIdle（全部 listener settle）
   → 会话树上多了一条可 /tree 回溯的分支路径
```

**换一种模式，主线不变**：`pi -p "..."`（print 模式）只是把 ⑤ 的 UI 更新换成 stdout 文本；`--mode rpc` 把事件序列化成 stdin/stdout 的 JSONL 消息；experimental 的 `pi client`/`pi serve` 则把 ③④ 挪进独立 worker 进程，跨进程传输同一套事件语义（见 `docs/07-supporting-packages.md`）。

## 4. 横切的三个机制

**事件流（贯穿全部四层）**：pi-ai 定义最细粒度的 `AssistantMessageEvent`（含共享可变 partial，不可缓存）；agent 翻译成 `AgentEvent`（11 种，二代 30 种）；coding-agent 再翻译成扩展事件（约 40 种）+ 持久化。理解"每一层翻译一次、逐层变粗"这个模式，事件系统就透明了。

**扩展钩子（每个层面都有入口）**：HTTP 层（before_provider_request）→ 上下文层（context 事件改消息数组）→ 工具层（tool_call 拦截）→ 输入层（input 事件改用户输入）→ 渲染层（registerMessageRenderer/setEditorComponent）→ provider 层（registerProvider 接任意 API）。扩展与内核同进程同语言，拿全套类型（详见 `docs/05-package-coding-agent.md` 第 4 节）。

**会话持久化（两代并存）**：第一代（生产路径）——coding-agent 的 SessionManager 自己订阅 Agent 事件写 JSONL 树（id/parentId，原地分叉）；第二代（experimental AgentHarness）——持久化下沉进 agent 包，副作用前先写意图（intent-before-effect），崩溃可恢复。JSONL 格式细节见 `docs/04-package-agent.md` 第 6 节，官方说明见翻译版 `docs/translations/packages/coding-agent/docs/session-format.md`。

## 5. 代码量与学习策略

全仓约 32 万行 TS，其中生产源码 ~15.3 万、测试 ~14.3 万、示例脚本 ~2.3 万。**不要通读**。建议：

1. **先走主线**（第 3 节的 ①→⑦），对应文件精读一遍——约 2 万行核心，覆盖 80% 的设计思想；
2. **再按包展开**：每篇包解析末尾有带优先级的阅读清单；
3. **其余代码当字典查**：各厂商适配器、43 个 TUI 组件、285 个测试文件，用到再看。

各包学习文档：`03`(ai) `04`(agent) `05`(coding-agent) `06`(tui) `07`(周边包)。
