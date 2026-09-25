# 开发工作流：构建、运行、测试、调试、贡献

> 本文档帮你把项目在本地跑起来并安全地改代码。项目规范原文见根目录 `AGENTS.md`（中文翻译：`docs/translations/AGENTS.md`）与 `CONTRIBUTING.md`。

## 1. 环境准备

```bash
# 要求 Node >= 22.19（README 的 engines 字段写死了）
node -v

# 安装依赖。注意 --ignore-scripts：本项目供应链安全规范，
# 禁止 npm 依赖的生命周期脚本在你机器上执行
npm install --ignore-scripts
```

**新手第一个坑**：`packages/ai/src/providers/data/`（约 3.2MB 的模型目录数据）被 .gitignore 忽略，克隆后不存在，直接编译会失败。两个选择：

```bash
npm run build         # 联网刷新模型目录（访问 models.dev / OpenRouter 等）再构建
npm run build:offline # 如果之前生成过数据，离线复用
```

## 2. 构建：注意包的依赖顺序

根 `package.json` 的 `build` 脚本是一串 `cd` + 逐包构建，顺序不可乱（被依赖的先建）：

```
chord → tui → telemetry → ai → agent → session-backends/sqlite-node
      → protocol → client → server → coding-agent
```

这个顺序同时也是**自底向上的依赖图**，读代码时可以反过来用（coding-agent 最顶层）。

## 3. 从源码运行

```bash
./pi-test.sh          # 用 tsx 直接跑 TS 源码，可在任意目录执行
./pi-test.sh --no-env # 跑之前清空所有 LLM 相关环境变量（防止误用你的 API key）
```

`pi-test.sh` 实际执行的是 `tsx packages/coding-agent/src/experimental/cli.ts`——这是个**超集入口**：先识别 experimental 子命令（如 `pi client` / `pi serve`），不是则回落到与发布版相同的 `main()`。所以开发时跑的就是完整 CLI + 实验性 server 架构子命令。安装发布版则是 `npm install -g @earendil-works/pi-coding-agent` 后用 `pi` 命令。

## 4. 检查与测试

```bash
npm run check         # lint + 格式化 + 类型检查（biome、tsgo --noEmit、依赖锁定校验等）
./test.sh             # 从仓库根跑全部测试
```

`./test.sh` 的隔离设计值得一看（它本身就是个不错的学习材料）：`env -i` 清空全部环境变量，把 HOME 换成临时目录，注入 `GIT_TERMINAL_PROMPT=0`、`PI_NO_LOCAL_LLM=1` 等，确保测试不碰你的真实凭据与 git 配置，无 API key 时自动跳过 LLM 相关测试。

跑单个测试文件（不要直接跑全量 vitest——含会真实调 API 的 e2e 测试）：

```bash
# 各包通用（vitest）：
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts
# 在对应包目录下执行；tui 包例外，用 node --test：
node --test test/specific.test.ts
```

coding-agent 的测试套件用 `test/suite/harness.ts` + faux provider（可编程假 LLM，见 `packages/ai/src/providers/faux.ts`），不花真钱。

## 5. 调试技巧

- **观察 LLM 线上流量**：`streamSimple` 的 options 里有 `onPayload` 回调（`packages/ai/src/api/anthropic-messages.ts` 等），可在发送前打印/改写最终请求体——研究各厂商请求格式的最佳挂点。
- **不花钱跑 agent**：用 faux provider 写脚本/测试，可编程控制模型回复序列（包括工具调用）。
- **交互模式测试**：项目自带 tmux 测试技能，见 `.pi/skills/interactive-testing.md`（这是给 pi 自己用的 skill，人也能照着做）。
- **实验性 client/server 架构**：环境变量 `PI_EXPERIMENTAL=1` 开启（详见 `docs/07-supporting-packages.md`）。

## 6. 改代码前必须知道的项目规范

来自 `AGENTS.md`（对人和 AI 都生效的硬规则）：

| 规则 | 内容 |
|---|---|
| 语法约束 | `packages/*/src` 只允许可擦除 TS 语法：**禁止 enum、namespace、构造器参数属性、`import =`** 等（Node strip-only 运行的前提） |
| 禁 any | `No any unless absolutely necessary`（全仓 unknown 632 处 vs any 66 处） |
| 禁内联 import | 不用 `await import()` / 动态类型导入；顶层 import only（例外：ai 包的 `*.lazy.ts` 懒加载机制是架构设计） |
| 改代码后 | 跑 `npm run check`，修完所有 error/warning/info 再提交 |
| 不许擅自跑 | `npm run build`、`npm test` 仅在用户要求时跑 |
| 生成文件 | 永远不要手改 `packages/ai/src/models.generated.ts`；改 `packages/ai/scripts/generate-models.ts` 后重新生成 |
| Git | 只 stage 自己改的文件（显式路径，禁 `git add .`）；commit message 格式 `feat|fix|docs[(ai,tui,agent,coding-agent)]: <消息>` |
| Lockfile | `package-lock.json` 变更需要 `PI_ALLOW_LOCKFILE_CHANGE=1`，依赖一律锁精确版本 |
| Changelog | 每个包自己的 `packages/*/CHANGELOG.md`，新条目进 `## [Unreleased]` |

## 7. 贡献流程（fork 场景特别注意）

这个仓库对新人贡献有特殊机制（详见 `CONTRIBUTING.md` 翻译）：

- **新贡献者的 issue 和 PR 默认被自动关闭**，维护者每天审一遍 auto-closed 的内容——不要被吓到，这是 spam 防御机制，不是拒绝你。
- 质量门槛：`lgtm` / `lgtmi` 标签机制 + 高质量标准。
- 提 PR 前：改动 → `npm run check` 全绿 → changelog 补条目 → 测试（新测试文件必须跑通）。

## 8. 推荐的动手路径（从易到难）

1. **改配置/主题试水**：跑起 `./pi-test.sh`，改一个 theme 或 keybinding，热重载看效果。
2. **写一个 extension**：`packages/coding-agent/examples/extensions/` 有完整示例（自定义工具、自定义 provider、sandbox），这是项目设计上最容易的切入点。
3. **给内置工具加小功能**：工具实现在 `packages/coding-agent/src/core/tools/`（详见 `docs/05-package-coding-agent.md`），接口清晰。
4. **用 faux provider 写测试**：练手 agent 循环相关改动，不花 token。
5. **读 + 改 agent 循环**：`packages/agent/src/agent-loop.ts`——动这里之前确保理解事件流契约。
