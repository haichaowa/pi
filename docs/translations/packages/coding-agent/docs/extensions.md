> 译注：本文是 `packages/coding-agent/docs/extensions.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

> pi 可以创建 extension。可以让它为你的使用场景构建一个。

# Extensions

Extension 是扩展 pi 行为的 TypeScript 模块。它们可以订阅生命周期 event、注册 LLM 可调用的自定义 tool、添加 command，等等。

> **关于 /reload 的存放位置：** 把 extension 放在 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目内）即可被自动发现。`pi -e ./path.ts` 只用于快速测试。位于自动发现位置的 extension 可以用 `/reload` 热重载。

**核心能力：**
- **自定义 tool** — 通过 `pi.registerTool()` 注册 LLM 可调用的 tool
- **event 拦截** — 阻止或修改 tool 调用、注入上下文、自定义 compaction
- **用户交互** — 通过 `ctx.ui` 向用户发起选择、确认、输入、通知
- **自定义 UI component** — 通过 `ctx.ui.custom()` 构建支持键盘输入的完整 TUI component，处理复杂交互
- **自定义 command** — 通过 `pi.registerCommand()` 注册 `/mycommand` 之类的 command
- **session 持久化** — 通过 `pi.appendEntry()` 保存可跨重启保留的状态
- **自定义 render** — 控制 tool 调用/结果和消息在 TUI 中的呈现方式

**示例使用场景：**
- 权限门禁（在执行 `rm -rf`、`sudo` 等之前确认）
- Git checkpoint（每轮 stash，切分支时恢复）
- 路径保护（阻止写入 `.env`、`node_modules/`）
- 自定义 compaction（按你自己的方式总结对话）
- 对话摘要（参见 `summarize.ts` 示例）
- 交互式 tool（提问、向导、自定义对话框）
- 有状态的 tool（todo 列表、连接池）
- 外部集成（文件监听、webhook、CI 触发器）
- 等待时玩点游戏（参见 `snake.ts` 示例）

完整实现见 [examples/extensions/](../examples/extensions/)。

## 目录

- [快速开始](#quick-start)
- [Extension 存放位置](#extension-locations)
- [可用导入](#available-imports)
- [编写 Extension](#writing-an-extension)
  - [Extension 组织形式](#extension-styles)
- [Events](#events)
  - [生命周期总览](#lifecycle-overview)
  - [Resource Events](#resource-events)
  - [Session Events](#session-events)
  - [Agent Events](#agent-events)
  - [Model Events](#model-events)
  - [Tool Events](#tool-events)
- [ExtensionContext](#extensioncontext)
- [ExtensionCommandContext](#extensioncommandcontext)
- [ExtensionAPI 方法](#extensionapi-methods)
- [状态管理](#state-management)
- [自定义 Tool](#custom-tools)
  - [动态 Tool 加载](#dynamic-tool-loading)
- [自定义 UI](#custom-ui)
- [错误处理](#error-handling)
- [Mode 行为](#mode-behavior)
- [示例索引](#examples-reference)

<a id="quick-start"></a>

## 快速开始

创建 `~/.pi/agent/extensions/my-extension.ts`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // React to events
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // Register a custom tool
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // Register a command
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

用 `--extension`（或 `-e`）标志测试：

```bash
pi -e ./my-extension.ts
```

<a id="extension-locations"></a>

## Extension 存放位置

> **安全提示：** extension 以你的完整系统权限运行，可以执行任意代码。只从你信任的来源安装。

Extension 会从受信任的位置自动发现。项目内的 `.pi/extensions` 条目只有在项目被信任之后才会加载。

| 位置 | 作用范围 |
|----------|-------|
| `~/.pi/agent/extensions/*.ts` | 全局（所有项目） |
| `~/.pi/agent/extensions/*/index.ts` | 全局（子目录） |
| `.pi/extensions/*.ts` | 项目内 |
| `.pi/extensions/*/index.ts` | 项目内（子目录） |

还可以通过 `settings.json` 追加路径：

```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ],
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ]
}
```

要通过 npm 或 git 把 extension 作为 pi package 分享，参见 [packages.md](packages.md)。

<a id="available-imports"></a>

## 可用导入

| 包 | 用途 |
|---------|---------|
| `@earendil-works/pi-coding-agent` | Extension 类型（`ExtensionAPI`、`ExtensionContext`、event） |
| `typebox` | 用于 tool 参数的 schema 定义 |
| `@earendil-works/pi-ai` | AI 工具函数（`StringEnum`，Google 兼容的枚举） |
| `@earendil-works/pi-tui` | 用于自定义 render 的 TUI component |

npm 依赖同样可用。在 extension 旁边（或任意父目录）放一个 `package.json`，运行 `npm install`，来自 `node_modules/` 的导入就会被自动解析。

对于用 `pi install` 安装的发行版 pi package（npm 或 git），运行时依赖必须放在 `dependencies` 里。package 安装默认采用生产安装（`npm install --omit=dev`），所以 `devDependencies` 在运行时不可用；配置了 `npmCommand` 时，git package 出于对包装器的兼容会改用普通 `install`。

Node.js 内置模块（`node:fs`、`node:path` 等）同样可用。

<a id="writing-an-extension"></a>

## 编写 Extension

Extension 导出一个默认的工厂函数，接收 `ExtensionAPI`。工厂函数可以是同步的，也可以是异步的：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui for user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "info");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor (default)
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("my-flag", { ... });
}
```

Extension 通过 [jiti](https://github.com/unjs/jiti) 加载，因此 TypeScript 无需编译即可运行。

如果工厂函数返回 `Promise`，pi 会先等它完成再继续启动。也就是说，异步初始化会在 `session_start` 之前、`resources_discover` 之前，以及通过 `pi.registerProvider()` 排队的 provider 注册被刷入之前完成。

### 异步工厂函数

需要做一次性启动工作（比如拉取远程配置、动态发现可用模型）时，可以用异步工厂函数。

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const response = await fetch("http://localhost:1234/v1/models");
  const payload = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      context_window?: number;
      max_tokens?: number;
    }>;
  };

  pi.registerProvider("local-openai", {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "$LOCAL_OPENAI_API_KEY",
    api: "openai-completions",
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? 128000,
      maxTokens: model.max_tokens ?? 4096,
    })),
  });
}
```

这种模式让取到的模型在正常启动期间可用，对 `pi --list-models` 也可见。

### 长生命周期资源与 shutdown

Extension 工厂函数可能在根本不会启动 session 的调用中运行。不要在工厂函数里启动进程、socket、文件监听器、定时器这类后台资源。

把后台资源的启动推迟到 `session_start`，或推迟到需要该资源的 command/tool/event。再注册一个幂等的 `session_shutdown` handler，用来关闭你启动的所有 session 范围的资源。

<a id="extension-styles"></a>

### Extension 组织形式

**单文件** — 最简单，适合小型 extension：

```
~/.pi/agent/extensions/
└── my-extension.ts
```

**带 index.ts 的目录** — 适合多文件 extension：

```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (exports default function)
    ├── tools.ts        # Helper module
    └── utils.ts        # Helper module
```

**带依赖的 package** — 需要 npm 包的 extension：

```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # Declares dependencies and entry points
    ├── package-lock.json
    ├── node_modules/   # After npm install
    └── src/
        └── index.ts
```

```json
// package.json
{
  "name": "my-extension",
  "dependencies": {
    "zod": "^3.0.0",
    "chalk": "^5.0.0"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

在 extension 目录里运行 `npm install`，之后来自 `node_modules/` 的导入就能自动生效。

## Events

<a id="lifecycle-overview"></a>

### 生命周期总览

```
pi starts
  │
  ├─► project_trust (user/global and CLI extensions only, before project resources load)
  ├─► session_start { reason: "startup" }
  └─► resources_discover { reason: "startup" }
      │
      ▼
user sends prompt ─────────────────────────────────────────┐
  │                                                        │
  ├─► (extension commands checked first, bypass if found)  │
  ├─► input (can intercept, transform, or handle)          │
  ├─► (skill/template expansion if not handled)            │
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start                                          │
  ├─► message_start / message_update / message_end         │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   ├─► context (can modify messages)            │       │
  │   ├─► before_provider_headers (can mutate headers)     |
  │   ├─► before_provider_request (can inspect or replace payload)
  │   ├─► after_provider_response (status + headers, before stream consume)
  │   │                                            │       │
  │   │   LLM responds, may call tools:            │       │
  │   │     ├─► tool_execution_start               │       │
  │   │     ├─► tool_call (can block)              │       │
  │   │     ├─► tool_execution_update              │       │
  │   │     ├─► tool_result (can modify)           │       │
  │   │     └─► tool_execution_end                 │       │
  │   │                                            │       │
  │   └─► turn_end                                 │       │
  │                                                        │
  ├─► agent_end                                            │
  └─► agent_settled (no retry/compaction/follow-up left)   │
                                                           │
user sends another prompt ◄────────────────────────────────┘

/new (new session) or /resume (switch session)
  ├─► session_before_switch (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "new" | "resume", previousSessionFile? }
  └─► resources_discover { reason: "startup" }

/fork or /clone
  ├─► session_before_fork (can cancel)
  ├─► session_shutdown
  ├─► session_start { reason: "fork", previousSessionFile }
  └─► resources_discover { reason: "startup" }

/name or pi.setSessionName()
  └─► session_info_changed

/compact or auto-compaction
  ├─► session_before_compact (can cancel or customize)
  ├─► session_compact (success)
  └─► session_compact_failed (failure or abort)

/tree navigation
  ├─► session_before_tree (can cancel or customize)
  └─► session_tree

/model or Ctrl+P (model selection/cycling)
  ├─► thinking_level_select (if model change changes/clamps thinking level)
  └─► model_select

thinking level changes (settings, keybinding, pi.setThinkingLevel())
  └─► thinking_level_select

exit (Ctrl+C, Ctrl+D, SIGHUP, SIGTERM)
  └─► session_shutdown
```

### Startup Events

#### project_trust

在 pi 决定是否信任一个带动态配置（`.pi` 或 `.agents/skills`）的项目之前触发。它在启动时运行；当 session 替换（例如 `/resume`）进入一个当前进程尚未解析过信任状态的 cwd 时也会运行。只有 user/global extension 和 CLI `-e` extension 参与其中；项目内的 extension 在信任解析完成之前不会加载。

```typescript
pi.on("project_trust", async (event, ctx) => {
  // event.cwd - current working directory
  // ctx has a limited trust context: cwd, mode, hasUI, and select/confirm/input/notify UI helpers
  if (await ctx.ui.confirm("Trust project?", event.cwd)) {
    return { trusted: "yes", remember: true };
  }
  return { trusted: "undecided" };
});
```

`project_trust` handler 必须返回 `{ trusted: "yes" | "no" | "undecided" }`。返回 `"yes"` 或 `"no"` 的 user/global 或 CLI extension 拥有决定权；第一个 yes/no 决定生效，并抑制内置的信任提示。用 `remember: true` 持久化 yes/no 决定；否则该决定只对当前进程有效。返回 `"undecided"` 则交给后续 handler 或内置信任流程决定。弹提示之前先检查 `ctx.hasUI`。如果没有 handler 返回 yes/no，就继续正常的信任解析：先应用已保存的 `trust.json` 决定，再由 `defaultProjectTrust` 控制 pi 默认是询问、信任还是拒绝。

### Resource Events

#### resources_discover

在 `session_start` 之后触发，extension 可以借此贡献额外的 skill、prompt 和 theme 路径。
启动路径使用 `reason: "startup"`。重载使用 `reason: "reload"`。

```typescript
pi.on("resources_discover", async (event, _ctx) => {
  // event.cwd - current working directory
  // event.reason - "startup" | "reload"
  return {
    skillPaths: ["/path/to/skills"],
    promptPaths: ["/path/to/prompts"],
    themePaths: ["/path/to/themes"],
  };
});
```

### Session Events

session 存储的内部细节和 SessionManager API 参见 [Session Format](session-format.md)。

#### session_start

session 被启动、加载或重载时触发。

```typescript
pi.on("session_start", async (event, ctx) => {
  // event.reason - "startup" | "reload" | "new" | "resume" | "fork"
  // event.previousSessionFile - present for "new", "resume", and "fork"
  ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

#### session_info_changed

通过 `/name`、RPC 或 `pi.setSessionName()` 设置当前 session 显示名称时触发。

```typescript
pi.on("session_info_changed", async (event, ctx) => {
  // event.name - current normalized name, or undefined if cleared
  ctx.ui.notify(`Session renamed: ${event.name ?? "(none)"}`, "info");
});
```

#### session_before_switch

在开始新 session（`/new`）或切换 session（`/resume`）之前触发。

```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event.reason - "new" or "resume"
  // event.targetSessionFile - session we're switching to (only for "resume")

  if (event.reason === "new") {
    const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
    if (!ok) return { cancel: true };
  }
});
```

切换或新建 session 成功后，pi 会为旧的 extension 实例发出 `session_shutdown`，为新 session 重新加载并重新绑定 extension，然后发出带 `reason: "new" | "resume"` 和 `previousSessionFile` 的 `session_start`。
清理工作放在 `session_shutdown` 里做，然后在 `session_start` 里重建内存状态。

#### session_before_fork

通过 `/fork` fork 或通过 `/clone` 克隆时触发。

```typescript
pi.on("session_before_fork", async (event, ctx) => {
  // event.entryId - ID of the selected entry
  // event.position - "before" for /fork, "at" for /clone
  return { cancel: true }; // Cancel fork/clone
  // OR
  return { skipConversationRestore: true }; // Reserved for future conversation restore control
});
```

fork 或克隆成功后，pi 会为旧的 extension 实例发出 `session_shutdown`，为新 session 重新加载并重新绑定 extension，然后发出带 `reason: "fork"` 和 `previousSessionFile` 的 `session_start`。
清理工作放在 `session_shutdown` 里做，然后在 `session_start` 里重建内存状态。

#### session_before_compact / session_compact / session_compact_failed

compaction 时触发。详情参见 [compaction.md](compaction.md)。

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

  // reason - "manual" (/compact), "threshold", or "overflow"
  // willRetry - whether the aborted turn is retried after compaction (overflow recovery)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      // usage: summaryResponse.usage, // Optional; included in session totals
    }
  };
});

pi.on("session_compact", async (event, ctx) => {
  // event.compactionEntry - the saved compaction
  // event.fromExtension - whether extension provided it
  // event.reason - "manual" (/compact), "threshold", or "overflow"
  // event.willRetry - whether the aborted turn is retried after compaction (overflow recovery)
});

pi.on("session_compact_failed", async (event, ctx) => {
  // event.reason - "manual" (/compact), "threshold", or "overflow"
  // event.errorMessage - present for non-abort failures
  // event.aborted - true for cancelled/aborted compactions
  // event.willRetry - whether the aborted turn would have retried after compaction
  // event.fromExtension - whether extension-provided compaction content was being used
});
```

