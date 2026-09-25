> 译注：本文是 `packages/evals/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# Pi evals

Pi evals 是针对 Pi 工作流的行为级、由模型支撑的检查。它们把真实的 `AgentSession` 适配到 `vitest-evals`，在相互隔离的临时项目目录和 agent 目录中运行它，并附加原生 Pi session 产物。
可以用它们来度量端到端行为，并比较 prompt、工具、skill、模型或其他 harness 配置。

## 运行 evals

从仓库根目录运行，并指定默认 provider 和模型：

```bash
npm run eval -- --provider openai --model gpt-5.6-sol
```

等价的环境变量写法是：

```bash
PI_PROVIDER=openai PI_MODEL=gpt-5.6-sol npm run eval
```

CLI 取值优先，并成为未显式选择模型的 harness 的默认值。provider 和模型必须一起提供。如果每个被执行的 harness 都配置了自己的模型，runner 也允许不设默认值。
认证来自 Pi 正常的 `ModelRuntime`，包括 Pi subscription 凭证和 provider 的 API key 环境变量。

其余参数会转发给 Vitest：

```bash
npm run eval -- src/extensions.eval.ts
npm run eval -- -t "creates and uses the extension"
npm run eval -- src/docs.eval.ts -t "session-format\.md"
```

在单次调用中把所有对比型定制 evals 运行五次：

```bash
npm run eval -- \
  src/extensions.eval.ts src/models.eval.ts src/providers.eval.ts \
  --provider openai --model gpt-5.6-sol \
  --repetitions 5
```

`--repetitions` 适用于以 `evalHarnessTable(...)` 声明的套件。套件中显式给出的 `repetitions` 值会覆盖命令行默认值。`PI_EVAL_REPETITIONS=5` 等价于该命令行选项。开发一个 eval 时用一次重复，汇报提升（lift）时用五次。

## 报告与产物

每次调用都会在 Vitest 结果之后打印一份复合的 `Eval Comparisons` 报告。当同一次调用运行多个对比文件时，该报告会为每个 eval 集合输出一个单独的章节。例如（数值仅为示意）：

```text
Eval Comparisons
  Add model to existing provider
     Baseline  system-prompt-without-docs
    Candidate  default-system-prompt (5/5 pairs)
    Pass rate  +60.0 pp (candidate 80.0%, baseline 20.0%)
       Tokens  +1200.0 (candidate 24000.0, baseline 22800.0)
      Latency  -850.0ms (candidate 14000.0ms, baseline 14850.0ms)
    Est. cost  +$0.0100 (candidate $0.1200, baseline $0.1100)

  Add OpenAI-compatible provider
    ...

  Add custom streaming provider
    ...
```

runner 会在启动时打印被忽略的 `.eval/` 产物目录。其中包含：

- `report.txt`：不带颜色码的终端对比报告。
- `report.json`：以结构化 JSON 表示的同一份聚合对比数据。
- `runs.jsonl`：每次完成的 harness run 各一条记录。
- `sessions/`：原生 Pi session 的 JSONL 附件。
- `sources/`：各个 eval 记录的源码附件。

该报告覆盖使用 `evalHarnessTable(...)` 的对比套件。普通 eval 仍会出现在 Vitest 汇总和 `runs.jsonl` 中，但不会出现在 baseline 对 candidate 的对比报告里。产物可能包含 prompt、响应、源码和工具输出。

## 编写 evals

关于套件、judge、断言和规范化 trace 的一般性指导，请遵循 [`vitest-evals`](https://github.com/getsentry/vitest-evals)。Pi 专属的 eval 使用 `src/pi-harness.ts` 中的 `createPiCodingAgentHarness(...)`，每个 `describeEval(...)` 套件绑定一个 harness：

```ts
import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createPiCodingAgentHarness } from "./pi-harness.ts";

const harness = createPiCodingAgentHarness({ noTools: "all" });

