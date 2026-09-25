> 译注：本文是 `packages/agent/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-agent-core

具有 tool 执行与 event 流式输出的有状态 agent。基于 `@earendil-works/pi-ai` 构建。

## 安装

```bash
npm install @earendil-works/pi-agent-core
```

### SQLite session 后端

SQLite session 后端与 `node:sqlite` 适配器位于独立的包 `@earendil-works/pi-session-backend-sqlite-node` 中，这样核心包默认就不会引入运行时内置模块或原生 SQLite 依赖。该后端接受一个与特定运行时相关的 SQLite 工厂，未来其他 session 后端也可以作为独立的包发布。

## 快速开始

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // Stream just the new text chunk
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

## 实验性 facet 服务

与传输层无关的 facet-service 原语位于 `@earendil-works/chord` 中。agent core 不导出该服务运行时。

## 核心概念

### AgentMessage 与 LLM Message

agent 使用 `AgentMessage` 进行工作，这是一个灵活的类型，可以包含：
- 标准 LLM 消息（`user`、`assistant`、`toolResult`）
- 通过声明合并（declaration merging）扩展的自定义应用消息类型

LLM 只能理解 `user`、`assistant` 和 `toolResult`。`convertToLlm` 函数会在每次 LLM 调用前对消息进行过滤和转换，从而弥合这一差距。

### 消息流程

```
AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
                    (optional)                           (required)
