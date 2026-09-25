# pi-ai 包解析：统一多厂商 LLM API

> 对应包：`packages/ai`（npm 包名 `@earendil-works/pi-ai`，约 179 个源文件 / 2.4 万行）。
> 它是整个 monorepo 的地基：所有 LLM 请求最终都经过这里。唯一内部依赖是 `@earendil-works/pi-telemetry`（且只用了类型）。
> 官方 README 中文翻译见 `docs/translations/packages/ai/README.md`（原文极详尽，有事件参考与迁移指南）。

## 1. 一句话定位

把 OpenAI、Anthropic、Google、Bedrock、Mistral 等 **40 家厂商** 的 LLM API 统一成一套调用方式：统一的模型目录、统一的认证解析（API key / OAuth）、统一的流式消息协议、统一的用量与成本核算。

## 2. 核心设计思想：按「API 协议」抽象，不按「厂商」抽象

这是本包最重要的一个设计决策。`packages/ai/src/types.ts:17` 定义了 10 种 `KnownApi`：

```
openai-completions / openai-responses / azure-openai-responses / openai-codex-responses
anthropic-messages / bedrock-converse-stream / google-generative-ai / google-vertex
mistral-conversations / pi-messages
```

一个「厂商」= 认证方式 + 模型目录 + 绑定到某个 API 协议。所以 groq、cerebras、deepseek、together、fireworks 等 30 多家 OpenAI 兼容厂商全部复用同一个 `openai-completions` 适配器——新增一家厂商往往只需要写一个 ~40 行的工厂文件（例如 `packages/ai/src/providers/anthropic.ts` 只有 59 行）。

`pi-messages` 是 pi 自有的线上协议（POST `<baseUrl>/messages` 返回 SSE 事件流），是 Radius gateway 说的语言。

## 3. 对外 API 怎么用

注意：`src/index.ts` **不导出任何 `stream()`/`complete()` 函数**——核心入口是 `Models` 对象（多入口在 package.json `exports` 里：`./providers/*`、`./api/*`、`./compat` 等）：

```ts
import { createModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models = builtinModels();  // createModels() + 40 个内置 provider
const stream = models.streamSimple(model, context, { reasoning: "high" });
for await (const event of stream) { /* 处理流式事件 */ }
const message = await stream.result();  // 拿最终 AssistantMessage
```

`Models` 接口的两层 API（都在 `packages/ai/src/models.ts`）：

| 方法 | 行号 | 特点 |
|---|---|---|
| `stream()` / `complete()` | models.ts:203 / 687 | 传 provider 原生选项 |
| `streamSimple()` / `completeSimple()` | models.ts:695 / 703 | **provider 中立**：`reasoning: ThinkingLevel`（6 档）、`toolChoice`、`deferred` 等，由适配层翻译成各家方言 |

另有 `streamDeferred` / `fetchDeferred` / `cancelDeferred`（异步长任务）、`createProvider()`（models.ts:775）、`createModels()`（models.ts:748）、动态目录两阶段 `refresh()`（先恢复缓存再联网，带 generation 防竞态）。

## 4. 目录地图

| 目录 | 规模 | 职责 | 学习优先级 |
|---|---|---|---|
| `src/api/` | 32 文件 / 约 1.2 万行 | **包的心脏**：按 API 协议的适配器实现 | 最高 |
| `src/auth/` | 16 文件 / 约 3.6 千行 | 认证类型与解析 + 8 家 OAuth 流程 | 高 |
| `src/providers/` | 88 文件 / 约 2.5 千行 | 40 个厂商工厂 + `all.ts` 注册表 + `faux.ts` 测试替身（708 行） | 中（每个文件都很短） |
| `src/utils/` | 23 文件 / 约 2.5 千行 | event-stream、两层重试、overflow、流式 JSON 解析等 | 高 |
| src 根 | 20 文件 / 约 3 千行 | `types.ts`(881 行)、`models.ts`(957 行) | 最高 |
| `scripts/` | 7 文件 / 约 3.7 千行 | 构建期模型目录生成器 | 低（了解即可） |

**生成代码提醒**：`src/models.generated.ts`（124 行）只是索引；真正的模型数据在 `src/providers/data/*.json`（约 3.2MB）——**该目录被 .gitignore（根 .gitignore 第 11 行），克隆后不存在**，必须先跑 `npm run generate-models`（联网）生成，否则编译失败。41 个 `*.models.ts` 桩文件（每个 8 行）只是把 JSON flatten 成类型。

## 5. 核心类型速查（全部在 `packages/ai/src/types.ts`）

**消息**（types.ts:422）：`Message = UserMessage | AssistantMessage | ToolResultMessage`。`AssistantMessage` 关键字段：`content`、`api`、`provider`、`model`、`responseModel`（OpenRouter auto 路由后的真实模型）、`usage`、`stopReason`、`deferred`、`errorMessage`、`timestamp`。

