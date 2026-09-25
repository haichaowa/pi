> 译注：本文是 `packages/coding-agent/docs/custom-provider.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# 自定义 Provider

Extension 可以通过 `pi.registerProvider()` 注册自定义模型 provider。这可以实现：

- **代理** - 通过企业代理或 API 网关路由请求
- **自定义端点** - 使用自托管或私有部署的模型
- **OAuth/SSO** - 为企业 provider 添加认证流程
- **自定义 API** - 为非标准 LLM API 实现 streaming

## 示例 Extension

完整的 provider 示例请参见：

- [`examples/extensions/custom-provider-anthropic/`](../examples/extensions/custom-provider-anthropic/)
- [`examples/extensions/custom-provider-gitlab-duo/`](../examples/extensions/custom-provider-gitlab-duo/)

## 目录

- [示例 Extension](#示例-extension)
- [快速参考](#快速参考)
- [覆盖已有 Provider](#覆盖已有-provider)
- [注册新 Provider](#注册新-provider)
- [注销 Provider](#注销-provider)
- [OAuth 支持](#oauth-支持)
- [自定义 Streaming API](#自定义-streaming-api)
- [上下文溢出错误](#上下文溢出错误)
- [测试你的实现](#测试你的实现)
- [配置参考](#配置参考)
- [模型定义参考](#模型定义参考)

## 快速参考

Extension 既可以注册完整的 pi-ai `Provider`，也可以使用旧版的 provider-config 形式。当需要自定义认证、过滤、刷新或 streaming 行为时，建议使用完整的 provider。pi 会将 `models.json` 中的覆盖组合在已注册的原生 provider 之上。

```typescript
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createProvider({
    id: "native-local",
    name: "Native Local",
    baseUrl: "http://localhost:8080/v1",
    auth: {
      apiKey: {
        name: "Local server API key",
        async login(interaction) {
          return {
            type: "api_key",
            key: await interaction.prompt({ type: "secret", message: "API key" })
          };
        },
        async resolve({ credential }) {
          return credential?.key
            ? { auth: { apiKey: credential.key }, source: "stored API key" }
            : undefined;
        }
      }
    },
    models: [],
    api: openAICompletionsApi()
  }));

  // Legacy provider-config form:
  // Override baseUrl for existing provider
  pi.registerProvider("anthropic", {
    baseUrl: "https://proxy.example.com"
  });

  // Register new provider with models
  pi.registerProvider("my-provider", {
    name: "My Provider",
    baseUrl: "https://api.example.com",
    apiKey: "$MY_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "my-model",
        name: "My Model",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  });
}
```

extension 工厂也可以是 `async` 的。对于动态模型发现，请在工厂中（而不是 `session_start` 中）获取并注册模型。pi 会等待工厂执行完毕后再继续启动，因此该 provider 在交互式启动期间以及 `pi --list-models` 中均可用。

## 覆盖已有 Provider

最简单的用例：将已有的 provider 经由代理重定向。

```typescript
// All Anthropic requests now go through your proxy
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// Add custom headers to OpenAI requests
pi.registerProvider("openai", {
  headers: {
    "X-Custom-Header": "value"
  }
});

// Both baseUrl and headers
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: {
    "X-Corp-Auth": "$CORP_AUTH_TOKEN"  // env var or literal
  }
});
```

当只提供 `baseUrl` 和/或 `headers`（不提供 `models`）时，该 provider 的所有现有模型都会保留，只是改用新的端点。

## 注册新 Provider

要添加全新的 provider，请在必需配置之外指定 `models`。

如果模型列表来自远程端点，请使用 async 的 extension 工厂：

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

这样可以在启动完成之前注册获取到的模型。

```typescript
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "$MY_LLM_API_KEY",  // env var reference
  api: "openai-completions",  // which streaming API to use
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,        // supports extended thinking
      input: ["text", "image"],
      cost: {
        input: 3.0,           // $/million tokens
        output: 15.0,
        cacheRead: 0.3,
        cacheWrite: 3.75
      },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});
```

提供 `models` 时，它会**替换**该 provider 的所有现有模型。

`apiKey` 和自定义 header 的值使用与 `models.json` 相同的配置值语法：开头的 `!command` 会执行命令并以输出作为整个值，`$ENV_VAR` 和 `${ENV_VAR}` 插值环境变量，`$$` 输出字面量 `$`，`$!` 输出字面量 `!`。

## 注销 Provider

使用 `pi.unregisterProvider(name)` 可以移除先前通过 `pi.registerProvider(name, ...)` 注册的 provider：

```typescript
// Register
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "$MY_LLM_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "my-llm-large",
      name: "My LLM Large",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});

