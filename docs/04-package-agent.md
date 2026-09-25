# pi-agent-core 包解析：agent 运行时（整个项目的心脏）

> 对应包：`packages/agent`（`@earendil-works/pi-agent-core`，约 91 个源文件 / 2.5 万行）。
> 依赖极简：pi-ai（只用类型与纯工具）、chord（只用 Go 风格 Context）、pi-telemetry、typebox——**不依赖任何 provider catalog，保持 provider 无关**。

## 0. 理解这个包的钥匙：两代运行时并存

| | 第一代（生产在用） | 第二代（experimental） |
|---|---|---|
| 入口 | `Agent` 类 + `runAgentLoop` 纯函数 | `AgentHarness` / `Lane` / `Drive` |
| 位置 | `src/agent.ts`、`src/agent-loop.ts`（顶层，~2400 行） | `src/harness/`（占包体约 90%） |
| 形态 | 内存态、事件驱动的经典 while 循环 | **可崩溃恢复的持久化状态机**（13 个状态叶子） |
| 消费者 | coding-agent 的 `AgentSession` | coding-agent 的 `src/experimental/*`（session-worker、mini） |

学代码从第一代入手（几百行就能看懂整个循环），理解设计方向再看第二代。

## 1. 对外 API

**第一代 Agent 的构造与驱动**：

```ts
const agent = new Agent({
  initialState: { systemPrompt, model, thinkingLevel, tools, messages },
  streamFn: models.streamSimple.bind(models),   // 必填（或全局 setDefaultStreamFn）
  convertToLlm, transformContext,               // AgentMessage[] → LLM Message[] 的桥
  beforeToolCall, afterToolCall,                // 工具拦截钩子
  shouldStopAfterTurn, prepareNextTurn,         // 每轮回调（prepareNextTurn 可换 model/context）
  steeringMode: "one-at-a-time",                // 用户插话策略
  toolExecution: "parallel",                    // 或 "sequential"
});
agent.subscribe((event, signal) => { /* 订阅事件流 */ });
await agent.prompt("Hello!");   // 驱动一轮完整循环
agent.steer(msg);               // 运行中插话
agent.followUp(msg); agent.continue(); agent.abort(); agent.waitForIdle();
```

**`StreamFn` 契约**（`src/types.ts:28`）：**绝不 throw**，失败编码进返回的事件流，最终 AssistantMessage 带 `stopReason: "error"|"aborted"` + `errorMessage`。（还记得 pi-ai 的 `lazyStream` 吗？就是为这个契约设计的。）

**第二代 AgentHarness**：

```ts
const { harness, open } = await AgentHarness.create({ session, models, model, tools, ... }, context);
// open = 崩溃后待恢复的操作列表（durable 语义的直接体现）
const lane = await harness.lane("main", context);
const result = await lane.prompt("hi", undefined, context);  // 两段式：accept + drive
lane.steer(...); lane.abort(context); lane.watch(context);   // WatchHandle<LaneSnapshot>
harness.hooks.on("before_tool", handler); harness.events.on("tool_end", listener);
```

## 2. 目录地图

| 目录 | 规模 | 职责 |
|---|---|---|
| `src/` 顶层 | 7 文件 / 2,417 行 | 第一代运行时：`agent-loop.ts`(803)、`agent.ts`(592)、`types.ts`(446)、`proxy.ts`(402) |
| `src/harness/` 根 | 12 文件 / 3,547 行 | harness 公共接口、事件总线、hooks、skills、系统提示词 |
| `src/harness/runtime/` | 21 文件 / 7,505 行 | **durable 状态机核心**：`lane.ts`(2012)、`harness.ts`、`reducer.ts`、`drive/` 12 个文件（每叶一文件） |
| `src/harness/session/` | 29 文件 / 7,108 行 | 持久层：Entry 树数据模型、JSONL 实现、内存实现、conformance 测试套件 |
| `src/harness/compaction/` | 3 文件 / 1,297 行 | 上下文压缩（两代共用） |
| `src/harness/tools/` | 10 文件 / 1,209 行 | 内置工具：read/write/edit/bash/edit-diff |
| `src/harness/env/` | 1 文件 / 924 行 | `NodeExecutionEnv`：FileSystem+Shell 能力接口的 node 实现 |
| `src/harness/execution/`、`src/harness/utils/` | 8 文件 | 流消费、工具执行原语、截断、用量 |

## 3. 核心抽象

