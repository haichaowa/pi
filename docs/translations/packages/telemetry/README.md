> 译注：本文是 `packages/telemetry/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-telemetry

面向 pi 包的供应商中立（vendor-neutral）遥测契约与类型化 schema 工具。

本包提供：

- 一份显式的、基于回调的 `TelemetryContext` / `TelemetrySpan` 契约；
- 一个共享的 `NOOP_TELEMETRY_CONTEXT`；
- 一个参考实现 `InMemoryTelemetryContext`；
- 可序列化的 schema 定义，并可从中推断出 TypeScript 类型；
- 不包含 exporter、全局 current-span 状态，也不依赖任何遥测后端。

应用程序可以使用内存版参考实现，也可以为 OpenTelemetry、Sentry、日志或其他后端提供 adapter。Pi 包显式地传递 telemetry context，并各自单独定义其领域 schema。

## 目录

- [安装](#installation)
- [遥测概念](#telemetry-concepts)
- [核心 Context API](#core-context-api)
- [Adapter 契约](#adapter-contract)
- [No-op Context](#no-op-context)
- [内存版参考 Adapter](#in-memory-reference-adapter)
- [Adapter 一致性](#adapter-conformance)
- [类型化 Schema](#typed-schemas)
  - [启动与完成 Attribute](#start-and-completion-attributes)
- [Schema 元数据](#schema-metadata)
- [Pi 包集成](#pi-package-integration)
- [安全与可移植性](#security-and-portability)
- [API 参考](#api-reference)
- [开发](#development)
- [许可证](#license)

## 安装

```bash
npm install @earendil-works/pi-telemetry
```

## 遥测概念

遥测（telemetry）描述的是程序在运行期间做了什么。本包使用 span、attribute、event、status 以及显式 context 来对这类工作进行建模：

| 概念 | 通俗含义 |
|---|---|
| **Span** | 对单个操作的计时记录，例如加载一个账户或发起一次 AI 请求。它在工作开始之前启动，在工作结束时结束。 |
| **父 span 与子 span** | 操作可以包含更小的操作。一个请求 span 可能包含一次缓存查找和一次数据库查询。它们共同构成一棵树，展示时间都花在了哪里。 |
| **Attribute** | 附加在 span 上的具名事实，例如 `provider: "openai"`、`cache.hit: true` 或 `item_count: 12`。attribute 描述操作及其结果。 |
| **Event** | 在 span 期间某个时点发生的一次具名事件，例如 `retry.scheduled` 或 `cache.lookup`。event 没有持续时间，并可以携带自己的 attribute。 |
| **Status** | 操作的结果：`ok` 或 `error`。error status 可以包含错误名称和错误消息。 |
| **Context** | 一个句柄，用于标识新工作在 span 树中所属的位置。从某个 context 启动 span，会使该 span 成为该 context 的子 span。 |

例如，加载一个账户可能产生如下遥测数据：

```text
example.account.load                         span
├─ attributes: account.id=123, found=true   facts about the span
├─ event: example.cache.lookup              occurrence during the span
│  └─ attribute: cache.hit=false            fact about the event
└─ status: ok                               final outcome
```

span 是诊断数据，而不是业务状态。记录 span 绝不能改变账户加载是否运行、成功、失败或被持久化。adapter 负责把这些通用概念转换成 OpenTelemetry、Sentry、日志或其他后端所使用的对应概念。

## 核心 Context API

`TelemetryContext` 围绕一个回调启动 span。回调会收到一个 `TelemetrySpan`，它同时也是子 span 的显式父 context。

```typescript
import {
  NOOP_TELEMETRY_CONTEXT,
  type TelemetryContext,
} from '@earendil-works/pi-telemetry';