#### session_before_tree / session_tree

`/tree` 导航时触发。树导航概念参见 [Sessions](sessions.md)。

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;
  return { cancel: true };
  // OR provide custom summary:
  return {
    summary: {
      summary: "...",
      // usage: summaryResponse.usage, // Optional; included in session totals
      details: {},
    },
  };
});

pi.on("session_tree", async (event, ctx) => {
  // event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

#### session_shutdown

已启动的 session 运行时被拆除之前触发。用它清理在 `session_start` 或其他 session 范围 hook 里打开的资源。

```typescript
pi.on("session_shutdown", async (event, ctx) => {
  // event.reason - "quit" | "reload" | "new" | "resume" | "fork"
  // event.targetSessionFile - destination session for session replacement flows
  // Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

用户提交 prompt 之后、agent 循环之前触发。可以注入消息和/或修改 system prompt。

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event.prompt - user's prompt text
  // event.images - attached images (if any)
  // event.systemPrompt - current chained system prompt for this handler
  //   (includes changes from earlier before_agent_start handlers)
  // event.systemPromptOptions - structured options used to build the system prompt
  //   .customPrompt - any custom system prompt (from --system-prompt, SYSTEM.md, or custom templates)
  //   .selectedTools - tools currently active in the prompt
  //   .toolSnippets - one-line descriptions for each tool
  //   .promptGuidelines - custom guideline bullets
  //   .appendSystemPrompt - text from --append-system-prompt flags
  //   .cwd - working directory
  //   .contextFiles - AGENTS.md files and other loaded context files
  //   .skills - loaded skills

  return {
    // Inject a persistent message (stored in session, sent to LLM)
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    // Replace the system prompt for this turn (chained across extensions)
    systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn...",
  };
});
```

`systemPromptOptions` 字段让 extension 能拿到 Pi 构建 system prompt 时所用的同一份结构化数据。这样你不用重新发现资源、重新解析 flag，就能看到 Pi 加载了什么——自定义 prompt、guideline、tool 片段、上下文文件、skill。当你的 extension 需要在尊重用户配置的前提下对 system prompt 做深度、知情的修改时，就用它。

在 `before_agent_start` 内部，`event.systemPrompt` 和 `ctx.getSystemPrompt()` 反映的都是截至当前 handler 的链式 system prompt。后面的 `before_agent_start` handler 仍可以再改一次。

#### agent_start / agent_end / agent_settled

`agent_start` 在一次底层 agent run 开始时触发。`agent_end` 在该 run 结束时触发，但此后 Pi 仍可能自动重试、自动 compaction 后重试，或继续处理排队的后续消息。需要确认 Pi 不会再自动继续运行的状态集成，请用 `agent_settled`。

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
  // event.messages - messages from this low-level run
});

pi.on("agent_settled", async (_event, ctx) => {
  // ctx.isIdle() is true here unless another extension started a new run.
});
```

#### ui_prompt_start / ui_prompt_end

围绕阻塞式用户交互的 extension UI prompt 的纯通知生命周期 event。它们在 `ctx.ui.select()`、`ctx.ui.confirm()`、`ctx.ui.input()`、`ctx.ui.editor()` 和 `ctx.ui.custom()` 前后触发，让 host/状态集成可以上报"等待用户"，而不只是"运行中"。

嵌套或重叠的 prompt 会合并成一个外层等待 span。handler 以尽力而为的方式调用，在显示或关闭 prompt 前不会等待它们完成。

```typescript
pi.on("ui_prompt_start", async (event, ctx) => {
  // event.reason === "ui_prompt"
  // event.kind: "select" | "confirm" | "input" | "editor" | "custom"
  // event.title: prompt title when available
});

pi.on("ui_prompt_end", async (event, ctx) => {
  // Pi is no longer waiting on that UI prompt span.
});
```

#### turn_start / turn_end

每个 turn（一次 LLM 响应 + tool 调用）触发。

```typescript
pi.on("turn_start", async (event, ctx) => {
  // event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
  // event.turnIndex, event.message, event.toolResults
});
```

#### message_start / message_update / message_end

消息生命周期更新时触发。

- `message_start` 和 `message_end` 对 user、assistant 和 toolResult 消息触发。
- `message_update` 对 assistant 流式更新触发。
- `message_end` handler 可以返回 `{ message }` 替换定稿的消息。替换必须保持相同的 `role`。

```typescript
pi.on("message_start", async (event, ctx) => {
  // event.message
});

pi.on("message_update", async (event, ctx) => {
  // event.message
  // event.assistantMessageEvent (token-by-token stream event)
});

pi.on("message_end", async (event, ctx) => {
  if (event.message.role !== "assistant") return;

  return {
    message: {
      ...event.message,
      usage: {
        ...event.message.usage,
        cost: {
          ...event.message.usage.cost,
          total: 0.123,
        },
      },
    },
  };
});
```

#### tool_execution_start / tool_execution_update / tool_execution_end

tool 执行生命周期更新时触发。

并行 tool 模式下：
- `tool_execution_start` 在 preflight 阶段按 assistant 源顺序发出
- `tool_execution_update` event 可能跨 tool 交错
- `tool_execution_end` 在每个 tool 定稿后按完成顺序发出
- 最终的 `toolResult` 消息 event 仍会在之后按 assistant 源顺序发出

```typescript
pi.on("tool_execution_start", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args
});

pi.on("tool_execution_update", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.args, event.partialResult
});

pi.on("tool_execution_end", async (event, ctx) => {
  // event.toolCallId, event.toolName, event.result, event.isError
});
```

#### context

每次 LLM 调用前触发。以非破坏性的方式修改消息。消息类型参见 [Session Format](session-format.md)。

```typescript
pi.on("context", async (event, ctx) => {
  // event.messages - deep copy, safe to modify
  const filtered = event.messages.filter(m => !shouldPrune(m));
  return { messages: filtered };
});
```

#### before_provider_headers

在发往远端的 HTTP header 组装完成后触发。用它添加、覆盖或删除请求 header。

handler 直接就地修改 `event.headers`。把某个 key 设为字符串即添加或覆盖，设为 `null` 则删除。

```typescript
pi.on("before_provider_headers", (event, ctx) => {
  // Add or override — e.g. a session id for gateway tracing/attribution
  event.headers["x-session-id"] = ctx.sessionManager.getSessionId();

  // Drop a tracking header pi adds for this call
  event.headers["X-OpenRouter-Title"] = null;
});
```

每次 provider 请求运行一次；重试会复用同样的 header，不会重新触发该 hook。

#### before_provider_request

在 provider 专属 payload 构建完成之后、请求发出之前触发。handler 按 extension 加载顺序运行。返回 `undefined` 则 payload 保持不变。返回其他任何值都会替换 payload，对后续 handler 和实际请求同时生效。

这个 hook 可以重写 provider 层面的 system 指令，或者将其整个移除。这类 payload 层面的改动不会反映到 `ctx.getSystemPrompt()`——它报告的是 Pi 的 system prompt 字符串，而不是最终序列化的 provider payload。

```typescript
pi.on("before_provider_request", (event, ctx) => {
  console.log(JSON.stringify(event.payload, null, 2));

  // Optional: replace payload
  // return { ...event.payload, temperature: 0 };
});
```

主要用于调试 provider 序列化和缓存行为。

#### after_provider_response

在收到 HTTP 响应之后、消费其流式 body 之前触发。handler 按 extension 加载顺序运行。

```typescript
pi.on("after_provider_response", (event, ctx) => {
  // event.status - HTTP status code
  // event.headers - normalized response headers
  if (event.status === 429) {
    console.log("rate limited", event.headers["retry-after"]);
  }
});
```

header 的可用性取决于 provider 和传输方式。把 HTTP 响应抽象掉的 provider 可能不暴露 header。

### Model Events

#### model_select

通过 `/model` command、模型轮换（`Ctrl+P`）或 session 恢复改变模型时触发。

```typescript
pi.on("model_select", async (event, ctx) => {
  // event.model - newly selected model
  // event.previousModel - previous model (undefined if first selection)
  // event.source - "set" | "cycle" | "restore"

  const prev = event.previousModel
    ? `${event.previousModel.provider}/${event.previousModel.id}`
    : "none";
  const next = `${event.model.provider}/${event.model.id}`;

  ctx.ui.notify(`Model changed (${event.source}): ${prev} -> ${next}`, "info");
});
```

模型变化时，用它更新 UI 元素（状态栏、footer），或执行模型相关的初始化。

#### thinking_level_select

thinking level 变化时触发。纯通知性质；handler 返回值会被忽略。

```typescript
pi.on("thinking_level_select", async (event, ctx) => {
  // event.level - newly selected thinking level
  // event.previousLevel - previous thinking level

  ctx.ui.setStatus("thinking", `thinking: ${event.level}`);
});
```

当 `pi.setThinkingLevel()`、模型变化或内置 thinking level 控件改变活动 thinking level 时，用它更新 extension UI。

### Tool Events

#### tool_call

在 `tool_execution_start` 之后、tool 执行之前触发。**可以阻止执行。** 用 `isToolCallEventType` 收窄类型、拿到带类型的输入。

在 `tool_call` 运行之前，pi 会等先前发出的 Agent event 全部排空穿过 `AgentSession`。这意味着 `ctx.sessionManager` 已更新到当前的 assistant tool 调用消息。

默认的并行 tool 执行模式下，同一条 assistant 消息的兄弟 tool 调用会先按顺序 preflight，再并发执行。`tool_call` 不保证能在 `ctx.sessionManager` 里看到同一条 assistant 消息的兄弟 tool 结果。

`event.input` 可变。就地修改它，即可在执行前修补 tool 参数。

行为保证：
- 对 `event.input` 的修改会影响真正的 tool 执行
- 后面的 `tool_call` handler 能看到前面 handler 做的修改
- 修改之后不会重新校验
- `tool_call` 的返回值通过 `{ block: true, reason?: string, terminate?: boolean }` 控制阻止
- `terminate` 只对被阻止的调用生效；只有批次里每个定稿结果都是 terminating 时，agent 才会提前停止

```typescript
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  // event.toolName - "bash", "read", "write", "edit", etc.
  // event.toolCallId
  // event.input - tool parameters (mutable)

  // Built-in tools: no type params needed
  if (isToolCallEventType("bash", event)) {
    // event.input is { command: string; timeout?: number }
    event.input.command = `source ~/.profile\n${event.input.command}`;

    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous command", terminate: true };
    }
  }

  if (isToolCallEventType("read", event)) {
    // event.input is { path: string; offset?: number; limit?: number }
    console.log(`Reading: ${event.input.path}`);
  }
});
```

#### 为自定义 tool 的输入标注类型

自定义 tool 应导出自己的输入类型：

```typescript
// my-extension.ts
export type MyToolInput = Static<typeof myToolSchema>;
```

给 `isToolCallEventType` 传显式类型参数：

```typescript
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { MyToolInput } from "my-extension";

pi.on("tool_call", (event) => {
  if (isToolCallEventType<"my_tool", MyToolInput>("my_tool", event)) {
    event.input.action;  // typed
  }
});
```

#### tool_result

在 tool 执行结束之后、`tool_execution_end` 及最终 tool 结果消息 event 发出之前触发。**可以修改结果。**

并行 tool 模式下，`tool_result` 和 `tool_execution_end` 可能按 tool 完成顺序交错，而最终的 `toolResult` 消息 event 仍会在之后按 assistant 源顺序发出。

`tool_result` handler 像中间件一样链式执行：
- handler 按 extension 加载顺序运行
- 每个 handler 看到的是前面 handler 修改后的最新结果
- handler 可以返回部分补丁（`content`、`details`、`isError` 或 `usage`）；省略的字段保持当前值

handler 内部的嵌套异步工作请用 `ctx.signal`。这样 Esc 才能取消 extension 发起的模型调用、`fetch()` 和其他支持中止的操作。

```typescript
import { isBashToolResult } from "@earendil-works/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content, event.details, event.isError, event.usage

  if (isBashToolResult(event)) {
    // event.details is typed as BashToolDetails
  }

  const response = await fetch("https://example.com/summarize", {
    method: "POST",
    body: JSON.stringify({ content: event.content }),
    signal: ctx.signal,
  });

  // Modify result:
  return { content: [...], details: {...}, isError: false, usage: nestedModelUsage };
});
```

### User Bash Events

#### user_bash

用户执行 `!` 或 `!!` command 时触发。**可以拦截。**

```typescript
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