```

1. **transformContext**：裁剪旧消息，注入外部上下文
2. **convertToLlm**：过滤掉仅供 UI 使用的消息，将自定义类型转换为 LLM 格式

## Event 流程

agent 会发出 event 驱动 UI 更新。理解 event 的顺序有助于构建响应灵敏的界面。

### prompt() 的 Event 序列

当你调用 `prompt("Hello")` 时：

```
prompt("Hello")
├─ agent_start
├─ turn_start
├─ message_start   { message: userMessage }      // Your prompt
├─ message_end     { message: userMessage }
├─ message_start   { message: assistantMessage } // LLM starts responding
├─ message_update  { message: partial... }       // Streaming chunks
├─ message_update  { message: partial... }
├─ message_end     { message: assistantMessage } // Complete response
├─ turn_end        { message, toolResults: [] }
└─ agent_end       { messages: [...] }
```

### 涉及 Tool 调用时

如果 assistant 调用了 tool，循环会继续：

```
prompt("Read config.json")
├─ agent_start
├─ turn_start
├─ message_start/end  { userMessage }
├─ message_start      { assistantMessage with toolCall }
├─ message_update...
├─ message_end        { assistantMessage }
├─ tool_execution_start  { toolCallId, toolName, args }
├─ tool_execution_update { partialResult }           // If tool streams
├─ tool_execution_end    { toolCallId, result }
├─ message_start/end  { toolResultMessage }
├─ turn_end           { message, toolResults: [toolResult] }
│
├─ turn_start                                        // Next turn
├─ message_start      { assistantMessage }           // LLM responds to tool result
├─ message_update...
├─ message_end
├─ turn_end
└─ agent_end
```

Tool 执行模式是可配置的：

- `parallel`（默认）：按顺序预检（preflight）tool 调用，并发执行获得放行的 tool，每个 tool 一旦完成就立即发出 `tool_execution_end`，然后按 assistant 源顺序发出 toolResult 消息和 `turn_end.toolResults`
- `sequential`：逐个执行 tool 调用，与历史行为保持一致

在 parallel 模式下，tool 完成 event 遵循 tool 的完成顺序，但持久化的 toolResult 消息仍遵循 assistant 源顺序。

该模式可以通过 agent 配置中的 `toolExecution` 全局设置，也可以通过 `AgentTool` 上的 `executionMode` 按 tool 设置。如果一批 tool 调用中有任何一个目标 tool 设有 `executionMode: "sequential"`，则无论全局设置如何，整批调用都会按顺序执行。

`beforeToolCall` 钩子在 `tool_execution_start` 以及参数校验解析完成之后运行。它可以阻止执行，并在被阻止的结果上附加 `terminate: true`。`afterToolCall` 钩子在 tool 执行结束之后、`tool_execution_end` 与最终的 tool result 消息 event 发出之前运行。

Tool、被阻止的 `beforeToolCall` 结果以及 `afterToolCall` 的覆盖返回值都可以返回 `terminate: true`，以提示应跳过自动的后续 LLM 调用。只有当该批次中每个已定稿的 tool result 都设置了 `terminate: true` 时，循环才会提前停止。混合批次则照常继续。

`Agent` 类在 `AgentOptions` 中接受 `shouldStopAfterTurn`。使用低层 loop 的调用方可以在 `AgentLoopConfig` 中设置同样的钩子：

```typescript
const stream = agentLoop(
  prompts,
  context,
  {
    model,
    convertToLlm,
    shouldStopAfterTurn: async ({ message, toolResults, context, newMessages }) => {
      return shouldCompactBeforeNextTurn(context.messages);
    },
  },
  undefined,
  models.streamSimple.bind(models),
);
```

`shouldStopAfterTurn` 在 `turn_end` 发出之后、assistant 响应与所有 tool 执行都正常完成之后运行。如果它返回 `true`，循环会发出 `agent_end` 并退出——这发生在轮询 steering 或 follow-up 队列之前，也发生在启动下一次 LLM 调用之前。它不会中止 provider 流，不会取消正在运行的 tool，也不会改变 assistant 消息的 stop reason。`AgentOptions` 的回调还会以当前运行的 `AbortSignal` 作为第二个参数。

使用 `Agent` 类时，assistant 的 `message_end` 处理会被视为屏障，先于 tool 预检开始。这意味着 `beforeToolCall` 看到的 agent 状态已经包含了请求该 tool 调用的 assistant 消息。

### continue() 的 Event 序列

`continue()` 在不新增消息的情况下从现有 context 恢复运行。用于出错后的重试。

```typescript
// After an error, retry from current state
await agent.continue();
```

context 中的最后一条消息必须是 `user` 或 `toolResult`（不能是 `assistant`）。

### Event 类型

| Event | 说明 |
|-------|-------------|
| `agent_start` | agent 开始处理 |
| `agent_end` | 本次运行的最终 event。对该 event 的 awaited 订阅者仍会计入运行结算 |
| `turn_start` | 新的 turn 开始（一次 LLM 调用 + tool 执行） |
| `turn_end` | turn 完成，附带 assistant 消息和 tool 结果 |
| `message_start` | 任意消息开始（user、assistant、toolResult） |
| `message_update` | **仅限 assistant。** 包含带 delta 的 `assistantMessageEvent` |
| `message_end` | 消息完成 |
| `tool_execution_start` | tool 开始执行 |
| `tool_execution_update` | tool 流式上报进度 |
| `tool_execution_end` | tool 执行完成 |

`Agent.subscribe()` 的监听器会按注册顺序依次被 await。`agent_end` 表示不会再发出更多循环 event，但 `await agent.waitForIdle()` 和 `await agent.prompt(...)` 只有在被 await 的 `agent_end` 监听器执行完毕后才会 settle。

## Agent 选项

```typescript
const agent = new Agent({
  // Initial state
  initialState: {
    systemPrompt: string,
    model: Model<any>,
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
    tools: AgentTool<any>[],
    messages: AgentMessage[],
  },

  // Convert AgentMessage[] to LLM Message[] (required for custom message types)
  convertToLlm: (messages) => messages.filter(...),

  // Transform context before convertToLlm (for pruning, compaction)
  transformContext: async (messages, signal) => pruneOldMessages(messages),

  // Steering mode: "one-at-a-time" (default) or "all"
  steeringMode: "one-at-a-time",

  // Follow-up mode: "one-at-a-time" (default) or "all"
  followUpMode: "one-at-a-time",

  // Required stream function
  streamFn: models.streamSimple.bind(models),

  // Session ID for provider caching
  sessionId: "session-123",

  // Dynamic API key resolution (for expiring OAuth tokens)
  getApiKey: async (provider) => refreshToken(),

  // Tool execution mode: "parallel" (default) or "sequential"
  toolExecution: "parallel",

  // Preflight each tool call after args are validated. Can block execution.
  beforeToolCall: async ({ toolCall, args, context }) => {
    if (toolCall.name === "bash") {
      return { block: true, reason: "bash is disabled", terminate: true };
    }
  },

  // Postprocess each tool result before final tool events are emitted.
  afterToolCall: async ({ toolCall, result, isError, context }) => {
    if (toolCall.name === "notify_done" && !isError) {
      return { terminate: true };
    }
    if (!isError) {
      return { details: { ...result.details, audited: true } };
    }
  },

  // Stop gracefully after a completed turn, before queued messages are polled.
  shouldStopAfterTurn: async ({ context }, signal) => {
    return shouldCompactBeforeNextTurn(context.messages, signal);
  },

  // Custom thinking budgets for token-based providers
  thinkingBudgets: {
    minimal: 128,
    low: 512,
    medium: 1024,
    high: 2048,
  },
});
```

## Agent 状态

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

通过 `agent.state` 访问状态。

为 `agent.state.tools = [...]` 或 `agent.state.messages = [...]` 赋值时，会在存储前复制顶层数组。对返回的数组进行原地修改会直接作用于当前 agent 状态。

流式输出期间，`agent.state.streamingMessage` 包含当前不完整的 assistant 消息。

`agent.state.isStreaming` 会保持为 `true`，直到运行完全 settle，包括被 await 的 `agent_end` 订阅者执行完毕。

## 方法

### 发送 Prompt

```typescript
// Text prompt
await agent.prompt("Hello");