async function loadAccount(
  accountId: string,
  telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT,
) {
  return telemetryContext.startSpan(
    {
      name: 'example.account.load',
      attributes: { 'example.account.id': accountId },
    },
    async (span) => {
      const account = await readAccount(accountId);
      span.setAttributes({ 'example.account.found': account !== undefined });
      return account;
    },
  );
}
```

把回调中的 span 传给更低层的工作，即可创建显式的嵌套：

```typescript
return telemetryContext.startSpan({ name: 'example.parent' }, async (parentSpan) => {
  return parentSpan.startSpan({ name: 'example.child' }, async (childSpan) => {
    childSpan.addEvent('example.cache.lookup', { 'example.cache.hit': true });
    return performWork();
  });
});
```

这里没有公开的 `end()` 方法。`startSpan()` 负责结算（settlement），并保持 span 打开，直到回调返回的值或 promise settle。对于由普通返回值表示的预期失败，应显式设置 status：

```typescript
return telemetryContext.startSpan({ name: 'example.save' }, async (span) => {
  const result = await save();
  if (!result.ok) {
    span.setStatus({
      status: 'error',
      error: { name: 'SaveError', message: result.reason },
    });
  }
  return result;
});
```

## Adapter 契约

adapter 实现 `TelemetryContext`，并把这套通用 API 桥接到自己的后端。它必须：

- 同步地、且恰好一次地创建子 span 并调用回调；
- 保留回调的返回值和 rejection 值；当回调同步抛出异常时，返回一个以相同值 reject 的 promise；
- 在返回的 promise settle 之前保持原生 span 打开；
- 除非已显式设置 status，否则把正常完成视为 `ok`，把抛出异常/rejection 视为 error；
- 让重复的 `setStatus()` 调用遵循 last-write-wins（后写优先）；
- 合并多次 `setAttributes()` 调用：后定义的值覆盖先前的值，`undefined` 则被忽略；
- 让记录类方法保持同步、被动且不抛出异常；
- 忽略结算之后发起的调用；
- 原子地忽略失败的记录调用，抑制后端故障，同时仍然恰好执行一次业务回调。

adapter 可以在内部激活后端原生的环境式（ambient）context 以支持自动埋点，但 pi 代码始终通过 `TelemetryContext` 参数显式传递父级。exporter 的缓冲、刷新、采样、后端 ID 以及后端特定的 context 对象都归 adapter 所有。可以使用 [adapter 一致性测试套件](#adapter-conformance)来检查这些可观测语义。

## No-op Context

当遥测是可选的时候，使用 `NOOP_TELEMETRY_CONTEXT`：

```typescript
import { NOOP_TELEMETRY_CONTEXT } from '@earendil-works/pi-telemetry';

const result = await NOOP_TELEMETRY_CONTEXT.startSpan(
  { name: 'example.operation' },
  () => runOperation(),
);
```

no-op context 会：

- 同步调用回调；
- 保留返回值和异步 rejection，并把同步抛出的异常转换为以相同值 reject 的 promise；
- 使用一个共享的、被冻结的惰性 span（对嵌套 span 也是如此）；
- 不检查也不保留名称、attribute、event 或 status。

## 内存版参考 Adapter

`InMemoryTelemetryContext` 是与后端无关的参考实现。它适用于测试、本地诊断，以及有意想要无 exporter 的进程内捕获的应用程序：

```typescript
import { InMemoryTelemetryContext } from '@earendil-works/pi-telemetry';

const telemetry = new InMemoryTelemetryContext();

await telemetry.startSpan(
  { name: 'example.operation', attributes: { input: 'demo' } },
  async (span) => {
    span.addEvent('example.started');
    span.setAttributes({ output_count: 3 });
  },
);

console.log(telemetry.getSpans());
```

`getSpans()` 按 span 启动顺序返回分离的 snapshot。每个 `RecordedTelemetrySpan` 包含确定性的数字 ID、父 ID、合并后的 attribute、有序的 event、最终 status、结算状态，以及确定性的结束序号。它不记录时间戳。

该 adapter 可以像普通 `TelemetryContext` 一样安全使用，但其存储是无上限且进程本地的。请创建全新实例来隔离测试或记录范围，并且除非调用方的数据策略允许，否则不要捕获敏感 attribute。

## Adapter 一致性（Conformance）

`@earendil-works/pi-telemetry/testing` 导出一套与测试运行器无关的一致性测试套件，其形式是分组用例。fixture 负责提供一个全新的 context，并把其后端已完成的 span 转换为规范化的 `RecordedTelemetrySpan` snapshot：

```typescript
import {
  createTelemetryAdapterConformance,
  type TelemetryAdapterFixture,
} from '@earendil-works/pi-telemetry/testing';
import { describe, it } from 'vitest';