// Later, remove it
pi.unregisterProvider("my-llm");
```

注销会移除该 provider 的动态模型、API key 回退、OAuth provider 注册以及自定义 stream handler 注册。任何被覆盖的内置模型或 provider 行为都会恢复原状。

在 extension 初始加载阶段之后进行的调用会立即生效，因此无需 `/reload`。

### API 类型

`api` 字段决定使用哪种 streaming 实现：

| API | 用途 |
|-----|---------|
| `anthropic-messages` | Anthropic Claude API 及兼容 API |
| `openai-completions` | OpenAI Chat Completions API 及兼容 API |
| `openai-responses` | OpenAI Responses API |
| `azure-openai-responses` | Azure OpenAI Responses API |
| `openai-codex-responses` | OpenAI Codex Responses API |
| `mistral-conversations` | Mistral 原生 Chat Completions streaming |
| `google-generative-ai` | Google Generative AI API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

大多数 OpenAI 兼容的 provider 都能配合 `openai-completions` 使用。模型专属的 thinking 级别请用模型级的 `thinkingLevelMap` 配置，provider 的特殊行为请用 `compat` 配置。`xhigh` 和 `max` 级别属于可选启用（opt-in），要求映射表中存在非 null 的条目，且中间可能存在不支持的空洞：

```typescript
models: [{
  id: "custom-model",
  // ...
  reasoning: true,
  thinkingLevelMap: {              // map pi levels to provider values; null hides unsupported levels
    minimal: null,
    low: null,
    medium: null,
    high: "default",
    xhigh: null,
    max: "max"
  },
  compat: {
    supportsDeveloperRole: false,   // use "system" instead of "developer"
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens",   // instead of "max_completion_tokens"
    requiresToolResultName: true,   // tool results need name field
    thinkingFormat: "qwen",        // top-level enable_thinking: true
    cacheControlFormat: "anthropic" // Anthropic-style cache_control markers
  }
}]
```

`openrouter` 用于 OpenRouter 风格的 `reasoning: { effort }` 控制。`together` 用于 Together 风格的 `reasoning: { enabled }` 控制；启用 `supportsReasoningEffort` 时还会发送 `reasoning_effort`。`qwen-chat-template` 用于会读取 `chat_template_kwargs.enable_thinking` 且需要 `preserve_thinking` 的本地 Qwen 兼容服务器。
对于通过 system prompt、最后一个 tool 定义以及最后一条 user、assistant 或 tool 结果文本内容上的 `cache_control` 暴露 Anthropic 风格 prompt 缓存的 OpenAI 兼容 provider，请使用 `cacheControlFormat: "anthropic"`。

对于使用 `api: "anthropic-messages"` 的 Anthropic 兼容 provider，如果上游模型要求 adaptive thinking（`thinking.type: "adaptive"` 加上 `output_config.effort`），请在对应的模型或 provider 上设置 `compat.forceAdaptiveThinking: true`。内置的 adaptive Claude 模型会自动设置该项。只有对会发出空 thinking 签名、并在重放时期望收到 `signature: ""` 的 provider，才设置 `compat.allowEmptySignature: true`。

> 迁移说明：Mistral 已从 `openai-completions` 迁移到 `mistral-conversations`。
> 对 Mistral 原生模型请使用 `mistral-conversations`。
> 如果你有意将 Mistral 兼容/自定义端点经由 `openai-completions` 路由，请按需显式设置 `compat` 标志。

### Auth Header

如果你的 provider 期望 `Authorization: Bearer <key>` 但并不使用标准 API，请设置 `authHeader: true`：

```typescript
pi.registerProvider("custom-api", {
  baseUrl: "https://api.example.com",
  apiKey: "$MY_API_KEY",
  authHeader: true,  // adds Authorization: Bearer header
  api: "openai-completions",
  models: [...]
});
```

key 会在每次请求时解析。请求中显式设置的 `Authorization` header 优先于自动生成的值。

## OAuth 支持

添加可与 `/login` 集成的 OAuth/SSO 认证：

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "Corporate AI (SSO)",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      const method = await callbacks.onSelect({
        message: "Select login method:",
        options: [
          { id: "browser", label: "Browser OAuth" },
          { id: "device", label: "Device code" }
        ]
      });
      if (!method) throw new Error("Login cancelled");

      let code: string;
      if (method === "device") {
        callbacks.onDeviceCode({
          userCode: "ABCD-1234",
          verificationUri: "https://sso.corp.com/device",
          intervalSeconds: 5,
          expiresInSeconds: 900
        });
        code = await pollDeviceCodeUntilComplete();
      } else {
        callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });
        code = await callbacks.onPrompt({ message: "Enter SSO code:" });
      }

      // Exchange for tokens (your implementation)
      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh, signal);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    }
  }
});
```