// With images
await agent.prompt("What's in this image?", [
  { type: "image", data: base64Data, mimeType: "image/jpeg" }
]);

// AgentMessage directly
await agent.prompt({ role: "user", content: "Hello", timestamp: Date.now() });

// Continue from current context (last message must be user or toolResult)
await agent.continue();
```

### 状态管理

```typescript
agent.state.systemPrompt = "New prompt";
agent.state.model = getModel("openai", "gpt-4o");
agent.state.thinkingLevel = "medium";
agent.state.tools = [myTool];
agent.toolExecution = "sequential";
agent.beforeToolCall = async ({ toolCall }) => undefined;
agent.afterToolCall = async ({ toolCall, result }) => undefined;
agent.shouldStopAfterTurn = async ({ context }) => shouldCompactBeforeNextTurn(context.messages);
agent.state.messages = newMessages; // top-level array is copied
agent.state.messages.push(message);
agent.reset();
```

### Session 与 Thinking Budgets

```typescript
agent.sessionId = "session-123";

agent.thinkingBudgets = {
  minimal: 128,
  low: 512,
  medium: 1024,
  high: 2048,
};
```

### 控制

```typescript
agent.abort();           // Cancel current operation
await agent.waitForIdle(); // Wait for completion
```

### Events

```typescript
const unsubscribe = agent.subscribe(async (event, signal) => {
  if (event.type === "agent_end") {
    // Final barrier work for the run
    await flushSessionState(signal);
  }
});
unsubscribe();
```

## Steering 与 Follow-up

Steering 消息让你可以在 tool 运行期间打断 agent。Follow-up 消息让你可以在 agent 本应停止的时刻排队后续工作。

```typescript
agent.steeringMode = "one-at-a-time";
agent.followUpMode = "one-at-a-time";

// While agent is running tools
agent.steer({
  role: "user",
  content: "Stop! Do this instead.",
  timestamp: Date.now(),
});

// After the agent finishes its current work
agent.followUp({
  role: "user",
  content: "Also summarize the result.",
  timestamp: Date.now(),
});

const steeringMode = agent.steeringMode;
const followUpMode = agent.followUpMode;

