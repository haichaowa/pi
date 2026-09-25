> 译注：本文是 `packages/coding-agent/docs/settings.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# 设置

pi 使用 JSON 设置文件，项目设置会覆盖全局设置。

| 位置 | 作用范围 |
|----------|-------|
| `~/.pi/agent/settings.json` | 全局（所有项目） |
| `.pi/settings.json` | 项目（当前目录） |

可以直接编辑，或使用 `/settings` 调整常用选项。要以交互方式保存启动时的 model 默认值，请使用 `/model` 并在目标 model 上按 Ctrl+S。要保存启动时的 thinking 级别，请使用 `/thinking` 并按 Ctrl+S。

## 项目信任

交互模式启动时，如果某个项目文件夹包含项目级设置、资源或项目 `.agents/skills`，且 `~/.pi/agent/trust.json` 中没有针对该文件夹或其父文件夹的已保存决定，pi 会先询问是否信任该文件夹。信任一个项目后，pi 才会加载 `.pi/settings.json` 和 `.pi` 资源、安装缺失的项目包并执行项目扩展。

非交互模式（`-p`、`--mode json` 和 `--mode rpc`）不会显示信任提示。在没有适用的已保存信任决定时，它们会使用全局设置中的 `defaultProjectTrust`：`ask`（默认）和 `never` 会忽略这些项目资源，`always` 则信任它们。可以通过 `--approve`/`-a` 或 `--no-approve`/`-na` 为单次运行覆盖项目信任。

当没有适用的扩展或已保存决定时，`defaultProjectTrust` 决定回退行为。可以在 `~/.pi/agent/settings.json` 中将其设为 `"ask"`、`"always"` 或 `"never"`，也可以通过 `/settings` 修改。

`pi config` 和包管理命令使用同样的项目信任流程，但 `pi update` 从不提示。传入 `--approve` 可在单条命令中信任项目级设置，传入 `--no-approve` 则忽略它们。

在交互模式中使用 `/trust` 可为以后的会话保存项目信任决定，包括对直接父文件夹的信任。它只写入 `~/.pi/agent/trust.json`；当前会话不会重新加载，因此需要重启 pi 才能生效。

## 全部设置

### Model 与 Thinking

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `defaultProvider` | string | - | 启动时的 provider（例如 `"anthropic"`、`"openai"`；通过在 `/model` 中按 Ctrl+S 保存，或手动编辑） |
| `defaultModel` | string | - | 启动时的 model ID（通过在 `/model` 中按 Ctrl+S 保存，或手动编辑） |
| `defaultThinkingLevel` | string | - | 启动时的 thinking 级别（通过在 `/thinking` 中按 Ctrl+S 保存，或手动编辑）：`"off"`、`"minimal"`、`"low"`、`"medium"`、`"high"`、`"xhigh"`、`"max"` |
| `modelThinkingLevels` | object | - | 按 `"provider/modelId"` 索引的各 model 启动 thinking 级别；可在 `/settings` → Default thinking level per model 中配置，或手动编辑 |
| `hideThinkingBlock` | boolean | `false` | 在输出中隐藏 thinking block |
| `showCacheMissNotices` | boolean | `false` | 在会话记录中显示相关提示：显著的 prompt cache 未命中、compaction 或 branch summary 用量，以及 provider 恢复诊断信息（例如被丢弃的 Anthropic thinking block） |
| `thinkingBudgets` | object | - | 每个 thinking 级别的自定义 token 预算。Anthropic、Google 和 Bedrock 原生使用它们。OpenAI 兼容 model 在设置了 `compat.thinkingTokenBudgetField`（或 `supportsThinkingTokenBudget`）时使用它们。 |

#### thinkingBudgets

```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