describeEval("Pi smoke", { harness }, (it) => {
	it("answers a factual question", async ({ run }) => {
		const result = await run("What is the capital of France? Reply with only the city name.");
		expect(result.output).toBe("Paris");
	});
});
```

### 配置 Pi harness

`createPiCodingAgentHarness(...)` 接受：

- `name`：报告与对比所使用的稳定 harness 标识。
- `model`：可选的 `{ provider, id }` 选择。它会覆盖 runner 的默认模型。
- `noTools`：Pi 的工具禁用配置。
- `tools`：可选的工具名称允许列表，限定被评估 agent 可用的工具。
- `customTools`：为被评估 agent 注册的自定义工具定义。
- `transformSystemPrompt`：在 eval 开始前对完整默认 prompt 进行变换。
- `output`：把最终响应和 `AgentSession` 变换为 JSON 安全的领域结果。

显式选择模型可以让模型对比类 harness 不受 runner 默认值的影响：

```ts
const harness = createPiCodingAgentHarness({
	name: "claude-opus-4-6",
	model: { provider: "anthropic", id: "claude-opus-4-6" },
});
```

一次 run 既可以只接受一个 prompt，也可以接受由 prompt 和 reload 步骤组成的序列。当前面的 prompt 创建或修改了 Pi 资源时，reload 步骤就很有用：

```ts
const result = await run([
	{ type: "prompt", content: "Create a Pi extension." },
	{ type: "reload" },
	{ type: "prompt", content: "Use the extension." },
]);
```

### 变换 harness 输出

使用 `output` 来暴露场景特定的、JSON 安全的行为，而不必把这些行为加进通用的 Pi 适配器：

```ts
const harness = createPiCodingAgentHarness({
	output: ({ response, session }) => ({
		response,
		activeTools: session.getActiveToolNames(),
		extensionErrors: session.resourceLoader.getExtensions().errors,
	}),
});
```

在 `result.output` 上断言应用行为。在 `result.session` 上断言模型与工具 trace，可使用 `toolCalls(...)` 等 `vitest-evals` 辅助函数。

### 编写对比型 eval 集合

把 `evalHarnessTable(...)` 与 Vitest 原生的 `describe.for(...)` 结合使用，即可用相同的输入运行多个 harness。各 harness 可以在 prompt、工具、skill、模型或其他任意 Pi 配置上不同：

```ts
import { describe } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import { evalHarnessTable } from "./vitest-evals/harness-table.ts";

const TargetTaskJudge = createJudge<string, string>("TargetTaskJudge", ({ output }) => ({
	score: output === "expected result" ? 1 : 0,
}));

const harnessTable = evalHarnessTable(
	"target skill effectiveness",
	{
		baseline: withoutTargetSkillHarness,
		candidate: withTargetSkillHarness,
		repetitions: 6,
	},
);

describe.for(harnessTable)("$name repetition $repetition", ({ harness }) => {
	describeEval("target skill effectiveness", { harness, judges: [TargetTaskJudge], judgeThreshold: null }, (it) => {
		it("completes the target task", async ({ run }) => {
			await run("Complete the target task.");
		});
	});
});
```

对比套件应当用确定性 judge 或模型 judge 记录正确性，并设置 `judgeThreshold: null`。
这样低分只会作为观察结果保留，而不会让 Vitest 调用失败。硬断言只用于套件不变量和基础设施契约。`expect.soft(...)` 仍会让测试失败，因此不是一种打分机制。

Pi harness 会在删除其临时工作区之前对原生 session 的 JSONL 做 snapshot。一个仅供 eval 使用的 `afterEach` 钩子会在 reporter 运行之前，把该 snapshot 注册到显式的 Vitest 测试任务上。

harness 名称在一个 eval 集合内必须稳定且唯一。分组键由 repetition 与非空字符串 `input.id`（如果存在）组成，否则使用严格规范化 JSON 输入的 SHA-256 哈希。单一处理用 `candidate`，多种处理用 `candidates`。每个 candidate 只与声明的 baseline 比较。对每个匹配的输入和 repetition，reporter 会基于每次 run 记录的平均 judge 分数计算通过率提升（lift），分数至少为 `1` 视为通过。lift 即 candidate 通过率减去 baseline 通过率，以百分点计。缺失的 judge 分数会作为不完整的观察上报。token、延迟和估算成本保持为各自独立的 candidate 减 baseline 成对 delta；缺失的遥测数据仍视为不可用。如果确有必要随机化执行顺序，请使用 Vitest 内置的 sequence shuffle。

对比型 eval 方法论、重复策略、可信 judge 以及遥测解读，请参见 [`skill-eval-harness`](https://github.com/adewale/skill-eval-harness/) 的指导。
