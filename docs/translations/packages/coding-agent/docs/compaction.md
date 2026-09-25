> 译注：本文是 `packages/coding-agent/docs/compaction.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# Compaction 与分支总结

LLM 的上下文窗口有限。当对话变得过长时，Pi 会使用 compaction 来总结较旧的内容，同时保留最近的工作。本页同时涵盖自动 compaction 和分支总结。

**源文件**（[pi](https://github.com/earendil-works/pi)）：
- [`packages/coding-agent/src/core/compaction/compaction.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) - 自动 compaction 逻辑
- [`packages/coding-agent/src/core/compaction/branch-summarization.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) - 分支总结
- [`packages/coding-agent/src/core/compaction/utils.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/utils.ts) - 共享工具（文件跟踪、序列化）
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts) - 条目类型（`CompactionEntry`、`BranchSummaryEntry`）
- [`packages/coding-agent/src/core/extensions/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts) - 扩展事件类型

要查看你项目中的 TypeScript 定义，请检查 `node_modules/@earendil-works/pi-coding-agent/dist/`。

## 概述

Pi 有两种总结机制：

| 机制 | 触发条件 | 用途 |
|-----------|---------|---------|
| compaction | 上下文超过阈值，或使用 `/compact` | 总结旧消息以释放上下文 |
| 分支总结 | `/tree` 导航 | 在切换分支时保留上下文 |

两者使用相同的结构化总结格式，并以累计方式跟踪文件操作。compaction 和分支总结请求会使用全新的路由 session ID，并且在提供商支持的情况下禁用 prompt 缓存写入，因为这些一次性 prompt 不太可能被复用。

## Compaction

### 触发时机

自动 compaction 在以下情况触发：

```
contextTokens > contextWindow - reserveTokens
```

默认情况下，`reserveTokens` 为 16384 token（可在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置）。这为 LLM 的回复留出了空间。

在多轮 agent 运行期间，Pi 会在工具执行完毕并追加其结果之后、开始下一条 assistant 回复之前检查该阈值。如果越过阈值，Pi 会在同一次 agent 运行内进行 compaction，然后使用总结和保留的消息继续运行。当已完成的工具批次终止了运行、且没有排队的消息需要再次回复时，会跳过这一轮间检查。Pi 还会在新的用户 prompt 之前以及低层级 agent 运行结束后检查该阈值。

你也可以用 `/compact [instructions]` 手动触发，其中可选的指示用于聚焦总结内容。

### 工作原理

1. **寻找切分点**：从最新消息向前回溯，累计 token 估算值，直到达到 `keepRecentTokens`（默认 20k，可在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置）
2. **提取消息**：收集从上一个保留边界（或 session 起点）到切分点之间的消息
3. **生成总结**：调用 LLM 以结构化格式进行总结，若存在上一次总结则将其作为迭代上下文传入
4. **追加条目**：保存带有 summary 和 `firstKeptEntryId` 的 `CompactionEntry`
5. **重建上下文**：session 为下一个请求重建上下文，使用 summary + 从 `firstKeptEntryId` 开始的消息

```
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

在多次 compaction 时，被总结的范围从上一次 compaction 的保留边界（`firstKeptEntryId`）开始，而不是从 compaction 条目本身开始；如果该保留条目在路径中找不到，则回退为上一次 compaction 之后的条目。这样，在上一次 compaction 中幸存的消息也会被纳入下一次总结，从而得到保留。Pi 还会在写入新的 `CompactionEntry` 之前，根据重建后的 session 上下文重新计算 `tokensBefore`，因此该 token 数反映的是被替换的实际 compaction 前上下文。

### 拆分轮次

一个“轮次（turn）”从一条用户消息开始，包含其后的所有 assistant 回复和工具调用，直到下一条用户消息。正常情况下，compaction 会在轮次边界处切分。

当单个轮次超过 `keepRecentTokens` 时，切分点会落在轮次中间的某条 assistant 消息上。这就是“拆分轮次（split turn）”：

```
Split turn (one huge turn exceeds budget):

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── kept (7-8)

  isSplitTurn = true
  messagesToSummarize = []  (no complete turns before)
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

对于拆分轮次，Pi 会生成两份总结并合并它们：
1. **历史总结**：此前的上下文（如有）
2. **轮次前缀总结**：拆分轮次的前半部分

### 切分点规则

有效的切分点包括：
- 用户消息
- assistant 消息
- BashExecution 消息
- 自定义消息（custom_message、branch_summary）

绝不在工具结果处切分（它们必须与其工具调用保持在一起）。

### CompactionEntry 结构

定义于 [`session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)：

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage?: Usage;       // LLM usage that generated the summary
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default compaction uses this for details (from compaction.ts):
interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