### UI 与显示

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `theme` | string | `"dark"` | 主题名（`"dark"`、`"light"` 或自定义主题） |
| `externalEditor` | string | 依次为 `$VISUAL`、`$EDITOR`，Windows 上为 Notepad，其他平台为 `nano` | Ctrl+G 外部编辑器命令；优先于环境变量 |
| `quietStartup` | boolean | `false` | 隐藏启动时的头部信息 |
| `defaultProjectTrust` | string | `"ask"` | 项目信任的回退行为：`"ask"`、`"always"` 或 `"never"`。仅限全局设置 |
| `collapseChangelog` | boolean | `false` | 更新后显示精简版 changelog |
| `enableInstallTelemetry` | boolean | `true` | 发送匿名的安装/更新 ping 以及所选 provider 的归因 header。不控制更新检查 |
| `enableAnalytics` | boolean | `false` | 选择性加入的 analytics 数据共享。目前仅在实验性的首次设置流程（`PI_EXPERIMENTAL=1`）中询问 |
| `trackingId` | string | - | analytics 跟踪标识符，在开启 `enableAnalytics` 时生成 |
| `doubleEscapeAction` | string | `"tree"` | 连按两次 Esc 触发的动作：`"tree"`、`"fork"` 或 `"none"` |
| `treeFilterMode` | string | `"default"` | `/tree` 的默认过滤模式：`"default"`、`"no-tools"`、`"user-only"`、`"labeled-only"`、`"all"` |
| `editorPaddingX` | number | `0` | 输入编辑器的水平内边距（0-3） |
| `outputPad` | number | `1` | 用户消息、assistant 消息和 thinking 的水平内边距（0 或 1） |
| `autocompleteMaxVisible` | number | `5` | 自动补全下拉框中最多可见条目数（3-20） |
| `showHardwareCursor` | boolean | `false` | 在 TUI 为支持输入法（IME）而定位终端光标时显示该光标 |
| `tuiMode` | string | `"regular"` | 交互式 TUI 模式：`"regular"` 或实验性的 `"fullscreen"`。在 `/settings` 中修改会立即生效；启动时 `--tui-mode` 会覆盖此设置 |
| `fullscreenExitOutput` | string | `"transcript"` | 全屏模式退出时的输出：`"transcript"` 打印最终会话记录和恢复提示，`"resume-hint"` 恢复之前的屏幕内容并只打印恢复提示。在常规 TUI 模式下无效 |
| `fullscreenScrollbar` | string | `"auto"` | 全屏会话记录滚动条：`"auto"` 在滚动时或指针悬停在其最右列轨道上时临时显示，`"always"` 保留该列并保持可见，`"hidden"` 隐藏。在常规 TUI 模式下无效 |
| `fullscreenCopyOnSelect` | boolean | `true` | 在全屏模式中选中即自动复制。禁用时，选中内容保持高亮，用 `Ctrl+X` 复制当前选中 |

对于 VS Code，请加上 `--wait`，这样 pi 会在编辑器退出后继续运行：

```json
{
  "externalEditor": "code --wait"
}
```

### Telemetry 与更新检查

`enableInstallTelemetry` 控制发送到 `https://pi.dev/api/report-install` 的匿名安装/更新 ping，以及 OpenRouter、NVIDIA NIM 和 Cloudflare provider 请求所带的 pi 归因 header。选择退出会同时关闭两者。它不会关闭更新检查；pi 仍可访问 `https://pi.dev/api/latest-version` 查询最新版本。

设置 `PI_SKIP_VERSION_CHECK=1` 可禁用 pi 版本更新检查。使用 `--offline` 或 `PI_OFFLINE=1` 可禁用此处描述的所有启动网络操作，包括更新检查、包更新检查以及安装/更新 telemetry。

### 网络

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `httpProxy` | string | - | 以 `HTTP_PROXY` 和 `HTTPS_PROXY` 形式应用的 HTTP 代理 URL。仅限全局设置。 |

```json
{
  "httpProxy": "http://127.0.0.1:7890"
}
```

### 警告

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `warnings.anthropicExtraUsage` | boolean | `true` | 当 Anthropic 订阅认证可能使用付费 extra usage 时显示警告 |

```json
{
  "warnings": {
    "anthropicExtraUsage": false
  }
}
```

### Compaction

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `compaction.enabled` | boolean | `true` | 启用自动 compaction |
| `compaction.reserveTokens` | number | `16384` | 为 LLM 响应预留的 token 数 |
| `compaction.keepRecentTokens` | number | `20000` | 保留（不参与摘要）的近期 token 数 |
| `compaction.modelOverrides` | object | - | 按精确 `"provider/modelId"` 索引的各 model `reserveTokens` 和 `keepRecentTokens` 覆盖 |

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

