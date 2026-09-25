> 译注：本文是 `packages/ai/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-ai

统一的 LLM API，提供 provider 集合、自动认证（auth）解析、token 与成本跟踪，以及简单的上下文持久化和会话中途交接给其他模型的能力。

**注意**：本库只收录支持 tool calling（函数调用）的模型，因为这对 agentic 工作流至关重要。

## 目录

- [支持的 Provider](#supported-providers)
- [安装](#installation)
- [快速上手](#quick-start)
- [Provider 与模型](#providers-and-models)
  - [Provider 工厂](#provider-factories)
  - [所有内置 Provider](#all-built-in-providers)
  - [查询模型](#querying-models)
  - [静态目录读取](#static-catalog-reads)
  - [动态 Provider](#dynamic-providers)
- [认证（Auth）](#auth)
  - [认证如何解析](#how-auth-resolves)
  - [转换请求头](#transforming-request-headers)
  - [凭据存储（Credential Store）](#credential-store)
  - [环境变量](#environment-variables)
- [工具（Tools）](#tools)
  - [定义工具](#defining-tools)
  - [处理 Tool Call](#handling-tool-calls)
  - [以 Partial JSON 流式传输 Tool Call](#streaming-tool-calls-with-partial-json)
  - [校验工具参数](#validating-tool-arguments)
  - [完整事件参考](#complete-event-reference)
  - [紧凑的 Assistant Message 帧](#compact-assistant-message-frames)
- [图片输入](#image-input)
- [图片生成](#image-generation)
- [Thinking/Reasoning](#thinkingreasoning)
  - [统一接口（streamSimple/completeSimple）](#unified-interface-streamsimplecompletesimple)
  - [Provider 特定选项（stream/complete）](#provider-specific-options-streamcomplete)
  - [流式传输 thinking 内容](#streaming-thinking-content)
- [Stop Reasons](#stop-reasons)
- [错误处理](#error-handling)
  - [中止请求](#aborting-requests)
  - [中止后继续](#continuing-after-abort)
  - [调试 Provider 负载](#debugging-provider-payloads)
- [自定义 Provider](#custom-providers)
  - [createProvider()](#createprovider)
  - [直接调用 API 实现](#calling-api-implementations-directly)
  - [OpenAI 兼容性设置](#openai-compatibility-settings)
- [用于测试的 Faux Provider](#faux-provider-for-tests)
- [跨 Provider 交接（Handoff）](#cross-provider-handoffs)
- [上下文序列化](#context-serialization)
- [浏览器中使用](#browser-usage)
- [打包与 Tree Shaking](#bundling-and-tree-shaking)
- [OAuth Provider](#oauth-providers)
  - [Vertex AI](#vertex-ai)
  - [CLI 登录](#cli-login)
  - [编程式 OAuth](#programmatic-oauth)
- [从旧的全局 API 迁移](#migrating-from-the-old-global-api)
- [开发](#development)
- [许可证](#license)

## 支持的 Provider

- **OpenAI**
- **Ant Ling**
- **Azure OpenAI (Responses)**
- **OpenAI Codex**（ChatGPT Plus/Pro 订阅，需要 OAuth，见下文）
- **DeepSeek**
- **NVIDIA NIM**
- **Anthropic**
- **Google**
- **Vertex AI**（通过 Vertex AI 使用 Gemini）
- **Mistral**
- **Groq**
- **Cerebras**
- **Cloudflare AI Gateway**
- **Cloudflare Workers AI**
- **xAI**
- **OpenRouter**
- **Vercel AI Gateway**
- **ZAI Coding Plan (Global)**（另有单独的中国 provider）
- **MiniMax**（另有单独的中国 provider）
- **Together AI**
- **Baseten**
- **Hugging Face**
- **Moonshot AI**（另有单独的中国 provider）
- **GitHub Copilot**（需要 OAuth，见下文）
- **Amazon Bedrock**
- **OpenCode Zen**
- **OpenCode Go**
- **Fireworks**（使用 OpenAI 和 Anthropic 兼容的 API）
- **Kimi For Coding**（Moonshot AI 订阅端点，使用 Anthropic 兼容 API）
- **Qwen Token Plan**（Individual 与 existing 各自独立的目录，另有单独的中国 provider）
- **Xiaomi MiMo**（默认使用 API 计费端点，另为 `cn`/`ams`/`sgp` 区域提供独立的 Token Plan provider）
- **任意 OpenAI 兼容 API**：Ollama、vLLM、LM Studio 等

## 安装

```bash
npm install @earendil-works/pi-ai
```

`@earendil-works/pi-ai` 重新导出了 TypeBox 的导出项：`Type`、`Static` 和 `TSchema`。

## 快速上手

你构建一个由 provider 组成的 `Models` 集合并通过它进行 stream。最快的入门方式是注册所有内置 provider；关注包体积的应用则改为注册单个 provider（参见 [Provider 工厂](#provider-factories)与[打包与 Tree Shaking](#bundling-and-tree-shaking)）。

```typescript
import { Type, type Context, type Tool } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

// A Models collection with every built-in provider registered
const models = builtinModels();

// Sync lookup against the collection
const model = models.getModel('openai', 'gpt-4o-mini')!;

// Define tools with TypeBox schemas for type safety and validation
const tools: Tool[] = [{
  name: 'get_time',
  description: 'Get the current time',
  parameters: Type.Object({
    timezone: Type.Optional(Type.String({ description: 'Optional timezone (e.g., America/New_York)' }))
  })
}];

// Build a conversation context (easily serializable and transferable between models)
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What time is it?', timestamp: Date.now() }],
  tools
};

// Option 1: Streaming with all event types.
// Auth resolves through the provider (OPENAI_API_KEY from the environment here).
const s = models.stream(model, context);

for await (const event of s) {
  switch (event.type) {
    case 'start':
      console.log(`Starting with ${event.partial.model}`);
      break;
    case 'text_start':
      console.log('\n[Text started]');
      break;
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'text_end':
      console.log('\n[Text ended]');
      break;
    case 'thinking_start':
      console.log('[Model is thinking...]');
      break;
    case 'thinking_delta':
      process.stdout.write(event.delta);
      break;
    case 'thinking_end':
      console.log('[Thinking complete]');
      break;
    case 'toolcall_start':
      console.log(`\n[Tool call started: index ${event.contentIndex}]`);
      break;
    case 'toolcall_delta':
      // Partial tool arguments are being streamed
      const partialCall = event.partial.content[event.contentIndex];
      if (partialCall.type === 'toolCall') {
        console.log(`[Streaming args for ${partialCall.name}]`);
      }
      break;
    case 'toolcall_end':
      console.log(`\nTool called: ${event.toolCall.name}`);
      console.log(`Arguments: ${JSON.stringify(event.toolCall.arguments)}`);
      break;
    case 'done':
      console.log(`\nFinished: ${event.reason}`);
      break;
    case 'error':
      console.error(`Error: ${event.error.errorMessage}`);
      break;
  }
}

// Get the final message after streaming, add it to the context
const finalMessage = await s.result();
context.messages.push(finalMessage);

// Handle tool calls if any
const toolCalls = finalMessage.content.filter(b => b.type === 'toolCall');
for (const call of toolCalls) {
  const result = call.name === 'get_time'
    ? new Date().toLocaleString('en-US', {
        timeZone: call.arguments.timezone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'long'
      })
    : 'Unknown tool';

  // Add tool result to context (supports text and images)
  context.messages.push({
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: result }],
    isError: false,
    timestamp: Date.now()
  });
}

// Continue if there were tool calls
if (toolCalls.length > 0) {
  const continuation = await models.complete(model, context);
  context.messages.push(continuation);
  console.log('After tool execution:', continuation.content);
}

console.log(`Total tokens: ${finalMessage.usage.input} in, ${finalMessage.usage.output} out`);
console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`);

// Option 2: Get complete response without streaming
const response = await models.complete(model, context);

for (const block of response.content) {
  if (block.type === 'text') {
    console.log(block.text);
  } else if (block.type === 'toolCall') {
    console.log(`Tool: ${block.name}(${JSON.stringify(block.arguments)})`);
  }
}
```

本 README 其余部分的代码片段都假定已按上述方式设置好 `models` 集合（并注册了相关 provider）。

## Provider 与模型

**provider** 是运行时单元：它拥有自己的模型目录、自己的认证（API key 解析、OAuth 流程）以及自己的 stream 行为。`Models` 集合持有 provider，并把每个请求路由到拥有该模型的 provider。

Provider 内部共享 **API 实现**（即线上协议）：Anthropic 模型使用 `anthropic-messages`，OpenAI 使用 `openai-responses`，而 xAI、Groq、Cerebras、OpenRouter 以及大多数其他 provider 共享 `openai-completions`。混合 API 的 provider（GitHub Copilot、OpenCode Zen）则按模型分发。

### Provider 工厂

对于只需要特定 provider 的应用，每个内置 provider 都有一个对应的工厂，各是一个子路径导入，只拉取该 provider 的目录：

```typescript
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { amazonBedrockProvider } from '@earendil-works/pi-ai/providers/amazon-bedrock';
// ...one module per provider in the Supported Providers list

const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(openrouterProvider());
```

Provider 工厂导入各自的模型目录和一个 lazy API 包装器，不会导入其他 provider。在 bundler 代码分割下，SDK 实现（`@anthropic-ai/sdk`、`openai`、`@google/genai` 等）留在 lazy chunk 中，首次请求该 API 的模型时才加载。

### 所有内置 Provider

对于想要全部内容的应用（如快速上手所示）：

```typescript
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

const models = builtinModels(); // a Models collection with every built-in provider registered
```

这会导入全部目录和每个内置 provider 工厂，是重量级的显式入口。`builtinModels()` 接受与 `createModels()` 相同的选项（`credentials`、`authContext`）；如果你想在自己的集合上注册这些 provider，`builtinProviders()` 会返回 provider 数组。

### 查询模型

读取操作是同步的，返回最后一次已知的列表：

