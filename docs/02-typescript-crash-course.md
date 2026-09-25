# TypeScript 速成：写给 Go / Java / Python 开发者

> 本文档面向有 Go / Java / Python 背景但不熟悉 TypeScript（下称 TS）的读者。所有代码示例均取自本仓库真实源码（标注了文件路径），学完可以直接去读对应的文件。
>
> 配套建议：读完本文后，精读两个"麻雀虽小五脏俱全"的百行文件——`packages/ai/src/api/lazy.ts`（99 行）和 `packages/ai/src/utils/event-stream.ts`（111 行），它们覆盖了本文大部分概念。

## 0. 先建立两个心智模型

**模型一：TS = JavaScript + 一层可擦除的类型标注。** 编译产物里所有类型信息全部消失，只剩纯 JS。这和 Go"类型是运行时实体"完全不同：TS 的类型只存在于编译期，运行时没有任何类型检查。所以 TS 里"类型收窄"（后面讲）才那么重要——你要用代码逻辑说服编译器，而不是靠运行时反射。

**模型二：本仓库有一项特殊约束——erasable syntax only（可擦除语法）。** 项目要求 Node >= 22.19 直接运行 `.ts` 文件（机制叫 type stripping：只删类型、不做代码生成），所以一切"需要编译器改写代码"的语法都被禁用：`enum`、`namespace`、构造器参数属性、`import =` 等（见根目录 `AGENTS.md` 第 23 条，`tsconfig.base.json` 里 `erasableSyntaxOnly: true` 强制执行）。这解释了本仓库很多"看起来奇怪"的写法——全仓库 0 个 `enum`、私有字段用 `#x`、类字段必须显式声明再赋值。

## 1. 类型注解、interface、type alias、可选字段

TS 用 interface 描述对象形状，`?` 表示字段可选（可能为 `undefined`）。来自 `packages/ai/src/types.ts:568`：

```ts
export interface OpenAICompletionsCompat {
	/** Whether the provider supports the `store` field. Default: auto-detected from URL. */
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
}
```

`export` 表示模块导出（类似 Go 的大写首字母导出、Python 的 `__all__`）。斜杠星注释是 JSDoc，会出现在 IDE 悬浮提示里。

变量标注用 `: 类型`。来自 `packages/agent/src/agent-loop.ts:296`：

```ts
const llmContext: Context = { systemPrompt: ..., messages: llmMessages, tools: context.tools };
```

**仓库惯例**：对象形状用 `interface`；联合类型、函数签名等"计算出来的类型"用 `type`。

| TS 写法 | Go | Java | Python |
|---|---|---|---|
| `field?: T` | 指针 `*T` | `Optional<T>` | `x: T \| None` |
| `interface` | struct + interface | interface / record | Protocol / dataclass |
| `const x: T = ...` | `var x T = ...` | `T x = ...` | `x: T = ...` |

## 2. 联合类型与可辨识联合（本项目最重要的建模方式）

union type 表示"值是这几种之一"。当每个成员带一个不同的字面量标签字段时，叫 discriminated union（可辨识联合）。这是整个项目事件系统的统一建模方式。来自 `packages/ai/src/types.ts:546`：

```ts
export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">; message: AssistantMessage }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
```

含义：一个事件要么是 `type` 为 `"start"` 的对象（带 `partial` 字段），要么是 `type` 为 `"text_delta"` 的对象（带 `delta` 字段）……注意 `"start"` 这种**字符串字面量本身也是类型**（字面量类型）。

同款设计：`AgentEvent`（`packages/agent/src/types.ts:431`，agent 生命周期共 14 个变体）。你在本仓库看到 `XxxEvent` 类型，几乎都是这个模式。

| TS | Go | Java | Python |
|---|---|---|---|
| discriminated union | interface + type switch | sealed interface + record + 模式匹配 switch（Java 17+） | `Union` 类型 + `match case`（3.10+） |

## 3. 泛型

来自 `packages/ai/src/utils/event-stream.ts:26`，注意泛型参数可以带默认值：

```ts
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue = new FifoQueue<T>();
	private finalResultPromise: Promise<R>;
	result(): Promise<R> { return this.finalResultPromise; }
}
```

子类把它实例化为 `EventStream<AssistantMessageEvent, AssistantMessage>`。

带约束的泛型：`packages/server/src/server.ts:46` 的 `class Server<TMetadata extends SessionMetadata = SessionMetadata>`（`extends` 在泛型约束里读作"必须是…的子类型"）。

| TS | Go | Java | Python |
|---|---|---|---|
| `<T extends X>` | `[T X]` | `<T extends X>` | `TypeVar("T", bound=X)` |