### 3.1 消息模型
`AgentMessage = Message | CustomAgentMessages[keyof ...]`（types.ts:326）。应用通过 **declaration merging** 扩展 `CustomAgentMessages` 接口来自定义消息角色；harness 自带四种：`bashExecution`、`custom`、`branchSummary`、`compactionSummary`。LLM 只认 user/assistant/toolResult，靠 `convertToLlm` 桥接（`harness/messages.ts:124` 有参考实现）。消息管线：

```
AgentMessage[] → transformContext()（应用级修剪/注入）→ convertToLlm() → Message[] → LLM
```

### 3.2 工具接口（第一代，types.ts:387）

```ts
interface AgentTool<TParameters extends TSchema, TDetails> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>;  // schema 校验前的兼容 shim
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
  replay?: "never" | "safe";        // 副作用恢复策略（第二代崩溃恢复用）
  executionMode?: "sequential" | "parallel";
}
// AgentToolResult: { content: (Text|Image)[]; details: T; usage?; terminate? }
```

工具 **throw 即错误结果**（不进 content）。第二代的 `AgentHarnessTool`（harness/types.ts:108）execute 签名更长，`invocation` 参数提供 `getMemo/setMemo`——**调用级持久化重放备忘录**（崩溃恢复时判断副作用是否已发生），`onUpdate(partial, { checkpoint: true })` 可把进度快照写盘。

### 3.3 事件
- 第一代 `AgentEvent`（types.ts:431）11 种：`agent_start/end`、`turn_start/end`、`message_start/update/end`、`tool_execution_start/update/end`。
- 第二代 `HarnessEvent` 约 30 种，多出 `run_start/end/suspend/resume`、`retry_*`、`compaction_*`、`navigation_*`、`fault` 等，带 `lane` 字段和 `recovery?: true`（重放标记）。
- `HarnessEventBus`（harness/events.ts）：每个事件 `structuredClone` 后投递（listener 改不动内部状态）；listener 异常转成 `handler_error` 事件，不中断主流程。

### 3.4 上下文压缩（compaction）
纯函数在 `harness/compaction/compaction.ts`：`estimateContextTokens`（优先用最近一次 assistant usage，退化到字符估算）→ `shouldCompact`（`contextTokens > contextWindow - reserveTokens`）→ `findCutPoint`（只在完整 turn 边界切）→ `prepareCompaction` → `compact`（生成结构化摘要）。默认设置 `{ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }`。CompactionEntry 持久化为树节点，**文件操作清单跨压缩继承**（readFiles/modifiedFiles 从上一条 compaction entry 累积）。重建上下文时找到路径上最后一条 compaction entry，从它截断。

### 3.5 第二代持久化模型（harness/session/types.ts）
- **会话是树不是数组**：`MessageEntry | CompactionEntry | BranchSummaryEntry | CustomEntry`，字段 `{ id(uuidv7), parentId, seq, timestamp }`，沿 parentId 回溯即对话路径。
- **OperationState 13 个状态叶子**：`starting / checkpoint / assistant.ready / assistant.effect_pending / assistant.retry_wait / tools / deferred.* / summary.* / navigation.ready_to_commit`；ToolCall 子状态机 `planned → effect_pending → outcome_ready → completed`；取消是正交的 `Control: running | cancel_requested`。
- **Storage 接口**：`commit(writes) / getEntries / scanBranch / scanUsage...`；`Write = EntryWrite | UsageWrite | ValueWrite | ListWrite`。

## 4. Agent 循环全流程（第一代，函数级 trace）

**这是整个项目最值得逐行读的一段代码**。入口：`Agent.prompt()`（agent.ts:348）→ `runWithLifecycle()`（建 AbortController）→ `runAgentLoop()`（agent-loop.ts:96）。

**双层循环**——`runLoop`（agent-loop.ts:156）：外层 `while(true)` 处理 follow-up，内层处理 tool calls + steering：