**内容块**（types.ts:351）：`TextContent`、`ThinkingContent`（带 `thinkingSignature` 用于回放）、`ImageContent`（base64）、`ToolCall`。注意没有独立的 assistant 文本/工具块类型——都内联在 `AssistantMessage.content` 数组里。

**工具**（types.ts:517）：`Tool { name, description, parameters: TSchema }`。schema 用 **typebox**（不是 zod），`Type` 构造器从 index 导出。

**流式事件**（types.ts:546）：`AssistantMessageEvent` = `start | text_start/delta/end | thinking_start/delta/end | toolcall_start/delta/end | done | error`，每个事件都带 `partial: AssistantMessage`。两条契约要记住：
- `start` 之前不得有 delta；
- **`partial` 是共享可变的"目前为止"对象，不是快照**——消费者不可缓存它（性能考虑），要快照自己 `{...partial}` 拷贝。

**流原语**：`AssistantMessageEventStream`（`src/utils/event-stream.ts:91`，继承通用 `EventStream<T,R>`）——手写 FifoQueue 背压，`push()` / `for await` / `result(): Promise<AssistantMessage>`。

**模型**（types.ts:845）：`Model<TApi> { id, provider, api, baseUrl, reasoning, thinkingLevelMap?, input, cost(分层计价), contextWindow, maxTokens, compat? }`。`compat` 是条件类型：按 `api` 映射到对应协议的 Compat 配置（OpenAI 家族约 30 个开关，`thinkingFormat` 有 11 种方言——这是维护长尾 OpenAI 兼容服务器的核心机制，也是本包最大的复杂度来源；无显式配置时 `detectCompat`（`openai-completions.ts:1581`）按 provider id / baseUrl 自动判定）。

## 6. 关键执行流：一次「带工具的流式调用」怎么走

以 `models.streamSimple(model, context, { reasoning: "high" })`（Anthropic 协议）为例：

1. **`ModelsImpl.streamSimple`**（`src/models.ts:695`）→ 包进 **`lazyStream`**（`src/api/lazy.ts:46`）：**同步**返回一个空流，认证解析等异步准备在背后跑，失败则以 `error` 事件终止流。"stream 永远同步返回"的关键技巧。
2. 准备阶段：`requireProvider` → `applyAuth`（models.ts:641）：`resolveProviderAuth` 合并存储的凭据与环境变量（`src/env-api-keys.ts` 定义各家 env 名），产出 `{ apiKey, headers, env }`。
3. `createProvider` 的 **`dispatch`**（models.ts:794）按 `model.api` 路由到对应协议的 `ProviderStreams` 实现。
4. **`lazyApi` 包装**（`src/api/anthropic-messages.lazy.ts`，4 行）动态 `import("./anthropic-messages.ts")`，`forwardStream` 把内层事件搬进外层流（为了 tree-shaking，SDK 只在真正用到时才加载——`sideEffects` 白名单仅 3 个文件）。
5. **协议层 `streamSimple`**（`src/api/anthropic-messages.ts:846`）：认证缺失时**同步 throw**（唯一允许同步抛错的路径）→ `buildBaseOptions`（`src/api/simple-options.ts:21`，推理预算/maxTokens 策略）→ 调 `stream`。
6. **`stream`**（anthropic-messages.ts:502）：
   - `createClient`（:898）建 SDK 客户端；
   - `buildParams`（:1021）：`convertMessages`（:1223）把统一 `Message[]` 转成 Anthropic 格式；`convertTools`（:1425）typebox → JSON Schema 并按 `cacheRetention` 打 `cache_control` 标记（`getCacheControl` :63）；`getBetaFeatures`（:979）拼 beta header；
   - `options.onPayload` 回调允许调用方改写最终 payload（调试/魔改入口）；
   - **`retryProviderRequest`**（`src/utils/provider-retry.ts:105`）发起请求——**SDK 内建重试全部关闭（maxRetries: 0），重试由 pi 统一控制**（HTTP 429/5xx，尊重 Retry-After，有 `maxRetryDelayMs` 上限防挂死）；
   - `stream.push({ type: "start" })` → **手写 SSE 解码器** `iterateSseMessages`（:402，不依赖 SDK 的流类型）→ `iterateAnthropicEvents`（:461）把 Anthropic 事件翻译成统一事件：`message_start` 记 usage 并 `calculateCost`（models.ts:891，Anthropic 1h cache write 按 2 倍 input 价计）；`content_block_delta` 里的 `input_json_delta` 用 `parseStreamingJson`（partial-json 库）**增量解析流式工具参数**；`message_delta` → `mapStopReason`（:1464）统一 `StopReason`；
   - 终态 `push({type:"done"})` + `stream.end()`；异常则保留已累积的 partial、`stopReason` 置 error/aborted 再发 `error` 事件。`complete()` 等的就是 `.result()`。