```typescript
const providers = models.getProviders();           // registered Provider objects
const provider = models.getProvider('anthropic');  // one provider

const all = models.getModels();                    // every model across providers
const anthropicModels = models.getModels('anthropic');
const model = models.getModel('anthropic', 'claude-sonnet-4-5');

for (const m of anthropicModels) {
  console.log(`${m.id}: ${m.name}`);
  console.log(`  API: ${m.api}`);
  console.log(`  Context: ${m.contextWindow} tokens`);
  console.log(`  Vision: ${m.input.includes('image')}`);
  console.log(`  Reasoning: ${m.reasoning}`);
}
```

动态列出的模型类型为 `Model<Api>`。当你需要 API 特定的选项类型时，用 `hasApi()` 类型守卫来收窄：

```typescript
import { hasApi } from '@earendil-works/pi-ai';

const m = models.getModel('anthropic', 'claude-sonnet-4-5');
if (m && hasApi(m, 'anthropic-messages')) {
  // m: Model<'anthropic-messages'> — stream options fully typed
  models.stream(m, context, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
}
```

### 静态目录读取

对于希望使用生成的内置目录并获得完整字面量类型（provider 和模型 ID 可自动补全）、且不依赖任何集合的工具：

```typescript
import { getBuiltinModel, getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';

const model = getBuiltinModel('openai', 'gpt-4o-mini'); // typed Model<'openai-responses'>
const providers = getBuiltinProviders();
const anthropic = getBuiltinModels('anthropic');
```

### 动态 Provider

Provider 可能拥有动态的模型列表（llama.cpp 服务器、实时的 OpenRouter 列表）。读取保持同步；拉取则是一个显式的异步操作：

```typescript
// getModels() returns the last-known list (empty before the first refresh)
await models.refresh({ providers: ['llamacpp'] }); // refresh one provider
await models.refresh();                            // refresh all providers concurrently, best-effort
const fresh = models.getModel('llamacpp', 'qwen3-30b');
```

静态内置 provider 的 `refresh()` 是空操作。构建动态 provider 请参见 [createProvider()](#createprovider)。

## 认证（Auth）

每个 provider 拥有自己的认证：API key 如何解析（存储的凭据、环境变量、AWS profile 或 gcloud ADC 之类的环境来源），以及在支持的情况下 OAuth 登录/刷新流程。

### 认证如何解析

调用 `models.stream()` 时，集合会通过拥有该模型的 provider 解析认证并将其合并进请求。显式的按请求取值总是优先：

```typescript
// Resolved through the provider (env var, stored credential, OAuth token):
await models.complete(model, context);

// Explicit key wins over anything the provider would resolve:
await models.complete(model, context, { apiKey: 'sk-explicit' });
```

你可以在不发起请求的情况下检查认证解析结果。传入 provider ID 得到 provider 范围的认证，或传入模型以包含其静态 `model.headers`：

```typescript
const providerAuth = await models.getAuth(model.provider);
const modelAuth = await models.getAuth(model);

if (modelAuth) {
  console.log(`configured via ${modelAuth.source}`); // e.g. "ANTHROPIC_API_KEY", "OAuth", "stored credential"
  console.log(modelAuth.auth.headers);              // Provider auth headers + model.headers
} else {
  console.log('not configured');
}
```

两个重载都会解析凭据、在必要时刷新过期的 OAuth，并可能返回由认证派生的 `apiKey`、`headers` 或 `baseUrl`。对于未配置的 provider，`getAuth()` 解析为 `undefined`；当确实出现故障时则以 `ModelsError` 拒绝（`"oauth"`：token 刷新失败，保留凭据以便重新登录；`"auth"`：key 解析或凭据存储失败）。请求路径会把同样的失败作为 stream 错误暴露出来。

`getAuth()`、`checkAuth()`、`getAvailable()`、login 和 logout 通过各自既有的选项或 interaction 对象接受调用方可选的取消信号；未提供 signal 时不设限制。Provider 的 `login`、`ApiKeyAuth.check`、`ApiKeyAuth.resolve` 和 `OAuthAuth.refresh` 实现总是会收到具体的 signal，并且在执行阻塞工作时必须遵守它。

### 转换请求头

`Models.stream()`、`complete()`、`streamSimple()` 和 `completeSimple()` 接受一个仅属于 Models 的 `transformHeaders` 选项。它在 provider 认证、`model.headers` 和显式 `options.headers` 合并之后、provider 分发之前运行一次：

```typescript
const response = await models.completeSimple(model, context, {
  headers: { "X-Client": "my-app" },
  transformHeaders: async (headers) => ({
    ...headers,
    "X-Request-ID": crypto.randomUUID(),
  }),
});
```

顺序为：

```text
provider auth headers -> model.headers -> explicit options.headers -> transformHeaders -> Provider.stream*()
```

请求头名称以大小写不敏感的方式合并。显式 header 覆盖认证/模型 header，转换函数拥有最终决定权；对某个 header 返回 `null` 可以抑制支持删除的底层默认值。

`transformHeaders` 属于 `Models`，不属于 `Provider`。`Models` 的实现必须消费它，并在调用 `Provider.stream*()` 之前将其移除。Provider 实现继续接收普通的 `ApiStreamOptions` 或 `SimpleStreamOptions`，绝不自行处理该转换。请使用这个选项，而不是在 `stream*()` 之前调用 `getAuth(model)`，那会导致请求认证被解析两次。

### 凭据存储（Credential Store）

存储的凭据（交互式输入的 API key、OAuth token）保存在 `CredentialStore` 中，每个 provider 一条带类型标签的凭据。pi-ai 自带一个内存默认实现；应用可注入持久化存储：

```typescript
import { createModels, type CredentialStore } from '@earendil-works/pi-ai';

const models = createModels({ credentials: myFileBackedStore });
// builtinModels() takes the same options:
// const models = builtinModels({ credentials: myFileBackedStore });
```

接口约定很小：`read(providerId)`、用于非机密的 `{ providerId, type }` 元数据的 `list()`、`modify(providerId, fn)`（唯一的写入路径，即串行化的读-改-写），以及 `delete(providerId)`。每个操作都接受可选的取消选项。枚举操作不得解析机密内容，也不得执行已配置的 key 命令。OAuth token 刷新在 `modify` 内部进行，因此并发的请求和进程无法对同一个轮换后的 token 重复刷新。一条存储的凭据*拥有*其 provider：只有在没有存储任何内容时才会查询环境变量，刷新失败也绝不会悄悄回退到环境变量中的 key。

API key 凭据使用与 pi 的 `auth.json` 相同的 discriminator，并可携带 provider 范围的 env/config 值：

```typescript
const credential = {
  type: 'api_key',
  key: '...',
  env: {
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_GATEWAY_ID: 'gateway-id'
  }
} as const;
```

### 环境变量

内置 provider 会解析这些环境变量（Node.js 环境；在浏览器中请显式传入 `apiKey`）：

| Provider | 环境变量 |
|----------|------------------------|
| OpenAI | `OPENAI_API_KEY` |
| Ant Ling | `ANT_LING_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_BASE_URL`（例如 `https://{resource}.ai.azure.com`）或 `AZURE_OPENAI_RESOURCE_NAME`。支持 `*.openai.azure.com`、`*.cognitiveservices.azure.com` 和 `*.ai.azure.com`；根端点会自动归一化为 `/openai/v1`。可选：`AZURE_OPENAI_API_VERSION`（默认 `v1`）、`AZURE_OPENAI_DEPLOYMENT_NAME_MAP`。 |
| Anthropic | `ANTHROPIC_API_KEY` 或 `ANTHROPIC_OAUTH_TOKEN` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Google | `GEMINI_API_KEY` |
| Vertex AI | `GOOGLE_CLOUD_API_KEY` 或 `GOOGLE_CLOUD_PROJECT`（或 `GCLOUD_PROJECT`）+ `GOOGLE_CLOUD_LOCATION` + ADC |
| Mistral | `MISTRAL_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| Cloudflare AI Gateway | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_GATEWAY_ID` |
| Cloudflare Workers AI | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` |
| xAI | `XAI_API_KEY` |
| Fireworks | `FIREWORKS_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| Baseten | `BASETEN_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| ZAI Coding Plan (Global) | `ZAI_API_KEY` |
| ZAI Coding Plan (China) | `ZAI_CODING_CN_API_KEY` |
| MiniMax (Global) | `MINIMAX_API_KEY` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` |
| Moonshot AI / Moonshot AI (China) | `MOONSHOT_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| OpenCode Zen / OpenCode Go | `OPENCODE_API_KEY` |
| Kimi For Coding | `KIMI_API_KEY` |
| Qwen Token Plan (existing catalog) | `QWEN_TOKEN_PLAN_API_KEY` |
| Qwen Token Plan (Individual) | `QWEN_TOKEN_PLAN_API_KEY` |
| Qwen Token Plan (China) | `QWEN_TOKEN_PLAN_CN_API_KEY` |
| Xiaomi MiMo (API billing) | `XIAOMI_API_KEY` |
| Xiaomi MiMo Token Plan (China) | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| Xiaomi MiMo Token Plan (Amsterdam) | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| Xiaomi MiMo Token Plan (Singapore) | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |
| GitHub Copilot | `COPILOT_GITHUB_TOKEN` |

`qwen-token-plan-individual` 与 `qwen-token-plan` 共享国际端点和 `QWEN_TOKEN_PLAN_API_KEY`。Individual provider 只暴露为 Individual 订阅记录的模型，而 existing provider 出于向后兼容保留更宽的目录。存储的凭据保持 provider 范围，因此请把 key 保存到你注册的 provider ID 下。

Amazon Bedrock 会解析环境中的 AWS 凭据（`AWS_PROFILE`、访问密钥对、`AWS_BEARER_TOKEN_BEDROCK`、ECS 任务角色、web identity token）；其 provider 自带的登录流程支持 bearer token、AWS profile 和现有的凭据链。Vertex AI 会解析显式 key，或 gcloud Application Default Credentials 加 project/location，并针对 API key、ADC 和服务账号文件提供 provider 自带的登录流程。

## 工具（Tools）

工具让 LLM 能够与外部系统交互。本库使用 TypeBox schema 来定义类型安全的工具，并借助 TypeBox 内置的校验器和值转换工具进行自动校验。TypeBox schema 可以按普通 JSON 序列化与反序列化，因此非常适合分布式系统。

### 定义工具

```typescript
import { Type, type Tool, StringEnum } from '@earendil-works/pi-ai';

// Define tool parameters with TypeBox
const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: Type.Object({
    location: Type.String({ description: 'City name or coordinates' }),
    units: StringEnum(['celsius', 'fahrenheit'], { default: 'celsius' })
  })
};