## 4. async/await 与 Promise

`Promise<T>` 是"未来才会有 T 值"的容器；`await` 等它兑现；标记 `async` 的函数返回 Promise。**TS 的并发模型是单线程事件循环 + 协作式异步**——没有 goroutine，没有线程锁，只有"等待"。来自 `packages/coding-agent/src/package-manager-cli.ts:206`：

```ts
const [packageJsonContent, packageLockContent] = await Promise.all([
	fetchInstallerArtifact(`${releaseUrl}/package.json`, "package.json"),
	fetchInstallerArtifact(`${releaseUrl}/package-lock.json`, "package-lock.json"),
]);
```

两个下载并行执行，`await` 等全部完成（左边的数组解构一次拿两个结果）。另有 `Promise.allSettled`（单个失败不中断整体，`packages/server/src/server.ts:115`）。

| TS | Go | Java | Python |
|---|---|---|---|
| `Promise.all([...])` | `errgroup.Wait()` | `CompletableFuture.allOf` | `asyncio.gather` |
| `async fn` / `await` | `go func()` + channel | `CompletableFuture` 链 | `async def` / `await`（语义几乎相同，这套就是借鉴 Python 的） |

## 5. 异步迭代器与 generator（流式 LLM 响应的核心机制）

LLM 响应是流式的，本项目大量使用异步迭代器。

**消费端**——`for await...of`，来自 agent 主循环 `packages/agent/src/agent-loop.ts:315`：

```ts
for await (const event of response) {
	switch (event.type) {
		case "start":
			partialMessage = event.partial;
			await emit({ type: "message_start", message: { ...partialMessage } });
			break;
		// ...
		case "done":
		case "error": {
			const finalMessage = await response.result();
			return finalMessage;
		}
	}
}
```

**生产端**——`async function*` 是 generator 函数，`yield` 产出一个值后暂停，等消费者要下一个再继续。来自 `packages/ai/src/api/anthropic-messages.ts:402`（`iterateSseMessages` 把 HTTP 响应体逐块解析、逐条产出 SSE 消息）。还有一种更本仓库风格的做法：给普通类实现 `async *[Symbol.asyncIterator]()` 方法（`packages/ai/src/utils/event-stream.ts:72`），之后这个类的实例就能被 `for await` 消费。`yield* x` 表示把另一个迭代器的值逐个转发（`packages/agent/src/harness/session/jsonl/fork.ts:271`）。

| TS | Go | Java | Python |
|---|---|---|---|
| `for await...of` | `for v := range ch` | `Flow.Publisher` 订阅 | `async for` |
| `async function*` + `yield` | producer goroutine + channel | — | `async def` + `yield`（一一对应） |

## 6. 函数是一等公民：函数类型、箭头函数、闭包

函数可以存变量、当参数传、当返回值。函数类型声明来自 `packages/agent/src/agent-loop.ts:26`：

```ts
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;
```

读作：`AgentEventSink` 是一种函数，收一个 `AgentEvent`，返回 `Promise<void>` 或 `void`。

箭头函数 `(x) => ...` 相当于 lambda（与 Java lambda、Python lambda 类似，但箭头函数不绑定自己的 `this`）。闭包捕获来自 `packages/ai/src/api/lazy.ts:46`：

```ts
export function lazyStream(model: Model<Api>, setup: () => Promise<AsyncIterable<AssistantMessageEvent>>): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();
	setup()
		.then((inner) => forwardStream(outer, inner))   // 箭头函数捕获了外层的 outer
		.catch((error) => { outer.push({ type: "error", /* ... */ }); });
	return outer;
}
```

这是本仓库最重要的模式之一：**同步返回一个空流，异步准备工作在背后跑**。这个 99 行的文件值得整篇精读。

## 7. 语法糖四件套：解构、展开、可选链、空值合并

```ts
// 1. 解构赋值：从对象/数组里直接取字段（≈ Python 解包）
const { lane, context, session } = this.#options;          // packages/coding-agent/src/experimental/mini/worker/lane-service.ts:41

// 2. 展开运算符：浅拷贝 + 覆盖部分字段（不可变更新的标准姿势）
const response = await streamFunction(config.model, llmContext, {
	...config,           // 先展开 config 的所有字段
	apiKey: resolvedApiKey,  // 再覆盖个别字段
	signal,
});                                                            // packages/agent/src/agent-loop.ts:305

// 3. 可选链：a?.b 等价于 "a 不为 null/undefined 才取 a.b，否则整个表达式为 undefined"
if (capabilities?.fetchDeferred) { /* ... */ }              // packages/ai/src/api/lazy.ts:81

// 4. 空值合并：a ?? b 表示 "a 是 null/undefined 才用 b"（注意：0 和 "" 不会触发，|| 会误伤）
const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;  // packages/client/src/unix.ts:40
```