其他协议同构：`openai-completions.ts`（1717 行，最复杂）、`google-generative-ai.ts` / `google-vertex.ts`（共享 `google-shared.ts`）、`bedrock-converse-stream.ts`（AWS SDK + Smithy middleware 保 SigV4 签名）、`openai-codex-responses.ts`（1657 行，WebSocket 传输 + SSE fallback）、`mistral-conversations.ts`。

## 7. 认证体系（`src/auth/`）

- `Credential = ApiKeyCredential | OAuthCredential`（`src/auth/types.ts`）；
- `CredentialStore`：read/list/modify/delete，**modify 是唯一写路径且串行化**（OAuth refresh 在锁内跑，防止并发双刷新）——锁语义的注释值得精读；
- `ApiKeyAuth { login?, check?, resolve() }`：环境变量、AWS profile、ADC 文件都算 apiKey 认证；
- `OAuthAuth { login, refresh, toAuth }`：8 家 OAuth 流程在 `src/auth/oauth/`（openai-codex 544 行、github-copilot 507 行、radius 403 行、anthropic 364 行等）；
- 解析入口 `resolveProviderAuth`（`src/auth/resolve.ts:50`），错误统一为 `ModelsError`（code: auth/oauth/provider/stream/model_source…）。

## 8. 新手必知的坑

1. **fresh clone 编译失败**：`src/providers/data/` 不在 git 里，先跑 `npm run generate-models`（需联网）。`npm run build` 会自动做；`build:offline` 用已有数据。
2. **两条错误语义**：直接调适配层的 `streamSimple`（不经 Models）时认证缺失会**同步 throw**；经 `Models` 则变成流内 `error` 事件。
3. **`partial` 不可缓存**：事件里的 `partial` 是同一个被持续修改的对象。
4. **Anthropic OAuth（Claude Pro/Max）模式下工具名会被重写**（`fromClaudeCodeName`，伪装 Claude Code 客户端的兼容处理）。
5. **`compat.ts` 是遗留兼容层**（298 行，旧全局 API），文件头注明「coding-agent 迁移完成后删除」——学新代码绕开它，但 coding-agent 还有 12 处在用。

## 9. 推荐阅读顺序（15 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 1 | `packages/ai/src/types.ts` | 全部核心类型的唯一来源；先读消息/事件/Model/Compat 四块 |
| 2 | `packages/ai/src/utils/event-stream.ts` | 111 行的流原语，push/迭代/result 协作 |
| 3 | `packages/ai/src/models.ts` | 运行时中枢：Models/Provider/calculateCost |
| 4 | `packages/ai/src/api/lazy.ts` | 「同步返回流 + 异步准备」的胶水，贯穿所有调用路径 |
| 5 | `packages/ai/src/providers/anthropic.ts` + `anthropic.models.ts` | 59+8 行，最小 provider 工厂范本 |
| 6 | `packages/ai/src/providers/all.ts` | 40 家注册表与静态目录读取 |
| 7 | `packages/ai/src/api/anthropic-messages.ts` | 最完整的适配器范本（SSE 手解析、缓存、thinking、工具流） |
| 8 | `packages/ai/src/api/simple-options.ts` | streamSimple 的推理预算策略，95 行小而关键 |
| 9 | `packages/ai/src/api/openai-completions.ts` | 最复杂的适配器；重点 `detectCompat` 与 `convertMessages` |
| 10 | `packages/ai/src/auth/types.ts` | 认证抽象与 CredentialStore 锁语义 |
| 11 | `packages/ai/src/auth/resolve.ts` | `resolveProviderAuth` 合并顺序 |
| 12 | `packages/ai/src/utils/provider-retry.ts` + `retry.ts` | 双层重试（HTTP 层 / agent 层） |
| 13 | `packages/ai/src/api/transform-messages.ts` | 跨 provider 上下文迁移（图片占位符、消息裁剪），配合 `utils/overflow.ts` |
| 14 | `packages/ai/scripts/generate-models.ts` | 模型目录数据管线（只需读结构与 override 表） |
| 15 | `packages/ai/src/providers/faux.ts` | 708 行的可编程假 provider，写测试/演示的标准工具 |

## 10. 被谁消费

grep 确认：`coding-agent`（177 个文件引用，主力消费者）、`agent`（64 个）、`evals`（4 个）、`session-backends/sqlite-node`（3 个）、`server`（1 个）。

---

下一篇：`docs/04-package-agent.md`——pi-ai 之上如何长出 agent 循环。
