# Pi 源码学习文档（个人学习资料）

> 这套文档是为深入学习本仓库（fork 自 earendil-works/pi）而整理的中文学习资料，由 AI 辅助生成（2026-09），基于当时的 main 分支代码——**代码演进后请以源码为准**。
> 阅读前提：有 Go / Java / Python 背景，TypeScript 不熟（正好有一篇速成）。

## 文档清单与阅读顺序

| 顺序 | 文档 | 内容 | 适合什么时候读 |
|---|---|---|---|
| 1 | [01-architecture.md](01-architecture.md) | 分层架构图 + **一次对话的端到端主线**（终端输入 → LLM → 工具 → 渲染） | 第一天，建立全局图景 |
| 2 | [02-typescript-crash-course.md](02-typescript-crash-course.md) | TS 速成：全部示例取自本仓库，附 Go/Java/Python 对照 | 第一天，读代码前扫一遍，之后当字典查 |
| 3 | [03-package-ai.md](03-package-ai.md) | pi-ai：统一多厂商 LLM API（协议抽象、事件流、一次流式调用的函数级 trace） | 第 1 周 |
| 4 | [04-package-agent.md](04-package-agent.md) | pi-agent-core：agent 循环（**整个项目的心脏**）、两代运行时、持久化 | 第 1-2 周，重点 |
| 5 | [05-package-coding-agent.md](05-package-coding-agent.md) | 主产品：启动流程、8 内置工具、扩展系统（重点）、配置体系 | 第 2-3 周，重点 |
| 6 | [06-package-tui.md](06-package-tui.md) | pi-tui：差分渲染、Component 模型、编辑器、键盘协议 | 第 3-4 周，或按需 |
| 7 | [07-supporting-packages.md](07-supporting-packages.md) | chord / protocol / client / server / telemetry / evals + client/server 分离架构 | 按需 |
| 8 | [08-dev-workflow.md](08-dev-workflow.md) | 构建、运行、测试、调试、贡献流程（含新手第一个坑） | 随时查 |

`translations/` 目录下是**官方英文文档的中文翻译**（目录镜像原项目结构，原文件未动），清单见 [translations/README.md](translations/README.md)。

## 分阶段学习路线

### 阶段 0：跑起来 + 建立图景（第 1-2 天）

1. 读 [01-architecture.md](01-architecture.md)，记住端到端主线的 7 个步骤；
2. 按 [08-dev-workflow.md](08-dev-workflow.md) 装依赖、构建、`./pi-test.sh` 跑起来玩一玩（注意 `providers/data/` 不在 git 里的坑）；
3. 扫读 [02-typescript-crash-course.md](02-typescript-crash-course.md)，精读结尾推荐的三个百行小文件；
4. 读翻译版 [translations/README.md](translations/README.md)（项目 README）和 [translations/packages/coding-agent/docs/quickstart.md](translations/packages/coding-agent/docs/quickstart.md)。

### 阶段 1：吃透主线（第 1 周，约 1 万行）

按 [03](03-package-ai.md) → [04](04-package-agent.md) 的阅读清单走：

1. `packages/ai`：types.ts → event-stream.ts → models.ts → lazy.ts → anthropic-messages.ts；
2. `packages/agent`：types.ts → **agent-loop.ts（803 行，逐行读完）** → agent.ts；
3. 对照 [01](01-architecture.md) 第 3 节的主线，确认每一步都能在代码里指认出来。

**检验标准**：能回答"一次带工具调用的对话，事件从 SSE 到屏幕经过哪几层翻译？"

### 阶段 2：主产品（第 2-3 周，约 1.5 万行）

按 [05](05-package-coding-agent.md) 的 18 项清单：入口 → AgentSession → 工具双轨制 → **扩展系统（extensions/types.ts 精读）** → SessionManager → 系统提示词。同时动手：

- 抄 `examples/extensions/hello.ts` 写第一个扩展；
- 跑 `examples/sdk/01-minimal.ts`（10 行）理解 "CLI 即 SDK"；
- 读翻译版 [extensions.md](translations/packages/coding-agent/docs/extensions.md)（官方权威文档）。

### 阶段 3：按兴趣深入（第 4 周起）

- UI 方向：[06](06-package-tui.md)（差分渲染 + 编辑器）；
- 架构方向：[07](07-supporting-packages.md)（experimental client/server 分离架构）+ `packages/coding-agent/src/experimental/`；
- 稳定性方向：`packages/agent/src/harness/`（durable 状态机、崩溃恢复）+ compaction 细节；
- 评测方向：`packages/evals/`。

## 三条实用建议

1. **让 pi 解释它自己**：系统提示词里注入了 pi 自身文档路径（见 `core/system-prompt.ts`），跑起来的 pi 能回答"你怎么实现的"这类问题——边读边问效率很高。
2. **改代码前读 `translations/AGENTS.md`**：那是项目的硬规则（可擦除语法、禁 any、测试怎么跑、commit 格式）。
3. **测试是最好的用法示例**：每个包的 test/ 目录大量使用 faux provider 和虚拟终端，比文档更具体。

## 代码量参考（撰写时）

生产源码 ~15.3 万行（coding-agent 7.0 万 / agent 2.5 万 / ai 2.4 万 / tui 1.8 万 / 其余 ~1.6 万），测试 ~14.3 万行。核心主线约 2 万行——**不要试图通读**，走通主线后其余按需查。