`?.` 和 `??` 是 strictNullChecks（严格空值检查）的配套设施，本仓库全程开启 strict，这两个符号无处不在。

## 8. class

来自 `packages/server/src/errors.ts:14`：

```ts
export class ServerError extends Error {
	readonly code: ServerOperationErrorCode;
	constructor(code: ServerOperationErrorCode, message: string) {
		super(message);
		this.name = "ServerError";
		this.code = code;
	}
}
```

要点：

- `readonly` = 初始化后不可再赋值（类似 Java `final` 字段）。
- `constructor` 是构造器，`super(...)` 调父类。
- `#field` 是**运行时真私有**字段（`packages/coding-agent/src/experimental/mini/worker/lane-service.ts:31`）；TS 的 `private` 关键字只是编译期检查，运行时可绕过。两者本仓库都在用。
- `implements SomeInterface` 表示"满足该接口的形状"，但**不继承任何实现**（`extends` 才继承）。
- 本仓库约束（strip-only）：**禁止**构造器参数属性简写（`constructor(private code: T)` 这种一行声明+赋值），必须像上面那样显式声明字段再在构造器里赋值。

| TS | Go | Java | Python |
|---|---|---|---|
| class + extends | 内嵌结构体 | class + extends | class + 继承 |
| `#x` | 小写字母私有 | `private` | `_x` 约定 |

## 9. 模块系统

```ts
// packages/ai/src/index.ts（barrel：一个文件汇总 re-export 全包公共 API）
export type { Static, TSchema } from "typebox";
export { Type } from "typebox";
export * from "./api/lazy.ts";
export type { AnthropicEffort, AnthropicOptions } from "./api/anthropic-messages.ts";
```

- `import { X } from "./y.ts"`：相对导入。**本仓库显式写 `.ts` 后缀**（tsconfig 开了 `allowImportingTsExtensions`），这在多数 TS 项目里不常见，是本项目的特色。
- `import type { X }`：只导入类型，编译后完全擦除，不产生运行时代码。
- `index.ts` 汇总导出叫 barrel 模式，等价于 Python 的 `__init__.py` 聚合 re-export。每个包的 `package.json` 里还有 `exports` 子路径映射（如 `@earendil-works/pi-ai/providers/all`），决定外部能 import 哪些入口。

| TS | Go | Java | Python |
|---|---|---|---|
| `import` / `export` | `import` / 大写导出 | module / package | `import` / `__init__.py` |
| barrel index.ts | internal/ 聚合 | — | `__init__.py` |

## 10. 类型收窄、断言 `as`、`satisfies`、`as const`

**收窄（narrowing）**：编译器根据检查逻辑把宽类型变窄。最重要的就是第 2 节 discriminated union 的 `switch (event.type)`——每个 case 分支里，`event` 自动被收窄成对应变体，`event.partial`、`event.message` 直接可用，无需任何断言（`packages/agent/src/agent-loop.ts:316`）。这是本仓库代码的主体写法。

运行时检查的组合拳（来自 `packages/evals/src/vitest-evals/harness-table.ts:101`）：

```ts
if (typeof input === "object" && input !== null && !Array.isArray(input) && "id" in input) {
```

- `typeof x === "object"` 只能证明"是对象或 null"，所以还要 `!== null`；
- `"id" in input` 证明对象上有 `id` 字段，之后 `input.id` 类型合法。

**断言 `as`**：程序员向编译器担保"我知道它实际是什么"（≈ Go 的 `v := x.(T)`，但纯编译期、无运行时检查，担保错了运行时才炸）。逃生舱，仓库里用得克制。

**`as const`**：把对象/数组类型固定成最窄的字面量版本。**`satisfies`**：校验值满足某类型但不拓宽它的类型。两个连用（`packages/tui/src/keybindings.ts:210`）：

```ts
} as const satisfies KeybindingDefinitions;
```

读作："这个对象按字面量锁定，同时校验它符合 KeybindingDefinitions"。

## 11. 不可变更新习惯

本仓库默认不改（mutate）共享对象，而是"浅拷贝 + 覆盖变化字段"（`packages/chord/src/services/state-codec.ts:71`）：

```ts
case "state":
	return { ...update, ops: codecs.get(/* ... */).encode(update.ops) };
```

发事件前先做快照也是同款（`packages/agent/src/agent-loop.ts:320`）：

```ts
await emit({ type: "message_start", message: { ...partialMessage } });  // {...x} 浅拷贝一份再发
```