const conformance = createTelemetryAdapterConformance(async () => {
  const adapter = createMyTelemetryAdapter();
  return {
    context: adapter.context,
    getSpans: async () => adapter.normalizedSpans(),
    async [Symbol.asyncDispose]() {
      await adapter.close();
    },
  } satisfies TelemetryAdapterFixture;
});

for (const group of new Set(conformance.map((testCase) => testCase.group))) {
  describe(group, () => {
    for (const testCase of conformance.filter((candidate) => candidate.group === group)) {
      it(testCase.name, () => testCase.run());
    }
  });
}
```

该套件检查：同步的一次性准入、返回值与 rejection 的同一性、自动与显式 status、attribute 合并、event 顺序、结算后调用的惰性、嵌套与并发父子关系，以及对无法读取的遥测 payload 失败的抑制。`getSpans()` 可以在返回前刷新异步 exporter。testing 子路径使用 Node 的断言 API；根遥测包本身保持运行时中立。

## 类型化 Schema

底层 span API 有意接受开放的名称和 attribute bag，从而让 adapter 保持通用。领域包则可以定义封闭、可序列化的 schema，并从中推断出精确的 TypeScript 类型。

```typescript
import {
  createTypedSpanStarter,
  defineTelemetrySchema,
} from '@earendil-works/pi-telemetry';

export const EXAMPLE_TELEMETRY_SCHEMA = defineTelemetrySchema({
  version: 1,
  spans: {
    'example.read': {
      description: 'Read one resource',
      parents: { kind: 'any' },
      startAttributes: {
        'example.resource': {
          type: 'string',
          required: true,
          values: ['account', 'project'],
          description: 'Resource kind',
        },
      },
      endAttributes: {
        'example.item_count': {
          type: 'number',
          description: 'Number of returned items',
        },
      },
      events: {
        'example.cache': {
          description: 'Cache lookup result',
          attributes: {
            'example.cache.hit': {
              type: 'boolean',
              required: true,
              description: 'Whether the cache contained the resource',
            },
          },
        },
      },
      status: {
        default: 'ok',
        errorWhen: 'The read throws or returns an error result',
      },
    },
  },
} as const);

const startSpan = createTypedSpanStarter(
  telemetryContext,
  [EXAMPLE_TELEMETRY_SCHEMA],
);
```

starter 为每个 span 暴露一个重载，并在编译期检查名称和 attribute。联合类型的名称必须先收窄再调用，从而保持每个运行时名称与其 attribute schema 之间的对应关系。它的回调会收到一个基于相同 schema 的子 starter，且该 starter 已经绑定到回调的 span：

```typescript
await startSpan(
  'example.read',
  { 'example.resource': 'account' },
  async (span, startChildSpan) => {
    span.addEvent('example.cache', { 'example.cache.hit': true });
    const accounts = await readAccounts();
    span.setAttributes({ 'example.item_count': accounts.length });

    await startChildSpan(
      'example.read',
      { 'example.resource': 'project' },
      async (childSpan) => {
        const projects = await readProjects();
        childSpan.setAttributes({ 'example.item_count': projects.length });
      },
    );

    return accounts;
  },
);
```

### 启动与完成 Attribute

`startAttributes` 和 `endAttributes` 描述的是 attribute 通常在何时可知，而不是相互独立的运行时存储：

| Schema 字段 | 值如何被记录 | 是否必填 |
|---|---|---|
| `startAttributes` | 在 span 创建时通过类型化 starter 的 `attributes` 参数传入 | 每个定义都显式设置 `required: true` 或 `false` |
| `endAttributes` | 之后通过 schema 作用域 span 的 `setAttributes()` 方法添加 | 始终可选 |

这两组 attribute 最终都会成为同一个后端 span 上的普通 attribute。不存在单独的结束 attribute payload，也没有结束回调。在前面的示例中，`example.resource` 在 `example.read` 启动时已知，而 `example.item_count` 只有在 `readAccounts()` 返回之后才可知：

```typescript
await startSpan(
  'example.read',
  { 'example.resource': 'account' }, // required start attribute
  async (span) => {
    const accounts = await readAccounts();
    span.setAttributes({
      'example.item_count': accounts.length, // optional completion attribute
    });
    return accounts;
  },
); // resolving the callback settles the span
```

这里的“结束”指完成时的补充：end attribute 可以在回调活跃期间的任意时点设置，不可用时也可以省略。一次 `setAttributes()` 都不调用也是合法的。这对早期失败、取消，以及并非每条路径都存在的 provider 特定数据非常重要。

重复调用 `setAttributes()` 会合并进同一个 attribute bag。同一个 key 后定义的值会替换先前的值，而 `undefined` 会被忽略。这个 schema 作用域的方法只接受当前 span 已声明的 end attribute。

设置 attribute 并不会结束 span。从回调返回、resolve、抛出异常或 reject 才控制结算；真正执行结束操作的是 `startSpan()`。结算之后对 adapter 的调用都是惰性的。

一个 starter 可以组合多个独立版本化的 schema：

```typescript
import { AGENT_TELEMETRY_SCHEMAS } from '@earendil-works/pi-agent-core';