注册后，用户即可通过 `/login corporate-ai` 完成认证。

### OAuthLoginCallbacks

`callbacks` 对象为 provider 自有的流程提供与 UI 无关的交互手段：

```typescript
interface OAuthLoginCallbacks {
  // Open URL in browser (for OAuth redirects)
  onAuth(params: { url: string }): void;

  // Show device code (for device authorization flow)
  onDeviceCode(params: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }): void;

  // Show transient progress
  onProgress?(message: string): void;

  // Prompt user for input (for manual token entry)
  onPrompt(params: { message: string }): Promise<string>;

  // Show an interactive selector, e.g. to choose browser OAuth vs device code
  onSelect(params: {
    message: string;
    options: { id: string; label: string }[];
  }): Promise<string | undefined>;
}
```

### OAuthCredentials

凭据持久化保存在 `~/.pi/agent/auth.json` 中：

```typescript
interface OAuthCredentials {
  refresh: string;   // Refresh token (for refreshToken())
  access: string;    // Access token (returned by getApiKey())
  expires: number;   // Expiration timestamp in milliseconds
}
```

## 自定义 Streaming API

对于使用非标准 API 的 provider，可以实现 `streamSimple`。在动手编写自己的实现之前，请先研究现有的 API 实现：

**参考实现：**
- [anthropic-messages.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/anthropic-messages.ts) - Anthropic Messages API
- [mistral-conversations.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/mistral-conversations.ts) - Mistral Conversations API
- [openai-completions.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts) - OpenAI Chat Completions
- [openai-responses.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-responses.ts) - OpenAI Responses API
- [google-generative-ai.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/google-generative-ai.ts) - Google Generative AI
- [bedrock-converse-stream.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/bedrock-converse-stream.ts) - AWS Bedrock

### Stream 模式

所有 provider 都遵循相同的模式：

```typescript
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

function streamMyProvider(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    // Initialize output message
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      // Push start event
      stream.push({ type: "start", partial: output });

      // Make API request and process response...
      // Push content events as they arrive and set stopReason from the terminal event.
      if (output.stopReason === "pending") {
        throw new Error("Provider stream ended without a stop reason");
      }
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      // Push done event
      stream.push({
        type: "done",
        reason: output.stopReason,
        message: output
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
```

### Event 类型

按以下顺序通过 `stream.push()` 推送 event：

1. `{ type: "start", partial: output }` - stream 已开始

2. 内容 event（可重复，为每个块跟踪 `contentIndex`）：
   - `{ type: "text_start", contentIndex, partial }` - 文本块开始
   - `{ type: "text_delta", contentIndex, delta, partial }` - 文本片段
   - `{ type: "text_end", contentIndex, content, partial }` - 文本块结束
   - `{ type: "thinking_start", contentIndex, partial }` - thinking 开始
   - `{ type: "thinking_delta", contentIndex, delta, partial }` - thinking 片段
   - `{ type: "thinking_end", contentIndex, content, partial }` - thinking 结束
   - `{ type: "toolcall_start", contentIndex, partial }` - tool 调用开始
   - `{ type: "toolcall_delta", contentIndex, delta, partial }` - tool 调用 JSON 片段
   - `{ type: "toolcall_end", contentIndex, toolCall, partial }` - tool 调用结束

3. `{ type: "done", reason, message }` 或 `{ type: "error", reason, error }` - stream 已结束

每个 event 中的 `partial` 字段承载当前的 `AssistantMessage` 状态。收到数据时更新 `output.content`，然后将 `output` 作为 `partial` 放入 event。

### 内容块

在内容块到达时将其添加到 `output.content`：

```typescript
// Text block
output.content.push({ type: "text", text: "" });
stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });

// As text arrives
const block = output.content[contentIndex];
if (block.type === "text") {
  block.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: output });
}

// When block completes
stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
```

### Tool 调用

tool 调用需要累积 JSON 并进行解析：