// Note: For Google API compatibility, use StringEnum helper instead of Type.Enum
// Type.Enum generates anyOf/const patterns that Google doesn't support

const bookMeetingTool: Tool = {
  name: 'book_meeting',
  description: 'Schedule a meeting',
  parameters: Type.Object({
    title: Type.String({ minLength: 1 }),
    startTime: Type.String({ format: 'date-time' }),
    endTime: Type.String({ format: 'date-time' }),
    attendees: Type.Array(Type.String({ format: 'email' }), { minItems: 1 })
  })
};
```

### 工具的受限采样（Constrained Sampling）

工具可以选择启用 provider 侧的受限采样。对于 JSON-schema 工具，`strict: 'prefer'` 会在受支持时使用 provider 侧的严格 schema 约束，否则回退到普通 tool calling。当当前 provider/模型无法满足 `strict: 'require'` 时，请求会失败。设置 `constrainedSampling: false` 可显式退出，其行为与省略该字段相同。

```typescript
const strictTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file',
  parameters: Type.Object({
    path: Type.String(),
    content: Type.String()
  }, { additionalProperties: false }),
  constrainedSampling: { type: 'json_schema', strict: 'prefer' }
};
```

严格的 JSON-schema 受限采样支持以下场景：OpenAI、Anthropic、受支持的 Amazon Bedrock Converse 模型、Mistral，以及通过 Google Generative AI 和 Vertex 适配器进行的 Gemini 3 tool call。Google 使用 `VALIDATED` 函数调用模式（显式请求时为 `ANY`）；更早的 Gemini 版本对 `strict: 'prefer'` 会回退处理，并拒绝 `strict: 'require'`，因为它们不强制执行 required 参数。Bedrock 的 strict 工具能力由模型的 structured-output 元数据生成；自定义 Bedrock 模型可以覆盖 `compat.supportsStrictMode`。OpenAI Responses 和 Chat Completions 还能以 OpenAI Lark 或正则 grammar 变体的形式发出受 grammar 约束的自定义工具；若同时提供多个 OpenAI 变体，Lark 优先于正则。当当前模型支持 grammar 工具时会强制应用 grammar 约束，否则该工具回退到普通的 function/JSON-schema 处理。Grammar 工具能力属于模型元数据：生成的目录会在透传 OpenAI custom tools 的端点（OpenAI、OpenAI Codex、Azure OpenAI Responses、GitHub Copilot、opencode 和 Cloudflare AI Gateway）上为 GPT-5 及以上模型设置 `compat.supportsOpenAIGrammarTools`。OpenAI 会拒绝 pre-GPT-5 模型的 `type: "custom"` 工具，而会对工具 schema 做归一化的网关（如 OpenRouter）会破坏这类工具，因此其他端点该标志保持关闭。自定义模型定义可以通过 `compat` 自行启用。支持 grammar 的模型会拒绝缺少非空受支持变体的 grammar 配置。原生 grammar 工具的参数 schema 必须是对象类型，且恰好包含一个必填的 string 属性：

```typescript
const patchTool: Tool = {
  name: 'apply_patch',
  description: 'Apply a patch',
  parameters: Type.Object({
    input: Type.String()
  }, { additionalProperties: false }),
  constrainedSampling: {
    type: 'grammar',
    variants: {
      openai_lark: 'start: /.+/s'
    }
  }
};
```

### 处理 Tool Call

工具结果使用内容块（content block），可以同时包含文本和图片：

```typescript
import { readFileSync } from 'fs';

const context: Context = {
  messages: [{ role: 'user', content: 'What is the weather in London?', timestamp: Date.now() }],
  tools: [weatherTool]
};

const response = await models.complete(model, context);

// Check for tool calls in the response
for (const block of response.content) {
  if (block.type === 'toolCall') {
    // Execute your tool with the arguments
    // See "Validating Tool Arguments" section for validation
    const result = await executeWeatherApi(block.arguments);

    // Add tool result with text content
    context.messages.push({
      role: 'toolResult',
      toolCallId: block.id,
      toolName: block.name,
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: false,
      timestamp: Date.now()
    });
  }
}

// Tool results can also include images (for vision-capable models)
const imageBuffer = readFileSync('chart.png');
context.messages.push({
  role: 'toolResult',
  toolCallId: 'tool_xyz',
  toolName: 'generate_chart',
  content: [
    { type: 'text', text: 'Generated chart showing temperature trends' },
    { type: 'image', data: imageBuffer.toString('base64'), mimeType: 'image/png' }
  ],
  isError: false,
  timestamp: Date.now()
});
```

### 以 Partial JSON 流式传输 Tool Call

在流式传输过程中，tool call 的参数会随着到达被逐步解析。这使得在完整参数就绪之前就能进行实时的 UI 更新：

```typescript
const s = models.stream(model, context);

for await (const event of s) {
  if (event.type === 'toolcall_delta') {
    const toolCall = event.partial.content[event.contentIndex];

    // toolCall.arguments contains partially parsed JSON during streaming
    // This allows for progressive UI updates
    if (toolCall.type === 'toolCall' && toolCall.arguments) {
      // BE DEFENSIVE: arguments may be incomplete
      // Example: Show file path being written even before content is complete
      if (toolCall.name === 'write_file' && toolCall.arguments.path) {
        console.log(`Writing to: ${toolCall.arguments.path}`);

        // Content might be partial or missing
        if (toolCall.arguments.content) {
          console.log(`Content preview: ${toolCall.arguments.content.substring(0, 100)}...`);
        }
      }
    }
  }

  if (event.type === 'toolcall_end') {
    // Here toolCall.arguments is complete (but not yet validated)
    const toolCall = event.toolCall;
    console.log(`Tool completed: ${toolCall.name}`, toolCall.arguments);
  }
}
```

**关于部分 tool 参数的重要说明：**
- 在 `toolcall_delta` 事件期间，`arguments` 包含对部分 JSON 的尽力解析结果
- 字段可能缺失或不完整，使用前务必检查其是否存在
- 字符串值可能在单词中间被截断
- 数组可能不完整
- 嵌套对象可能只填充了一部分
- 至少，`arguments` 会是空对象 `{}`，而不会是 `undefined`
- Google provider 不支持函数调用流式传输。作为替代，你会收到一个携带完整参数的 `toolcall_delta` 事件。

### 校验工具参数

在实现自己的工具执行循环时，使用 `validateToolCall` 在把参数传给你的工具之前进行校验：

```typescript
import { validateToolCall, type Tool } from '@earendil-works/pi-ai';

const tools: Tool[] = [weatherTool, calculatorTool];
const s = models.stream(model, { messages, tools });

for await (const event of s) {
  if (event.type === 'toolcall_end') {
    const toolCall = event.toolCall;

    try {
      // Validate arguments against the tool's schema (throws on invalid args)
      const validatedArgs = validateToolCall(tools, toolCall);
      const result = await executeMyTool(toolCall.name, validatedArgs);
      // ... add tool result to context
    } catch (error) {
      // Validation failed - return error as tool result so model can retry
      context.messages.push({
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: error.message }],
        isError: true,
        timestamp: Date.now()
      });
    }
  }
}
```

### 完整事件参考

成功的生成遵循 `start → updates* → done`。生成开始后的失败遵循 `start → updates* → error`。请求准备（setup）可能在生成开始之前就失败，此时 stream 只包含 `error`；`done` 和更新事件在 `start` 之前都是无效的。直接 API 的 `streamSimple()` 调用在请求认证缺失时会同步抛出异常。

每个非终结事件的 `partial` 都是共享的实时 helper，表示“到目前为止的响应”。它有意设计成不是事件发生时刻的快照：随着生成推进，provider 可能修改同一个 message 和内容块，包括较早的事件还在 stream 队列中等待的时候。请在处理某个事件时检查它，而不要把它留作历史状态。文本块和普通 thinking 块在发出 `*_start` 事件时为空，只通过对应的 `*_delta` 事件增长，直到权威的 `*_end`；redacted thinking 可能在 start 时就是完整的，并且不发出 delta。`toolcall_start` 时的 tool call 参数因 provider 而异；`toolcall_delta` 携带后续的 JSON 更新。

assistant message 生成期间发出的所有流式事件：

| 事件类型 | 描述 | 关键属性 |
|------------|-------------|----------------|
| `start` | Stream 开始 | `partial`: assistant message 的初始结构 |
| `text_start` | 文本块开始 | `contentIndex`: 在 content 数组中的位置 |
| `text_delta` | 收到文本片段 | `delta`: 新文本，`contentIndex`: 位置 |
| `text_end` | 文本块完成 | `content`: 完整文本，`contentIndex`: 位置 |
| `thinking_start` | thinking 块开始 | `contentIndex`: 在 content 数组中的位置 |
| `thinking_delta` | 收到 thinking 片段 | `delta`: 新文本，`contentIndex`: 位置 |
| `thinking_end` | thinking 块完成 | `content`: 完整 thinking 内容，`contentIndex`: 位置 |
| `toolcall_start` | tool call 开始 | `contentIndex`: 在 content 数组中的位置 |
| `toolcall_delta` | tool 参数流式传输中 | `delta`: JSON 片段，`partial.content[contentIndex].arguments`: 部分解析的参数 |
| `toolcall_end` | tool call 完成 | `toolCall`: 完整（但未经 schema 校验）的 tool call，含 `id`、`name`、`arguments` |
| `done` | Stream 完成 | `reason`: 停止原因（"stop"、"length"、"toolUse"），`message`: 最终的 assistant message |
| `error` | 发生错误 | `reason`: 错误类型（"error" 或 "aborted"），`error`: 带部分内容的 AssistantMessage |

不同内容块的流式事件不保证是连续的。Provider 可能在同一个上游 chunk 中发出文本、thinking 和 tool call 的 delta，pi 也可能交错地呈现相应事件，例如 `text_start`、`text_delta`、`toolcall_start`、`text_delta`、`toolcall_delta`。消费方必须使用 `contentIndex` 把每个 delta/end 事件关联到其所属的内容块，并且不得假定某个内容块的 `*_start`/`*_delta`/`*_end` 序列不会被其他内容块的事件打断。

### 紧凑的 Assistant Message 帧

`AssistantMessageFrameEncoder` 把一个 stream 转换成紧凑、可持久化的 `AssistantMessageFrame` 值。每个 stream 创建一个 encoder，并按顺序喂入每个事件。encoder 明白 `partial` 是实时的：如果 provider 已经把后续 delta 排入队列，之后才被消费的块开始事件只会对当前块做一次快照，而被覆盖的排队文本/thinking delta 不会产生重复帧。它只保留每个未闭合块的计数器，外加（临时地）同步一个已经前进的 tool call 所需的原始前缀。它绝不会为每个 token 克隆不断增长的完整 partial。

起始帧包含 content 为空的 message 元数据。文本帧和 thinking 帧在权威结束帧之前，每个生成的字符至多存储一次。如果 tool call 的 start 事件被消费时该调用已经前进，则先用一个紧凑的 JSON 检查点，之后恢复正常 delta。终结性的 `done` 和 `error` 事件不产生帧，因为最终消息的落定是单独处理的。因此，生成开始前的 `error` 不会产生任何帧。

`reduceAssistantMessageFrames()` 是规范意义上的纯 reducer。它重建文本、thinking 和 tool call 参数（包括通过 `contentIndex` 标识的交错块），并拒绝格式错误的序列。它对可迭代对象做单次遍历，在没有起始帧时返回 `undefined`。结束帧会用 provider 权威的已完成内容和元数据替换相应块。该 reducer 不会依据 TypeBox schema 校验工具参数；请在执行前调用 `validateToolCall`。

```typescript
import {
  AssistantMessageFrameEncoder,
  reduceAssistantMessageFrames,
  type AssistantMessageFrame,
} from '@earendil-works/pi-ai';