扩展可以在 `details` 中存储任何可 JSON 序列化的数据。默认 compaction 跟踪文件操作，但自定义扩展实现可以使用自己的结构。生成的以及由扩展提供的总结会在可用时存储其 LLM `usage`，这样 session 总量中就会包含总结工作。

实现细节参见 [`prepareCompaction()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) 和 [`compact()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)。若需直接以编程方式进行总结，`generateSummary()` 返回总结文本，`generateSummaryWithUsage()` 返回 `{ text, usage }`。

## 分支总结

### 触发时机

当你使用 `/tree` 导航到另一个分支时，Pi 会提议总结你即将离开的工作。这会把离开分支中的上下文注入新分支。

### 工作原理

1. **寻找公共祖先**：新旧位置共享的最深节点
2. **收集条目**：从旧叶子回溯到公共祖先
3. **按预算准备**：在 token 预算内纳入消息（从最新开始）
4. **生成总结**：以结构化格式调用 LLM
5. **追加条目**：在导航点保存 `BranchSummaryEntry`

```
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D
    A ───┤
         └─ E ─ F ─ [summary of B,C,D] (new leaf)
```

### 累计文件跟踪

compaction 和分支总结都以累计方式跟踪文件。生成总结时，pi 会从以下来源提取文件操作：
- 被总结消息中的工具调用
- 先前 compaction 或分支总结的 `details`（如有）

这意味着文件跟踪会在多次 compaction 或嵌套的分支总结之间不断累积，保留读取和修改文件的完整历史。

### BranchSummaryEntry 结构

定义于 [`session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)：

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;      // Entry we navigated from
  usage?: Usage;       // LLM usage that generated the summary
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default branch summarization uses this for details (from branch-summarization.ts):
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

与 compaction 一样，扩展可以在 `details` 中存储自定义数据。

实现细节参见 [`collectEntriesForBranchSummary()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)、[`prepareBranchEntries()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) 和 [`generateBranchSummary()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)。

## 总结格式

compaction 和分支总结使用相同的结构化格式：

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 消息序列化

在总结之前，消息会通过 [`serializeConversation()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/utils.ts) 序列化为文本：

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

这可以防止模型把它当作一段待续写的对话。

序列化时工具结果会被截断到 2000 个字符。超出该限制的内容会被替换为一个标记，指明截断了多少字符。这能让总结请求保持在合理的 token 预算内，因为工具结果（尤其是来自 `read` 和 `bash` 的结果）通常是上下文体积的最大来源。

## 通过扩展自定义总结

扩展可以拦截并自定义 compaction 和分支总结。事件类型定义参见 [`extensions/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)。

### session_before_compact

