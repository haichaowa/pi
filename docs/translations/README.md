# 官方文档中文翻译索引

> 本目录是项目英文文档的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。**目录结构镜像原项目位置**，原文件一律未改动。
> 翻译约定：代码块逐字保留；session/provider/tool/extension 等通用术语保留英文；CLI 命令、类型名、路径、环境变量不译。

## 根目录文档

| 译文 | 原文 | 内容 |
|---|---|---|
| [README.md](README.md) | `/README.md` | 项目总览、包清单、开发命令、供应链安全 |
| [AGENTS.md](AGENTS.md) | `/AGENTS.md` | **开发硬规则**（语法约束、测试、git、changelog）——改代码前必读 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | `/CONTRIBUTING.md` | 贡献流程（auto-close 机制、质量门槛） |
| [SECURITY.md](SECURITY.md) | `/SECURITY.md` | 安全策略与上报渠道 |

## 各包 README

| 译文 | 原文 |
|---|---|
| [packages/ai/README.md](packages/ai/README.md) | pi-ai 官方文档（调用方式、事件参考、迁移指南）——**内容最详尽的一篇** |
| [packages/agent/README.md](packages/agent/README.md) | pi-agent-core 使用指南 |
| [packages/tui/README.md](packages/tui/README.md) | pi-tui 组件与渲染指南 |
| [packages/coding-agent/README.md](packages/coding-agent/README.md) | 主产品总览 |
| [packages/chord/README.md](packages/chord/README.md) | chord 运行时 |
| [packages/protocol/README.md](packages/protocol/README.md) / [client](packages/client/README.md) / [server](packages/server/README.md) | experimental 协议栈三件套 |
| [packages/telemetry/README.md](packages/telemetry/README.md) | 遥测契约 |
| [packages/evals/README.md](packages/evals/README.md) | 评测框架 |
| [packages/session-backends/sqlite-node/README.md](packages/session-backends/sqlite-node/README.md) | SQLite 会话后端 |

## coding-agent 官方文档（docs/）

| 译文 | 主题 |
|---|---|
| [docs/index.md](packages/coding-agent/docs/index.md) | 文档站首页 |
| [docs/quickstart.md](packages/coding-agent/docs/quickstart.md) | 快速上手 |
| [docs/extensions.md](packages/coding-agent/docs/extensions.md) | **扩展系统权威文档**（最重要） |
| [docs/models.md](packages/coding-agent/docs/models.md) / [providers.md](packages/coding-agent/docs/providers.md) / [settings.md](packages/coding-agent/docs/settings.md) | 模型与配置 |
| [docs/skills.md](packages/coding-agent/docs/skills.md) | Agent Skills |
| [docs/sessions.md](packages/coding-agent/docs/sessions.md) / [session-format.md](packages/coding-agent/docs/session-format.md) | 会话管理与 JSONL 格式 |
| [docs/compaction.md](packages/coding-agent/docs/compaction.md) | 上下文压缩 |
| [docs/usage.md](packages/coding-agent/docs/usage.md) | 使用手册（含产品哲学） |
| [docs/sdk.md](packages/coding-agent/docs/sdk.md) | **SDK 嵌入 API**（createAgentSession、选项参考、运行模式） |
| [docs/custom-provider.md](packages/coding-agent/docs/custom-provider.md) | 自定义 provider（含 OAuth、自定义流式 API） |

## 未翻译（原文较短或偏运维，需要时可让我补译）

coding-agent/docs 的：rpc、json、tui、themes、keybindings、packages、prompt-templates、environment-variables、terminal-setup、tmux、windows、termux、llama-cpp、containerization、security、development、shell-aliases；packages/agent/docs/ 下的设计文档（harness.md、pico-v3.md、values.md 等）。