```typescript
// Start tool call
output.content.push({
  type: "toolCall",
  id: toolCallId,
  name: toolName,
  arguments: {}
});
stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });

// Accumulate JSON
let partialJson = "";
partialJson += jsonDelta;
try {
  block.arguments = JSON.parse(partialJson);
} catch {}
stream.push({ type: "toolcall_delta", contentIndex, delta: jsonDelta, partial: output });

// Complete
stream.push({
  type: "toolcall_end",
  contentIndex,
  toolCall: { type: "toolCall", id, name, arguments: block.arguments },
  partial: output
});
```

### 用量与成本

根据 API 响应更新用量并计算成本：

```typescript
output.usage.input = response.usage.input_tokens;
output.usage.output = response.usage.output_tokens;
output.usage.cacheRead = response.usage.cache_read_tokens ?? 0;
output.usage.cacheWrite = response.usage.cache_write_tokens ?? 0;
output.usage.totalTokens = output.usage.input + output.usage.output +
                           output.usage.cacheRead + output.usage.cacheWrite;
calculateCost(model, output.usage);
```

### 上下文溢出错误

当请求超过模型的 context window 时，pi 可以通过压缩（compact）对话并重试来自动恢复。只有当 pi 将该失败识别为溢出时，这种恢复才会触发。

检测针对最终确定的 assistant 消息进行：

- `stopReason === "error"`
- `errorMessage` 匹配 pi 已知的溢出模式之一（见 [`packages/ai/src/utils/overflow.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/overflow.ts)）

如果你的 provider 返回的溢出错误消息 pi 无法识别，请在注册该 provider 的同一个 extension 中对该错误进行归一化。使用 `message_end` handler 重写 assistant 消息，使其 `errorMessage` 以 pi 能识别的短语开头。通用回退短语 `context_length_exceeded` 是最安全的选择。

```typescript
const MY_PROVIDER_OVERFLOW_PATTERN = /your provider's overflow phrase/i;

export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", { /* ... */ });

  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;
    if (
      message.provider !== "my-provider" &&
      ctx.model?.provider !== "my-provider"
    )
      return;

    const errorMessage = message.errorMessage ?? "";
    if (errorMessage.includes("context_length_exceeded")) return;
    if (!MY_PROVIDER_OVERFLOW_PATTERN.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });
}
```

`message_end` 在 pi 为 auto-compaction 跟踪 assistant 消息之前运行，因此 pi 检查的是重写后的 `errorMessage`。完成上述处理后，pi 将会：

1. 从 `errorMessage` 中检测到溢出。
2. 将失败的 assistant 消息从活动上下文中移除。
3. 执行 compaction。
4. 对请求重试一次。

请谨慎地为重写添加防护条件：

- 将其限定在你的 provider 范围内（`message.provider` 和 `ctx.model?.provider`），使来自其他 provider 的无关错误不受影响。
- 匹配 provider 特有的模式，而不是 pi 的通用溢出模式。如果重写限流类错误（`rate limit`、`too many requests`），会错误地触发 compaction，而不是走 pi 正常的 retry-with-backoff 路径。
- 当 `errorMessage` 已包含 `context_length_exceeded` 时跳过重写，以保证 handler 幂等。

### 注册

注册你的 stream 函数：

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  apiKey: "$MY_API_KEY",
  api: "my-custom-api",
  models: [...],
  streamSimple: streamMyProvider
});
```

## 测试你的实现