1. 若有上一轮：`config.prepareNextTurn(lastCompletedTurn)`（可整体替换 context/model/thinkingLevel——coding-agent 用它做自动压缩），然后再 poll 一次 steering。
2. 注入 pendingMessages（steering 队列 drain 出的）。
3. **`streamAssistantResponse`**（:279）：`transformContext` → `convertToLlm` → `getApiKey`（OAuth token 过期时每次现取）→ `streamFunction(model, {systemPrompt, messages, tools}, options)` → `for await` 消费事件流：`start`→emit `message_start`；`*_delta`→emit `message_update`（partial message 就地替换 context 尾部）；`done/error`→`response.result()`→emit `message_end`。
4. `stopReason === "error"|"aborted"` → 循环终止。
5. 提取 `toolCalls = message.content.filter(c => c.type === "toolCall")`。
6. **`stopReason === "length"`（截断）→ `failToolCallsFromTruncatedMessage`（:379）：整批 tool call 判错不执行**——流式 JSON salvage 会产出"能通过校验但被截断"的参数，不可信。
7. `executeToolCalls`（:409）选串行（:431）或并行（:487）执行：
   - `prepareToolCall`（:607）：查工具 → `prepareArguments` → `validateToolArguments`（pi-ai 的 typebox 校验）→ `beforeToolCall` hook（返回 `{block, reason}` 则合成错误 toolResult）
   - `executePreparedToolCall`（:677）：`tool.execute(...)`；onUpdate → emit `tool_execution_update`
   - `finalizeExecutedToolCall`（:720）：`afterToolCall` hook 可逐字段覆盖结果
   - `shouldTerminateToolBatch`（:589）：**批内全部** result.terminate 才提前终止
8. emit `turn_end`；`shouldStopAfterTurn` 返回 true → 优雅退出。
9. poll steering → 有则内层继续（下一轮 LLM 调用带上插话）；无工具无插话 → poll followUp → 有则外层继续，无则 `agent_end` 退出。

**事件顺序保证**：每个事件经 `Agent.processEvents`（agent.ts:544）：先 reduce 内部 `AgentState`，再**按订阅顺序 await 每个 listener**——listener 慢会背压循环，这是刻意设计：coding-agent 靠它保证「事件处理完 = 会话持久化完」。

**异常路径**：`handleRunFailure`（agent.ts:511）合成一条 `stopReason: aborted|error` 的空 assistant 消息，补齐 message_start→message_end→turn_end→agent_end 完整序列（订阅者状态机不残缺）。

## 5. 第二代（durable harness）概览

`lane.prompt()` = **两段式**：

1. **`accept()`**（lane.ts:480）：在 session 互斥写线上**单次原子 commit**——校验、链 entries、写 branchTip、写 `operationState = { at: "starting" }`。此刻起操作已持久化，崩溃后可见。
2. **`drive()`**（runtime/drive.ts:29）：`for(;;) 按 state.at 分派`——这就是被打碎的 while 循环，每一叶都是「**prepare → publish intent（先写盘）→ perform 副作用 → publish outcome（单次 commit）**」四拍：
   - `assistant.ready` → 准备上下文 → **先持久化 `assistant.effect_pending` 并预留 responseEntryId** → 真正调 LLM → 流帧双路输出（emit 事件 + 帧编码写入持久 list，供崩溃后重建 partial）→ 单次 commit 写 message entry + usage + branchTip
   - `tools` → 每个 call 同样「持久化 intent（effect_pending）→ 执行 → 写 outcome」；并行工具的 toolResult entry 按 **assistant 源顺序**入链（事件按完成顺序发）
   - 每圈检查"状态没变且未取消"→ `SessionInvariantError`（防死循环）

**崩溃恢复**：进程重启 → `AgentHarness.create` → `restoreSession` 读出 open operations → `assistant.effect_pending` 用持久帧重建 partial 再结算；`tools.effect_pending`：`replay === "safe"` 的工具**用持久化 args 重放**，否则产出带 `INTERRUPTION_MARKER` 的中断标记。这就是 **intent-before-effect**——第二代与第一代的本质区别。

## 6. 会话持久化（JSONL，format v4）

- 文件路径：`<sessionsRoot>/--<cwd 编码>--/<ISO 时间戳>_<urlencoded id>.jsonl`
- 首行 header `{ v: 4, kind: "header", id, createdAt, cwd, ... }`；之后**每行一个事务**（write 数组原子生效）
- commit = `appendFile` 追加一行（串行队列）；**open 时全量 replay 进内存索引**，运行时读全走内存；末尾 torn line 自动修复；fork/升级用 tmp 文件 + rename 原子重写；v3 legacy 首次 commit 时原子升级 v4
- 写路径必须走 `session.mutate(cb)`，callback 拿到的 `SessionMutator` **至多 commit 一次**
- `packages/session-backends/sqlite-node` 是同一 `Storage`/`SessionRepo` 契约的独立可选实现；契约由 `harness/session/testing/conformance/`（约 2000 行一致性测试）保证——任何新后端跑过这套测试即可接入
- 第一代的持久化不在此层：coding-agent 的 `AgentSession` 自己订阅事件、自己写 JSONL；第二代才把持久化下沉进包内