对应 Java 的 `withX()` / record、Python 的 `{**obj, "k": v}` 或 `dataclasses.replace`。Go 的值语义 struct 天然如此，最容易适应。

## 12. 枚举的替代品（为什么全仓库 0 个 enum）

`enum` 需要编译器生成运行时代码，违反本仓库的 erasable-syntax 约束（见第 0 节），所以全仓库用两种替代：

```ts
// 替代一：字面量联合类型（packages/server/src/errors.ts:3）
type ServerOperationErrorCode =
	| RemoteServiceErrorCode
	| "wrong_server"
	| "session_not_found"
	| "session_ambiguous";

// 替代二：as const（packages/tui/src/keys.ts:165）
escape: "escape" as const,
esc: "esc" as const,
enter: "enter" as const,
```

对应 Go 的 `const + iota`、Java 的 enum、Python 的 `Literal` / `Final`。读到 `type X = "a" | "b" | "c"` 时，直接按"字符串枚举"理解即可。

## 13. any vs unknown

量化数据：全仓库 `any` 仅 66 处，`unknown` 632 处——`unknown` 是主流。项目规范（`AGENTS.md`）："No `any` unless absolutely necessary"。

- `unknown`："不知道是什么"，**用之前必须收窄**（`catch ((error: unknown)` 后要 `error instanceof Error` 才能取 `.message`，见 `packages/ai/src/api/lazy.ts:20`）。相当于 Java 的 `Object` + 强制向下转型检查、Go 的 `any`（`interface{}`）。
- `any`：关闭所有类型检查的逃生舱。仅存于动态负载等无法标注的场合（如 `packages/agent/src/types.ts:444` 工具参数 `args: any`）。

## 14. 装饰器：没有

仓库源码中没有装饰器（decorator）和 `reflect-metadata` 元编程。装饰器需要编译器改写代码，属于非 erasable 语法，被项目规范禁止。tsconfig 里的相关开关只是为依赖库兼容保留。**读代码时不用找注解，本项目的"注解"就是普通的函数调用和类型标注。**（对 Java 开发者尤其重要：没有 Spring 风格的魔法，一切依赖注入都是显式传参。）

## 15. 工具链对照表

根 `package.json` 的 `workspaces` 字段列出所有包目录——npm 会为每个包在根 `node_modules` 里建符号链接，包之间用 `@earendil-works/pi-ai` 这样的名字互相 import，开发时直连兄弟包源码，发布时按版本解析。等价于 Maven 多模块 / uv workspace；Go 里最接近的形态是单 module + internal 包。

| 工具 | 干什么 | 对应你熟悉的 |
|---|---|---|
| `npm` + workspaces | 依赖管理 + monorepo | Maven 多模块 / uv workspace / go.mod |
| `tsgo`（@typescript/native-preview） | TS 官方原生编译器（Go 实现的 tsc，约快 10 倍），全仓类型检查 | go build / javac |
| `tsx` | 不编译直接跑 .ts 文件 | go run / python x.py |
| `vitest` | 测试框架（tui 包例外用 `node --test`） | go test / pytest / JUnit |
| `biome` | 一体化格式化 + lint（Rust 写的，替代 ESLint+Prettier） | gofmt + golangci-lint / black + ruff |
| `esbuild` | 极速打包器，打 CLI 产物 | Maven Shade；Go 无对应（go build 自带） |
| `husky` | git hooks 管理器（pre-commit 跑检查） | Python pre-commit 框架 |

**strict 模式**（`tsconfig.base.json` 的 `strict: true`）一次打开整个严格家族，对读代码影响最大的三项：

- `strictNullChecks`：`null`/`undefined` 是独立类型，可空字段必须显式标注 `?`，取值前必须处理——相当于 Go "nil 必须显式判"的编译器强制版，`?.`/`??` 是它的配套语法；
- `noImplicitAny`：不标注就报错，禁止隐式 `any`；
- `useUnknownInCatchVariables`：`catch (e)` 里 `e` 是 `unknown`，用前必须收窄。

## 16. 下一步

带着这份语法地图，按 `docs/README.md` 的路线开始读代码。第一站推荐：

1. `packages/ai/src/utils/event-stream.ts`（111 行）——泛型类、私有字段、异步迭代器、Promise 组合全在里面；
2. `packages/ai/src/api/lazy.ts`（99 行）——闭包、函数类型、错误处理、"同步返回流"模式；
3. `packages/agent/src/agent-loop.ts` 的主循环段（约 296-360 行）——`for await` + discriminated union + 不可变快照，这是整个项目的心脏
4. 