const encoder = new AssistantMessageFrameEncoder();
const frames: AssistantMessageFrame[] = [];
for await (const event of s) {
  const frame = encoder.encode(event);
  if (frame) frames.push(frame);
}

const reconstructedPartial = reduceAssistantMessageFrames(frames);
const finalMessage = await s.result(); // Persist terminal settlement separately.
```

encoder 会拒绝重复的 start、start 之前的更新、start 之前的 `done`、终结事件之后的事件、重复的块开始，以及块类型不匹配。start 之前的 `error` 是合法的，不产生帧。

## 图片输入

具备视觉能力的模型可以处理图片。你可以通过 `input` 属性检查模型是否支持图片。如果把图片传给不支持视觉的模型，它们会被静默忽略。

```typescript
import { readFileSync } from 'fs';

const model = models.getModel('openai', 'gpt-4o-mini')!;

// Check if model supports images
if (model.input.includes('image')) {
  console.log('Model supports vision');
}

const imageBuffer = readFileSync('image.png');
const base64Image = imageBuffer.toString('base64');

const response = await models.complete(model, {
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in this image?' },
      { type: 'image', data: base64Image, mimeType: 'image/png' }
    ],
    timestamp: Date.now()
  }]
});

// Access the response
for (const block of response.content) {
  if (block.type === 'text') {
    console.log(block.text);
  }
}
```

## 图片生成

图片生成使用与文本/聊天生成分离的 API 界面，设计上与聊天侧一致：`ImagesModels` 集合持有 `ImagesProvider`，读取是同步的，认证通过拥有该模型的 provider 解析。图片生成是一次性 API：`generateImages()` 等待 provider 响应并返回最终的 `AssistantImages` 结果，不要为它使用聊天/stream API。

### 基础图片生成

```typescript
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';

// Every built-in image-generation provider; accepts the same options as createModels()
const imagesModels = builtinImagesModels();

const model = imagesModels.getModel('openrouter', 'google/gemini-2.5-flash-image')!;

// Auth resolves through the provider (OPENROUTER_API_KEY here); explicit apiKey wins
const result = await imagesModels.generateImages(model, {
  input: [{ type: 'text', text: 'Generate a red circle on a plain white background.' }]
});

for (const block of result.output) {
  if (block.type === 'text') {
    console.log(block.text);
  } else if (block.type === 'image') {
    console.log(block.mimeType);
    console.log(block.data.substring(0, 32));
  }
}
```

与聊天侧一样，你可以用各个部件组装集合：`createImagesModels({ credentials?, authContext? })`、来自 `@earendil-works/pi-ai/providers/openrouter-images` 的 `openrouterImagesProvider()` 工厂，以及用于自定义图片 provider 的 `createImagesProvider({ id, auth, models, refreshModels?, api })`（动态列表可用 `imagesModels.refresh(provider?)`）。失败从不 reject，而是返回一个带有 `stopReason: "error"` 的 `AssistantImages`。集合的 provider 范围 `getAuth(providerId)` 与聊天侧的完全一致。

旧的全局 API（`getImageModel()` / `getImageModels()` / `getImageProviders()` / `generateImages()`）仍然可以通过 [compat 入口](#migrating-from-the-old-global-api)使用：

```typescript
import { getImageModel, generateImages } from '@earendil-works/pi-ai/compat';

const model = getImageModel('openrouter', 'google/gemini-2.5-flash-image');
const result = await generateImages(model, {
  input: [{ type: 'text', text: 'Generate a red circle on a plain white background.' }]
}, {
  apiKey: process.env.OPENROUTER_API_KEY
});
```

有些模型还支持图片输入：

```typescript
import { readFileSync } from 'fs';

const imageBuffer = readFileSync('input.png');
const result = await imagesModels.generateImages(model, {
  input: [
    { type: 'text', text: 'Create a variation of this image with a blue background.' },
    { type: 'image', data: imageBuffer.toString('base64'), mimeType: 'image/png' }
  ]
});
```

在模型元数据上检查能力：

```typescript
console.log(model.input);   // ['text', 'image']
console.log(model.output);  // ['image'] or ['image', 'text']
```

### 说明与限制

- 图片模型位于 `ImagesModels` 集合中，聊天模型位于 `Models` 集合中；两者是相互独立的界面。
- 使用 `generateImages()`，而不是聊天/stream API。
- 图片生成模型不参与 tool calling。
- 输出通过 `AssistantImages.output` 返回，可以同时包含 base64 编码的 `ImageContent` 块和 `TextContent` 块。
- 有些模型只返回图片，有些则返回图片加文本。请检查 `model.output`。
- 有些模型接受图片输入，有些只支持文本生成图片。请检查 `model.input`。
- 与流式 API 一样，图片生成支持 `apiKey`、`signal`、`headers`、`onPayload` 和 `onResponse` 等选项，结果可能包含 `stopReason`、`responseId` 和 `usage`。
- 如果你想让模型在对话中分析图片或调用工具，请通过常规聊天 API 使用支持图片输入的模型。
- 目前，图片生成只能通过一个 provider（OpenRouter）使用。

## Thinking/Reasoning

许多模型支持 thinking/reasoning 能力，可以展示其内部思考过程。你可以通过 `reasoning` 属性检查模型是否支持 reasoning。如果把 reasoning 选项传给不支持 reasoning 的模型，它们会被静默忽略。

### 统一接口（streamSimple/completeSimple）

```typescript
// Many models across providers support thinking/reasoning
const model = models.getModel('anthropic', 'claude-sonnet-4-5')!;
// or models.getModel('openai', 'gpt-5-mini');
// or models.getModel('google', 'gemini-2.5-flash');
// or models.getModel('xai', 'grok-4.6');

// Check if model supports reasoning
if (model.reasoning) {
  console.log('Model supports reasoning/thinking');
}

// Use the simplified reasoning option
const response = await models.completeSimple(model, {
  messages: [{ role: 'user', content: 'Solve: 2x + 5 = 13', timestamp: Date.now() }]
}, {
  reasoning: 'medium'  // 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
});

// Access thinking and text blocks
for (const block of response.content) {
  if (block.type === 'thinking') {
    console.log('Thinking:', block.thinking);
  } else if (block.type === 'text') {
    console.log('Response:', block.text);
  }
}
```

`xhigh` 和 `max` 是模型特定、需主动启用的级别。使用 `getSupportedThinkingLevels(model)` 来判断某个具体模型是否暴露这两个级别；GPT-5.6 之类的模型可以两者都支持。

### Provider 特定选项（stream/complete）

`models.stream()`/`complete()` 接受所属 API 的完整选项集。使用 `hasApi()` 把动态查到的模型收窄到其 API，以获得完整的选项类型：

```typescript
import { hasApi } from '@earendil-works/pi-ai';

// OpenAI Reasoning (o1, o3, gpt-5)
const openaiModel = models.getModel('openai', 'gpt-5-mini')!;
if (hasApi(openaiModel, 'openai-responses')) {
  await models.complete(openaiModel, context, {
    reasoningEffort: 'medium',
    reasoningSummary: 'detailed'  // OpenAI Responses API only
  });
}

// Anthropic Thinking
const anthropicModel = models.getModel('anthropic', 'claude-sonnet-4-5')!;
if (hasApi(anthropicModel, 'anthropic-messages')) {
  await models.complete(anthropicModel, context, {
    thinkingEnabled: true,
    thinkingBudgetTokens: 8192  // Optional token limit
  });
}

// Google Gemini Thinking
const googleModel = models.getModel('google', 'gemini-2.5-flash')!;
if (hasApi(googleModel, 'google-generative-ai')) {
  await models.complete(googleModel, context, {
    thinking: {
      enabled: true,
      budgetTokens: 8192  // -1 for dynamic, 0 to disable
    }
  });
}
```

### 流式传输 thinking 内容

流式传输时，thinking 内容通过特定事件传递：

```typescript
const s = models.streamSimple(model, context, { reasoning: 'high' });

