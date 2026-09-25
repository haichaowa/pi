> 译注：本文是 `packages/coding-agent/docs/models.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# 自定义模型

通过 `~/.pi/agent/models.json` 添加自定义 provider 和 model（Ollama、vLLM、LM Studio、代理等）。

## 目录

- [最小示例](#minimal-example)
- [完整示例](#full-example)
- [支持的 API](#supported-apis)
- [Provider 配置](#provider-configuration)
- [Model 配置](#model-configuration)
- [覆盖内置 Provider](#overriding-built-in-providers)
- [按模型覆盖](#per-model-overrides)
- [Anthropic Messages 兼容性](#anthropic-messages-compatibility)
- [OpenAI 兼容性](#openai-compatibility)

## 最小示例

对于本地 model（Ollama、LM Studio、vLLM），每个 model 只需提供 `id`：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" },
        { "id": "qwen2.5-coder:7b" }
      ]
    }
  }
}
```

`apiKey` 的值只是一个占位符，因为 Ollama 会忽略它。但 pi 仍要求 model 先通过认证才会出现在 `/model` 中，因此无密钥的本地服务器应保留一个占位值，或者通过 `/login` 为该 provider 保存一个 key，或者在选择 model 时传入 `--api-key`。

一些 OpenAI 兼容服务器无法理解支持 reasoning 的 model 所使用的 `developer` 角色。对于这类 provider，请将 `compat.supportsDeveloperRole` 设为 `false`，这样 pi 会改用 `system` 消息发送 system prompt。如果服务器也不支持 `reasoning_effort`，请同时将 `compat.supportsReasoningEffort` 设为 `false`。