#### 按 model 的 compaction 覆盖

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "modelOverrides": {
      "some-provider/big-model": {
        "reserveTokens": 400000
      },
      "local/small-model": {
        "reserveTokens": 2048,
        "keepRecentTokens": 4096
      }
    }
  }
}
```

键必须精确匹配区分大小写的 `provider/modelId` 值，而不是名称或 glob 模式。model ID 中可以包含斜杠（例如 `openrouter/anthropic/claude-sonnet-4`）。

每个 token 设置独立解析：匹配的 model 覆盖 → 普通 `compaction` 设置 → 内置默认值。在上面的示例中，`some-provider/big-model` 的近期 token 仍使用普通的 20000。token 值必须是非负安全整数。匹配的 model 覆盖中的非法值会在读取时报错；只有省略的字段才回退到普通设置。model 覆盖条目必须是对象。普通 token 设置中的非法值会在读取时报错，即使当前 model 有合法覆盖也是如此；只有省略的普通值才使用内置默认值。可以设为 0，但 `reserveTokens: 0` 不会为响应留出任何余量，同时也会把摘要输出预算设为 0。

全局与项目设置会在 model 查找**之前**递归合并。项目可以只覆盖某个 model 的一个字段，而不影响该 model 的其他字段或其他 model。全局的 model 专属值优先于项目级回退值；要修改它，需在项目中覆盖同一个 model 条目。

`enabled` 不是按 model 区分的。当前 model 的 token 设置适用于手动 compaction、自动阈值检查（包括 assistant 轮次之间）以及溢出恢复。切换 model 会在下一次检查或 compaction 时生效。覆盖需在 JSON 中配置；`/settings` 保留的是普通的自动 compaction 开关。

触发与摘要行为见 [compaction.md](compaction.md)。

### Branch Summary

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `branchSummary.reserveTokens` | number | `16384` | 选取 branch 历史时预留的 token 数；输出上限为 4096 token |
| `branchSummary.skipPrompt` | boolean | `false` | 在 `/tree` 导航时跳过 "Summarize branch?" 提示（默认不生成摘要） |

### 重试

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `retry.enabled` | boolean | `true` | 对临时错误启用 agent 级自动重试 |
| `retry.maxRetries` | number | `3` | agent 级重试的最大次数 |
| `retry.baseDelayMs` | number | `2000` | agent 级指数退避的基础延迟（2s、4s、8s） |
| `retry.maxAgentDelayMs` | number | `60000` | agent 级重试的最大延迟（60s） |
| `retry.provider.timeoutMs` | number | SDK 默认值 | provider/SDK 请求超时（毫秒） |
| `retry.provider.maxRetries` | number | `0` | provider/SDK 重试次数 |
| `retry.provider.maxRetryDelayMs` | number | `60000` | 失败前服务器所要求的最大等待延迟（60s） |

agent 级重试使用指数退避，并以 `retry.maxAgentDelayMs` 为上限，因此在长时间故障后，漫长的重试过程仍能保持响应。

当 provider 要求的重试延迟超过 `retry.provider.maxRetryDelayMs` 时，请求会立即失败并给出明确的错误信息，而不是静默等待。设为 `0` 可禁用该限制。

除非明确需要 provider 级重试，否则请将 `retry.provider.maxRetries` 保持在 `0`。将其设为大于 0 时，SDK/provider 的重试可能在 pi 看到之前就处理用量超限错误，某些情况下这可能导致 agent 一直阻塞到 provider 配额重置。

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "maxAgentDelayMs": 60000,
    "provider": {
      "timeoutMs": 3600000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

### 消息投递

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `steeringMode` | string | `"one-at-a-time"` | steering 消息的发送方式：`"all"` 或 `"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | follow-up 消息的发送方式：`"all"` 或 `"one-at-a-time"` |
| `transport` | string | `"auto"` | 支持多种传输方式的 provider 的首选传输方式：`"sse"`、`"websocket"`、`"websocket-cached"` 或 `"auto"` |
| `httpIdleTimeoutMs` | number | `300000` | HTTP header/body 空闲超时（毫秒），也被具有显式流空闲超时的 provider 使用。设为 `0` 可禁用。 |
| `websocketConnectTimeoutMs` | number | `15000` | 支持 WebSocket 传输的 provider 的 WebSocket 连接/打开握手超时（毫秒）。设为 `0` 可禁用。 |

### 终端与图片

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `terminal.showImages` | boolean | `true` | 在终端中显示图片（如受支持） |
| `terminal.imageWidthCells` | number | `60` | 内联图片的首选宽度（以终端 cell 计） |
| `terminal.clearOnShrink` | boolean | `false` | 内容收缩时清除空行（可能引起闪烁） |
| `terminal.hyperlinks` | boolean 或 `"auto"` | `"auto"` | 覆盖 OSC 8 超链接支持（高级，仅 JSON） |
| `terminal.images` | string 或 boolean | `"auto"` | 用 `"kitty"`、`"iterm2"`、`false` 或 `"auto"` 覆盖图片协议支持（高级，仅 JSON） |
| `terminal.trueColor` | boolean 或 `"auto"` | `"auto"` | 覆盖 truecolor 支持（高级，仅 JSON） |
| `images.autoResize` | boolean | `true` | 将图片缩放到最大 2000x2000。适用于 `@file` 附件、`read` 以及 tool 返回的图片 |
| `images.blockImages` | boolean | `false` | 阻止所有图片发送给 LLM |

### Shell

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `shellPath` | string | - | 自定义 shell 路径（例如 Windows 上的 Cygwin）；支持以 `~` 开头表示主目录 |
| `shellCommandPrefix` | string | - | 每条 bash 命令的前缀（例如 `"shopt -s expand_aliases"`） |
| `npmCommand` | string[] | - | 用于 npm 包查询/安装操作的命令 argv（例如 `["mise", "exec", "node@20", "--", "npm"]`） |