for await (const event of s) {
  switch (event.type) {
    case 'thinking_start':
      console.log('[Model started thinking]');
      break;
    case 'thinking_delta':
      process.stdout.write(event.delta);  // Stream thinking content
      break;
    case 'thinking_end':
      console.log('\n[Thinking complete]');
      break;
  }
}
```

## Stop Reasons

每个 `AssistantMessage` 都包含一个 `stopReason` 字段，指示生成是如何结束的：

- `"pending"` - 仅出现在部分（partial）消息中，表示我们还不知道停止原因会是什么
- `"stop"` - 这是模型本轮将产生的最终消息
- `"length"` - 输出达到了最大 token 限制
- `"toolUse"` - 模型正在调用工具并期待工具结果
- `"error"` - 生成过程中发生了错误
- `"aborted"` - 请求通过 abort signal 被取消

`AssistantMessage` 还可能包含 `responseId`，即底层 API 暴露时的 provider 特定上游响应或消息标识符。不要假定它在所有 provider 上都存在。

## 错误处理

stream 返回之后的请求失败从不抛出异常：当请求以错误结束（包括中止和 tool call 校验错误）时，流式 API 会发出 error 事件，最终消息携带详细信息。准备阶段的失败可能只发出 `error` 而没有 `start`；生成开始后的失败会先发出 `start`、所有已观察到的更新，然后是 `error`。直接 API 的 `streamSimple()` 调用在请求认证缺失时会同步抛出异常：

```typescript
// In streaming
for await (const event of s) {
  if (event.type === 'error') {
    // event.reason is either "error" or "aborted"
    // event.error is the AssistantMessage with partial content
    console.error(`Error (${event.reason}):`, event.error.errorMessage);
    console.log('Partial content:', event.error.content);
  }
}

// The final message will have the error details
const message = await s.result();
if (message.stopReason === 'error' || message.stopReason === 'aborted') {
  console.error('Request failed:', message.errorMessage);
  // message.content contains any partial content received before the error
  // message.usage contains partial token counts and costs
}
```

使用 provider 集合时，认证失败（OAuth 刷新失败、未知 provider）会以 `stopReason: "error"` 的 stream 错误形式出现。直接 API 的 `streamSimple()` 调用则在所需认证缺失时同步抛出异常。

### 中止请求

abort signal 允许你取消进行中的请求。被中止的请求其 `stopReason === 'aborted'`：

```typescript
const controller = new AbortController();

// Abort after 2 seconds
setTimeout(() => controller.abort(), 2000);

const s = models.stream(model, {
  messages: [{ role: 'user', content: 'Write a long story', timestamp: Date.now() }]
}, {
  signal: controller.signal
});

for await (const event of s) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'error') {
    // event.reason tells you if it was "error" or "aborted"
    console.log(`${event.reason === 'aborted' ? 'Aborted' : 'Error'}:`, event.error.errorMessage);
  }
}

// Get results (may be partial if aborted)
const response = await s.result();
if (response.stopReason === 'aborted') {
  console.log('Request was aborted:', response.errorMessage);
  console.log('Partial content received:', response.content);
  console.log('Tokens used:', response.usage);
}
```

### 中止后继续

被中止的消息可以加入对话上下文，并在后续请求中继续：

```typescript
const context = {
  messages: [
    { role: 'user', content: 'Explain quantum computing in detail', timestamp: Date.now() }
  ]
};

// First request gets aborted after 2 seconds
const controller1 = new AbortController();
setTimeout(() => controller1.abort(), 2000);

const partial = await models.complete(model, context, { signal: controller1.signal });

// Add the partial response to context
context.messages.push(partial);
context.messages.push({ role: 'user', content: 'Please continue', timestamp: Date.now() });

// Continue the conversation
const continuation = await models.complete(model, context);
```

### 调试 Provider 负载

使用 `onPayload` 回调来检查发送给 provider 的请求负载。这对调试请求格式问题或 provider 校验错误很有用。

```typescript
const response = await models.complete(model, context, {
  onPayload: (payload) => {
    console.log('Provider payload:', JSON.stringify(payload, null, 2));
  }
});
```

`stream`、`complete`、`streamSimple` 和 `completeSimple` 都支持该回调。

## 自定义 Provider

### createProvider()

`createProvider()` 用各个部件构建 provider：身份标识、认证、模型列表和 API 实现。适用于本地推理服务器、代理，或任何 OpenAI/Anthropic 兼容端点：

```typescript
import { createModels, createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

const ollamaModel: Model<'openai-completions'> = {
  id: 'llama-3.1-8b',
  name: 'Llama 3.1 8B (Ollama)',
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000
};

const ollama = createProvider({
  id: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  // Every provider declares auth; keyless local servers resolve as configured with no key.
  auth: { apiKey: { name: 'Ollama', resolve: async () => ({ auth: {} }) } },
  models: [ollamaModel],
  api: openAICompletionsApi(),
});

const models = createModels();
models.setProvider(ollama);

await models.complete(models.getModel('ollama', 'llama-3.1-8b')!, context);
```

对有真实 key 的 provider，`envApiKeyAuth(displayName, envVars)` 提供标准行为（存储的凭据优先，其次取第一个已设置的环境变量）：

```typescript
const proxy = createProvider({
  id: 'my-proxy',
  auth: { apiKey: envApiKeyAuth('My proxy API key', ['MY_PROXY_API_KEY']) },
  models: [/* ... */],
  api: openAICompletionsApi(),
});
```

混合 API 的 provider 传入以 `model.api` 为键的映射；每个模型分发到其 API 的实现：

```typescript
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';

const gateway = createProvider({
  id: 'my-gateway',
  auth: { apiKey: envApiKeyAuth('Gateway key', ['GATEWAY_API_KEY']) },
  models: [/* models with api: 'anthropic-messages' or 'openai-responses' */],
  api: {
    'anthropic-messages': anthropicMessagesApi(),
    'openai-responses': openAIResponsesApi(),
  },
});
```

provider 级别的端点或请求转换应放在 provider 的 API 实现中：把你作为 `api` 传入的 `ProviderStreams` 包装一层，让每个请求在分发前都经过该转换。Cloudflare provider 就是这样用已解析的 provider env 来具体化 account/gateway 端点占位符的：

```typescript
function tenantStreams(streams: ProviderStreams): ProviderStreams {
  const withTenant = (model: Model<Api>) => ({ ...model, baseUrl: model.baseUrl.replace('{tenant}', tenantId) });
  return {
    stream: (model, context, options) => streams.stream(withTenant(model), context, options),
    streamSimple: (model, context, options) => streams.streamSimple(withTenant(model), context, options),
  };
}

const tenantGateway = createProvider({
  id: 'tenant-gateway',
  auth: { apiKey: envApiKeyAuth('Gateway key', ['GATEWAY_API_KEY']) },
  models: [/* ... */],
  api: tenantStreams(openAICompletionsApi()),
});
```

动态模型列表使用 `fetchModels`。`Models.refresh()` 会刷新每个已配置的动态 provider，并传入其生效的 API key 或已刷新的 OAuth 凭据。`ModelsStore` 负责持久化动态目录；两种存储默认都是内存实现。其 `read`、`write` 和 `delete` 操作接受可选的取消信号，`Models` 会把这些等待绑定到 provider 刷新 signal 上。

```typescript
const models = createModels({ credentials, modelsStore });
const llamacpp = createProvider({
  id: 'llamacpp',
  auth: { apiKey: { name: 'llama.cpp', resolve: async () => ({ auth: {} }) } },
  models: [],
  fetchModels: async ({ signal }) => fetchModelsFromServer('http://localhost:8080', signal),
  api: openAICompletionsApi(),
});

models.setProvider(llamacpp);
const result = await models.refresh({ signal });
if (result.aborted) console.log('refresh cancelled');
for (const [provider, error] of result.errors) console.error(provider, error);
```

省略可选 signal 时，`Models.refresh()` 不设限制。Provider 总是会收到具体的 `RefreshModelsContext.signal`，并且在发起网络请求和其他阻塞工作时必须遵守它。当调用方提供了 signal 时，取消之后即使自定义 provider 不配合，`Models.refresh()` 也会及时以 `aborted: true` 返回；但 provider 仍必须遵守该 signal 以停止其底层工作。

使用 `models.refresh({ providers: ['openrouter'] })` 把工作限定在选定的 provider 上，使用 `models.refresh({ allowNetwork: false })` 在不访问网络的情况下恢复已持久化的目录，或使用 `models.refresh({ force: true })` 跳过 provider 的新鲜度检查。模型读取保持同步，返回最后一次恢复或刷新的列表。

`createProvider()` 自动处理动态发布与持久化。手写的 `Provider.refreshModels()` 实现会收到只读的 `context.stored` 快照，并通过 `context.publish({ persist?, update? })` 发布。省略 `persist` 表示存储保持不变，传入一个 `ModelsStoreEntry` 表示写入，传入 `persist: null` 表示删除。发布带有 generation 检查；同步的内存目录变更应放入 `update`，而不是在发布前直接修改状态。

自定义模型可以携带 `headers`（例如位于 bot 检测之后的代理）和 `compat` 标志。`Models.getAuth(model)` 会包含这些模型 header，stream 方法会在显式请求头和 `transformHeaders` 之前合并它们。参见 [OpenAI 兼容性设置](#openai-compatibility-settings)。

一些 OpenAI 兼容服务器无法理解 reasoning 模型使用的 `developer` 角色。对这类 provider，把 `compat.supportsDeveloperRole` 设为 `false`，让 system prompt 改以 `system` 消息发送。如果服务器也不支持 `reasoning_effort`，再把 `compat.supportsReasoningEffort` 设为 `false`。这通常适用于 Ollama、vLLM、SGLang 及类似的 OpenAI 兼容服务器。

使用模型级 `thinkingLevelMap` 描述模型特定的 thinking 控制。键是 pi 的 thinking 级别（`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`）。到 `high` 为止缺失的标准级别使用 provider 默认值；`xhigh` 和 `max` 是需主动启用的级别，要求映射中有非空条目。字符串值会发送给 provider，`null` 表示该级别不受支持，映射可以跳过某些级别。

```typescript
const ollamaReasoningModel: Model<'openai-completions'> = {
  id: 'gpt-oss:20b',
  name: 'GPT-OSS 20B (Ollama)',
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 32000,
  thinkingLevelMap: {
    minimal: null,
    low: null,
    medium: null,
    high: 'high',
    xhigh: null,
  },
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  }
};
```

### 直接调用 API 实现

API 实现本身是可以导入的。每个模块只导出 `stream` 和 `streamSimple`，并带有该 API 的完整选项类型。直接调用会绕过 provider 认证，请显式传入 `apiKey`：

```typescript
import { stream } from '@earendil-works/pi-ai/api/anthropic-messages';