pi.on("user_bash", (event, ctx) => {
  // event.command - the bash command
  // event.excludeFromContext - true if !! prefix
  // event.cwd - working directory

  // Option 1: Provide custom operations (e.g., SSH)
  return { operations: remoteBashOps };

  // Option 2: Wrap pi's built-in local bash backend
  const local = createLocalBashOperations();
  return {
    operations: {
      exec(command, cwd, options) {
        return local.exec(`source ~/.profile\n${command}`, cwd, options);
      }
    }
  };

  // Option 3: Full replacement - return result directly
  return { result: { output: "...", exitCode: 0, cancelled: false, truncated: false } };
});
```

### Input Events

#### input

收到用户输入时触发；此时 extension command 已检查完毕，但 skill 和 template 尚未展开。event 看到的是原始输入文本，所以 `/skill:foo` 和 `/template` 还未展开。

**处理顺序：**
1. 先检查 extension command（`/cmd`）——命中则运行其 handler，并跳过 input event
2. 触发 `input` event——可以拦截、变换或处理
3. 未处理：skill command（`/skill:name`）展开为 skill 内容
4. 未处理：prompt 模板（`/template`）展开为模板内容
5. 开始 agent 处理（`before_agent_start` 等）

```typescript
pi.on("input", async (event, ctx) => {
  // event.text - raw input (before skill/template expansion)
  // event.images - attached images, if any
  // event.source - "interactive" (typed), "rpc" (API), or "extension" (via sendUserMessage)
  // event.streamingBehavior - "steer" | "followUp" | undefined
  //   undefined when idle, "steer" for mid-stream interrupts,
  //   "followUp" for messages queued until the agent finishes

  // Transform: rewrite input before expansion
  if (event.text.startsWith("?quick "))
    return { action: "transform", text: `Respond briefly: ${event.text.slice(7)}` };

  // Handle: respond without LLM (extension shows its own feedback)
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }

  // Route by source: skip processing for extension-injected messages
  if (event.source === "extension") return { action: "continue" };

  // Intercept skill commands before expansion
  if (event.text.startsWith("/skill:")) {
    // Could transform, block, or let pass through
  }

  return { action: "continue" };  // Default: pass through to expansion
});
```

**结果：**
- `continue` — 原样放行（handler 不返回内容时的默认行为）
- `transform` — 修改文本/图片，然后继续进入展开流程
- `handled` — 完全跳过 agent（第一个返回该值的 handler 生效）

transform 会在多个 handler 之间链式传递。感知 `streamingBehavior` 的路由参见 [input-transform.ts](../examples/extensions/input-transform.ts) 和 [input-transform-streaming.ts](../examples/extensions/input-transform-streaming.ts)。

## ExtensionContext

所有 handler 都会收到 `ctx: ExtensionContext`。

### ctx.ui

用于用户交互的 UI 方法。完整细节参见 [自定义 UI](#custom-ui)。

### ctx.mode

当前运行 mode：`"tui"`、`"rpc"`、`"json"` 或 `"print"`。用 `ctx.mode === "tui"` 守护仅限终端的功能，例如 `custom()`、component 工厂、终端输入和直接 TUI render。

### ctx.hasUI

在 TUI 和 RPC mode 下为 `true`。在 print mode（`-p`）和 JSON mode 下为 `false`。用它守护对话框方法（`select`、`confirm`、`input`、`editor`）和即发即弃的方法（`notify`、`setStatus`、`setWidget`、`setTitle`、`setEditorText`），后者在 TUI 和 RPC mode 下都可用。RPC mode 下，某些 TUI 专属方法是 no-op 或返回默认值（参见 [rpc.md](rpc.md#extension-ui-protocol)）。

### ctx.cwd

当前工作目录。

构造项目内配置路径时，请用 `CONFIG_DIR_NAME`，不要硬编码 `.pi`。换了品牌的发行版可能用不同的配置目录名。

```typescript
import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const projectConfigPath = join(ctx.cwd, CONFIG_DIR_NAME, "my-extension.json");
    // ...
  });
}
```

### ctx.isProjectTrusted()

返回当前 session 上下文中项目级信任是否已生效。这包括临时信任决定和 CLI 信任覆盖，而不只是全局信任存储里保存的决定。

在读取只应对受信任项目生效的项目内 extension 配置之前，先用它检查。

### ctx.sessionManager

对 session 状态的只读访问。完整的 SessionManager API 和 entry 类型参见 [Session Format](session-format.md)。

对于 `tool_call`，该状态在 handler 运行前已同步到当前的 assistant 消息。并行 tool 执行模式下，仍不保证包含同一条 assistant 消息的兄弟 tool 结果。

```typescript
ctx.sessionManager.getEntries()             // All entries
ctx.sessionManager.getBranch()              // Current branch
ctx.sessionManager.buildContextEntries()    // Active branch entries with compaction applied
ctx.sessionManager.getLeafId()              // Current leaf entry ID
```

### ctx.modelRegistry / ctx.model / ctx.thinkingLevel / ctx.scopedModels

访问模型、provider 和已解析的认证信息。`ctx.modelRegistry.getProvider(id)` 返回生效的 pi-ai provider；`getProviderAuth(id)` 会解析它当前的 API key、header、base URL 和 provider 范围的环境，且不需要加载模型。`ctx.model` 是活动模型，`ctx.thinkingLevel` 是它当前生效的 thinking level。

`ctx.scopedModels` 是限定到当前 session 的模型的只读列表——与 `/scoped-models` command 显示的集合相同。它在 session 开始时从 `--models` CLI flag 和 `enabledModels` 设置解析而来（用 minimatch 对 `provider/modelId` 或裸 `modelId` 与可用目录做匹配）。没有配置任何限定时为空，表示所有可用模型都可使用。每个条目是 `{ model, thinkingLevel? }`，其中 `thinkingLevel` 仅在某个模式固定了它时才有值（例如 `anthropic/*:high`）。用它填充一个与内置选择器一致的模型选择器，而不要通过 `ctx.modelRegistry.getAvailable()` 枚举整个目录。

#### 流式模型调用

需要 `reasoning` 这类 provider 中立的选项时，用 `ctx.modelRegistry.streamSimple(model, context, options)`；需要 API 特定选项则用 `stream()`。两者都使用已配置的 provider 并解析认证，包括通过 `pi.registerProvider()` 注册的 provider。请用它们代替 `pi-ai/compat` 的流式函数——后者看不到 extension 的 provider 注册。

两者都返回 `AssistantMessageEventStream`。迭代它获取响应 event，await `.result()` 得到最终消息。setup 阶段的失败会产生 error event 和 error 结果。

### ctx.signal

当前的 agent 中止 signal；没有活动的 agent turn 时为 `undefined`。

extension handler 发起的、需要感知中止的嵌套工作请用它，例如：
- `fetch(..., { signal: ctx.signal })`
- 接受 `signal` 的模型调用
- 接受 `AbortSignal` 的文件或进程辅助函数

`ctx.signal` 通常在活动的 turn event 期间有定义，例如 `tool_call`、`tool_result`、`message_update` 和 `turn_end`。
在空闲或非 turn 上下文中通常为 `undefined`，例如 session event、extension command，以及 pi 空闲时触发的 shortcut。

```typescript
pi.on("tool_result", async (event, ctx) => {
  const response = await fetch("https://example.com/api", {
    method: "POST",
    body: JSON.stringify(event),
    signal: ctx.signal,
  });

  const data = await response.json();
  return { details: data };
});
```

### ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()

控制流辅助方法。当 Pi 正在处理 agent run、自动重试、自动 compaction 重试或排队续跑时，`ctx.isIdle()` 为 false。

### ctx.shutdown()

请求优雅关闭 pi。

- **交互模式：** 推迟到 agent 空闲之后（处理完所有排队的 steering 和 follow-up 消息之后）。
- **RPC 模式：** 推迟到下一个空闲状态（完成当前 command 响应之后、等待下一条 command 时）。
- **Print 模式：** no-op。所有 prompt 处理完毕后进程自动退出。

退出前向所有 extension 发出 `session_shutdown` event。在所有上下文中都可用（event handler、tool、command、shortcut）。

```typescript
pi.on("tool_call", (event, ctx) => {
  if (isFatal(event.input)) {
    ctx.shutdown();
  }
});
```

### ctx.getContextUsage()

返回活动模型的当前上下文用量。优先使用最近一次 assistant usage（如果有），否则对末尾消息估算 token。

```typescript
const usage = ctx.getContextUsage();
if (usage && usage.tokens > 100_000) {
  // ...
}
```

### ctx.compact()

触发 compaction 但不等待其完成。后续处理用 `onComplete` 和 `onError`。

```typescript
ctx.compact({
  customInstructions: "Focus on recent changes",
  onComplete: (result) => {
    ctx.ui.notify("Compaction completed", "info");
  },
  onError: (error) => {
    ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
  },
});
```

### ctx.getSystemPrompt()

返回 Pi 当前的 system prompt 字符串。

- 在 `before_agent_start` 期间，它反映当前 turn 到目前为止的链式 system prompt 修改。
- 不包含之后 `context` 对消息的修改。
- 不包含 `before_provider_request` 对 payload 的重写。
- 如果后加载的 extension 在你的之后运行，它们仍可能改变最终发送的内容。

```typescript
pi.on("before_agent_start", (event, ctx) => {
  const prompt = ctx.getSystemPrompt();
  console.log(`System prompt length: ${prompt.length}`);
});
```

## ExtensionCommandContext

command handler 收到的是 `ExtensionCommandContext`，它在 `ExtensionContext` 的基础上增加了 session 控制方法。这些方法只在 command 中可用，因为从 event handler 里调用可能死锁。

### ctx.getSystemPromptOptions()

返回 Pi 当前用于构建 system prompt 的基础输入。

```typescript
const options = ctx.getSystemPromptOptions();
const contextPaths = options.contextFiles?.map((file) => file.path) ?? [];
```

它的形状和可变性都与 `before_agent_start` 的 `event.systemPromptOptions` 相同：自定义 prompt、活动 tool、tool 片段、prompt guideline、追加的 system prompt 文本、cwd、已加载的上下文文件和已加载的 skill。它可能包含完整的上下文文件内容，因此请把它当作 extension 本地的敏感数据，避免通过 command 列表、日志或自动补全元数据暴露它。

它报告的是当前的基础 prompt 输入。不包含每轮 `before_agent_start` 的链式 system prompt 修改、后续 `context` event 对消息的修改，也不包含 `before_provider_request` 对 payload 的重写。

### ctx.waitForIdle()

等待 agent 完全稳定下来，包括自动重试、自动 compaction 重试和排队续跑：

```typescript
pi.registerCommand("my-cmd", {
  handler: async (args, ctx) => {
    await ctx.waitForIdle();
    // Agent is now idle, safe to modify session
  },
});
```

### ctx.newSession(options?)

创建新 session：

```typescript
const parentSession = ctx.sessionManager.getSessionFile();
const kickoff = "Continue in the replacement session";

const result = await ctx.newSession({
  parentSession,
  setup: async (sm) => {
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Context from previous session..." }],
      timestamp: Date.now(),
    });
  },
  withSession: async (ctx) => {
    // Use only the replacement-session ctx here.
    await ctx.sendUserMessage(kickoff);
  },
});

if (result.cancelled) {
  // An extension cancelled the new session
}
```

选项：
- `parentSession`：记录到新 session header 里的父 session 文件
- `setup`：在 `withSession` 运行前修改新 session 的 `SessionManager`
- `withSession`：针对全新的替换 session 上下文运行切换后的工作。不要使用捕获的旧 `pi` / command `ctx`；参见 [Session 替换生命周期与常见陷阱](#session-replacement-lifecycle-and-footguns)。

### ctx.fork(entryId, options?)

从指定 entry fork，创建新的 session 文件：

```typescript
const result = await ctx.fork("entry-id-123", {
  withSession: async (ctx) => {
    // Use only the replacement-session ctx here.
    ctx.ui.notify("Now in the forked session", "info");
  },
});
if (result.cancelled) {
  // An extension cancelled the fork
}

const cloneResult = await ctx.fork("entry-id-456", { position: "at" });
if (cloneResult.cancelled) {
  // An extension cancelled the clone
}
```

选项：
- `position`：`"before"`（默认）在选中的 user 消息之前 fork，并把该 prompt 恢复到编辑器里
- `position`：`"at"` 复制经过所选 entry 的活动路径，不恢复编辑器文本
- `withSession`：针对全新的替换 session 上下文运行切换后的工作。不要使用捕获的旧 `pi` / command `ctx`；参见 [Session 替换生命周期与常见陷阱](#session-replacement-lifecycle-and-footguns)。

### ctx.navigateTree(targetId, options?)

导航到 session 树中的另一个位置。当 agent 响应、手动或自动 compaction、或另一次树导航正在进行时会 reject，即使传了 `summarize: false`。这些冲突不会改变活动分支，并以 reject promise 的方式失败，而不是返回 `{ cancelled: true }`。等活动的操作结束（例如在 command handler 里 `await ctx.waitForIdle()`）再重试：

```typescript
const result = await ctx.navigateTree("entry-id-456", {
  summarize: true,
  customInstructions: "Focus on error handling changes",
  replaceInstructions: false, // true = replace default prompt entirely
  label: "review-checkpoint",
});
```

选项：
- `summarize`：是否为被放弃的分支生成摘要
- `customInstructions`：给摘要器的自定义指令
- `replaceInstructions`：为 true 时，`customInstructions` 完全替换默认 prompt，而不是追加
- `label`：附加到分支摘要 entry（不做摘要时附加到目标 entry）的标签

### ctx.switchSession(sessionPath, options?)

切换到另一个 session 文件：

```typescript
const result = await ctx.switchSession("/path/to/session.jsonl", {
  withSession: async (ctx) => {
    await ctx.sendUserMessage("Resume work in the replacement session");
  },
});
if (result.cancelled) {
  // An extension cancelled the switch via session_before_switch
}
```

选项：
- `withSession`：针对全新的替换 session 上下文运行切换后的工作。不要使用捕获的旧 `pi` / command `ctx`；参见 [Session 替换生命周期与常见陷阱](#session-replacement-lifecycle-and-footguns)。

要发现可用的 session，用静态方法 `SessionManager.list()` 或 `SessionManager.listAll()`：

```typescript
import { SessionManager } from "@earendil-works/pi-coding-agent";

pi.registerCommand("switch", {
  description: "Switch to another session",
  handler: async (args, ctx) => {
    const sessions = await SessionManager.list(ctx.cwd);
    if (sessions.length === 0) return;
    const choice = await ctx.ui.select(
      "Pick session:",
      sessions.map(s => s.file),
    );
    if (choice) {
      await ctx.switchSession(choice, {
        withSession: async (ctx) => {
          ctx.ui.notify("Switched session", "info");
        },
      });
    }
  },
});
```

<a id="session-replacement-lifecycle-and-footguns"></a>

### Session 替换生命周期与常见陷阱

`withSession` 收到一个全新的 `ReplacedSessionContext`，它在 `ExtensionCommandContext` 的基础上增加了绑定到替换 session 的异步 `sendMessage()` 和 `sendUserMessage()` 辅助方法。

生命周期与陷阱：
- `withSession` 只在旧 session 已发出 `session_shutdown`、旧运行时已拆除、替换 session 已重新绑定、且新 extension 实例已收到 `session_start` 之后才运行。
- 回调仍在原来的闭包里执行，而不是在新 extension 实例内部。也就是说，你的旧 extension 实例可能在 `withSession` 开始之前就已执行完 shutdown 清理。
- 被捕获的旧 `pi` / 旧 command `ctx` 等 session 绑定对象在替换后已失效，使用会抛错。session 绑定的工作只用传给 `withSession` 的那个 `ctx`。
- 之前提取出来的裸对象仍由你自己负责。例如，替换前捕获了 `const sm = ctx.sessionManager`，`sm` 就还是旧的 `SessionManager` 对象。替换后不要复用它。
- `withSession` 里的代码应假设任何被你的 `session_shutdown` handler 判定失效的状态都已不存在。只捕获能干净穿越 shutdown 的纯数据，例如字符串、id 和序列化后的配置。

安全模式：

```typescript
pi.registerCommand("handoff", {
  handler: async (_args, ctx) => {
    const kickoff = "Continue from the replacement session";
    await ctx.newSession({
      withSession: async (ctx) => {
        await ctx.sendUserMessage(kickoff);
      },
    });
  },
});
```

不安全模式：

```typescript
pi.registerCommand("handoff", {
  handler: async (_args, ctx) => {
    const oldSessionManager = ctx.sessionManager;
    await ctx.newSession({
      withSession: async (_ctx) => {
        // stale old objects: do not do this
        oldSessionManager.getSessionFile();
        pi.sendUserMessage("wrong");
      },
    });
  },
});
```

### ctx.reload()

运行与 `/reload` 相同的重载流程。

```typescript
pi.registerCommand("reload-runtime", {
  description: "Reload extensions, skills, prompts, themes, and context files",
  handler: async (_args, ctx) => {
    await ctx.reload();
    return;
  },
});
```

重要行为：
- `await ctx.reload()` 会为当前 extension 运行时发出 `session_shutdown`
- 然后重新加载资源，并发出 `reason: "reload"` 的 `session_start`，以及 reason 为 `"reload"` 的 `resources_discover`
- 当前正在运行的 command handler 仍在旧的调用帧里继续
- `await ctx.reload()` 之后的代码仍以重载前的版本运行
- `await ctx.reload()` 之后的代码不得假设旧的内存中的 extension 状态仍然有效
- handler 返回之后，后续的 command/event/tool 调用使用新的 extension 版本

为了行为可预测，把 reload 当作该 handler 的终点（`await ctx.reload(); return;`）。

Tool 运行时拿到的是 `ExtensionContext`，因此不能直接调用 `ctx.reload()`。用 command 作为 reload 入口，再暴露一个 tool，把该 command 作为 follow-up user 消息排队。

LLM 可调用的触发 reload 的示例 tool：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("reload-runtime", {
    description: "Reload extensions, skills, prompts, themes, and context files",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerTool({
    name: "reload_runtime",
    label: "Reload Runtime",
    description: "Reload extensions, skills, prompts, themes, and context files",
    parameters: Type.Object({}),
    async execute() {
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return {
        content: [{ type: "text", text: "Queued /reload-runtime as a follow-up command." }],
      };
    },
  });
}
```

<a id="extensionapi-methods"></a>

## ExtensionAPI 方法

### pi.on(event, handler)

订阅 event。event 类型和返回值参见 [Events](#events)。

### pi.registerTool(definition)

注册 LLM 可调用的自定义 tool。完整细节参见 [自定义 Tool](#custom-tools)。

`pi.registerTool()` 在 extension 加载期间和启动之后都可用。你可以在 `session_start`、command handler 或其他 event handler 里调用它。新 tool 会在同一 session 内立即刷新，出现在 `pi.getAllTools()` 里并可被 LLM 调用，无需 `/reload`。

用 `pi.setActiveTools()` 在运行时启用或禁用 tool（包括动态添加的 tool）。

用 `promptSnippet` 让自定义 tool 在 `Available tools` 里占一行，用 `promptGuidelines` 在 tool 激活时向默认的 `Guidelines` 部分追加该 tool 专属的条目。

**重要：** `promptGuidelines` 条目会平铺追加到 `Guidelines` 部分，不带 tool 名称前缀。每条 guideline 都必须写明它指的是哪个 tool——避免"Use this tool when..."这种写法，因为 LLM 无法判断"this"指哪个 tool。应写成"Use my_tool when..."。

完整示例见 [dynamic-tools.ts](../examples/extensions/dynamic-tools.ts)。

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  promptSnippet: "Summarize or transform text according to action",
  promptGuidelines: ["Use my_tool when the user asks to summarize previously generated text."],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    // Optional compatibility shim. Runs before schema validation.
    // Return the current schema shape, for example to fold legacy fields
    // into the modern parameter object.
    return args;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Stream progress
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

    return {
      content: [{ type: "text", text: "Done" }],
      details: { result: "..." },
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

### pi.sendMessage(message, options?)

向 session 注入自定义消息。自定义消息参与 LLM 上下文。对于不应发送给 LLM、只在 TUI 展示的持久内容，用 [`pi.appendEntry()`](#piappendentrycustomtype-data) 配合 [`pi.registerEntryRenderer()`](#piregisterentryrenderercustomtype-renderer)。

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, {
  triggerTurn: true,
  deliverAs: "steer",
});
```

**选项：**
- `deliverAs` - 投递 mode：
  - `"steer"`（默认）- 流式期间把消息排队。在当前 assistant turn 执行完 tool 调用之后、下一次 LLM 调用之前投递。
  - `"followUp"` - 等 agent 完成。只在 agent 没有更多 tool 调用时投递。
  - `"nextTurn"` - 排队到下一次用户 prompt。不打断、不触发任何东西。
- `triggerTurn: true` - agent 空闲时立即触发一次 LLM 响应。只对 `"steer"` 和 `"followUp"` mode 生效（对 `"nextTurn"` 忽略）。

### pi.sendUserMessage(content, options?)

向 agent 发送 user 消息。与发送自定义消息的 `sendMessage()` 不同，这里发送的是真实的 user 消息，看起来就像用户亲手输入的一样。总是触发一个 turn。

```typescript
// Simple text message
pi.sendUserMessage("What is 2+2?");

// With content array (text + images)
pi.sendUserMessage([
  { type: "text", text: "Describe this image:" },
  { type: "image", source: { type: "base64", mediaType: "image/png", data: "..." } },
]);

// During streaming - must specify delivery mode
pi.sendUserMessage("Focus on error handling", { deliverAs: "steer" });
pi.sendUserMessage("And then summarize", { deliverAs: "followUp" });

// Opt in to extension command dispatch and skill/prompt template expansion
pi.sendUserMessage("/review src/index.ts", { expandPromptTemplates: true });
```

**选项：**
- `deliverAs` - agent 正在流式输出时必填：
  - `"steer"` - 把消息排队，在当前 assistant turn 执行完 tool 调用后投递
  - `"followUp"` - 等 agent 完成所有 tool
- `expandPromptTemplates` - 分发 extension command，并展开 skill command 和 prompt 模板。默认 `false`。

未在流式时，消息立即发送并触发新 turn。流式时未传 `deliverAs` 会抛错。

完整示例见 [send-user-message.ts](../examples/extensions/send-user-message.ts)。

### pi.appendEntry(customType, data?)

持久化 extension 数据。自定义 entry 不参与 LLM 上下文。交互模式下，配合 `pi.registerEntryRenderer()` 还能在聊天记录里 render。

```typescript
pi.appendEntry("my-state", { count: 42 });
pi.appendEntry("status-card", { title: "Indexed files", count: 17 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "my-state") {
      // Reconstruct from entry.data
    }
  }
});
```

### pi.setSessionName(name)

设置 session 显示名称（显示在 session 选择器里，取代第一条消息）。

```typescript
pi.setSessionName("Refactor auth module");
```

### pi.getSessionName()

获取当前 session 名称（如果设置过）。

```typescript
const name = pi.getSessionName();
if (name) {
  console.log(`Session: ${name}`);
}
```

### pi.setLabel(entryId, label)

设置或清除 entry 上的标签。标签是用户定义的标记，用于收藏和导航（显示在 `/tree` 选择器里）。

```typescript
// Set a label
pi.setLabel(entryId, "checkpoint-before-refactor");

// Clear a label
pi.setLabel(entryId, undefined);

// Read labels via sessionManager
const label = ctx.sessionManager.getLabel(entryId);
```

标签持久保存在 session 里，跨重启保留。用它们标记对话树中的重要节点（turn、checkpoint）。

### pi.registerCommand(name, options)

注册 command。

如果多个 extension 注册了同名 command，pi 会全部保留，并按加载顺序分配数字调用后缀，例如 `/review:1` 和 `/review:2`。

```typescript
pi.registerCommand("stats", {
  description: "Show session statistics",
  handler: async (args, ctx) => {
    const count = ctx.sessionManager.getEntries().length;
    ctx.ui.notify(`${count} entries`, "info");
  }
});
```

可选：为 `/command ...` 添加参数自动补全：

```typescript
import type { AutocompleteItem } from "@earendil-works/pi-tui";

pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
    const envs = ["dev", "staging", "prod"];
    const items = envs.map((e) => ({ value: e, label: e }));
    const filtered = items.filter((i) => i.value.startsWith(prefix));
    return filtered.length > 0 ? filtered : null;
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying: ${args}`, "info");
  },
});
```

### pi.getCommands()

获取当前 session 中可通过 `prompt` 调用的 slash command。包括 extension command、prompt 模板和 skill command。
列表顺序与 RPC `get_commands` 一致：extension 在前，然后是模板，然后是 skill。

```typescript
const commands = pi.getCommands();
const bySource = commands.filter((command) => command.source === "extension");
const userScoped = commands.filter((command) => command.sourceInfo.scope === "user");
```

每个条目的形状如下：

```typescript
{
  name: string; // Invokable command name without the leading slash. May be suffixed like "review:1"
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}
```

请把 `sourceInfo` 当作规范的来源字段。不要从 command 名称或临时的路径解析来推断归属。

内置交互 command（如 `/model` 和 `/settings`）不包含在这里。它们只在交互模式下处理，通过 `prompt` 发送不会执行。

### pi.registerMessageRenderer(customType, renderer)

为带有你的 `customType` 的自定义消息注册自定义 TUI renderer。自定义消息通过 `pi.sendMessage()` 创建，参与 LLM 上下文。参见 [自定义 UI](#custom-ui)。

### pi.registerMarkdownTransformer(transformer)

为普通 user 文本、assistant 文本和 thinking 块中的 Markdown 注册 transformer。transformer 按 extension 加载顺序运行，每个 transformer 收到的是上一个 transformer 返回的 Markdown。链条结束后，Pi 用内置 renderer render 转换后的内容。

transformer 收到 Markdown 字符串和一个包含以下字段的上下文：

- `messageType` — `"user"`、`"assistant"` 或 `"assistant-thinking"`
- `isStreaming` — assistant 部分更新时为 `true`；user 消息、定稿的 assistant 消息和恢复的消息为 `false`
- `availableWidth` — 转换后的 Markdown 内容可用的精确终端列数

返回转换后的 Markdown：

```typescript
pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
  if (isStreaming || messageType === "assistant-thinking") return markdown;
  return markdown.replaceAll("-->", "→");
});
```

如果某个 transformer 抛错，Pi 保留到目前为止生成的 Markdown，并继续下一个 transformer。该 hook 只影响显示：原始消息在 session 和模型上下文中保持不变。它会在新 user 消息、assistant 流式更新、恢复的 session 消息以及终端宽度变化时运行，因此 transformer 应保持同步且开销小。

### pi.registerEntryRenderer(customType, renderer)

为带有你的 `customType` 的自定义 entry 注册自定义 TUI renderer。自定义 entry 通过 `pi.appendEntry()` 创建，不参与 LLM 上下文。

```typescript
import { Box, Text } from "@earendil-works/pi-tui";

pi.registerEntryRenderer("status-card", (entry, { expanded }, theme) => {
  const data = entry.data as { title: string; count: number };
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(`${theme.bold(data.title)}: ${data.count}`));
  if (expanded) {
    box.addChild(new Text(theme.fg("dim", JSON.stringify(data, null, 2))));
  }
  return box;
});

pi.appendEntry("status-card", { title: "Indexed files", count: 17 });
```

### pi.registerShortcut(shortcut, options)

注册键盘 shortcut。shortcut 格式和内置快捷键参见 [keybindings.md](keybindings.md)。

```typescript
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    ctx.ui.notify("Toggled!");
  },
});
```

### pi.registerFlag(name, options)

注册 CLI flag。

```typescript
pi.registerFlag("plan", {
  description: "Start in plan mode",
  type: "boolean",
  default: false,
});

// Check value
if (pi.getFlag("plan")) {
  // Plan mode enabled
}
```

### pi.exec(command, args, options?)

执行 shell command。

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

管理活动 tool。这对内置 tool 和动态注册的 tool 都有效。`pi.getActiveTools()` 以 `string[]` 返回活动 tool 名称；`pi.getAllTools()` 返回所有已配置 tool 的元数据。

```typescript
const active = pi.getActiveTools(); // ["read", "bash", ...]
const all = pi.getAllTools();
// all = [{
//   name: "read",
//   description: "Read file contents...",
//   parameters: ...,
//   promptGuidelines: ["Use read to examine files instead of cat or sed."],
//   sourceInfo: { path: "<builtin:read>", source: "builtin", scope: "temporary", origin: "top-level" }
// }, ...]
const builtinTools = all.filter((t) => t.sourceInfo.source === "builtin");
const extensionTools = all.filter((t) => t.sourceInfo.source !== "builtin" && t.sourceInfo.source !== "sdk");
pi.setActiveTools([...new Set([...active, "my_custom_tool"])]); // Keep current tools and enable my_custom_tool
pi.setActiveTools(["read", "bash"]); // Switch to read-only
```

`pi.getAllTools()` 返回 `name`、`description`、`parameters`、`promptGuidelines` 和 `sourceInfo`。

常见的 `sourceInfo.source` 取值：
- `builtin` 表示内置 tool
- `sdk` 表示通过 `createAgentSession({ customTools })` 传入的 tool
- extension 注册的 tool 则是 extension 来源元数据

### pi.setModel(model)

设置当前 session 的模型。该变化会记录进 session 历史并在恢复该 session 时还原，但不会改变新 session 使用的 `defaultProvider` 和 `defaultModel` 配置。该模型的 provider 未配置认证时返回 `false`。自定义模型配置参见 [models.md](models.md)。

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
if (model) {
  const success = await pi.setModel(model);
  if (!success) {
    ctx.ui.notify("No API key for this model", "error");
  }
}
```

### pi.getThinkingLevel() / pi.setThinkingLevel(level)

获取当前 thinking level。level 会被限制在模型能力范围内（非推理模型始终为 "off"）。变化会发出 `thinking_level_select`。

`pi.setThinkingLevel()` 改变的是当前 session 的 thinking level。该变化会记录进 session 历史并在恢复该 session 时还原，但不会改变新 session 使用的默认配置。

```typescript
const current = pi.getThinkingLevel();  // "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
pi.setThinkingLevel("high");
```

### pi.events

extension 之间通信的共享 event 总线：

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

### pi.registerProvider(name, config)

动态注册或覆盖 model provider。适用于代理、自定义端点或团队级模型配置。

在 extension 工厂函数期间进行的调用会排队，待 runner 初始化后统一应用。在此之后进行的调用——例如用户走完 setup 流程后从 command handler 发起的——立即生效，无需 `/reload`。

动态 provider 可以实现 `refreshModels`。Pi 会在模型刷新期间调用它，把返回的列表通过该 provider 同步发布，并传入规范的凭据/已存目录/网络/signal 上下文。是否通过带 generation 检查的 `context.publish({ persist: entry })` 持久化目录元数据由 extension 决定；llama.cpp 这类 live server 可以只返回模型而不持久化。

`context.signal` 始终是具体的 signal，provider 回调必须把它传给阻塞式 I/O。公开的 `ModelRuntime.refresh()` 和 `ModelRegistry.refresh()` 接受可选 signal，省略时不设上限；extension 和应用自行决定截止时间。取消能让调用方停止等待，即使 provider 忽略该 signal；但要停掉底层工作仍需对方配合。

需要原生 provider 认证、过滤、刷新或流式行为的 extension，可以注册来自 `@earendil-works/pi-ai` 的完整 `Provider`。该 provider 成为组合基底，其上的 `models.json` 覆盖仍然适用。

```typescript
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai";

const provider = createProvider({
  id: "local-server",
  name: "Local Server",
  baseUrl: "http://localhost:8080/v1",
  auth: {
    apiKey: {
      name: "Local server setup",
      async login(interaction) {
        return {
          type: "api_key",
          key: await interaction.prompt({ type: "secret", message: "API key" }),
        };
      },
      async resolve({ credential }) {
        return credential?.key
          ? { auth: { apiKey: credential.key }, source: "stored API key" }
          : undefined;
      },
    },
  },
  models: [],
  api: openAICompletionsApi(),
});

pi.registerProvider(provider);

// Register a new provider with custom models
pi.registerProvider("my-proxy", {
  name: "My Proxy",
  baseUrl: "https://proxy.example.com",
  apiKey: "$PROXY_API_KEY",  // env var reference
  api: "anthropic-messages",
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude 4 Sonnet (proxy)",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});

// Register a live llama.cpp catalog without persisting discovered models
pi.registerProvider("llama.cpp", {
  baseUrl: "http://localhost:8080/v1",
  apiKey: "local",
  api: "openai-completions",
  async refreshModels({ signal }) {
    const response = await fetch("http://localhost:8080/v1/models", { signal });
    const { data } = await response.json();
    return data.map(({ id }) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384
    }));
  }
});

// Override baseUrl for an existing provider (keeps all models)
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// Register provider with OAuth support for /login
pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",
    async login(callbacks) {
      // Custom OAuth flow
      callbacks.onAuth({ url: "https://sso.corp.com/..." });
      const code = await callbacks.onPrompt({ message: "Enter code:" });
      return { refresh: code, access: code, expires: Date.now() + 3600000 };
    },
    async refreshToken(credentials, signal) {
      signal.throwIfAborted();
      // Refresh logic
      return credentials;
    },
    getApiKey(credentials) {
      return credentials.access;
    }
  }
});
```

对象形式接受完整的 pi-ai `Provider`，包括原生 `auth`、`getModels`、`refreshModels`、`filterModels`、`stream` 和 `streamSimple` 行为。

**旧版配置选项：**
- `name` - provider 在 `/login` 等 UI 里的显示名称。
- `baseUrl` - API 端点 URL。定义模型时必填。
- `apiKey` - API key 字面量、环境变量插值（`$ENV_VAR` 或 `${ENV_VAR}`）或 `!command` 前缀。定义模型时必填（提供 `oauth` 时除外）。`$$` 转义 `$`，`$!` 转义字面量 `!` 且不触发 command 执行。
- `api` - API 类型：`"anthropic-messages"`、`"openai-completions"`、`"openai-responses"` 等。
- `headers` - 包含进请求的自定义 header。
- `authHeader` - 为 true 时自动添加 `Authorization: Bearer` header。
- `models` - 模型定义数组。提供时会替换该 provider 的所有现有模型。模型定义可以设置 `baseUrl`，为该模型覆盖 provider 端点。
- `refreshModels` - 异步动态发现回调。其返回的模型会替换 extension 提供的模型。`context.stored` 包含已持久化的 provider 快照；只有当更新后的目录数据需要持久化时才用带 generation 检查的 `context.publish({ persist: entry })`。用 `persist: null` 删除该快照。
- `oauth` - 用于支持 `/login` 的 OAuth provider 配置。提供时该 provider 会出现在登录菜单里。
- `streamSimple` - 非标准 API 的自定义流式实现。

高级主题（自定义流式 API、OAuth 细节、模型定义参考）参见 [custom-provider.md](custom-provider.md)。

### pi.unregisterProvider(name)

移除先前注册的 provider 及其模型。被该 provider 覆盖的内置模型会恢复。provider 未注册时无效果。

与 `registerProvider` 一样，在初始加载阶段之后调用立即生效，无需 `/reload`。

```typescript
pi.registerCommand("my-setup-teardown", {
  description: "Remove the custom proxy provider",
  handler: async (_args, _ctx) => {
    pi.unregisterProvider("my-proxy");
  },
});
```

<a id="state-management"></a>

## 状态管理

有状态的 extension 应把状态存进 tool 结果的 `details`，以正确支持分支：

```typescript
export default function (pi: ExtensionAPI) {
  let items: string[] = [];

  // Reconstruct state from session
  pi.on("session_start", async (_event, ctx) => {
    items = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "toolResult") {
        if (entry.message.toolName === "my_tool") {
          items = entry.message.details?.items ?? [];
        }
      }
    }
  });

  pi.registerTool({
    name: "my_tool",
    // ...
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      items.push("new item");
      return {
        content: [{ type: "text", text: "Added" }],
        details: { items: [...items] },  // Store for reconstruction
      };
    },
  });
}
```

<a id="custom-tools"></a>

## 自定义 Tool

通过 `pi.registerTool()` 注册 LLM 可调用的 tool。tool 会出现在 system prompt 里，并可以有自定义 render。

用 `promptSnippet` 在默认 system prompt 的 `Available tools` 部分占一行简短条目。省略时，自定义 tool 不会出现在该部分。

用 `promptGuidelines` 向默认 system prompt 的 `Guidelines` 部分添加 tool 专属条目。这些条目只在该 tool 激活时包含（例如执行 `pi.setActiveTools([...])` 之后）。

**重要：** `promptGuidelines` 条目会平铺追加到 `Guidelines` 部分，没有 tool 名称前缀或分组。每条 guideline 都必须写明它指的是哪个 tool——避免"Use this tool when..."这种写法，因为 LLM 无法判断"this"指哪个 tool。应写成"Use my_tool when..."。

注意：有些模型很傻，会在 tool 的路径参数里带上 @ 前缀。内置 tool 在解析路径前会去掉开头的 @。如果你的自定义 tool 接受路径，也请归一化开头的 @。

如果你的自定义 tool 会修改文件，请用 `withFileMutationQueue()`，让它与内置 `edit` 和 `write` 一样参与同一个按文件的队列。这一点很重要，因为 tool 调用默认并行执行。不排队的话，两个 tool 可能读到同一份旧文件内容、计算出不同的更新，然后谁最后写入谁就覆盖对方。

一个失败示例：你的自定义 tool 修改 `foo.ts`，而内置 `edit` 在同一个 assistant turn 里也改了 `foo.ts`。如果你的 tool 不参与队列，两者都可能读到原始的 `foo.ts`、各自应用修改，然后其中一份修改就丢了。

把真实的目标文件路径传给 `withFileMutationQueue()`，而不是原始的用户参数。先解析为绝对路径（相对于 `ctx.cwd` 或你的 tool 的工作目录）。对已存在的文件，该辅助函数会通过 `realpath()` 规范化，因此指向同一文件的符号链接别名共享一个队列。对新文件，因为还没有可 `realpath()` 的东西，回退为解析后的绝对路径。

把整个修改窗口都在该目标路径上排队。这包括读-改-写逻辑，不只是最后那一次写入。

```typescript
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const absolutePath = resolve(ctx.cwd, params.path);

  return withFileMutationQueue(absolutePath, async () => {
    await mkdir(dirname(absolutePath), { recursive: true });
    const current = await readFile(absolutePath, "utf8");
    const next = current.replace(params.oldText, params.newText);
    await writeFile(absolutePath, next, "utf8");

    return {
      content: [{ type: "text", text: `Updated ${params.path}` }],
      details: {},
    };
  });
}
```

### Tool 定义

```typescript
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  promptSnippet: "List or add items in the project todo list",
  promptGuidelines: [
    "Use my_tool for todo planning instead of direct file edits when the user asks for a task list."
  ],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google compatibility
    text: Type.Optional(Type.String()),
  }),
  prepareArguments(args) {
    if (!args || typeof args !== "object") return args;
    const input = args as { action?: string; oldAction?: string };
    if (typeof input.oldAction === "string" && input.action === undefined) {
      return { ...input, action: input.oldAction };
    }
    return args;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Check for cancellation
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    // Run commands via pi.exec (captured from extension closure)
    const result = await pi.exec("some-command", [], { signal });

    // Return result
    return {
      content: [{ type: "text", text: "Done" }],  // Sent to LLM
      details: { data: result },                   // For rendering & state
      // usage: nestedModelResponse.usage,          // Optional nested LLM usage
      // Optional: stop after this tool batch when every finalized tool result
      // in the batch also returns terminate: true.
      terminate: true,
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme, context) { ... },
  renderResult(result, options, theme, context) { ... },
});
```

**用量统计：** 如果 tool 内部发起了嵌套 LLM 调用，把合计的 `Usage` 作为 `usage` 返回。Pi 会把它持久化到 tool 结果上，并计入 footer、`/session` 和 RPC 的 session 总量。`tool_result` handler 可以检查或替换该值。

**错误信号：** 要把一次 tool 执行标记为失败（在结果上设置 `isError: true` 并报告给 LLM），请在 `execute` 里抛错。返回值永远不会设置错误标志，无论你在返回对象里放了什么属性。

**提前终止：** 从 `execute()` 返回 `terminate: true`，提示当前 tool 批次之后应跳过自动的后续 LLM 调用。只有当批次里每个定稿的 tool 结果都是 terminating 时才生效。最简示例（agent 在最终的 structured-output tool 调用后结束）见 [examples/extensions/structured-output.ts](../examples/extensions/structured-output.ts)。

```typescript
// Correct: throw to signal an error
async execute(toolCallId, params) {
  if (!isValid(params.input)) {
    throw new Error(`Invalid input: ${params.input}`);
  }
  return { content: [{ type: "text", text: "OK" }], details: {} };
}
```

**重要：** 字符串枚举请用来自 `@earendil-works/pi-ai` 的 `StringEnum`。`Type.Union`/`Type.Literal` 在 Google 的 API 上不工作。

**参数准备：** `prepareArguments(args)` 是可选的。如果定义了，它会在 schema 校验之前、`execute()` 之前运行。当 pi 恢复一个旧 session、其中保存的 tool 调用参数与当前 schema 不匹配时，可以用它模拟旧版接受的输入形状。返回你想让它针对 `parameters` 校验的对象。保持公开 schema 严格。不要为了兼容旧的恢复 session 而往 `parameters` 里加已弃用的兼容字段。

示例：旧 session 里可能有一个带顶层 `oldText` 和 `newText` 的 `edit` tool 调用，而当前 schema 只接受 `edits: [{ oldText, newText }]`。

```typescript
pi.registerTool({
  name: "edit",
  label: "Edit",
  description: "Edit a single file using exact text replacement",
  parameters: Type.Object({
    path: Type.String(),
    edits: Type.Array(
      Type.Object({
        oldText: Type.String(),
        newText: Type.String(),
      }),
    ),
  }),
  prepareArguments(args) {
    if (!args || typeof args !== "object") return args;

    const input = args as {
      path?: string;
      edits?: Array<{ oldText: string; newText: string }>;
      oldText?: unknown;
      newText?: unknown;
    };

    if (typeof input.oldText !== "string" || typeof input.newText !== "string") {
      return args;
    }

    return {
      ...input,
      edits: [...(input.edits ?? []), { oldText: input.oldText, newText: input.newText }],
    };
  },
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // params now matches the current schema
    return {
      content: [{ type: "text", text: `Applying ${params.edits.length} edit block(s)` }],
      details: {},
    };
  },
});
```

### 覆盖内置 tool

Extension 可以通过注册同名 tool 来覆盖内置 tool（`read`、`bash`、`powershell`、`edit`、`write`、`grep`、`find`、`ls`）。发生覆盖时，交互模式会显示警告。

```bash
# Extension's read tool replaces built-in read
pi -e ./tool-override.ts
```

也可以用 `--no-builtin-tools` 在没有任何内置 tool 的情况下启动，同时保留 extension tool：
```bash
# No built-in tools, only extension tools
pi --no-builtin-tools -e ./my-extension.ts
```

覆盖 `read` 并加入日志和访问控制的完整示例见 [examples/extensions/tool-override.ts](../examples/extensions/tool-override.ts)。

**Render：** 内置 renderer 的继承按槽位解析。执行覆盖与 render 覆盖相互独立。如果你的覆盖省略了 `renderCall`，使用内置的 `renderCall`；省略了 `renderResult`，使用内置的 `renderResult`；两者都省略，则自动使用内置 renderer（语法高亮、diff 等）。这样你可以只为日志或访问控制包装内置 tool，而无需重写 UI。

**Prompt 元数据：** `promptSnippet` 和 `promptGuidelines` 不会从内置 tool 继承。如果你的覆盖需要保留这些 prompt 指令，请在覆盖里显式定义。

**你的实现必须匹配完全一致的结果形状**，包括 `details` 类型。UI 和 session 逻辑依赖这些形状做 render 和状态跟踪。

内置 tool 实现：
- [read.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts) - `ReadToolDetails`
- [bash.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts) - `BashToolDetails`
- [powershell.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/powershell.ts) - `PowerShellToolDetails`
- [edit.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit.ts)
- [write.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/write.ts)
- [grep.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/grep.ts) - `GrepToolDetails`
- [find.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/find.ts) - `FindToolDetails`
- [ls.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/ls.ts) - `LsToolDetails`

### 远程执行

内置 tool 支持可插拔的 operations，可以委托给远程系统（SSH、容器等）：

```typescript
import { createReadTool, createBashTool, type ReadOperations } from "@earendil-works/pi-coding-agent";

// Create tool with custom operations
const remoteRead = createReadTool(cwd, {
  operations: {
    readFile: (path) => sshExec(remote, `cat ${path}`),
    access: (path) => sshExec(remote, `test -r ${path}`).then(() => {}),
  }
});

// Register, checking flag at execution time
pi.registerTool({
  ...remoteRead,
  async execute(id, params, signal, onUpdate, _ctx) {
    const ssh = getSshConfig();
    if (ssh) {
      const tool = createReadTool(cwd, { operations: createRemoteOps(ssh) });
      return tool.execute(id, params, signal, onUpdate);
    }
    return localRead.execute(id, params, signal, onUpdate);
  },
});
```

**Operations 接口：** `ReadOperations`、`WriteOperations`、`EditOperations`、`BashOperations`、`PowerShellOperations`、`LsOperations`、`GrepOperations`、`FindOperations`

对于 `user_bash`，extension 可以通过 `createLocalBashOperations()` 复用 pi 的本地 shell 后端，而不用重新实现本地进程启动、shell 解析和进程树终止。

`bash` 和 `powershell` tool 还支持 spawn hook，在执行前调整 command、cwd 或 env：

```typescript
import { createBashTool } from "@earendil-works/pi-coding-agent";

const bashTool = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: `source ~/.profile\n${command}`,
    cwd: `/mnt/sandbox${cwd}`,
    env: { ...env, CI: "1" },
  }),
});
```

`createBashTool()` 和 `createPowerShellTool()` 通过 `PI_SESSION_ID`、`PI_SESSION_FILE`、`PI_PROVIDER`、`PI_MODEL` 和 `PI_REASONING_LEVEL` 向 command 暴露当前 session。注入发生在 `spawnHook` 之前，因此 hook 会在 `env` 里收到这些值，并在像上面那样展开现有环境时保留它们。设置 `exposeSessionEnvironment: false` 可禁用：

```typescript
const bashTool = createBashTool(cwd, {
  exposeSessionEnvironment: false,
});
```

变量语义参见 [Shell tool session environment](environment-variables.md#shell-tool-session-environment)。带 `--ssh` flag 的完整 SSH 示例见 [examples/extensions/ssh.ts](../examples/extensions/ssh.ts)。

### 输出截断

**tool 必须截断输出**，以免撑爆 LLM 上下文。过大的输出会导致：
- 上下文溢出错误（prompt 太长）
- compaction 失败
- 模型性能下降

内置上限是 **50KB**（约 1 万 token）和 **2000 行**，先到先算。使用导出的截断工具：

```typescript
import {
  truncateHead,      // Keep first N lines/bytes (good for file reads, search results)
  truncateTail,      // Keep last N lines/bytes (good for logs, command output)
  truncateLine,      // Truncate a single line to maxBytes with ellipsis
  formatSize,        // Human-readable size (e.g., "50KB", "1.5MB")
  DEFAULT_MAX_BYTES, // 50KB
  DEFAULT_MAX_LINES, // 2000
} from "@earendil-works/pi-coding-agent";

async execute(toolCallId, params, signal, onUpdate, ctx) {
  const output = await runCommand();

  // Apply truncation
  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let result = truncation.content;

  if (truncation.truncated) {
    // Write full output to temp file
    const tempFile = writeTempFile(output);

    // Inform the LLM where to find complete output
    result += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
    result += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
    result += ` Full output saved to: ${tempFile}]`;
  }

  return { content: [{ type: "text", text: result }] };
}
```

**要点：**
- 开头重要的内容（搜索结果、文件读取）用 `truncateHead`
- 结尾重要的内容（日志、command 输出）用 `truncateTail`
- 输出被截断时务必告知 LLM，并说明完整版本在哪里
- 在 tool 的 description 里写明截断限制

用正确截断包装 `rg`（ripgrep）的完整示例见 [examples/extensions/truncated-tool.ts](../examples/extensions/truncated-tool.ts)。

### 多个 tool

一个 extension 可以注册多个共享状态的 tool：

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;

  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });

  pi.on("session_shutdown", async () => {
    connection?.close();
  });
}
```

### 自定义 render

Tool 可以提供 `renderCall` 和 `renderResult` 来自定义 TUI 展示。完整的 component API 参见 [tui.md](tui.md)；tool 行如何组装参见 [tool-execution.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/tool-execution.ts)。

默认情况下，tool 输出包裹在一个处理 padding 和背景的 `Box` 里。定义了 `renderCall` 或 `renderResult` 时必须返回 `Component`。某个槽位的 renderer 未定义时，`tool-execution.ts` 对该槽位使用回退 render。

当 tool 需要 render 自己的外壳而不是使用默认 `Box` 时，设置 `renderShell: "self"`。适用于需要对边框或背景行为有完全控制权的 tool，例如 tool 定稿后必须保持视觉稳定的大预览。

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Custom shell example",
  parameters: Type.Object({}),
  renderShell: "self",
  async execute() {
    return { content: [{ type: "text", text: "ok" }], details: undefined };
  },
  renderCall(args, theme, context) {
    return new Text(theme.fg("accent", "my custom shell"), 0, 0);
  },
});
```

`renderCall` 和 `renderResult` 各自收到一个 `context` 对象，包含：
- `args` - 当前 tool 调用参数
- `state` - 跨 `renderCall` 和 `renderResult` 共享的行内局部状态
- `lastComponent` - 该槽位上一次返回的 component（如果有）
- `invalidate()` - 请求重 render 该 tool 行
- `toolCallId`、`cwd`、`executionStarted`、`argsComplete`、`isPartial`、`expanded`、`showImages`、`isError`

跨槽位共享状态用 `context.state`。想在多次 render 之间复用并修改同一个 component 实例时，把槽位局部缓存保存在返回的 component 实例上。

#### renderCall

render tool 调用或标题：

```typescript
import { Text } from "@earendil-works/pi-tui";

renderCall(args, theme, context) {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  let content = theme.fg("toolTitle", theme.bold("my_tool "));
  content += theme.fg("muted", args.action);
  if (args.text) {
    content += " " + theme.fg("dim", `"${args.text}"`);
  }
  text.setText(content);
  return text;
}
```

#### renderResult

render tool 结果或输出：

```typescript
renderResult(result, { expanded, isPartial }, theme, context) {
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  if (result.details?.error) {
    return new Text(theme.fg("error", `Error: ${result.details.error}`), 0, 0);
  }

  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }
  return new Text(text, 0, 0);
}
```

如果某个槽位刻意没有可见内容，返回空的 `Component`，例如空的 `Container`。

#### 快捷键提示

用 `keyHint()` 显示遵循当前快捷键配置的键位提示：

```typescript
import { keyHint } from "@earendil-works/pi-coding-agent";

renderResult(result, { expanded }, theme, context) {
  let text = theme.fg("success", "✓ Done");
  if (!expanded) {
    text += ` (${keyHint("app.tools.expand", "to expand")})`;
  }
  return new Text(text, 0, 0);
}
```

可用函数：
- `keyHint(keybinding, description)` - 格式化已配置的快捷键 id，例如 `"app.tools.expand"` 或 `"tui.select.confirm"`
- `keyText(keybinding)` - 返回快捷键 id 对应的原始按键文本
- `rawKeyHint(key, description)` - 格式化原始按键字符串

使用带命名空间的快捷键 id：
- coding-agent 的 id 用 `app.*` 命名空间，例如 `app.tools.expand`、`app.editor.external`、`app.session.rename`
- 共享 TUI 的 id 用 `tui.*` 命名空间，例如 `tui.select.confirm`、`tui.select.cancel`、`tui.input.tab`

快捷键 id 和默认值的完整列表参见 [keybindings.md](keybindings.md)。`keybindings.json` 用的就是这些带命名空间的 id。

自定义 editor 和 `ctx.ui.custom()` component 会收到注入的 `keybindings: KeybindingsManager` 参数。它们应直接用这个注入的 manager，而不是调用 `getKeybindings()` 或 `setKeybindings()`。

#### 最佳实践

- `Text` 使用 `(0, 0)` padding。默认 Box 已处理 padding。
- 多行内容用 `\n`。
- 处理 `isPartial` 以展示流式进度。
- 支持 `expanded` 以按需展开细节。
- 默认视图保持紧凑。
- 在 `renderResult` 里读取 `context.args`，不要把 args 复制进 `context.state`。
- `context.state` 只用于必须跨 call 和 result 槽位共享的数据。
- 同一个 component 实例可以原地更新时，复用 `context.lastComponent`。
- 只在默认的盒子外壳碍事时才用 `renderShell: "self"`。self-shell 模式下，边框、padding 和背景都由 tool 自己负责。

#### 回退

槽位 renderer 未定义或抛错时：
- `renderCall`：显示 tool 名称
- `renderResult`：显示 `content` 里的原始文本

<a id="dynamic-tool-loading"></a>

### 动态 Tool 加载

Extension 可以注册大量 tool，同时只保持少量初始激活集。tool 可以在执行期间用 `pi.setActiveTools()` 添加更多 tool。Pi 会检测纯增量变化，在该 tool 结果上记录新可用的 tool 名称，并在下一次模型请求前应用更新后的激活集。

这对所有模型都有效。支持原生延迟加载的模型会保持稳定的 prompt 前缀，并在 tool 结果位置加载新定义。其他模型使用下述回退方案。

生命周期如下：

1. 用 `pi.registerTool()` 注册所有 tool，使其出现在 `pi.getAllTools()` 里。
2. 保持 loader tool（例如 `search_tools`）激活，可被搜索的 tool 保持未激活。
3. 在 loader 执行期间，调用 `pi.setActiveTools([...currentTools, ...matchingTools])`。变化必须是增量的：同一次调用里不要移除当前激活的 tool。
4. Pi 在 loader 的 tool 结果上记录添加了哪些 tool。
5. 下一次模型响应之前，Pi 在支持原生延迟加载时用它暴露新增定义，否则使用常规激活 tool 列表。

你不需要返回 provider 特定的 tool 引用，也不需要把 loader 标记为特殊的搜索 tool。激活集变化本身就是信号。传给 `pi.setActiveTools()` 的名称必须已注册；未知名称会被忽略。

#### 支持原生延迟加载的模型

- **Anthropic**
  - **模型：** Sonnet、Opus、Fable 4.5 或更新版本（不含 Haiku）
  - **原生表示：** 延迟定义使用 `defer_loading`；加载点使用 `tool_reference` 内容。
- **Fireworks Messages API**
  - **原生表示：** 延迟定义使用 `defer_loading`；加载点使用 `tool_reference` 内容。
  - **Loader 名称：** 前缀延迟使用 `ToolSearch` 或 `tool_search`。其他 loader 名称也能工作，但 Fireworks 会把已加载的 schema 放进初始 tool 前缀，失去缓存收益。
  - 这不改变 API 路由：Fireworks 的 GLM 模型和 Kimi K3 走 Chat Completions，而不是 Messages。
- **OpenAI**
  - **模型：** `gpt-5.4` 及更新的家族
  - **原生表示：** Pi 在加载点添加完整的客户端 `tool_search_call` 和 `tool_search_output` 项。

对经过验证的自定义模型或代理，可以用 `anthropic-messages` 的 `compat.supportsToolReferences: true`，或 `openai-responses` 与 `openai-codex-responses` 的 `compat.supportsToolSearch: true` 启用原生处理。除非端点和模型确实接受相应的原生协议，否则保持禁用。

#### 回退行为

对其他所有模型和 provider，动态激活仍然有效：Pi 在下一次请求里正常发送完整的当前激活 tool 列表。模型可以调用新激活的 tool，但添加定义可能使 provider 缓存的 prompt 前缀失效。

当激活集不是纯增量时（例如用一组 tool 替换另一组），Pi 也使用这个安全回退。因此移除 tool 也能工作，只是不使用延迟加载。

为了获得最佳缓存行为，让 loader tool 在整个 session 里保持激活，并且只添加而不是替换激活集。另请注意，激活带 `promptSnippet` 或 `promptGuidelines` 的 tool 会重建 system prompt；即使 provider 支持延迟 schema，这种 system prompt 变化也可能使前缀失效。延迟加载的 tool 通常应只依赖 tool 的 `description`，省略仅激活时才有的 prompt 元数据。

#### 搜索 tool 示例

下面的 extension 注册了两个可被搜索的 tool，把它们移出初始激活集，只保留 `search_tools` 作为它们的 loader。示例用的是简单的关键词匹配，但搜索实现也可以用 BM25、embeddings、远程目录或项目特定的路由。

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SEARCHABLE_TOOL_NAMES = new Set(["lookup_weather", "search_issues"]);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "lookup_weather",
    label: "Lookup Weather",
    description: "Look up the current weather for a city",
    parameters: Type.Object({ city: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Weather for ${params.city}: sunny` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "search_issues",
    label: "Search Issues",
    description: "Search project issues by keyword",
    parameters: Type.Object({ query: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `No open issues matching ${params.query}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "search_tools",
    label: "Search Tools",
    description: "Search for and enable tools relevant to a task",
    promptSnippet: "Search for additional tools when the active tools cannot perform the task",
    promptGuidelines: [
      "Use search_tools when a task requires a capability that is not currently available.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Capability or task to search for" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_toolCallId, params) {
      const terms = params.query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const matches = pi.getAllTools()
        .filter((tool) => SEARCHABLE_TOOL_NAMES.has(tool.name))
        .map((tool) => ({
          tool,
          score: terms.reduce(
            (score, term) =>
              score + (`${tool.name} ${tool.description}`.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit ?? 3)
        .map((match) => match.tool.name);

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No tools found for: ${params.query}` }],
          details: { matches: [] },
        };
      }

      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);

      return {
        content: [{
          type: "text",
          text: added.length > 0
            ? `Loaded tools: ${added.join(", ")}`
            : `Matching tools already active: ${matches.join(", ")}`,
        }],
        details: { matches, added },
      };
    },
  });

  pi.on("session_start", () => {
    // Keep searchable tools registered but initially inactive. Preserve built-ins
    // and tools owned by other extensions, and keep the loader itself active.
    const initialTools = pi.getActiveTools().filter(
      (name) => !SEARCHABLE_TOOL_NAMES.has(name),
    );
    pi.setActiveTools([...new Set([...initialTools, "search_tools"])]);
  });
}
```

当 `search_tools` 添加了匹配项，模型会在紧接下来的请求里收到该定义。在原生支持的模型上，定义锚定在搜索结果之后，不改变初始 tool schema 前缀。在其他模型上，它出现在同一次下一个请求的常规 tool 列表里。

<a id="custom-ui"></a>

## 自定义 UI

Extension 可以通过 `ctx.ui` 方法与用户交互，并自定义消息/tool 的 render 方式。

**自定义 component 参见 [tui.md](tui.md)**，其中有可直接复制的模式：
- 选择对话框（SelectList）
- 可取消的异步操作（BorderedLoader）
- 设置开关（SettingsList）
- 状态指示（setStatus）
- 流式期间的工作消息、可见性和指示器（`setWorkingMessage`、`setWorkingVisible`、`setWorkingIndicator`）
- 编辑器上方/下方的 widget（setWidget）
- 叠加在内置 slash/路径补全之上的自动补全 provider（addAutocompleteProvider）
- 自定义 footer（setFooter）

### 对话框

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info");  // "info" | "warning" | "error"
```

#### 带倒计时的定时对话框

对话框支持 `timeout` 选项，会自动关闭并显示实时倒计时：

```typescript
// Dialog shows "Title (5s)" → "Title (4s)" → ... → auto-dismisses at 0
const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { timeout: 5000 }
);

if (confirmed) {
  // User confirmed
} else {
  // User cancelled or timed out
}
```

**超时时的返回值：**
- `select()` 返回 `undefined`
- `confirm()` 返回 `false`
- `input()` 返回 `undefined`

#### 使用 AbortSignal 手动关闭

需要更多控制时（例如区分超时和用户取消），用 `AbortSignal`：

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

const confirmed = await ctx.ui.confirm(
  "Timed Confirmation",
  "This dialog will auto-cancel in 5 seconds. Confirm?",
  { signal: controller.signal }
);

clearTimeout(timeoutId);

if (confirmed) {
  // User confirmed
} else if (controller.signal.aborted) {
  // Dialog timed out
} else {
  // User cancelled (pressed Escape or selected "No")
}
```

完整示例见 [examples/extensions/timed-confirm.ts](../examples/extensions/timed-confirm.ts)。

### Widget、状态与 Footer

```typescript
// Status in footer (persistent until cleared)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined);  // Clear

// Working loader (shown during streaming)
ctx.ui.setWorkingMessage("Thinking deeply...");
ctx.ui.setWorkingMessage();  // Restore default
ctx.ui.setWorkingVisible(false);  // Hide the built-in working loader row entirely
ctx.ui.setWorkingVisible(true);   // Show the built-in working loader row

// Working indicator (shown during streaming)
ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("accent", "●")] });  // Static dot
ctx.ui.setWorkingIndicator({
  frames: [
    ctx.ui.theme.fg("dim", "·"),
    ctx.ui.theme.fg("muted", "•"),
    ctx.ui.theme.fg("accent", "●"),
    ctx.ui.theme.fg("muted", "•"),
  ],
  intervalMs: 120,
});
ctx.ui.setWorkingIndicator({ frames: [] });  // Hide indicator
ctx.ui.setWorkingIndicator();  // Restore default spinner

// Widget above editor (default)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
// Widget below editor
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"], { placement: "belowEditor" });
ctx.ui.setWidget("my-widget", (tui, theme) => new Text(theme.fg("accent", "Custom"), 0, 0));
ctx.ui.setWidget("my-widget", undefined);  // Clear

// Custom footer (replaces built-in footer entirely)
ctx.ui.setFooter((tui, theme) => ({
  render(width) { return [theme.fg("dim", "Custom footer")]; },
  invalidate() {},
}));
ctx.ui.setFooter(undefined);  // Restore built-in footer

// Terminal title
ctx.ui.setTitle("pi - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();

// Paste into editor (triggers paste handling, including collapse for large content)
ctx.ui.pasteToEditor("pasted content");

// Stack custom autocomplete behavior on top of the built-in provider
ctx.ui.addAutocompleteProvider((current) => ({
  triggerCharacters: ["#"],
  async getSuggestions(lines, line, col, options) {
    const beforeCursor = (lines[line] ?? "").slice(0, col);
    const match = beforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
    if (!match) {
      return current.getSuggestions(lines, line, col, options);
    }

    return {
      prefix: `#${match[1] ?? ""}`,
      items: [{ value: "#2983", label: "#2983", description: "Extension API for autocomplete" }],
    };
  },
  applyCompletion(lines, line, col, item, prefix) {
    return current.applyCompletion(lines, line, col, item, prefix);
  },
  shouldTriggerFileCompletion(lines, line, col) {
    return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
  },
}));

// Tool output expansion
const wasExpanded = ctx.ui.getToolsExpanded();
ctx.ui.setToolsExpanded(true);
ctx.ui.setToolsExpanded(wasExpanded);

// Custom editor (vim mode, emacs mode, etc.)
ctx.ui.setEditorComponent((tui, theme, keybindings) => new VimEditor(tui, theme, keybindings));
const currentEditor = ctx.ui.getEditorComponent();
ctx.ui.setEditorComponent((tui, theme, keybindings) =>
  new WrappedEditor(tui, theme, keybindings, currentEditor?.(tui, theme, keybindings))
);
ctx.ui.setEditorComponent(undefined);  // Restore default editor

// Theme management (see themes.md for creating themes)
const themes = ctx.ui.getAllThemes();  // [{ name: "dark", path: "/..." | undefined }, ...]
const lightTheme = ctx.ui.getTheme("light");  // Load without switching
const result = ctx.ui.setTheme("light");  // Switch by name
if (!result.success) {
  ctx.ui.notify(`Failed: ${result.error}`, "error");
}
ctx.ui.setTheme(lightTheme!);  // Or switch by Theme object
ctx.ui.theme.fg("accent", "styled text");  // Access current theme
```

自定义 working-indicator 帧按原样 render。需要颜色的话，请自行加到帧字符串上，例如用 `ctx.ui.theme.fg(...)`。

### 自动补全 provider

用 `ctx.ui.addAutocompleteProvider()` 在内置 slash-command 和路径 provider 之上叠加自定义自动补全逻辑。设置 `triggerCharacters` 可以使用 `$` 这类自定义自然触发符。

典型模式：

- 检查光标前的文本
- 你的 extension 专属语法匹配时，返回自己的建议
- 否则委托给 `current.getSuggestions(...)`
- 除非需要自定义插入行为，否则委托 `applyCompletion(...)`

```typescript
pi.on("session_start", (_event, ctx) => {
  ctx.ui.addAutocompleteProvider((current) => ({
    triggerCharacters: ["#"],
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const line = lines[cursorLine] ?? "";
      const beforeCursor = line.slice(0, cursorCol);
      const match = beforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/);
      if (!match) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return {
        prefix: `#${match[1] ?? ""}`,
        items: [
          { value: "#2983", label: "#2983", description: "Extension API for registering custom @ autocomplete providers" },
          { value: "#2753", label: "#2753", description: "Reload stale resource settings" },
        ],
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  }));
});
```

完整示例见 [github-issue-autocomplete.ts](../examples/extensions/github-issue-autocomplete.ts)：它用 `gh issue list` 预加载最新的 open GitHub issue，并在本地过滤，实现快速的 `#...` 补全。需要 GitHub CLI（`gh`）和一个 GitHub 仓库 checkout。

### 自定义 Component

复杂 UI 用 `ctx.ui.custom()`。它会临时用你的 component 替换 editor，直到调用 `done()`：

```typescript
import { Text, Component } from "@earendil-works/pi-tui";

const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
  const text = new Text("Press Enter to confirm, Escape to cancel", 1, 1);

  text.onKey = (key) => {
    if (key === "return") done(true);
    if (key === "escape") done(false);
    return true;
  };

  return text;
});

if (result) {
  // User pressed Enter
}
```

回调收到：
- `tui` - TUI 实例（用于屏幕尺寸、焦点管理）
- `theme` - 用于样式的当前主题
- `keybindings` - 应用快捷键 manager（用于检查 shortcut）
- `done(value)` - 调用以关闭 component 并返回值

完整 component API 参见 [tui.md](tui.md)。

#### Overlay 模式（实验性）

传入 `{ overlay: true }` 可以把 component render 成悬浮在现有内容之上的模态框，不清屏：

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  { overlay: true }
);
```

高级定位（锚点、边距、百分比、响应式可见性）请传 `overlayOptions`。用 `onHandle` 以编程方式控制焦点或可见性：

```typescript
const result = await ctx.ui.custom<string | null>(
  (tui, theme, keybindings, done) => new MyOverlayComponent({ onClose: done }),
  {
    overlay: true,
    overlayOptions: { anchor: "top-right", width: "50%", margin: 2 },
    onHandle: (handle) => {
      handle.focus(); // focus this overlay and bring it to the visual front
      // handle.unfocus({ target: editorComponent }); // release input to a specific component
      // handle.setHidden(true/false); // toggle visibility
      // handle.hide(); // permanently remove
    }
  }
);
```

获得焦点的可见 overlay 可以在临时的非 overlay 自定义 UI 关闭后重新夺回输入。如果你刻意想让另一个 component 在 overlay 保持可见的同时持有输入，调用 `handle.unfocus({ target })`。传 `{ target: null }` 会释放 overlay，而不聚焦其他 component。

完整的 `OverlayOptions` 和 `OverlayHandle` API 参见 [tui.md](tui.md)，示例见 [overlay-qa-tests.ts](../examples/extensions/overlay-qa-tests.ts)。

### 自定义 Editor

用自定义实现（vim 模式、emacs 模式等）替换主输入 editor：

```typescript
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

class VimEditor extends CustomEditor {
  private mode: "normal" | "insert" = "insert";

  handleInput(data: string): void {
    if (matchesKey(data, "escape") && this.mode === "insert") {
      this.mode = "normal";
      return;
    }
    if (this.mode === "normal" && data === "i") {
      this.mode = "insert";
      return;
    }
    super.handleInput(data);  // App keybindings + text editing
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new VimEditor(tui, theme, keybindings)
    );
  });
}
```

**要点：**
- 继承 `CustomEditor`（而不是基础 `Editor`）以获得应用快捷键（escape 中止、ctrl+d、模型切换）
- 没处理的按键调用 `super.handleInput(data)`
- 自定义 editor 默认保留独立的工作行。把 `{ embedWorkingStatus: true }` 作为 `CustomEditor` 构造函数的第四个参数传入，可改用内置的 editor 边框 spinner。
- 工厂从应用收到 `tui`、`theme` 和 `keybindings`
- 在 `setEditorComponent()` 之前用 `ctx.ui.getEditorComponent()` 包装先前配置的自定义 editor
- 传 `undefined` 恢复默认：`ctx.ui.setEditorComponent(undefined)`

要与另一个已替换 editor 的 extension 组合，先捕获之前的工厂再设置你的：

```typescript
const previous = ctx.ui.getEditorComponent();
ctx.ui.setEditorComponent((tui, theme, keybindings) =>
  new MyEditor(tui, theme, keybindings, { base: previous?.(tui, theme, keybindings) })
);
```

带 mode 指示器的完整示例参见 [tui.md](tui.md) 的 Pattern 7。

### 消息与 entry 的 render

为带有你的 `customType` 的消息注册自定义 renderer。需要参与 LLM 上下文的内容用消息 renderer：

```typescript
import { Text } from "@earendil-works/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
  const { expanded, outputPad } = options;
  let text = theme.fg("accent", `[${message.customType}] `);
  text += message.content;

  if (expanded && message.details) {
    text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
  }

  return new Text(text, outputPad, 0);
});
```

消息通过 `pi.sendMessage()` 发送：

```typescript
pi.sendMessage({
  customType: "my-extension",  // Matches registerMessageRenderer
  content: "Status update",
  display: true,               // Show in TUI
  details: { ... },            // Available in renderer
});
```

对于不应发送给 LLM、只在 TUI 展示的内容，改用自定义 entry：

```typescript
pi.registerEntryRenderer("my-card", (entry, options, theme) => {
  return new Text(theme.fg("accent", JSON.stringify(entry.data)));
});

pi.appendEntry("my-card", { status: "done" });
```

### 主题颜色

所有 render 函数都会收到 `theme` 对象。自定义主题的创建和完整色板参见 [themes.md](themes.md)。

```typescript
// Foreground colors
theme.fg("toolTitle", text)   // Tool names
theme.fg("accent", text)      // Highlights
theme.fg("success", text)     // Success (green)
theme.fg("error", text)       // Errors (red)
theme.fg("warning", text)     // Warnings (yellow)
theme.fg("muted", text)       // Secondary text
theme.fg("dim", text)         // Tertiary text

// Text styles
theme.bold(text)
theme.italic(text)
theme.strikethrough(text)
```

自定义 tool renderer 里的语法高亮：

```typescript
import { highlightCode, getLanguageFromPath } from "@earendil-works/pi-coding-agent";

// Highlight code with explicit language
const highlighted = highlightCode("const x = 1;", "typescript", theme);

// Auto-detect language from file path
const lang = getLanguageFromPath("/path/to/file.rs");  // "rust"
const highlighted = highlightCode(code, lang, theme);
```

<a id="error-handling"></a>

## 错误处理

- Extension 出错会被记录，agent 继续运行
- `tool_call` 出错会阻止该 tool（fail-safe）
- Tool `execute` 的错误必须通过抛错来标记；抛出的错误会被捕获、以 `isError: true` 报告给 LLM，执行继续

<a id="mode-behavior"></a>

## Mode 行为

| Mode | `ctx.mode` | `ctx.hasUI` | 说明 |
|------|------------|-------------|-------|
| Interactive | `"tui"` | `true` | 完整 TUI，带终端 render |
| RPC (`--mode rpc`) | `"rpc"` | `true` | 通过 JSON 协议进行对话框和通知；`custom()` 返回 `undefined`。参见 [rpc.md](rpc.md) |
| JSON (`--mode json`) | `"json"` | `false` | event 流输出到 stdout；UI 方法为 no-op |
| Print (`-p`) | `"print"` | `false` | extension 会运行，但无法发起提示 |

TUI 专属功能（`custom()`、component 工厂、终端输入）之前先检查 `ctx.mode === "tui"`。在 TUI 和 RPC mode 下都可用的对话框和通知方法之前先检查 `ctx.hasUI`。

<a id="examples-reference"></a>

## 示例索引

所有示例位于 [examples/extensions/](../examples/extensions/)。

| 示例 | 说明 | 关键 API |
|---------|-------------|----------|
| **Tools** |||
| `hello.ts` | 最小 tool 注册示例 | `registerTool` |
| `question.ts` | 带用户交互的 tool | `registerTool`, `ui.select` |
| `questionnaire.ts` | 多步向导 tool | `registerTool`, `ui.custom` |
| `todo.ts` | 带持久化的有状态 tool | `registerTool`, `appendEntry`, `renderResult`, session event |
| `dynamic-tools.ts` | 启动后和 command 执行期间注册 tool | `registerTool`, `session_start`, `registerCommand` |
| `structured-output.ts` | 带 `terminate: true` 的最终 structured-output tool | `registerTool`, terminating tool 结果 |
| `truncated-tool.ts` | 输出截断示例 | `registerTool`, `truncateHead` |
| `tool-override.ts` | 覆盖内置 read tool | `registerTool`（与内置同名） |
| **Commands** |||
| `pirate.ts` | 每轮修改 system prompt | `registerCommand`, `before_agent_start` |
| `summarize.ts` | 对话摘要 command | `registerCommand`, `ui.custom` |
| `handoff.ts` | 跨 provider 的模型交接 | `registerCommand`, `ui.editor`, `ui.custom` |
| `qna.ts` | 带自定义 UI 的问答 | `registerCommand`, `ui.custom`, `setEditorText` |
| `send-user-message.ts` | 注入 user 消息 | `registerCommand`, `sendUserMessage` |
| `reload-runtime.ts` | reload command 与 LLM tool 交接 | `registerCommand`, `ctx.reload()`, `sendUserMessage` |
| `shutdown-command.ts` | 优雅关闭 command | `registerCommand`, `shutdown()` |
| **Events & Gates** |||
| `permission-gate.ts` | 阻止危险 command | `on("tool_call")`, `ui.confirm` |
| `project-trust.ts` | 从 user/global 或 CLI extension 决定或延后项目信任 | `on("project_trust")`, 信任 UI, 必需的 trust 结果 |
| `protected-paths.ts` | 阻止写入特定路径 | `on("tool_call")` |
| `confirm-destructive.ts` | 确认 session 变更 | `on("session_before_switch")`, `on("session_before_fork")` |
| `dirty-repo-guard.ts` | git 仓库有未提交变更时警告 | `on("session_before_*")`, `exec` |
| `input-transform.ts` | 变换用户输入 | `on("input")` |
| `input-transform-streaming.ts` | 感知流式状态的输入变换 | `on("input")`, `streamingBehavior` |
| `model-status.ts` | 响应模型变化 | `on("model_select")`, `setStatus` |
| `provider-payload.ts` | 检查 payload 和 provider 响应 header | `on("before_provider_request")`, `on("after_provider_response")` |
| `system-prompt-header.ts` | 显示 system prompt 信息 | `on("agent_start")`, `getSystemPrompt` |
| `claude-rules.ts` | 从文件加载规则 | `on("session_start")`, `on("before_agent_start")` |
| `prompt-customizer.ts` | 用 `systemPromptOptions` 添加上下文感知的 tool 指引 | `on("before_agent_start")`, `BuildSystemPromptOptions` |
| `file-trigger.ts` | 文件监听触发消息 | `sendMessage` |
| **Compaction & Sessions** |||
| `custom-compaction.ts` | 自定义 compaction 摘要 | `on("session_before_compact")` |
| `trigger-compact.ts` | 手动触发 compaction | `compact()` |
| `git-checkpoint.ts` | 每轮 git stash | `on("turn_start")`, `on("session_before_fork")`, `exec` |
| `git-merge-and-resolve.ts` | fetch、merge 并解决冲突 | `on("agent_end")`, `exec`, `sendUserMessage` |
| `auto-commit-on-exit.ts` | 关闭时提交 | `on("session_shutdown")`, `exec` |
| **UI Components** |||
| `status-line.ts` | Footer 状态指示器 | `setStatus`, session event |
| `working-indicator.ts` | 自定义流式 working 指示器 | `setWorkingIndicator`, `registerCommand` |
| `github-issue-autocomplete.ts` | 通过 `gh issue list` 预加载最近的 open issue，在内置自动补全之上添加 `#1234` issue 补全 | `addAutocompleteProvider`, `on("session_start")`, `exec` |
| `custom-footer.ts` | 完全替换 footer | `registerCommand`, `setFooter` |
| `custom-header.ts` | 替换启动 header | `on("session_start")`, `setHeader` |
| `modal-editor.ts` | Vim 风格的 modal editor | `setEditorComponent`, `CustomEditor` |
| `rainbow-editor.ts` | 自定义 editor 样式 | `setEditorComponent` |
| `widget-placement.ts` | 编辑器上方/下方的 widget | `setWidget` |
| `overlay-test.ts` | Overlay component | 带 overlay 选项的 `ui.custom` |
| `overlay-qa-tests.ts` | 全面的 overlay 测试 | `ui.custom`, 全部 overlay 选项 |
| `notify.ts` | 简单通知 | `ui.notify` |
| `timed-confirm.ts` | 带超时的对话框 | 带超时/signal 的 `ui.confirm` |
| `mac-system-theme.ts` | 自动切换主题 | `setTheme`, `exec` |
| **Complex Extensions** |||
| `plan-mode/` | 完整 plan mode 实现 | 全部 event 类型, `registerCommand`, `registerShortcut`, `registerFlag`, `setStatus`, `setWidget`, `sendMessage`, `setActiveTools` |
| `preset.ts` | 可保存的 preset（模型、tool、thinking） | `registerCommand`, `registerShortcut`, `registerFlag`, `setModel`, `setActiveTools`, `setThinkingLevel`, `appendEntry` |
| `tools.ts` | tool 开关 UI | `registerCommand`, `setActiveTools`, `SettingsList`, session event |
| **Remote & Sandbox** |||
| `ssh.ts` | SSH 远程执行 | `registerFlag`, `on("user_bash")`, `on("before_agent_start")`, tool operations |
| `interactive-shell.ts` | 持久 shell session | `on("user_bash")` |
| `sandbox/` | 沙箱化 tool 执行 | Tool operations |
| `gondolin/` | 把内置 tool 和 `!` command 路由进 Gondolin micro-VM | Tool operations, 内置 tool 覆盖, `on("user_bash")` |
| `subagent/` | 派生 sub-agent | `registerTool`, `exec` |
| **Games** |||
| `snake.ts` | 贪吃蛇游戏 | `registerCommand`, `ui.custom`, 键盘处理 |
| `space-invaders.ts` | Space Invaders 游戏 | `registerCommand`, `ui.custom` |
| `doom-overlay/` | Overlay 里的 Doom | 带 overlay 的 `ui.custom` |
| **Providers** |||
| `custom-provider-anthropic/` | 自定义 Anthropic 代理 | `registerProvider` |
| `custom-provider-gitlab-duo/` | GitLab Duo 集成 | 带 OAuth 的 `registerProvider` |
| **Messages & Communication** |||
| `message-renderer.ts` | 自定义消息 render | `registerMessageRenderer`, `sendMessage` |
| `entry-renderer.ts` | 仅 TUI 的自定义 entry render | `registerEntryRenderer`, `appendEntry` |
| `event-bus.ts` | extension 间 event | `pi.events` |
| **Session Metadata** |||
| `session-name.ts` | 为选择器命名 session | `setSessionName`, `getSessionName` |
| `bookmark.ts` | 为 /tree 收藏 entry | `setLabel` |
| **Misc** |||
| `inline-bash.ts` | tool 调用里的内联 bash | `on("tool_call")` |
| `bash-spawn-hook.ts` | 执行前调整 bash command、cwd 和 env | `createBashTool`, `spawnHook` |
| `with-deps/` | 带 npm 依赖的 extension | 使用 `package.json` 的 package 结构 |