在自动 compaction 或 `/compact` 之前触发。可以取消操作或提供自定义总结。参见类型文件中的 `SessionBeforeCompactEvent` 和 `CompactionPreparation`。

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

  // preparation.messagesToSummarize - messages to summarize
  // preparation.turnPrefixMessages - split turn prefix (if isSplitTurn)
  // preparation.previousSummary - previous compaction summary
  // preparation.fileOps - extracted file operations
  // preparation.tokensBefore - context tokens before compaction
  // preparation.firstKeptEntryId - where kept messages start
  // preparation.settings - effective settings after applying model overrides

  // branchEntries - all entries on current branch (for custom state)
  // reason - "manual" (/compact), "threshold", or "overflow"
  // willRetry - whether the aborted turn is retried after compaction (overflow recovery)
  // signal - AbortSignal (pass to LLM calls)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      // usage: summaryResponse.usage, // Optional; included in session totals
      details: { /* custom data */ },
    }
  };
});
```

#### 将消息转换为文本

要用你自己的模型生成总结，可使用 `serializeConversation` 把消息转换为文本：

```typescript
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // Convert AgentMessage[] to Message[], then serialize to text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // Returns:
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // Now send to your model for summarization
  const { summary, usage } = await myModel.summarize(conversationText);
  
  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage,
    }
  };
});
```

使用不同模型的完整示例参见 [custom-compaction.ts](../examples/extensions/custom-compaction.ts)。

### session_compact_failed

在手动或自动 compaction 失败或被中止时触发。对于需要把 `session_before_compact` 尝试与最终结果配对的遥测扩展来说非常有用。

```typescript
pi.on("session_compact_failed", async (event, ctx) => {
  const { reason, errorMessage, aborted, willRetry, fromExtension } = event;
  // reason - "manual" (/compact), "threshold", or "overflow"
  // errorMessage - present for non-abort failures
  // aborted - true for cancelled/aborted compactions
  // willRetry - whether the aborted turn would have retried after compaction
  // fromExtension - whether extension-provided compaction content was being used
});
```

### session_before_tree

在 `/tree` 导航之前触发。无论用户是否选择总结都会触发。可以取消导航或提供自定义总结。

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId - where we're navigating to
  // preparation.oldLeafId - current position (being abandoned)
  // preparation.commonAncestorId - shared ancestor
  // preparation.entriesToSummarize - entries that would be summarized
  // preparation.userWantsSummary - whether user chose to summarize

  // Cancel navigation entirely:
  return { cancel: true };

  // Provide custom summary (only used if userWantsSummary is true):
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "Your summary...",
        // usage: summaryResponse.usage, // Optional; included in session totals
        details: { /* custom data */ },
      }
    };
  }
});
```

参见类型文件中的 `SessionBeforeTreeEvent` 和 `TreePreparation`。

## 设置

在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置 compaction：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| 设置项 | 默认值 | 描述 |
|---------|---------|-------------|
| `enabled` | `true` | 启用自动 compaction |
| `reserveTokens` | `16384` | 为 LLM 回复预留的 token 数 |
| `keepRecentTokens` | `20000` | 保留（不参与总结）的近期 token 数 |

使用 `"enabled": false` 可禁用自动 compaction。你仍可以用 `/compact` 手动触发 compaction。

### 按模型覆盖

使用 `compaction.modelOverrides` 为不同模型调整 token 预算：

```json
{
  "compaction": {
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "modelOverrides": {
      "some-provider/big-model": {
        "reserveTokens": 400000
      }
    }
  }
}
```

对于拥有 1M 上下文窗口的模型，这一覆盖会在超过 600K token 时触发 compaction，并照常保留 20000 个近期 token。其他模型则保留通常的 16384 token 预留。`reserveTokens` 还会影响总结输出的上限（以模型的最大输出 token 数为上限）；它并不仅仅是一个触发阈值。

键是精确且区分大小写的 `provider/modelId` 值，包括模型 ID 中包含的任何斜杠。`reserveTokens` 和 `keepRecentTokens` 各自独立回退：从模型覆盖回退到普通设置，再回退到内置默认值。取值必须是非负的安全整数。匹配的模型覆盖中出现无效值会在读取时报错；只有省略的字段才会回退到普通设置。模型覆盖条目必须是对象。普通 token 设置无效时，读取同样会报错，即使当前模型拥有有效的覆盖也不例外；只有省略的普通取值才会使用内置默认值。`enabled` 保持全局有效，不区分模型。

这些解析后的取值用于手动 compaction、所有自动阈值检查、溢出恢复以及对扩展可见的 `preparation.settings`。切换模型会影响后续的检查与 compaction，但不会更改普通设置。已在进行中的 compaction 使用为该操作捕获的模型和设置。分支总结的设置不受影响。

覆盖在全局设置和项目设置中都可使用。这些文件会在查找之前递归合并，因此全局的模型专属取值会胜过项目级的回退值；项目必须覆盖该模型条目才能改变它。详情参见 [settings.md](settings.md#per-model-compaction-overrides)。