const s = stream(claudeModel, context, {
  apiKey: process.env.ANTHROPIC_API_KEY,
  thinkingEnabled: true,
  thinkingBudgetTokens: 2048,
});
```

内置 API 实现位于 `./api/<api-id>` 之下：

| API id | 选项类型 |
|--------|--------------|
| `anthropic-messages` | `AnthropicOptions` |
| `openai-completions` | `OpenAICompletionsOptions` |
| `openai-responses` | `OpenAIResponsesOptions` |
| `openai-codex-responses` | `OpenAICodexResponsesOptions` |
| `azure-openai-responses` | `AzureOpenAIResponsesOptions` |
| `google-generative-ai` | `GoogleOptions` |
| `google-vertex` | `GoogleVertexOptions` |
| `mistral-conversations` | `MistralOptions` |
| `bedrock-converse-stream` | `BedrockOptions` |

导入实现模块会加载其 SDK。`./api/<id>.lazy` 包装器（provider 工厂使用的就是它）在运行时或 bundler 支持动态 import 分块时，把该加载推迟到首次请求。旧版本的原生 API 子路径（`./anthropic`、`./google`、`./mistral`、`./openai-completions` 等）已被移除；请使用 `@earendil-works/pi-ai/api/<api-id>`。

### OpenAI 兼容性设置

许多 provider 都实现了 `openai-completions` API，但存在细微差别。默认情况下，库会基于 `baseUrl` 为一小部分已知的 OpenAI 兼容 provider（Cerebras、xAI、Chutes、DeepSeek、NVIDIA NIM、Together AI、zAi、OpenCode、Cloudflare Workers AI 等）自动检测兼容性设置。对于自定义代理或未知端点，你可以通过 `compat` 字段覆盖这些设置。对于 `openai-responses` 模型，compat 字段支持 Responses 特定的标志。

```typescript
interface OpenAICompletionsCompat {
  supportsStore?: boolean;           // Whether provider supports the `store` field (default: true)
  supportsDeveloperRole?: boolean;   // Whether provider supports `developer` role vs `system` (default: true)
  supportsReasoningEffort?: boolean; // Whether provider supports `reasoning_effort` (default: true)
  supportsUsageInStreaming?: boolean; // Whether provider supports `stream_options: { include_usage: true }` (default: true)
  supportsStrictMode?: boolean;      // Whether provider supports `strict` in tool definitions (default: true)
  supportsOpenAIGrammarTools?: boolean; // Whether to emit OpenAI custom Lark/regex grammar tools; false falls back to normal function tools (default: false; the generated catalog enables it for capable models)
  sendSessionAffinityHeaders?: boolean; // Send session-affinity data from `sessionId` (default: true for OpenRouter, false otherwise)
  sessionAffinityFormat?: 'openai' | 'openai-nosession' | 'openrouter'; // Format for session affinity: 'openai' uses `prompt_cache_key`, `session_id`, `x-client-request-id`, and `x-session-affinity`; 'openai-nosession' uses `prompt_cache_key`, `x-client-request-id`, and `x-session-affinity`; 'openrouter' uses `x-session-id` (default: auto-detected)
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';  // Which field name to use (default: max_completion_tokens)
  requiresToolResultName?: boolean;  // Whether tool results require the `name` field (default: false)
  requiresAssistantAfterToolResult?: boolean; // Whether tool results must be followed by an assistant message (default: false)
  requiresThinkingAsText?: boolean;  // Whether thinking blocks must be converted to text (default: false)
  requiresReasoningContentOnAssistantMessages?: boolean; // Whether all replayed assistant messages must include empty reasoning_content when reasoning is enabled (default: auto-detected for DeepSeek)
  thinkingFormat?: 'openai' | 'openrouter' | 'deepseek' | 'together' | 'baseten' | 'zai' | 'qwen' | 'chat-template' | 'qwen-chat-template' | 'string-thinking' | 'ant-ling'; // Format for reasoning param: 'openai' uses reasoning_effort, 'openrouter' uses reasoning: { effort }, 'deepseek' uses thinking: { type } plus reasoning_effort when supported, 'together' uses reasoning: { enabled } plus reasoning_effort when supported, 'baseten' uses configurable chat_template_args plus reasoning_effort when supported, 'zai' uses thinking: { type }, 'qwen' uses enable_thinking, 'chat-template' uses configurable chat_template_kwargs, 'qwen-chat-template' uses chat_template_kwargs.enable_thinking and preserve_thinking, 'string-thinking' uses top-level thinking, 'ant-ling' uses reasoning: { effort } only for mapped efforts (default: openai)
  chatTemplateKwargs?: Record<string, string | number | boolean | null | { '$var': 'thinking.enabled' | 'thinking.effort' | 'thinking.budget'; omitWhenOff?: boolean }>; // chat_template_kwargs values; use $var for pi-controlled thinking values
  chatTemplateArgs?: Record<string, string | number | boolean | null | { '$var': 'thinking.enabled' | 'thinking.effort' | 'thinking.budget'; omitWhenOff?: boolean }>; // chat_template_args values for thinkingFormat: 'baseten'; use $var for pi-controlled thinking values
  thinkingTokenBudgetField?: 'thinking_token_budget' | 'thinking_budget' | 'thinking_budget_tokens'; // Top-level field that caps reasoning tokens from thinkingBudgets (vLLM / Qwen / llama.cpp). Off by default.
  supportsThinkingTokenBudget?: boolean; // Alias for thinkingTokenBudgetField: 'thinking_token_budget' (vLLM). Prefer thinkingTokenBudgetField. Default: false.
  cacheControlFormat?: 'anthropic';  // Anthropic-style cache_control on system prompt, last tool, and last user/assistant text content
  openRouterRouting?: OpenRouterRouting; // OpenRouter routing preferences (default: {})
  vercelGatewayRouting?: VercelGatewayRouting; // Vercel AI Gateway routing preferences (default: {})
}

interface OpenAIResponsesCompat {
  supportsDeveloperRole?: boolean;   // Whether provider supports `developer` role vs `system` (default: true)
  sessionAffinityFormat?: 'openai' | 'openai-nosession' | 'openrouter'; // Session-affinity header format: 'openai' sends `session_id` and `x-client-request-id`; 'openai-nosession' sends `x-client-request-id`; 'openrouter' sends `x-session-id`. Does not affect the `prompt_cache_key` body param (default: auto-detected)
  supportsLongCacheRetention?: boolean; // Whether provider supports `prompt_cache_retention: "24h"` (default: true)
  supportsStrictMode?: boolean;      // Whether provider supports strict JSON-schema function tools (default: false; enabled in metadata for built-in OpenAI models)
  supportsOpenAIGrammarTools?: boolean; // Whether to emit OpenAI custom Lark/regex grammar tools; false falls back to normal function tools (default: false; the generated catalog enables it for capable models)
}
```

启用 prompt 缓存时，OpenRouter 请求会从 `sessionId` 发送 `x-session-id`。Chat Completions 和 Anthropic Messages 都会自动检测 OpenRouter 端点，除非 `sendSessionAffinityHeaders` 被显式设为 false。在 Anthropic 兼容模型上，`sessionAffinityFormat: "openrouter"` 选择 `x-session-id`；未设置时使用现有的 `x-session-affinity` 格式。显式请求头优先于生成的请求头。

如果未设置 `compat`，库会回退到基于 URL 的检测。如果部分设置了 `compat`，未指定的字段使用检测到的默认值。这在以下场景很有用：

- **LiteLLM 代理**：可能不支持 `store` 字段
- **自定义推理服务器**：可能使用非标准字段名
- **自托管端点**：可能有不同的功能支持

## 用于测试的 Faux Provider

`fauxProvider()` 构建一个带有预设脚本响应的内存 provider，用于测试和演示：

```typescript
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai';

const faux = fauxProvider({
  tokensPerSecond: 50 // optional
});

const models = createModels();
models.setProvider(faux.provider);

const model = faux.getModel();
const context = {
  messages: [{ role: 'user', content: 'Summarize package.json and then call echo', timestamp: Date.now() }]
};

faux.setResponses([
  fauxAssistantMessage([
    fauxThinking('Need to inspect package metadata first.'),
    fauxToolCall('echo', { text: 'package.json' })
  ], { stopReason: 'toolUse' })
]);

const first = await models.complete(model, context, {
  sessionId: 'session-1',
  cacheRetention: 'short'
});
context.messages.push(first);

context.messages.push({
  role: 'toolResult',
  toolCallId: first.content.find((block) => block.type === 'toolCall')!.id,
  toolName: 'echo',
  content: [{ type: 'text', text: 'package.json contents here' }],
  isError: false,
  timestamp: Date.now()
});

faux.setResponses([
  fauxAssistantMessage([
    fauxThinking('Now I can summarize the tool output.'),
    fauxText('Here is the summary.')
  ])
]);

const s = models.stream(model, context);
for await (const event of s) {
  console.log(event.type);
}

// Optional: multiple faux models for model-switching tests
const multiModel = fauxProvider({
  provider: 'faux-multi',
  models: [
    { id: 'faux-fast', reasoning: false },
    { id: 'faux-thinker', reasoning: true }
  ]
});
models.setProvider(multiModel.provider);
const thinker = multiModel.getModel('faux-thinker');