const startAgentSpan = createTypedSpanStarter(
  telemetryContext,
  AGENT_TELEMETRY_SCHEMAS,
);
```

内联的 schema 数组会自动保留其元组类型。单独声明的数组应使用 `as const`。数组中字面量重复的 span 名称会在编译期被拒绝；schema 在运行时不会被合并、检查或保留。

由 schema 推导出的类型会拒绝缺失的必填 attribute、未知的 key、非法的封闭集合取值、未声明的 event，以及空 schema 上的 attribute。end attribute 始终是可选的补充；类型系统不要求必须调用 `setAttributes()`。

`defineTelemetrySchema()` 是一个带类型的恒等函数。它返回普通的 JSON 可序列化数据，不做任何运行时校验，也不强制父级规则。

## Schema 元数据

支持的 attribute 类型有：

- `string`、`number` 和 `boolean`；
- `string[]`、`number[]` 和 `boolean[]`。

attribute 定义支持：

- `values`：标量值的封闭集合；
- `elementValues`：数组元素的封闭集合；
- `examples`：文档示例；
- `sensitive`：标记需要特殊处理的数据；
- `cardinality`：记录预期的 `low` 或 `high` 基数。

启动 attribute 和 event attribute 需要声明 `required`。end attribute 则不需要；参见[启动与完成 Attribute](#start-and-completion-attributes)。

父级元数据是描述性的 schema 数据：

- `{ kind: 'any' }`：根 span 或任意调用方 span；
- `{ kind: 'root_or_external' }`：根 span，或该 schema 之外由调用方拥有的 span；
- `{ kind: 'spans', spans: [...] }`：仅限列出的 schema span。

adapter 无需理解 schema 对象。埋点辅助工具和测试会使用它们，以保证产出的名称和 attribute 保持一致。

## Pi 包集成

包的所有权被有意拆分：

- `@earendil-works/pi-telemetry` 拥有供应商中立的契约、no-op 与内存版参考 context、schema 工具，以及 adapter 一致性测试套件；
- `@earendil-works/pi-ai` 在 provider 请求选项中接受并传递 `telemetryContext`，但不拥有任何遥测 schema；
- `@earendil-works/pi-agent-core` 拥有并导出 pi 的 AI 请求与 harness schema、它们的组合只读 schema 元组，以及类型化的 span 辅助工具。

```typescript
import {
  AGENT_TELEMETRY_SCHEMAS,
  AI_TELEMETRY_SCHEMA,
  HARNESS_TELEMETRY_SCHEMA,
  startAiSpan,
  startHarnessSpan,
} from '@earendil-works/pi-agent-core';
```

pi 的 schema 使用 pi 自有的 `pi.ai.*`、`pi.harness.*` 和 `pi.session.*` 命名。adapter 可以把它们转换成后端自己的约定，而不改变 pi 产出的词汇本身。

## 安全与可移植性

遥测是进程本地的诊断信息，不是持久化的应用状态。不要把 `TelemetryContext`、`TelemetrySpan` 或后端原生的 trace 对象持久化到记录、消息、snapshot 或延迟句柄中。

attribute 值被有意限制为原始标量和数组。领域埋点应避免记录 prompt、completion、工具参数或输出、文件内容、provider payload、header、凭证，以及自由格式的错误细节，除非其 schema 和数据策略明确允许。

本包不使用 `AsyncLocalStorage` 或其他运行时特定的环境式 context API。它适用于 Node.js、Bun、浏览器和 worker；后端 adapter 仍需自行负责各自运行时的兼容性。

## API 参考

### 核心类型与值

| 导出 | 用途 |
|---|---|
| `TelemetryContext` | 启动由回调管理的子 span |
| `TelemetrySpan` | 记录 attribute、event 和 status；同时也可充当子 context |
| `SpanOptions` | span 名称以及可选的启动 attribute |
| `SpanAttributes` / `AttributeValue` | 开放的 adapter 层 attribute bag 及其支持的取值 |
| `SpanStatus` | 显式的 `ok` 或 `error` status |
| `NOOP_TELEMETRY_CONTEXT` | 遥测关闭时共享的被动 context |
| `InMemoryTelemetryContext` | 具有确定性进程内记录的参考 adapter |
| `RecordedTelemetrySpan` | 规范化的已捕获 span snapshot |
| `RecordedTelemetryEvent` | 规范化的已捕获 event snapshot |

### Schema 定义与类型推断

| 导出 | 用途 |
|---|---|
| `defineTelemetrySchema()` | 用于可序列化 schema 数据的带类型恒等辅助函数 |
| `createTypedSpanStarter()` | 把父 context 绑定到一个或多个 schema 词汇表 |
| `TypedSpanStarter` | 精确的 starter 类型，回调递归绑定子级 |
| `TelemetrySchemaDefinition` | 顶层 schema 形状 |
| `TelemetrySpanDefinition` | span 元数据、父级、attribute、event 和 status 规则 |
| `TelemetryAttributeType` | 支持的标量与数组类型名称 |
| `TelemetryAttributeMetadata` | 描述、敏感性与基数元数据 |
| `TelemetryAttributeDefinition` | attribute 类型、允许取值、示例和元数据 |
| `TelemetryStartAttributeDefinition` | 带必填标记的启动 attribute 定义 |
| `TelemetryEventAttributeDefinition` | 带必填标记的 event attribute 定义 |
| `TelemetryEventDefinition` | event 描述与 attribute 定义 |
| `TelemetryParentDefinition` | 开放、外部根或有限 schema 父级规则 |
| `TelemetrySchemaSpanName` | 已声明 span 名称的联合类型 |
| `TelemetrySchemaSpanStartAttributes` | 单个 span 精确推断出的启动 attribute |
| `TelemetrySchemaSpanEndAttributes` | 单个 span 可选推断出的 end attribute |
| `TelemetrySchemaSpanEventName` | 单个 span 所声明 event 的联合类型 |
| `TelemetrySchemaSpanEventAttributes` | 单个 event 精确推断出的 attribute |
| `SchemaTelemetrySpan` | 限定于单个 schema span 的 span 视图 |
| `TelemetrySchemaSpanUnion` | schema 中所有 span 的可辨识联合 |
| `InferStartAttributes` | 从启动定义推断出的必填与可选值 |
| `InferOptionalAttributes` | 从结束定义推断出的可选值 |
| `InferEventAttributes` | 从 event 定义推断出的必填与可选值 |
| `InferRequiredAndOptionalAttributes` | 带必填标记定义所共享的推断工具类型 |
| `ExactTelemetryAttributes` | 拒绝预期 attribute 集合之外的 key |

### Testing 子路径

| 导出 | 用途 |
|---|---|
| `createTelemetryAdapterConformance()` | 创建与运行器无关的 adapter 一致性用例 |
| `TelemetryAdapterFixture` | 单个用例的全新 context 与规范化 snapshot 读取器 |
| `TelemetryAdapterFixtureFactory` | 创建相互隔离的 fixture |
| `TelemetryAdapterConformanceCase` | 由测试运行器执行的分组用例 |

## 开发

在本包目录下执行：

```bash
npm test
npm run build
```

仓库范围的类型检查、格式化、lint 和冒烟检查通过以下命令运行：

```bash
npm run check
```

## 许可证

MIT