## 7. 推荐阅读顺序（15 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 1 | `packages/agent/src/types.ts` | 第一代全部核心类型，一半设计意图在 JSDoc 里 |
| 2 | `packages/agent/src/agent-loop.ts` | **循环本体，803 行读完 agent 循环再无魔法** |
| 3 | `packages/agent/src/agent.ts` | 有状态封装、steering/followUp 队列、listener 背压 |
| 4 | `packages/agent/src/index.ts` | API 全景图 |
| 5 | `packages/agent/test/agent-loop.test.ts` + `e2e.test.ts` | 用行为样例验证理解（事件顺序、steering 时机） |
| 6 | `packages/agent/src/harness/types.ts` | Result 泛型、ExecutionEnv（FileSystem+Shell 能力接口） |
| 7 | `packages/agent/src/harness/messages.ts` | 自定义消息注册与 convertToLlm 参考实现，几十行讲清消息桥 |
| 8 | `packages/agent/src/harness/session/types.ts` | Entry 树、13 状态叶子、Storage 契约（第二代数据模型圣经） |
| 9 | `packages/agent/src/harness/session/session.ts` | MutationLine 与「至多一次 commit」能力模型 |
| 10 | `packages/agent/src/harness/session/jsonl/storage.ts`（配 io.ts） | append-only 事务日志 + replay + torn 修复 |
| 11 | `packages/agent/src/harness/agent-harness.ts` | harness 公共接口 + 全部事件/Hook 定义 |
| 12 | `packages/agent/src/harness/runtime/harness.ts` | create/restore/fault 流程 |
| 13 | `packages/agent/src/harness/runtime/lane.ts` | 最重的一块：command/settle/continue 三原语 + accept/drive/steer/abort |
| 14 | `drive.ts` → `drive/generation.ts` → `response.ts` → `tools.ts` → `checkpoint.ts` → `boundary.ts` | 状态机每一叶的四拍 |
| 15 | `packages/agent/src/harness/compaction/compaction.ts` | 压缩判定/切点/摘要（两代共用） |

进阶：`harness/events.ts`（事件总线）、`harness/runtime/reducer.ts`（客户端如何用事件维护 UI 快照）、`harness/env/nodejs.ts`（ExecutionEnv 实现）。

## 8. 设计决策与坑

**设计决策**（多数值得抄到自己的项目里）：
1. **错误不抛、编码进流**：StreamFn 及所有回调契约都是 must not throw；只有存储不变量破坏才真正炸出去。
2. **事件即持久化顺序**：listener 按订阅顺序 await，循环在 listener 完成前不推进。
3. **intent-before-effect**：副作用前先写盘意图，崩溃后按状态恢复。
4. **单 commit 原则**：每次状态转移 = 恰好一次原子 commit；副作用在 commit 之后执行。
5. **并行工具的顺序保证**：事件按完成顺序（UI 实时），entry 按源顺序（LLM 语义正确）。
6. **length 截断全批判错**、**terminate 需全票通过**、**steering 默认 one-at-a-time**。
7. **JSONL = 事务日志 + 内存索引**：写 O(1) append，读全内存，代价是 open 时全量 replay。
8. **uuidv7 万物**：ID 时间有序，timestamp 能从 ID 解出。

**坑**：
- `Agent.prompt()` 运行中再调会 throw——必须用 `steer()/followUp()`；`continue()` 不能从 assistant 消息结尾续。
- `AgentState.messages/tools` 的 setter 浅拷贝数组，但元素仍是共享引用。
- harness 仍在分片开发：`watchSession` 抛 `SliceNotImplemented`，代码里有 M8 里程碑注释。
- JSONL 会话目录编码有损（`/a/b` 与 `/a-b` 撞名），list 时必须按 header.cwd 过滤。
- 两代 compaction 共享纯函数但**触发路径不同**：第一代靠宿主在 `prepareNextTurn` 手动调；第二代在 checkpoint 自动判定。
- v3 legacy 会话首次非空 commit 触发整文件原子重写——大文件一次性 IO 成本。

---

下一篇：`docs/05-package-coding-agent.md`——这一切如何在主产品里组装成 `pi`。