console.log(thinker?.reasoning);
console.log(faux.getPendingResponseCount());
console.log(faux.state.callCount);
```

说明：
- 响应按请求开始顺序从队列中消费。
- 如果队列为空，faux provider 会返回一条 assistant 错误消息，其 `errorMessage: "No more faux responses queued"`。
- 使用 `faux.setResponses([...])` 替换剩余队列，使用 `faux.appendResponses([...])` 追加更多响应。
- `faux.models` 暴露所有 faux 模型。`faux.getModel()` 返回第一个，`faux.getModel(id)` 返回指定的那个。
- 使用 `fauxAssistantMessage(...)` 生成脚本化的 assistant 回复。使用 `fauxText(...)`、`fauxThinking(...)` 和 `fauxToolCall(...)` 构建内容块，无需手动填写底层字段。
- usage 按每 4 个字符约 1 token 估算。当提供 `sessionId` 且 `cacheRetention` 不是 `"none"` 时，会自动模拟 prompt 缓存读写。
- tool call 参数通过 `toolcall_delta` 块增量流式传输。
- 默认情况下，每个流式块都在自己的 microtask 上发出。设置 `tokensPerSecond` 可按实时节奏控制块的送达。
- 预期用法是每个句柄对应一个确定性的脚本化流程。如果需要独立的并发流程，请用不同的 `provider` id 创建各自的 faux provider。

## 跨 Provider 交接（Handoff）

本库支持在同一个对话中无缝地在不同 LLM provider 之间交接。这让你可以在对话中途切换模型，同时保留上下文，包括 thinking 块、tool call 和工具结果。

当来自一个 provider 的消息被发送给另一个 provider 时，库会自动为兼容性做转换：

- **用户消息和工具结果消息**原样传递
- **来自相同 provider/API 的 assistant 消息**保持原样
- **来自不同 provider 的 assistant 消息**的 thinking 块会转换为带 `<thinking>` 标签的文本
- **tool call 和普通文本**保持不变

```typescript
import { createModels, type Context } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';

const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(openaiProvider());
models.setProvider(googleProvider());

const context: Context = { messages: [] };

// Start with Claude
const claude = models.getModel('anthropic', 'claude-sonnet-4-5')!;
context.messages.push({ role: 'user', content: 'What is 25 * 18?', timestamp: Date.now() });
context.messages.push(await models.completeSimple(claude, context, { reasoning: 'medium' }));

// Switch to GPT-5 - it will see Claude's thinking as <thinking> tagged text
const gpt5 = models.getModel('openai', 'gpt-5-mini')!;
context.messages.push({ role: 'user', content: 'Is that calculation correct?', timestamp: Date.now() });
context.messages.push(await models.complete(gpt5, context));

// Switch to Gemini
const gemini = models.getModel('google', 'gemini-2.5-flash')!;
context.messages.push({ role: 'user', content: 'What was the original question?', timestamp: Date.now() });
const geminiResponse = await models.complete(gemini, context);
```

所有 provider 都能处理来自其他 provider 的消息，包括文本、tool call 与结果（含图片）、thinking 块（已转换为带标签的文本），以及带部分内容的被中止消息。这带来灵活的工作流：先用快速模型，复杂推理时切换到更强的模型，或在 provider 故障期间保持连续性。

## 上下文序列化

`Context` 对象可以使用标准 JSON 方法轻松序列化与反序列化，让持久化对话、实现聊天历史或在服务之间传输上下文变得简单：

```typescript
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'What is TypeScript?', timestamp: Date.now() }
  ]
};

const model = models.getModel('openai', 'gpt-4o-mini')!;
const response = await models.complete(model, context);
context.messages.push(response);

// Serialize the entire context
const serialized = JSON.stringify(context);

// Save to database, localStorage, file, etc.
localStorage.setItem('conversation', serialized);

// Later: deserialize and continue the conversation
const restored: Context = JSON.parse(localStorage.getItem('conversation')!);
restored.messages.push({ role: 'user', content: 'Tell me more about its type system', timestamp: Date.now() });

// Continue with any model
const newModel = models.getModel('anthropic', 'claude-3-5-haiku-20241022')!;
const continuation = await models.complete(newModel, restored);
```

模型也是普通的可序列化数据，不附带任何函数或实现，所以持久化“这段对话用的是哪个模型”只需要一次 `JSON.stringify`。

> **注意**：如果上下文包含图片（如图片输入一节所示以 base64 编码），它们也会被序列化。

## 浏览器中使用

本库支持浏览器环境。核心入口和 provider 工厂没有副作用，可以干净地打包。浏览器中无法使用环境变量，因此请显式传入 API key，或者注入一个 `CredentialStore`（例如基于 localStorage），让 provider 认证从存储的凭据解析：

```typescript
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

const models = createModels();
models.setProvider(anthropicProvider());

const model = models.getModel('anthropic', 'claude-3-5-haiku-20241022')!;
const response = await models.complete(model, {
  messages: [{ role: 'user', content: 'Hello!', timestamp: Date.now() }]
}, {
  apiKey: 'your-api-key'
});
```

> **安全警告**：在前端代码中暴露 API key 很危险。任何人都可以提取并滥用你的 key。只应在内部工具或演示中使用这种方式。对生产应用，请使用能保证 API key 安全的后端代理。

浏览器兼容性说明：

- 浏览器环境不支持 Amazon Bedrock（`bedrock-converse-stream`）。它仍可能出现在模型列表中，但调用会在运行时失败。
- OAuth 登录流程仅限 Node。它们通过 bundler 不可见的导入进行 lazy 加载，因此注册支持 OAuth 的 provider 不会把仅限 Node 的代码拉进浏览器包，只有真正执行登录才会。
- 如果你需要从 Web 应用使用 Bedrock 或基于 OAuth 的认证，请使用服务端代理或后端服务。

## 打包与 Tree Shaking

想要更小的包，只导入你需要的 provider：

```typescript
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

const models = createModels();
models.setProvider(openaiProvider());
```

规则：

- `@earendil-works/pi-ai` 是核心入口，不导入内置目录、provider 工厂或 SDK 实现。
- `@earendil-works/pi-ai/providers/<provider>` 只导入该 provider 的目录和 lazy API 包装器。
- `@earendil-works/pi-ai/providers/all` 导入所有内置 provider 工厂和全部目录。只有当你想要完整的内置集合时才使用它。
- 在代码分割下，provider SDK 留在 lazy chunk 中，首次请求时加载。
- 没有代码分割时，bundler 会把可达的 lazy API 实现合并进单一包。此时单 provider 的包会包含该 provider 的 SDK；`providers/all` 会包含所有静态可见的 SDK。Bedrock 是例外：其 AWS SDK 实现通过 bundler 不可见的仅限 Node 的导入加载。
- 直接导入 `@earendil-works/pi-ai/api/<api-id>` 会立即加载该 API 实现及其 SDK。

在新的打包应用中避免使用 `@earendil-works/pi-ai/compat`；它保留了旧的全局 API，并导入完整的内置目录界面。

对于单文件 Node ESM 包，一些 SDK 依赖内部可能仍使用动态 CommonJS `require()`。如果你看到诸如 `Dynamic require of "child_process" is not supported` 的错误，请向包中添加一个 Node `require` shim。以 esbuild 为例：

```bash
esbuild app.js --bundle --platform=node --format=esm \
  --banner:js='import { createRequire } from "module";const require = createRequire(import.meta.url);' \
  --outfile=app.bundle.js
```

这只适用于 Node 包；它不是浏览器或 Cloudflare Workers 的解决办法。

Bedrock 仅限 Node。像添加其他 provider 一样添加它：

```typescript
import { createModels } from '@earendil-works/pi-ai';
import { amazonBedrockProvider } from '@earendil-works/pi-ai/providers/amazon-bedrock';

const models = createModels();
models.setProvider(amazonBedrockProvider());
```

在正常的 Node 包使用和代码分割的包中，Bedrock 会 lazy 加载其 AWS SDK 实现。对于必须包含 Bedrock 支持的独立单文件包，请显式注册实现模块：

```typescript
import { setBedrockProviderModule } from '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';

setBedrockProviderModule(bedrockProviderModule);
```

这个显式覆盖会把 AWS SDK 打进包里。没有它的话，Bedrock 不透明的运行时导入会要求包的 Bedrock 实现文件在运行时可用。

### Provider 范围的环境变量覆盖

在 stream 选项中传入 `env`，把 provider 配置限定到单个请求。对于 provider 认证和配置（如 Cloudflare account ID、Azure OpenAI 设置、Vertex project/location、Bedrock 设置、`PI_CACHE_RETENTION` 以及 `HTTP_PROXY`/`HTTPS_PROXY`），`env` 中的值优先于进程环境变量。

```typescript
const models = builtinModels();
const model = models.getModel('cloudflare-ai-gateway', 'workers-ai/@cf/moonshotai/kimi-k2.6')!;

const response = await models.complete(model, context, {
  env: {
    CLOUDFLARE_API_KEY: '...',
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    CLOUDFLARE_GATEWAY_ID: 'gateway-id'
  }
});
```

当同一个进程需要针对每个请求使用不同 provider 设置，或不希望环境变量泄漏进 provider 调用时，可以使用这个功能。

## OAuth Provider

一些 provider 支持 OAuth 认证，而非静态 API key：

- **Anthropic**（Claude Pro/Max 订阅）
- **OpenAI Codex**（ChatGPT Plus/Pro 订阅，可使用 GPT-5.x Codex 模型）
- **GitHub Copilot**（Copilot 订阅）
- **OpenRouter**（OAuth PKCE，铸造一个由用户控制的 API key）

这些 provider 都在 `provider.auth.oauth` 上携带一个 `OAuthAuth`，包含三种操作：`login(interaction)` 使用 provider 无关的 `AuthInteraction.prompt()`/`notify()` 协议并返回一个凭据；`refresh(credential, signal)` 在适用时刷新即将过期的凭据；`toAuth(credential)` 派生请求认证（GitHub Copilot 的按账号 base URL 就来自这里）。Provider 的登录交互和刷新调用总是携带具体的 abort signal。刷新是自动的：`models.getAuth(providerId)` 和请求路径会在凭据存储锁之下刷新过期 token，因此并发的请求和进程不会重复刷新。OpenRouter 的 OAuth 流程返回的则是永久 API key，所以它的刷新操作是空操作。

```typescript
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

const models = createModels({ credentials: myStore }); // persistent CredentialStore
models.setProvider(anthropicProvider());

// Login: Models drives the flow and persists the credential
await models.login('anthropic', 'oauth', {
  prompt: async (p) => {
    // p.type: 'text' | 'secret' | 'select' | 'manual_code'
    // manual_code prompts race a local callback server; p.signal aborts them when the server wins
    return await askUser(p.message);
  },
  notify: (event) => {
    // event.type: 'info' | 'auth_url' | 'device_code' | 'progress'
    if (event.type === 'info') {
      console.log(event.message);
      for (const link of event.links ?? []) console.log(`${link.label ?? 'More information'}: ${link.url}`);
    }
    if (event.type === 'auth_url') console.log(`Open: ${event.url}`);
    if (event.type === 'device_code') console.log(`Code: ${event.userCode} at ${event.verificationUri}`);
    if (event.type === 'progress') console.log(event.message);
  },
});