JSON 中的 Windows 路径必须使用正斜杠或转义的反斜杠：

```json
{
  "shellPath": "C:/Program Files/Git/bin/bash.exe"
}
```

```json
{
  "shellPath": "C:\\Program Files\\Git\\bin\\bash.exe"
}
```

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

`npmCommand` 用于所有 npm 包管理操作，包括安装、卸载以及 git 包内的依赖安装。用户范围的 npm 包安装在 `~/.pi/agent/npm/` 下；项目范围的 npm 包安装在 `.pi/npm/` 下。argv 风格的条目要与进程实际的启动方式完全一致。配置 `npmCommand` 后，git 包的依赖安装会使用普通的 `install`，以避免在包装器或其他包管理器中出现 npm 特有的 flag。

### 工具

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `defaultTools` | string[] | - | 初始启用的内置 tool。省略时 pi 使用其标准默认值 |

`defaultTools` 选择启动时启用的内置 tool。扩展和 SDK 自定义 tool 保持启用。可用的内置 tool 有 `read`、`bash`、`powershell`、`edit`、`write`、`grep`、`find` 和 `ls`：

```json
{
  "defaultTools": ["bash", "edit", "write"]
}
```

在 Windows 上，请选择 `powershell` 而不是 `bash`，或者两者都包含：

```json
{
  "defaultTools": ["read", "powershell", "edit", "write"]
}
```

空数组表示启动时不启用任何内置 tool，同时保留扩展和 SDK 自定义 tool。`--tools` 会以针对所有 tool 的严格允许列表取代这一行为，`--no-tools` 禁用所有 tool，`--no-builtin-tools` 禁用内置默认值。`--exclude-tools` 会对最终列表进行过滤。项目的 `defaultTools` 数组会替换全局数组。

### 会话

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `sessionDir` | string | - | 会话文件的存储目录。接受绝对路径、相对路径以及 `~`。 |

```json
{ "sessionDir": ".pi/sessions" }
```

当多个来源指定会话目录时，优先级为 `--session-dir`、`PI_CODING_AGENT_SESSION_DIR`，然后是 settings.json 中的 `sessionDir`。

### Model 轮换

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `enabledModels` | string[] | - | 用于 Ctrl+P 轮换的 model 模式（格式与命令行 `--models` 参数相同） |

```json
{
  "enabledModels": ["claude-*", "gpt-4o", "gemini-2*"]
}
```

### Markdown

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `markdown.codeBlockIndent` | string | `"  "` | 代码块的缩进 |
| `markdown.mermaid` | string | `"streaming"` | Mermaid 渲染模式：`"off"`、`"final"` 或 `"streaming"` |

### 资源

这些设置定义从哪里加载扩展、skill、prompt 模板和主题。

`~/.pi/agent/settings.json` 中的路径相对于 `~/.pi/agent` 解析；`.pi/settings.json` 中的路径相对于 `.pi` 解析。支持绝对路径和 `~`。

| 设置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `packages` | array | `[]` | 用于加载资源的 npm/git 包 |
| `extensions` | string[] | `[]` | 本地扩展文件路径或目录 |
| `skills` | string[] | `[]` | 本地 skill 文件路径或目录 |
| `prompts` | string[] | `[]` | 本地 prompt 模板路径或目录 |
| `themes` | string[] | `[]` | 本地主题文件路径或目录 |
| `enableSkillCommands` | boolean | `true` | 将 skill 注册为 `/skill:name` 命令 |

数组支持 glob 模式和排除项。用 `!pattern` 排除。用 `+path` 强制包含某个精确路径，用 `-path` 强制排除某个精确路径。

#### packages

字符串形式会加载包中的所有资源：

```json
{
  "packages": ["pi-skills", "@org/my-extension"]
}
```

对象形式可以过滤要加载哪些资源：

```json
{
  "packages": [
    {
      "source": "pi-skills",
      "skills": ["brave-search", "transcribe"],
      "extensions": []
    }
  ]
}
```

包管理详情见 [packages.md](packages.md)。

## 示例

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "modelThinkingLevels": {
    "anthropic/claude-sonnet-4-20250514": "high"
  },
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  },
  "enabledModels": ["claude-*", "gpt-4o"],
  "warnings": {
    "anthropicExtraUsage": true
  },
  "packages": ["pi-skills"]
}
```

## 项目覆盖

项目设置（`.pi/settings.json`）会覆盖全局设置。嵌套对象会合并：

```json
// ~/.pi/agent/settings.json (global)
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}

// .pi/settings.json (project)
{
  "compaction": { "reserveTokens": 8192 }
}

// Result
{
  "theme": "dark",
  "compaction": { "enabled": true, "reserveTokens": 8192 }
}
```