你可以在 provider 层级设置 `compat` 使其作用于所有 model，也可以在 model 层级设置以覆盖某个特定 model。这通常适用于 Ollama、vLLM、SGLang 以及类似的 OpenAI 兼容服务器。

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "gpt-oss:20b",
          "reasoning": true
        }
      ]
    }
  }
}
```

## 完整示例

当需要特定取值时，可以覆盖默认值：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        {
          "id": "llama3.1:8b",
          "name": "Llama 3.1 8B (Local)",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

每次打开 `/model` 时都会重新加载该文件。可以在会话期间编辑，无需重启。

## Google AI Studio 示例

结合 `baseUrl` 使用 `google-generative-ai`，即可添加来自 Google AI Studio 的 model，包括自定义的 Gemma 4 条目：

```json
{
  "providers": {
    "my-google": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "api": "google-generative-ai",
      "apiKey": "$GEMINI_API_KEY",
      "models": [
        {
          "id": "gemma-4-31b-it",
          "name": "Gemma 4 31B",
          "input": ["text", "image"],
          "contextWindow": 262144,
          "reasoning": true
        }
      ]
    }
  }
}
```

为 `google-generative-ai` API 类型添加自定义 model 时，`baseUrl` 是必需的。

## 支持的 API

| API | 说明 |
|-----|-------------|
| `openai-completions` | OpenAI Chat Completions（兼容性最好） |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

可以在 provider 层级设置 `api`（对该 provider 的所有 model 生效），也可以在 model 层级设置（按 model 覆盖）。

## Provider 配置

| 字段 | 说明 |
|-------|-------------|
| `baseUrl` | API 端点 URL |
| `api` | API 类型（见上文） |
| `apiKey` | 可选的 API key 配置（取值解析见下文）。当认证由 `/login`/`auth.json` 或命令行 `--api-key` 提供时可省略。 |
| `oauth` | 动态 OAuth provider 类型。目前支持 `"radius"`；需要提供网关的 `baseUrl`。 |
| `headers` | 自定义 headers（取值解析见下文） |
| `authHeader` | 设为 `true` 时自动添加 `Authorization: Bearer <apiKey>` |
| `models` | model 配置数组 |
| `modelOverrides` | 对该 provider 上内置或由扩展注册的 model 的按模型覆盖 |

对于带 `models` 的 provider，非内置 provider 配置需要在 provider 或 model 层级提供 `baseUrl` 和 `api` 值。加载文件本身不要求 `apiKey`：当通过 `/login`/`auth.json`、命令行 `--api-key` 或 provider 的 `apiKey` 配置好认证后，model 即可使用。如果未配置任何认证，model 会照常加载，但在 `/model` 和 `--list-models` 中保持不可用。

### 取值解析

`apiKey` 和 `headers` 字段支持命令执行、环境变量插值和字面量：

- **Shell 命令：**以 `"!command"` 开头的值会作为命令整体执行，并使用其 stdout 输出
  ```json
  "apiKey": "!security find-generic-password -ws 'anthropic'"
  "apiKey": "!op read 'op://vault/item/credential'"
  ```
- **环境变量插值：**`"$ENV_VAR"` 或 `"${ENV_VAR}"` 使用指定变量的值。插值也可以出现在更长的字面量内部。
  ```json
  "apiKey": "$MY_API_KEY"
  "apiKey": "${KEY_PREFIX}_${KEY_SUFFIX}"
  ```
  `$FOO_BAR` 表示变量 `FOO_BAR`；当 `BAR` 是字面文本时，请写成 `${FOO}_BAR`。环境变量缺失会导致该值无法解析。
- **转义：**`"$$"` 输出字面量 `"$"`；`"$!"` 输出字面量 `"!"`，且不会触发命令执行。
  ```json
  "apiKey": "$$literal-dollar-prefix"
  "apiKey": "$!literal-bang-prefix"
  ```
- **字面量：**直接使用原值。诸如 `MY_API_KEY` 这样的大写普通字符串会被视为字面量；要引用环境变量请使用 `$MY_API_KEY`。
  ```json
  "apiKey": "sk-..."
  ```

对于 `models.json`，shell 命令会在发起请求时解析。pi 有意不对任意命令套用内置的 TTL、过期值复用或恢复逻辑。不同命令需要不同的缓存与失败处理策略，pi 无法推断哪种才合适。

如果你的命令执行缓慢、开销大、有速率限制，或者希望在出现临时故障时继续沿用上一次的值，请把它封装进你自己的脚本或命令，以实现所需的缓存或 TTL 行为。

`/model` 的可用性检查只看已配置的认证是否存在，不会执行 shell 命令。

### 自定义 Headers

```json
{
  "providers": {
    "custom-proxy": {
      "baseUrl": "https://proxy.example.com/v1",
      "apiKey": "$MY_API_KEY",
      "api": "anthropic-messages",
      "headers": {
        "x-portkey-api-key": "$PORTKEY_API_KEY",
        "x-secret": "!op read 'op://vault/item/secret'"
      },
      "models": [...]
    }
  }
}
```

## Model 配置

| 字段 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------------|
| `id` | 是 | — | model 标识符（传给 API） |
| `name` | 否 | `id` | 人类可读的 model 标签。用于匹配（`--model` 模式），并显示为次要的 model 详情文本。 |
| `api` | 否 | provider 的 `api` | 为该 model 覆盖 provider 的 API |
| `reasoning` | 否 | `false` | 是否支持 extended thinking |
| `thinkingLevelMap` | 否 | 省略 | 将 pi 的 thinking 级别映射到 provider 取值，并标记不支持的级别（见下文） |
| `input` | 否 | `["text"]` | 输入类型：`["text"]` 或 `["text", "image"]` |
| `contextWindow` | 否 | `128000` | context window 大小（以 token 计） |
| `maxTokens` | 否 | `16384` | 最大输出 token 数 |
| `samplingParams` | 否 | 省略 | 原样合并进每个请求体的采样参数（见下文） |
| `cost` | 否 | 全为 0 | 每百万 token 费率，支持可选的按整个请求生效的 input 定价档位 |
| `compat` | 否 | provider 的 `compat` | provider 兼容性覆盖。两者同时设置时，与 provider 层级的 `compat` 合并。 |

cost 档位会提供一整套替代费率，当总 input 用量（`input + cacheRead + cacheWrite`）超过 `inputTokensAbove` 时，该档位对整个请求生效。当多个档位都匹配时，取阈值最高的那个。

```json
{
  "cost": {
    "input": 5,
    "output": 30,
    "cacheRead": 0.5,
    "cacheWrite": 6.25,
    "tiers": [
      {
        "inputTokensAbove": 272000,
        "input": 10,
        "output": 45,
        "cacheRead": 1,
        "cacheWrite": 12.5
      }
    ]
  }
}
```

当前行为：
- `/model`、`--list-models` 和交互式底栏按 model `id` 显示条目。
- 配置的 `name` 用于 model 匹配和次要 model 详情文本，不会替换底栏/状态栏中的 model id。

### 采样参数

`samplingParams` 是一个自由格式的对象，会在 pi 自身设置的字段之后原样合并进该 model 的每个请求体，因此其中的键具有更高优先级。可以用它来发送 pi 未建模的采样参数——包括服务器特有的参数，例如 llama.cpp 的 `min_p` 或 vLLM 的 `top_k`：

```json
{
  "id": "deepseek-v4-flash",
  "samplingParams": {
    "temperature": 1.0,
    "top_p": 0.95,
    "top_k": 0,
    "min_p": 0.0
  }
}
```

只有 OpenAI 兼容 API 会应用它（`openai-completions`、`openai-responses`、`azure-openai-responses`）；其他 API 会忽略它。其中的键会覆盖 pi 设置的同名请求字段（例如这里的 `temperature` 键会压过请求级的 temperature），因此建议把它作为某个 model 采样参数的唯一事实来源。在 `modelOverrides` 中，`samplingParams` 会按键与基础 model 的值合并。

也可以在这里设置一个固定的 thinking token 上限，但它不会跟随 `thinkingBudgets`，也不会为回答预留空间。要实现该目的，请优先使用 `compat.thinkingTokenBudgetField`（或其别名 `supportsThinkingTokenBudget`）。

### Thinking Level Map

在 model 上使用 `thinkingLevelMap` 来描述该 model 特有的 thinking 控制。键是 pi 的 thinking 级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。映射可以存在缺口，例如某个 model 可以只暴露 `high` 和 `max` 而不暴露 `xhigh`。

取值是三态的：

| 取值 | 含义 |
|-------|---------|
| 省略 | `high` 及以下的标准级别使用 provider 的默认映射；扩展的 `xhigh` 和 `max` 级别不受支持 |
| 字符串 | 该级别受支持，此值会发送给 provider |
| `null` | 该级别不受支持，会被隐藏/跳过/收敛掉 |

只支持 off、high 和 max reasoning 的 model 示例：

```json
{
  "id": "deepseek-v4-pro",
  "reasoning": true,
  "thinkingLevelMap": {
    "minimal": null,
    "low": null,
    "medium": null,
    "high": "high",
    "xhigh": null,
    "max": "max"
  }
}
```

thinking 无法关闭的 model 示例：

```json
{
  "id": "always-thinking-model",
  "reasoning": true,
  "thinkingLevelMap": {
    "off": null
  }
}
```

迁移：旧配置中使用的 `compat.reasoningEffortMap` 应改为 model 层级的 `thinkingLevelMap`。不应在 UI 中出现的级别请使用 `null`。

## 覆盖内置 Provider

无需重新定义 model，即可让内置 provider 经过代理转发：

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1"
    }
  }
}
```