// From here on, requests resolve and refresh the token automatically
const model = models.getModel('anthropic', 'claude-sonnet-4-5')!;
await models.complete(model, context);

// Logout
await models.logout('anthropic');
```

### Vertex AI

Vertex AI 模型支持 Google Cloud API key 或 Application Default Credentials（ADC）其中之一。其 provider 自带的 API key 登录流程可以配置任意一种方式：

- **API key**：设置 `GOOGLE_CLOUD_API_KEY`，或在调用选项中传入 `apiKey`。
- **本地开发（ADC）**：运行 `gcloud auth application-default login`
- **CI/生产环境（ADC）**：把 `GOOGLE_APPLICATION_CREDENTIALS` 指向服务账号 JSON 密钥文件

使用 ADC 时，还需设置 `GOOGLE_CLOUD_PROJECT`（或 `GCLOUD_PROJECT`）和 `GOOGLE_CLOUD_LOCATION`。你也可以在调用选项中传入 `project`/`location`。使用 `GOOGLE_CLOUD_API_KEY` 时则不需要 `project` 和 `location`。

```bash
# Local (uses your user credentials)
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="my-project"
export GOOGLE_CLOUD_LOCATION="us-central1"

# CI/Production (service account key file)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

官方文档：[Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)

### CLI 登录

最快的认证方式：

```bash
npx @earendil-works/pi-ai login              # interactive provider selection
npx @earendil-works/pi-ai login anthropic    # login to specific provider
npx @earendil-works/pi-ai list               # list available providers
```

凭据会保存到当前目录下的 `auth.json`。

### 编程式 OAuth

内置的登录和刷新流程是私有的 provider 实现。请使用 provider 自带的 `OAuthAuth`，它可以与 `CredentialStore` 组合，并通过 `Models` 获得带锁的自动刷新。`@earendil-works/pi-ai/oauth` 入口只保留 coding-agent 扩展 OAuth 兼容所需的类型声明。

Provider 说明：

**OpenAI Codex**：需要 ChatGPT Plus 或 Pro 订阅。提供对 GPT-5.x Codex 模型的访问，具有扩展的上下文窗口和 reasoning 能力。当 stream 选项中提供 `sessionId` 且 `cacheRetention` 不是 `"none"` 时，库会自动处理基于会话的 prompt 缓存。你可以在 stream 选项中把 `transport` 设置为 `"sse"`、`"websocket"` 或 `"auto"` 来选择 Codex Responses 的传输方式。使用 WebSocket 且带 `sessionId` 并启用缓存保留时，连接按会话复用，闲置 5 分钟后过期。

**Azure OpenAI (Responses)**：只使用 Responses API。设置 `AZURE_OPENAI_API_KEY`，以及 `AZURE_OPENAI_BASE_URL` 或 `AZURE_OPENAI_RESOURCE_NAME` 之一。`AZURE_OPENAI_BASE_URL` 同时支持 `https://<resource>.openai.azure.com` 和 `https://<resource>.cognitiveservices.azure.com`；根端点会自动归一化为 `.../openai/v1`。如需覆盖 API 版本，可使用 `AZURE_OPENAI_API_VERSION`（默认 `v1`）。部署名默认被视为模型 ID，可通过 `azureDeploymentName` 或 `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` 覆盖，后者使用逗号分隔的 `model-id=deployment` 对（例如 `gpt-4o-mini=my-deployment,gpt-4o=prod`）。有意不支持旧的基于部署的 URL。

**GitHub Copilot**：如果你收到 “The requested model is not supported” 错误，请在 VS Code 中手动启用该模型：打开 Copilot Chat，点击模型选择器，选中该模型（带警告图标），然后点击 “Enable”。

## 从旧的全局 API 迁移

旧版本暴露一个全局 API：`stream()`/`complete()` 通过全局注册表按 `model.api` 分发、同步的 `getModel()`/`getModels()`/`getProviders()` 目录读取、`registerApiProvider()`、`getEnvApiKey()`，以及按 API 的 lazy stream 函数。这些界面在 **compat 入口**上原样保留：

```typescript
// Before
import { getModel, complete } from '@earendil-works/pi-ai';

// After (verbatim behavior, one import-path change)
import { getModel, complete } from '@earendil-works/pi-ai/compat';
```

Compat 是根入口的严格超集，因此文件可以整体切换导入路径。它将在未来的版本中移除；请迁移到 `createModels()` + provider 工厂：

| 旧 | 新 |
|-----|-----|
| `getModel('openai', 'gpt-4o-mini')` | `models.getModel('openai', 'gpt-4o-mini')` 或来自 `providers/all` 的 `getBuiltinModel()` |
| `getModels('anthropic')` / `getProviders()` | `models.getModels('anthropic')` / `models.getProviders()` 或 `getBuiltin*` |
| `stream(model, ctx, opts)`（env key 注入） | `models.stream(model, ctx, opts)`（provider 认证解析） |
| `registerApiProvider({ api, stream, streamSimple })` | `createProvider({ id, auth, models, api })` + `models.setProvider()` |
| `getEnvApiKey('openai')` | `await models.getAuth(model.provider)` |
| `streamAnthropic(model, ctx, opts)` | 来自 `@earendil-works/pi-ai/api/anthropic-messages` 的 `stream`，或集合中的 provider |
| `registerFauxProvider()` | `fauxProvider()` + `models.setProvider()` |

## 开发

### 添加新 Provider

添加一个新的 LLM provider 需要修改多个文件。分层布局为：API 实现位于 `src/api/`，provider 工厂位于 `src/providers/`，稳定的生成目录包装器位于 `src/providers/<id>.models.ts`，`src/models.generated.ts` 负责注册它们。以下清单涵盖所有必要步骤：

#### 1. 核心类型（`src/types.ts`）

- 如果是新 API，把 API 标识符加入 `KnownApi`（例如 `"bedrock-converse-stream"`）
- 把 provider 名称加入 `KnownProvider`（例如 `"amazon-bedrock"`）
- 把选项类型加入 `ApiOptionsMap`

#### 2. API 实现（`src/api/<api-id>.ts`，仅限新 API）

创建一个新的 API 实现文件（例如 `bedrock-converse-stream.ts`），只导出 `stream` 和 `streamSimple`，外加：

- 一个继承 `StreamOptions` 的选项接口（例如 `BedrockOptions`）
- 把 `Context` 转换为 provider 格式的消息转换函数
- 如果 provider 支持工具，还需要工具转换
- 发出标准化事件（`text`、`tool_call`、`thinking`、`usage`、`stop`）的响应解析

添加 lazy 包装器 `src/api/<api-id>.lazy.ts`（通过 `lazyApi()` 提供 `<name>Api()`），让 provider 无需导入其 SDK 即可引用该实现。在 `src/index.ts` 中添加应当继续从 `@earendil-works/pi-ai` 可用的根级 `export type` 再导出。

#### 3. 模型生成（`scripts/generate-models.ts`、`scripts/generate-image-models.ts`）

- 添加从 provider 的来源（例如 models.dev API）拉取并解析模型的逻辑
- 通过 `scripts/generate-models.ts` 把支持聊天/工具的 provider 模型数据映射到标准化的 `Model` 接口；hydration 会把被忽略的 `src/providers/data/<id>.json` 值按 API 分组，而稳定的 `src/providers/<id>.models.ts` 包装器直接从这些 JSON 键派生出精确的模型/API 类型
- 通过 `scripts/generate-image-models.ts` 把图片生成 provider 的模型数据映射到标准化的 `ImagesModel` 接口
- 处理 provider 特有的怪癖（定价格式、能力标志、模型 ID 转换）

#### 4. Provider 工厂（`src/providers/<id>.ts`）

- 用 `createProvider()` 把目录 + 认证 + lazy API 包装器连接起来
- 认证：标准 key provider 用 `envApiKeyAuth`，环境式认证（AWS profile、ADC）用自定义 `ApiKeyAuth`，存在 OAuth 流程时用 `lazyOAuth`
- 在 `src/providers/all.ts` 中注册该工厂
- 如果是新 API：在 `src/compat.ts` 的内置列表中注册它，并在 `package.json` 中添加包子路径导出

#### 5. 测试（`test/`）

创建或更新测试文件以覆盖新 provider：

- `stream.test.ts` - 基础流式传输和工具使用
- `tokens.test.ts` - token usage 报告
- `abort.test.ts` - 请求取消
- `empty.test.ts` - 空消息处理
- `context-overflow.test.ts` - 上下文超限错误
- `image-limits.test.ts` - 图片支持（如适用）
- `unicode-surrogate.test.ts` - Unicode 处理
- `tool-call-without-result.test.ts` - 孤立的 tool call
- `image-tool-result.test.ts` - 工具结果中的图片
- `total-tokens.test.ts` - token 计数准确性
- `cross-provider-handoff.test.ts` - 跨 provider 上下文重放
- `providers.test.ts` - provider 列表与认证解析

对于 `cross-provider-handoff.test.ts`，至少添加一个 provider/模型组合。如果该 provider 暴露多个模型家族（例如 GPT 和 Claude），每个家族至少添加一个组合。

对非标准认证的 provider（AWS、Google Vertex），创建一个类似 `bedrock-utils.ts` 的工具文件，包含凭据检测辅助函数。

#### 6. Coding Agent 集成（`../coding-agent/`）

更新 `src/core/model-resolver.ts`：

- 在 `DEFAULT_MODELS` 中为该 provider 添加默认模型 ID

更新 `src/cli/args.ts`：

- 在帮助文本中添加环境变量文档

更新 `README.md`：

- 在 providers 一节添加该 provider 及其配置说明

#### 7. 文档

更新 `packages/ai/README.md`：

- 添加到“支持的 Provider”一节
- 记录任何 provider 特定的选项或认证要求
- 把环境变量添加到环境变量一节

#### 8. 更新日志

在 `packages/ai/CHANGELOG.md` 的 `## [Unreleased]` 下添加条目：

```markdown
### Added
- Added support for [Provider Name] provider ([#PR](link) by [@author](link))
```

## 许可证

MIT