使用与内置 provider 相同的测试套件来验证你的 provider。从 [packages/ai/test/](https://github.com/earendil-works/pi/tree/main/packages/ai/test) 复制并适配以下测试文件：

| 测试 | 用途 |
|------|---------|
| `stream.test.ts` | 基本 streaming、文本输出 |
| `tokens.test.ts` | token 计数与用量 |
| `abort.test.ts` | AbortSignal 处理 |
| `empty.test.ts` | 空/最小响应 |
| `context-overflow.test.ts` | context window 限制 |
| `image-limits.test.ts` | 图像输入处理 |
| `unicode-surrogate.test.ts` | Unicode 边界情况 |
| `tool-call-without-result.test.ts` | tool 调用边界情况 |
| `image-tool-result.test.ts` | tool 结果中的图像 |
| `total-tokens.test.ts` | 总 token 计算 |
| `cross-provider-handoff.test.ts` | provider 之间的上下文交接 |

使用你的 provider/模型组合运行这些测试，以验证兼容性。

## 配置参考

```typescript
interface ProviderConfig {
  /** Display name for the provider in UI such as /login. */
  name?: string;

  /** API endpoint URL. Required when defining models. */
  baseUrl?: string;

  /** API key literal, env interpolation ($ENV_VAR or ${ENV_VAR}), or !command. Required when defining models (unless oauth). */
  apiKey?: string;

  /** API type for streaming. Required at provider or model level when defining models. */
  api?: Api;

  /** Custom streaming implementation for non-standard APIs. */
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;

  /** Custom headers to include in requests. Values use the same resolution syntax as apiKey. */
  headers?: Record<string, string>;

  /** If true, adds Authorization: Bearer header with the resolved API key. */
  authHeader?: boolean;

  /** Models to register. If provided, replaces all existing models for this provider. */
  models?: ProviderModelConfig[];

  /** OAuth provider for /login support. */
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
  };
}
```

## 模型定义参考

```typescript
interface ProviderModelConfig {
  /** Model ID (e.g., "claude-sonnet-4-20250514"). */
  id: string;

  /** Display name (e.g., "Claude 4 Sonnet"). */
  name: string;

  /** API type override for this specific model. */
  api?: Api;

  /** API endpoint URL override for this specific model. */
  baseUrl?: string;

  /** Whether the model supports extended thinking. */
  reasoning: boolean;

  /** Maps pi thinking levels to provider/model-specific values; null marks a level unsupported. */
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;

  /** Supported input types. */
  input: ("text" | "image")[];

  /** Cost per million tokens (for usage tracking). */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };

  /** Maximum context window size in tokens. */
  contextWindow: number;

  /** Maximum output tokens. */
  maxTokens: number;

  /** Custom headers for this specific model. */
  headers?: Record<string, string>;

  /** Compatibility settings for the selected API. */
  compat?: {
    // openai-completions
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsUsageInStreaming?: boolean;
    supportsFinishReason?: boolean;
    supportsStrictMode?: boolean;
    supportsOpenAIGrammarTools?: boolean; // openai-completions/openai-responses; false falls back to normal function tools
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    requiresReasoningContentOnAssistantMessages?: boolean;
    thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "baseten" | "zai" | "qwen" | "chat-template" | "qwen-chat-template" | "string-thinking" | "ant-ling";
    chatTemplateKwargs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    chatTemplateArgs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    thinkingTokenBudgetField?: "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";
    supportsThinkingTokenBudget?: boolean;
    cacheControlFormat?: "anthropic";
    sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
    sendSessionAffinityHeaders?: boolean;

    // anthropic-messages
    supportsEagerToolInputStreaming?: boolean;
    supportsLongCacheRetention?: boolean;
    sendSessionAffinityHeaders?: boolean;
    supportsCacheControlOnTools?: boolean;
    forceAdaptiveThinking?: boolean;
    allowEmptySignature?: boolean;
    supportsStrictTools?: boolean;
  };
}
```

`openrouter` 发送 `reasoning: { effort }`。`deepseek` 发送 `thinking: { type: "enabled" | "disabled" }`，启用时还会发送 `reasoning_effort`。`together` 发送 `reasoning: { enabled }`，当 `supportsReasoningEffort` 启用时还会发送 `reasoning_effort`。`qwen` 用于 DashScope 风格的顶层 `enable_thinking`。`qwen-chat-template` 用于会读取 `chat_template_kwargs.enable_thinking` 且需要 `preserve_thinking` 的本地 Qwen 兼容服务器。`chat-template` 用于可配置的 `chat_template_kwargs`，例如位于 vLLM 之后、配合 `chatTemplateKwargs: { "thinking": { "$var": "thinking.enabled" } }` 使用的 DeepSeek V3.x。当 provider 期望在 `chat_template_args` 下提供开关值并可选支持顶层 `reasoning_effort` 时，使用 `thinkingFormat: "baseten"` 配合 `chatTemplateArgs`。
`thinkingTokenBudgetField` 会按级别发送经过钳制（clamp）的 thinking 预算，作为顶层请求字段（vLLM 上为 `thinking_token_budget`，Qwen/SGLang 上为 `thinking_budget`，llama.cpp 上为 `thinking_budget_tokens`）。`supportsThinkingTokenBudget: true` 是 vLLM 字段名的别名。在 DashScope 的 Qwen 模型上，不要将它与 `reasoning_effort` 组合使用。
`cacheControlFormat: "anthropic"` 会将 Anthropic 风格的 `cache_control` 标记应用到 system prompt、最后一个 tool 定义以及最后一条 user、assistant 或 tool 结果文本内容上。