agent.clearSteeringQueue();
agent.clearFollowUpQueue();
agent.clearAllQueues();
```

使用 clearSteeringQueue、clearFollowUpQueue 或 clearAllQueues 来丢弃排队的消息。

当一个 turn 完成后检测到 steering 消息时：
1. 当前 assistant 消息的所有 tool 调用都已结束
2. 注入 steering 消息
3. LLM 在下一个 turn 中响应

只有在没有更多 tool 调用且没有 steering 消息时，才会检查 follow-up 消息。如果有排队的 follow-up 消息，它们会被注入并再运行一个 turn。

## 自定义消息类型

通过声明合并扩展 `AgentMessage`：

```typescript
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    notification: { role: "notification"; text: string; timestamp: number };
  }
}

// Now valid
const msg: AgentMessage = { role: "notification", text: "Info", timestamp: Date.now() };
```

在 `convertToLlm` 中处理自定义类型：

```typescript
const agent = new Agent({
  streamFn: models.streamSimple.bind(models),
  convertToLlm: (messages) => messages.flatMap(m => {
    if (m.role === "notification") return []; // Filter out
    return [m];
  }),
});
```

## Tools

使用 `AgentTool` 定义 tool：

```typescript
import { Type } from "typebox";

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  // Override execution mode for this tool (optional).
  // "sequential" forces the entire batch to run one at a time.
  // "parallel" allows concurrent execution with other tool calls.
  // If omitted, the global toolExecution config applies.
  executionMode: "sequential",
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");

    // Optional: stream progress
    onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

    // Optional: add `terminate: true` here to skip the automatic follow-up LLM call
    // when every finalized tool result in the batch does the same.
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};

agent.state.tools = [readFileTool];
```

### 错误处理

当 tool 失败时**抛出错误**。不要把错误消息当作 content 返回。

```typescript
execute: async (toolCallId, params, signal, onUpdate) => {
  if (!fs.existsSync(params.path)) {
    throw new Error(`File not found: ${params.path}`);
  }
  // Return content only on success
  return { content: [{ type: "text", text: "..." }] };
}
```

抛出的错误会被 agent 捕获，并以 `isError: true` 的 tool 错误形式报告给 LLM。

从 `execute()`、被阻止的 `beforeToolCall` 或 `afterToolCall` 返回 `terminate: true`，可以提示 agent 在当前 tool 批次结束后停止。只有当批次中每个已定稿的 tool result 都是终止性的，该提示才会生效。它只作用于运行时；发出的 `toolResult` transcript 消息仍是标准的 LLM tool 结果。

## Proxy 用法

适用于通过后端进行代理的浏览器应用：

```typescript
import { Agent, streamProxy } from "@earendil-works/pi-agent-core";

const agent = new Agent({
  streamFn: (model, context, options) =>
    streamProxy(model, context, {
      ...options,
      authToken: "...",
      proxyUrl: "https://your-server.com",
    }),
});
```

## 低层 API

需要绕过 Agent 类进行直接控制时：

```typescript
import { agentLoop, agentLoopContinue } from "@earendil-works/pi-agent-core";

const context: AgentContext = {
  systemPrompt: "You are helpful.",
  messages: [],
  tools: [],
};

const config: AgentLoopConfig = {
  model: getModel("openai", "gpt-4o"),
  convertToLlm: (msgs) => msgs.filter(m => ["user", "assistant", "toolResult"].includes(m.role)),
  toolExecution: "parallel",  // overridden by per-tool executionMode if set
  beforeToolCall: async ({ toolCall, args, context }) => undefined,
  afterToolCall: async ({ toolCall, result, isError, context }) => undefined,
};

const userMessage = { role: "user", content: "Hello", timestamp: Date.now() };

const streamFn = models.streamSimple.bind(models);
for await (const event of agentLoop([userMessage], context, config, undefined, streamFn)) {
  console.log(event.type);
}

// Continue from existing context
for await (const event of agentLoopContinue(context, config, undefined, streamFn)) {
  console.log(event.type);
}
```

这些低层流是观察性的（observational）。它们保留 event 顺序，但不会等待你的异步 event 处理 settle 后才继续后续的生产阶段。如果你需要消息处理在 tool 预检之前充当屏障，请使用 `Agent` 类，而不是直接使用 `agentLoop()` 或 `agentLoopContinue()`。

## 许可证

MIT