所有内置 Anthropic model 仍然可用。现有的 OAuth 或 API key 认证继续有效。

要将自定义 model 合并进内置 provider，请提供 `models` 数组：

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://my-proxy.example.com/v1",
      "apiKey": "$ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
      "models": [...]
    }
  }
}
```

合并语义：
- 保留内置 model。
- 自定义 model 在该 provider 内按 `id` 进行 upsert。
- 如果自定义 model 的 `id` 与某个内置 model 的 `id` 相同，则自定义 model 会替换该内置 model。
- 如果自定义 model 的 `id` 是新的，则会在内置 model 之外新增。

## 按模型覆盖

使用 `modelOverrides` 可以自定义内置 model 以及匹配的扩展注册 model，而无需替换 provider 的完整 model 列表。

```json
{
  "providers": {
    "openrouter": {
      "modelOverrides": {
        "anthropic/claude-sonnet-4": {
          "name": "Claude Sonnet 4 (Bedrock Route)",
          "compat": {
            "openRouterRouting": {
              "only": ["amazon-bedrock"]
            }
          }
        }
      }
    }
  }
}
```

`modelOverrides` 对每个 model 支持以下字段：`name`、`reasoning`、`thinkingLevelMap`、`input`、`cost`（部分更新）、`contextWindow`、`maxTokens`、`samplingParams`（按键合并）、`headers`、`compat`。

OpenAI 直连的 GPT-5.6 Sol、Terra 和 Luna 默认使用 `272000` 的 context window，以确保请求保持在 OpenAI 短上下文定价档位内。要选用 OpenAI 的 1.05M context window，请为你使用的每个 model 增大该值：

```json
{
  "providers": {
    "openai": {
      "modelOverrides": {
        "gpt-5.6-sol": {
          "contextWindow": 1050000
        }
      }
    }
  }
}
```

该覆盖会保留内置的定价元数据。总 input token 超过 272K 的请求将对整个请求采用 GPT-5.6 的长上下文费率。需要时对 `gpt-5.6-terra` 或 `gpt-5.6-luna` 应用同样的覆盖。

行为说明：
- `modelOverrides` 会应用于内置 provider 的 model 以及匹配的扩展注册 provider 的 model。
- 未知的 model ID 会被忽略。
- provider 层级的 `baseUrl`/`headers` 可以与 `modelOverrides` 组合使用。
- 覆盖 `name` 只会改变 model 匹配和次要详情文本；底栏和主要的 model 列表仍显示 model `id`。
- 如果该 provider 还定义了 `models`，自定义 model 会在内置覆盖之后合并。具有相同 `id` 的自定义 model 会替换被覆盖后的内置 model 条目。

## Anthropic Messages 兼容性

对于使用 `api: "anthropic-messages"` 的 provider 或代理，可使用 `compat` 控制 Anthropic 特有的请求兼容性。

默认情况下，pi 会为每个 tool 发送 `eager_input_streaming: true`。如果代理或 Anthropic 兼容后端拒绝该字段，请将 `supportsEagerToolInputStreaming` 设为 `false`。此时 pi 会省略 `tools[].eager_input_streaming`，并改为在启用 tool 的请求上发送旧的 `fine-grained-tool-streaming-2025-05-14` beta header。

一些 Anthropic model 要求使用 adaptive thinking（`thinking.type: "adaptive"` 加上 `output_config.effort`），而不是旧的基于预算的 thinking 负载。内置 model 会自动设置。对于路由到这些 model 的自定义 provider 或别名，请将 `forceAdaptiveThinking` 设为 `true`。

支持按轮次 effort 的 Claude model 需要设置 `supportsMidConvoEffort`。此后 pi 会持久化每次响应中的 provider effort，在后续请求中重建仅含 effort 的 system 消息，并附带 `prefix_mismatch_behavior: "drop_block"` 发送 thinking 绑定控制，以避免过期的带签名 thinking 前缀导致持续的 400 响应。仅应在忠实转发的 Anthropic Messages 传输上、针对完全匹配的受支持 Claude model 设置此项；对只是模仿 Messages 形态的 API 不要启用。

一些 Anthropic 兼容 provider 会发出签名为空的 thinking block，并且在重放时仍期望收到它们。只为这类 provider 将 `allowEmptySignature` 设为 `true`；真正的 Anthropic 会拒绝签名为空的 thinking。

内置 Anthropic model 在其 model 元数据中启用了 `supportsStrictTools`。自定义 Anthropic 兼容 model 若其 endpoint 接受严格的 JSON-schema tool 定义，则必须将其设为 `true`。

```json
{
  "providers": {
    "anthropic-proxy": {
      "baseUrl": "https://proxy.example.com",
      "api": "anthropic-messages",
      "apiKey": "$ANTHROPIC_PROXY_KEY",
      "compat": {
        "supportsEagerToolInputStreaming": false,
        "supportsLongCacheRetention": true,
        "forceAdaptiveThinking": true,
        "allowEmptySignature": true
      },
      "models": [
        {
          "id": "claude-opus-4-7",
          "reasoning": true,
          "input": ["text", "image"]
        }
      ]
    }
  }
}
```

| 字段 | 说明 |
|-------|-------------|
| `supportsEagerToolInputStreaming` | provider 是否接受每个 tool 的 `eager_input_streaming`。默认：`true`。设为 `false` 时省略该字段，并在启用 tool 的请求上改用旧的 fine-grained tool streaming beta header。 |
| `supportsLongCacheRetention` | 当 cache retention 为 `long` 时，provider 是否接受 Anthropic 的长 cache retention（`cache_control.ttl: "1h"`）。默认：`true`。 |
| `sendSessionAffinityHeaders` | 启用缓存时，是否基于 session id 发送 `x-session-affinity`。默认：对已知 provider 自动检测。 |
| `supportsCacheControlOnTools` | provider 是否接受 tool 定义上 Anthropic 风格的 `cache_control` 标记。默认：`true`。 |
| `forceAdaptiveThinking` | 是否为该 model 发送 adaptive thinking（`thinking.type: "adaptive"` 加上 `output_config.effort`）。内置 adaptive model 会自动设置。默认：`false`。 |
| `supportsMidConvoEffort` | 该 Claude model 的传输层是否支持按轮次 effort 的 system 消息以及 thinking 绑定控制。启用后 pi 会持久化原生 effort 级别，并且总是发送 `drop_block`。默认：`false`。 |
| `allowEmptySignature` | 重放时是否将空 thinking 签名按 `signature: ""` 发送，而不是把 thinking 转成文本。默认：`false`。 |
| `supportsStrictTools` | provider 是否接受严格的 JSON-schema tool 定义。默认：`false`；内置 Anthropic model 会在生成的元数据中启用它。 |

## OpenAI 兼容性

对于只部分兼容 OpenAI 的 provider，请使用 `compat` 字段。

- provider 层级的 `compat` 为该 provider 下的所有 model 提供默认值。
- model 层级的 `compat` 为该 model 覆盖 provider 层级的取值。

```json
{
  "providers": {
    "local-llm": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "compat": {
        "supportsUsageInStreaming": false,
        "maxTokensField": "max_tokens"
      },
      "models": [...]
    }
  }
}
```

| 字段 | 说明 |
|-------|-------------|
| `supportsStore` | provider 是否支持 `store` 字段 |
| `supportsDeveloperRole` | 使用 `developer` 还是 `system` 角色 |
| `supportsReasoningEffort` | 是否支持 `reasoning_effort` 参数 |
| `supportsUsageInStreaming` | 是否支持 `stream_options: { include_usage: true }`（默认：`true`） |
| `supportsFinishReason` | 流式响应是否包含 `finish_reason`。为 `false` 时，pi 会在流结束时推断 `stop` 或 `toolUse`。默认：`true`。 |
| `maxTokensField` | 使用 `max_completion_tokens` 还是 `max_tokens` |
| `requiresToolResultName` | 在 tool 结果消息中包含 `name` |
| `requiresAssistantAfterToolResult` | 在 tool 结果之后、用户消息之前插入一条 assistant 消息 |
| `requiresThinkingAsText` | 将 thinking block 转换为纯文本 |
| `requiresReasoningContentOnAssistantMessages` | 启用 reasoning 时，在所有重放的 assistant 消息上包含空的 `reasoning_content` |
| `thinkingFormat` | 使用 `reasoning_effort`、`openrouter`、`deepseek`、`together`、`baseten`、`zai`、`qwen`、`chat-template` 或 `qwen-chat-template` 的 thinking 参数 |
| `chatTemplateKwargs` | `thinkingFormat: "chat-template"` 所用的 `chat_template_kwargs` 值；pi 控制的 thinking 值使用 `{ "$var": "thinking.enabled" }`、`{ "$var": "thinking.effort" }` 或 `{ "$var": "thinking.budget" }` |
| `chatTemplateArgs` | `thinkingFormat: "baseten"` 所用的 `chat_template_args` 值；pi 控制的 thinking 值使用 `{ "$var": "thinking.enabled" }`、`{ "$var": "thinking.effort" }` 或 `{ "$var": "thinking.budget" }` |
| `thinkingTokenBudgetField` | 顶层请求字段，用于限制来自 `thinkingBudgets` 的 reasoning token 数，并会收敛以保证至少为回答保留 1024 个 token。可选 `"thinking_token_budget"`（vLLM）、`"thinking_budget"`（Qwen/DashScope/SGLang）、`"thinking_budget_tokens"`（llama.cpp）。默认关闭；生成的目录中不设置。 |
| `supportsThinkingTokenBudget` | `thinkingTokenBudgetField: "thinking_token_budget"`（vLLM）的别名。建议使用 `thinkingTokenBudgetField`。默认：`false`。 |
| `cacheControlFormat` | 在 system prompt、最后一个 tool 定义以及最后一条 user、assistant 或 tool 结果文本内容上使用 Anthropic 风格的 `cache_control` 标记。目前仅支持 `anthropic`。 |
| `sendSessionAffinityHeaders` | 对于 `openai-completions`，启用缓存时基于 session id 发送 session-affinity header。默认：`false`。 |
| `sessionAffinityFormat` | 对于 `openai-completions` 和 `openai-responses`，session-affinity header 的格式：`openai` 发送 `session_id`/`x-client-request-id`（completions 还发送 `x-session-affinity`），`openai-nosession` 省略含下划线的 `session_id` header，`openrouter` 发送 `x-session-id`。不影响 `prompt_cache_key` 请求体参数。默认：自动检测。 |
| `supportsStrictMode` | provider 是否接受严格的 JSON-schema function tool 定义。默认值取决于 API；内置 OpenAI model 带有显式的能力元数据。 |
| `supportsOpenAIGrammarTools` | OpenAI 兼容 API 是否会发出自定义 Lark/regex grammar tool。为 `false` 时，受语法约束的 tool 回退为普通 function tool。默认：`false`；内置 model 目录为 OpenAI、OpenAI Codex、Azure OpenAI、GitHub Copilot、opencode 和 Cloudflare AI Gateway 上的 GPT-5+ model 启用了它。 |
| `deferredToolsMode` | 使用 provider 特有的延迟 tool 序列化。目前仅支持 `"kimi"`，用于 Kimi 的 OpenAI 兼容 Chat Completions 格式。 |
| `supportsLongCacheRetention` | 当 cache retention 为 `long` 时，provider 是否接受长 cache retention：GPT-5.6+ Responses model 使用 `prompt_cache_options.ttl: "30m"`，更早的 OpenAI model 使用 `prompt_cache_retention: "24h"`；当 `cacheControlFormat` 为 `anthropic` 时使用 `cache_control.ttl: "1h"`。默认：`true`。 |
| `openRouterRouting` | OpenRouter 的 provider 路由偏好。该对象会原样放入 [OpenRouter API 请求](https://openrouter.ai/docs/guides/routing/provider-selection)的 `provider` 字段发送。 |
| `vercelGatewayRouting` | Vercel AI Gateway 的 provider 选择路由配置（`only`、`order`） |

`openrouter` 使用 `reasoning: { effort }`。`together` 使用 `reasoning: { enabled }`，并在 `supportsReasoningEffort` 启用时同时发送 `reasoning_effort`。`qwen` 使用顶层的 `enable_thinking`。需要 `chat_template_kwargs.enable_thinking` 和 `preserve_thinking` 的本地 Qwen 兼容服务器请使用 `qwen-chat-template`。需要可配置 `chat_template_kwargs` 的 vLLM/Hugging Face chat 模板请使用 `chat-template`，例如针对 DeepSeek V3.x 模板使用 `chatTemplateKwargs: { "thinking": { "$var": "thinking.enabled" } }`。通过 `chat_template_args` 暴露开关并可选支持顶层 `reasoning_effort` 的 provider，请使用 `thinkingFormat: "baseten"` 配合 `chatTemplateArgs`。

`thinkingTokenBudgetField` 与 `thinkingFormat` 相互独立。不要在生成的 Qwen 目录上启用它：这些 model 已经在发送 `reasoning_effort`，而 DashScope 会拒绝同时出现 `thinking_budget` 与 `reasoning_effort`。

`cacheControlFormat: "anthropic"` 适用于通过文本内容和 tool 定义上的 `cache_control` 标记来提供 Anthropic 风格 prompt caching 的 OpenAI 兼容 provider。

示例：

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "$OPENROUTER_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "openrouter/anthropic/claude-3.5-sonnet",
          "name": "OpenRouter Claude 3.5 Sonnet",
          "compat": {
            "openRouterRouting": {
              "allow_fallbacks": true,
              "require_parameters": false,
              "data_collection": "deny",
              "zdr": true,
              "enforce_distillable_text": false,
              "order": ["anthropic", "amazon-bedrock", "google-vertex"],
              "only": ["anthropic", "amazon-bedrock"],
              "ignore": ["gmicloud", "friendli"],
              "quantizations": ["fp16", "bf16"],
              "sort": {
                "by": "price",
                "partition": "model"
              },
              "max_price": {
                "prompt": 10,
                "completion": 20
              },
              "preferred_min_throughput": {
                "p50": 100,
                "p90": 50
              },
              "preferred_max_latency": {
                "p50": 1,
                "p90": 3,
                "p99": 5
              }
            }
          }
        }
      ]
    }
  }
}
```

Vercel AI Gateway 示例：

```json
{
  "providers": {
    "vercel-ai-gateway": {
      "baseUrl": "https://ai-gateway.vercel.sh/v1",
      "apiKey": "$AI_GATEWAY_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "moonshotai/kimi-k2.5",
          "name": "Kimi K2.5 (Fireworks via Vercel)",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 0.6, "output": 3, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 262144,
          "maxTokens": 262144,
          "compat": {
            "vercelGatewayRouting": {
              "only": ["fireworks", "novita"],
              "order": ["fireworks", "novita"]
            }
          }
        }
      ]
    }
  }
}
```
