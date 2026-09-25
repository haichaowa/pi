> 译注：本文是 `packages/coding-agent/docs/session-format.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# Session 文件格式

session 以 JSONL（JSON Lines）文件存储。每一行都是一个带有 `type` 字段的 JSON 对象。session 条目通过 `id`/`parentId` 字段构成树状结构，从而无需创建新文件即可原地分支。

## 文件位置

```
~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl
```

默认情况下，`<session-id>` 是一个 UUID。调用方可以通过 SDK 或 `--session-id` 提供自定义 ID。对于 `<path>`，Pi 会去掉开头的路径分隔符，并把 `/`、`\\` 和 `:` 替换为 `-`。

## 删除 session

删除 `~/.pi/agent/sessions/` 下对应的 `.jsonl` 文件即可移除 session。

Pi 也支持在 `/resume` 中以交互方式删除 session（选中一个 session 后按 `Ctrl+D`，然后确认）。在可用时，pi 会使用 `trash` CLI 来避免永久删除。

## session 版本

session 在文件头中带有版本字段：

- **版本 1**：线性条目序列（旧版，加载时自动迁移）
- **版本 2**：通过 `id`/`parentId` 链接的树状结构
- **版本 3**：将 `hookMessage` 角色更名为 `custom`（扩展统一化）

已有 session 会在加载时自动迁移到当前版本（v3）。

## 源文件

GitHub 上的源码（[pi](https://github.com/earendil-works/pi)）：
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts) - session 条目类型与 SessionManager
- [`packages/coding-agent/src/core/messages.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/messages.ts) - 扩展消息类型（BashExecutionMessage、CustomMessage 等）
- [`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) - 基础消息类型（UserMessage、AssistantMessage、ToolResultMessage）
- [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts) - AgentMessage 联合类型

要查看你项目中的 TypeScript 定义，请检查 `node_modules/@earendil-works/pi-coding-agent/dist/` 和 `node_modules/@earendil-works/pi-ai/dist/`。

## 消息类型

session 条目包含 `AgentMessage` 对象。理解这些类型对于解析 session 和编写扩展至关重要。

### 内容块

消息包含类型化的内容块数组：

```typescript
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

interface ImageContent {
  type: "image";
  data: string;      // base64 encoded
  mimeType: string;  // e.g., "image/jpeg", "image/png"
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
  namespace?: string;
}
```

### 基础消息类型（来自 pi-ai）

```typescript
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;  // Unix ms
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  providerThinkingLevel?: string;
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
  deferred?: DeferredHandle;
  errorMessage?: string;
  rawStopReason?: string;
  endTurn?: boolean;
  timestamp: number;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: any;      // Tool-specific metadata
  usage?: Usage;      // Nested LLM work performed by the tool
  addedToolNames?: string[];
  isError: boolean;
  timestamp: number;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

`"pending"` 保留给流式事件中的部分消息。终止事件会在 Pi 持久化 assistant 消息之前将其替换为完成原因，因此 `"pending"` 不应出现在 session JSONL 中。`"deferred"` 是一种终止原因，表示提供商的响应稍后才会完成；其 `deferred` 句柄包含取回该响应所需的提供商数据。

### 扩展消息类型（来自 pi-coding-agent）

```typescript
interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;  // true for !! prefix commands
  timestamp: number;
}

interface CustomMessage {
  role: "custom";
  customType: string;            // Extension identifier
  content: string | (TextContent | ImageContent)[];
  display: boolean;              // Show in TUI
  details?: any;                 // Extension-specific metadata
  timestamp: number;
}

interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string | null;         // Previous leaf whose abandoned path was summarized
  timestamp: number;
}

interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}
```

### AgentMessage 联合类型

```typescript
type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage;
```

## 条目基类

所有条目（`SessionHeader` 除外）都扩展自 `SessionEntryBase`：

```typescript
interface SessionEntryBase {
  type: string;
  id: string;           // Usually an 8-char hex ID; may fall back to a full UUID
  parentId: string | null;  // Parent entry ID (null for a root entry)
  timestamp: string;    // ISO timestamp
}
```

## 条目类型

### SessionHeader

文件的第一行。仅包含元数据，不属于树的一部分（没有 `id`/`parentId`）。

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project"}
```

对于有父 session 的情况（通过 `/fork`、`/clone` 或 `newSession({ parentSession })` 创建）：

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project","parentSession":"/path/to/original/session.jsonl"}
```

### SessionMessageEntry

对话中的一条消息。`message` 字段包含一个 `AgentMessage`。

```json
{"type":"message","id":"a1b2c3d4","parentId":"prev1234","timestamp":"2024-12-03T14:00:01.000Z","message":{"role":"user","content":"Hello","timestamp":1733234401000}}
{"type":"message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2024-12-03T14:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}],"api":"anthropic-messages","provider":"anthropic","model":"claude-sonnet-4-5","usage":{...},"stopReason":"stop","timestamp":1733234402000}}
{"type":"message","id":"c3d4e5f6","parentId":"b2c3d4e5","timestamp":"2024-12-03T14:00:03.000Z","message":{"role":"toolResult","toolCallId":"call_123","toolName":"bash","content":[{"type":"text","text":"output"}],"isError":false,"timestamp":1733234403000}}
```

### ModelChangeEntry

在用户于 session 中途切换模型时产生。

```json
{"type":"model_change","id":"d4e5f6g7","parentId":"c3d4e5f6","timestamp":"2024-12-03T14:05:00.000Z","provider":"openai","modelId":"gpt-4o"}
```

### ThinkingLevelChangeEntry

在用户更改 thinking/reasoning 级别时产生。

```json
{"type":"thinking_level_change","id":"e5f6g7h8","parentId":"d4e5f6g7","timestamp":"2024-12-03T14:06:00.000Z","thinkingLevel":"high"}
```

### CompactionEntry

在上下文被 compact 时创建。存储较早消息的总结。

```json
{"type":"compaction","id":"f6g7h8i9","parentId":"e5f6g7h8","timestamp":"2024-12-03T14:10:00.000Z","summary":"User discussed X, Y, Z...","firstKeptEntryId":"c3d4e5f6","tokensBefore":50000}
```

`firstKeptEntryId` 是必需的。它标识 compaction 条目之前被保留的第一个条目。重建上下文时，Pi 会用 compaction 总结替换更早的被总结条目，并保留从该条目开始的范围。

可选字段：
- `usage`：生成总结时的 LLM 用量；计入 session 的 token 与费用总量
- `details`：实现相关的数据（默认实现为 `{ readFiles: string[], modifiedFiles: string[] }`，扩展可使用自定义数据）
- `fromHook`：由扩展生成时为 `true`，由 pi 生成时为 `false`/`undefined`（旧字段名）

### BranchSummaryEntry

在通过 `/tree` 切换分支时创建，包含由 LLM 生成的、对被离开分支直至公共祖先部分的总结。捕获被放弃路径中的上下文。

```json
{"type":"branch_summary","id":"g7h8i9j0","parentId":"a1b2c3d4","timestamp":"2024-12-03T14:15:00.000Z","fromId":"f6g7h8i9","summary":"Branch explored approach A..."}
```

`parentId` 是新分支从其继续的条目。`fromId` 是其被放弃路径被总结的那个先前叶子。

可选字段：
- `usage`：生成总结时的 LLM 用量；计入 session 的 token 与费用总量
- `details`：文件跟踪数据（默认为 `{ readFiles: string[], modifiedFiles: string[] }`，扩展可使用自定义数据）
- `fromHook`：由扩展生成时为 `true`，由 pi 生成时为 `false`/`undefined`（旧字段名）

### CustomEntry

扩展状态持久化。不参与 LLM 上下文。

```json
{"type":"custom","id":"h8i9j0k1","parentId":"g7h8i9j0","timestamp":"2024-12-03T14:20:00.000Z","customType":"my-extension","data":{"count":42}}
```

重新加载时可用 `customType` 识别你的扩展的条目。交互模式可以通过 `pi.registerEntryRenderer(customType, renderer)` 渲染自定义条目，但它们仍不参与 LLM 上下文。

### CustomMessageEntry

由扩展注入、且确实参与 LLM 上下文的消息。

```json
{"type":"custom_message","id":"i9j0k1l2","parentId":"h8i9j0k1","timestamp":"2024-12-03T14:25:00.000Z","customType":"my-extension","content":"Injected context...","display":true}
```

字段：
- `content`：字符串或 `(TextContent | ImageContent)[]`（与 UserMessage 相同）
- `display`：`true` = 在 TUI 中以独特样式显示，`false` = 隐藏
- `details`：可选的扩展专属元数据（不会发送给 LLM）

### LabelEntry

用户在某条目上定义的书签/标记。

```json
{"type":"label","id":"j0k1l2m3","parentId":"i9j0k1l2","timestamp":"2024-12-03T14:30:00.000Z","targetId":"a1b2c3d4","label":"checkpoint-1"}
```

将 `label` 设为 `undefined` 即可清除标签。

### SessionInfoEntry

session 元数据（例如用户定义的显示名称）。通过 `/name`、`--name` / `-n` 或扩展中的 `pi.setSessionName()` 设置。

```json
{"type":"session_info","id":"k1l2m3n4","parentId":"j0k1l2m3","timestamp":"2024-12-03T14:35:00.000Z","name":"Refactor auth module"}
```

设置后，session 名称会显示在 session 选择器（`/resume`）中，取代第一条消息。

## 树结构

条目通常构成一棵树，但导航 API 可以创建多个根：
- 根条目的 `parentId` 为 `null`；最初第一个条目就是根
- 每个非根条目通过 `parentId` 指向其父条目
- 分支会从较早的条目创建新的子节点
- “叶子（leaf）”是树中的当前位置
- 调用 `resetLeaf()` 或 `branchWithSummary(null, ...)` 可以让后来的条目成为另一个根

```
[user msg] ─── [assistant] ─── [user msg] ─── [assistant] ─┬─ [user msg] ← current leaf
                                                            │
                                                            └─ [branch_summary] ─── [user msg] ← alternate branch
```

## 上下文构建

`buildContextEntries()` 从当前叶子回溯到根，在遵循 compaction 的前提下生成活动条目列表：

1. 收集路径上的所有条目
2. 如果路径上存在一个或多个 `CompactionEntry`，则使用最新的那个：
   - 首先包含该 compaction 条目
   - 包含从 `firstKeptEntryId` 到该 compaction 条目之前（不含）的条目
   - 包含 compaction 条目之后的条目
3. 保留所选范围内的非消息条目，以便交互模式可以渲染它们

`buildSessionContext()` 在该条目列表的基础上为 LLM 生成消息列表：

1. 从完整路径中提取当前的模型和 thinking 级别设置
2. 将选中的条目转换为消息：
   - `message` -> 存储的 `AgentMessage`
   - `compaction` -> `compactionSummary`
   - `branch_summary` -> `branchSummary`
   - `custom_message` -> `CustomMessage`
   - `custom` -> 不产生上下文消息

compaction 总结会替换 `firstKeptEntryId` 之前的条目。保留的条目以及 compaction 之后的全部条目仍对 LLM 可见。

## 解析示例

```typescript
import { readFileSync } from "fs";

const lines = readFileSync("session.jsonl", "utf8").trim().split("\n");

for (const line of lines) {
  const entry = JSON.parse(line);

  switch (entry.type) {
    case "session":
      console.log(`Session v${entry.version ?? 1}: ${entry.id}`);
      break;
    case "message":
      console.log(`[${entry.id}] ${entry.message.role}: ${JSON.stringify(entry.message.content)}`);
      break;
    case "compaction":
      console.log(`[${entry.id}] Compaction: ${entry.tokensBefore} tokens summarized`);
      break;
    case "branch_summary":
      console.log(`[${entry.id}] Branch from ${entry.fromId}`);
      break;
    case "custom":
      console.log(`[${entry.id}] Custom (${entry.customType}): ${JSON.stringify(entry.data)}`);
      break;
    case "custom_message":
      console.log(`[${entry.id}] Extension message (${entry.customType}): ${entry.content}`);
      break;
    case "label":
      console.log(`[${entry.id}] Label "${entry.label}" on ${entry.targetId}`);
      break;
    case "model_change":
      console.log(`[${entry.id}] Model: ${entry.provider}/${entry.modelId}`);
      break;
    case "thinking_level_change":
      console.log(`[${entry.id}] Thinking: ${entry.thinkingLevel}`);
      break;
  }
}
```

## SessionManager API

以编程方式操作 session 的关键方法。

### 静态创建方法
- `SessionManager.create(cwd, sessionDir?, options?)` - 新建 session；`options` 可设置 `id` 和 `parentSession`
- `SessionManager.open(path, sessionDir?, cwdOverride?)` - 打开已有的 session 文件
- `SessionManager.continueRecent(cwd, sessionDir?)` - 继续最近的 session 或新建
- `SessionManager.inMemory(cwd?, options?, entries?)` - 不持久化到文件，可选择用条目初始化
- `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?, options?)` - 从另一个项目 fork session

### 静态列出方法
- `SessionManager.list(cwd, sessionDir?, onProgress?)` - 列出某个目录的 session
- `SessionManager.listAll(onProgress?)` - 列出所有项目的全部 session
- `SessionManager.listAll(sessionDir?, onProgress?)` - 列出来自自定义 session 根目录的 session

### 实例方法 - session 管理
- `newSession(options?)` - 开始一个新 session（选项：`{ id?: string, parentSession?: string }`）
- `setSessionFile(path)` - 切换到另一个 session 文件
- `createBranchedSession(leafId)` - 把分支提取到新 session 文件

### 实例方法 - 追加（均返回条目 ID）
- `appendMessage(message)` - 添加消息
- `appendThinkingLevelChange(level)` - 记录 thinking 变更
- `appendModelChange(provider, modelId)` - 记录模型变更
- `appendCompaction(summary, firstKeptEntryId, tokensBefore, details?, fromHook?, usage?)` - 添加 compaction
- `appendCustomEntry(customType, data?)` - 扩展状态（不进入上下文）
- `appendSessionInfo(name)` - 设置 session 显示名称
- `appendCustomMessageEntry(customType, content, display, details?)` - 扩展消息（进入上下文）
- `appendLabelChange(targetId, label)` - 设置/清除标签

### 实例方法 - 树导航
- `getLeafId()` - 当前位置
- `getLeafEntry()` - 获取当前叶子条目
- `getEntry(id)` - 按 ID 获取条目
- `getBranch(fromId?)` - 从条目回溯到根
- `getTree()` - 获取完整树结构
- `getChildren(parentId)` - 获取直接子节点
- `getLabel(id)` - 获取条目的标签
- `branch(entryId)` - 把叶子移动到较早的条目
- `resetLeaf()` - 把叶子重置为 null（位于所有条目之前）
- `branchWithSummary(entryId, summary, details?, fromHook?, usage?)` - 带上下文总结进行分支；`entryId` 可为 `null` 表示从根开始分支

### 实例方法 - 上下文与信息
- `buildContextEntries()` - 获取应用 compaction 后的活动分支条目
- `buildSessionContext()` - 获取供 LLM 使用的消息、thinkingLevel 和模型
- `getEntries()` - 所有条目（不含文件头）
- `getHeader()` - session 文件头元数据
- `getSessionName()` - 从最新的 session_info 条目获取显示名称
- `getCwd()` - 工作目录
- `getSessionDir()` - session 存储目录
- `getSessionId()` - session UUID
- `getSessionFile()` - session 文件路径（内存 session 时为 undefined）
- `isPersisted()` - session 是否已保存到磁盘
