# event-stream.ts 语法与实现全解析

> 记录日期：2026-09-20
> 解析对象：`packages/ai/src/utils/event-stream.ts`（111 行，主线阅读清单 ①号文件）
> 面向：没写过 TS 的读者。每一行有新语法的地方都会停下来讲。

## 0. 这个文件是干什么的

一句话：**手写一个"异步队列"，让 LLM 的流式响应能被 `for await` 消费**。

背景问题：LLM 响应是流式的（token 一个个到），消费者想边到边处理。在 Go 里你会用 channel：生产者 `ch <- event`，消费者 `for event := range ch`。**TS/JS 没有 channel**，这个文件就是用「数组队列 + Promise + async generator」手搓一个等价物。它是 pi-ai 一切流式调用的底座（上一层的 `lazy.ts` ②号文件就建立在这上面）。

文件结构：`FifoQueue`（普通队列）→ `EventStream`（异步事件流）→ `AssistantMessageEventStream`（具体化）+ 一个工厂函数。

## 1. 第 1 行：import type

```ts
import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";
```

- `import type`：**只导入类型**，编译后整行消失，运行时不存在这个导入。
- `"../types.ts"`：相对路径 + 显式 `.ts` 后缀（本仓库惯例，多数 TS 项目不带后缀）。
- 效果：本文件只是"借用"那两个类型的名字来标注，不产生任何运行时依赖。

## 2. FifoQueue：泛型类 + 双栈队列（3-23 行）

```ts
class FifoQueue<T> {
    private incoming: T[] = [];
    private outgoing: T[] = [];
```

**语法点**：

- `class`：TS 的类 ≈ Java 的类（字段+方法+构造器），比 Go 的 struct+方法语法更紧凑。
- `<T>`：泛型参数。使用时 `FifoQueue<number>`、`FifoQueue<string>`……同一个类装任何类型，类型安全。≈ Go 的 `type FifoQueue[T any]`。
- `private incoming: T[] = []`：三段式字段声明——可见性（`private`，仅本类可访问，≈ Go 小写字段）+ 名字 + 类型 `T[]`（T 的数组）+ 初始值 `[]`（空数组）。一行完成了 Java 里要四行的事。

```ts
    get length(): number {
        return this.incoming.length + this.outgoing.length;
    }
```

- **`get` 访问器**（getter）：定义一个"看起来像字段的方法"。外部写 `q.length`（不加括号！）就触发这段计算。≈ C# 属性 / Kotlin 的自定义 getter；Go 和 Java 没有直接对应（Java 得写 `getLength()`）。
- `this`：指向实例自己（和 Java 一样；注意它比 Java 的 this 更危险——取决于调用方式）。

```ts
    enqueue(value: T): void {
        this.incoming.push(value);
    }
```

- 方法签名：`方法名(参数: 类型): 返回类型`。`: void` 表示无返回值（≈ Go 没有返回值 / Java 的 void）。
- `push` 是数组的尾部追加方法（改的是原数组，不是新建）。

```ts
    dequeue(): T | undefined {
        if (this.outgoing.length === 0) {
            while (this.incoming.length > 0) {
                this.outgoing.push(this.incoming.pop()!);
            }
        }
        return this.outgoing.pop();
    }
```

**算法**（你应该认识——算法题经典）：JS 数组的 `pop()`（尾部弹出）是 O(1)，但 `shift()`（头部弹出）是 O(n)（要搬移所有元素）。所以用两个栈：进队 push 到 `incoming`；出队时若 `outgoing` 空了，把 `incoming` 全部倒过去（顺序自然反转），再从 `outgoing` 弹出。均摊 O(1)。

**语法点**：

- 返回类型 `T | undefined`：union——要么是 T，要么是 undefined（队列空时 `pop()` 返回 undefined）。这就是 TS 表达"可能没有值"的方式，逼调用方判空（配合 `?.`/`??`/`if` 收窄）。
- **`!` 非空断言**（`this.incoming.pop()!`）：向编译器担保"这里不会是 undefined"。`while (incoming.length > 0)` 已保证 pop 非空，但编译器不分析这层，`!` 是人为消除警告。**它没有运行时效果**，担保错了运行时照样炸——是受控的逃生舱（Go 的类型断言至少有 `, ok` 形态，`!` 更裸）。

## 3. EventStream：本文件的主角（26-89 行）

### 3.1 类声明与字段

```ts
export class EventStream<T, R = T> implements AsyncIterable<T> {
```

- `export`：导出（其他文件可以 import 它）。没写 export 的 FifoQueue 是模块私有的。
- `<T, R = T>`：**两个泛型参数，第二个带默认值**。T 是事件类型，R 是最终结果类型；不指定 R 时默认 R = T。后面会看到具体化：`EventStream<AssistantMessageEvent, AssistantMessage>`——"事件流，终结时产出一个 AssistantMessage"。
- `implements AsyncIterable<T>`：承诺实现标准接口 `AsyncIterable`（可被 `for await...of` 消费的协议）。≈ Java 的 `implements Iterable<T>`，但 TS 的 implements **只做形状校验**，不带来任何运行时能力——你必须自己实现协议要求的 `[Symbol.asyncIterator]()` 方法（3.4 节）。

```ts
    private queue = new FifoQueue<T>();
    private waiting = new FifoQueue<(value: IteratorResult<T>) => void>();
    private done = false;
    private finalResultPromise: Promise<R>;
    private resolveFinalResult!: (result: R) => void;
    private isComplete: (event: T) => boolean;
    private extractResult: (event: T) => R;
```

逐个看，这里有三种新语法：

- `queue = new FifoQueue<T>()`：字段声明 + 直接 new 赋初始值（`new` 和 Java 一样）。没有类型标注——TS 从右边**推断**出类型（类型推断，类似 Kotlin 的 val / Python 靠运行时，但这里是编译期）。
- `waiting = new FifoQueue<(value: IteratorResult<T>) => void>()`：**泛型参数本身是一个函数类型**！这个队列里存的不是数据，是"回调函数"。`(value: IteratorResult<T>) => void` 读作"收一个 IteratorResult<T> 什么都不返回的函数"。**这个字段是整个机制的核心**：消费者把回调排在这里等生产者唤醒（3.4 节展开）。`IteratorResult<T>` 是标准协议类型：`{ value: T, done: false }` 或 `{ value: undefined, done: true }`。
- `resolveFinalResult!: (result: R) => void`：**definite assignment 断言**（`!` 写在字段名后、冒号前）。含义："编译器，这个字段现在没初始化，但我保证构造器里会赋值。" 它和第 2 节的 `pop()!` 是同一个符号的**两种用法**（那是"非空"，这是"已赋值"）。为什么不直接初始化？因为 resolve 只能在 `new Promise(...)` 的执行器里拿到（3.2 节）。
- `isComplete` / `extractResult`：**函数字段**——把两个策略函数作为配置存起来（本类不知道"什么算完成、怎么提取结果"，由子类注入，见第 4 节。这是无接口版的策略模式）。

### 3.2 构造器：留住 resolve

```ts
    constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
        this.isComplete = isComplete;
        this.extractResult = extractResult;
        this.finalResultPromise = new Promise((resolve) => {
            this.resolveFinalResult = resolve;
        });
    }
```

- `constructor`：构造器（每个类只能有一个，没有 Java 的重载）。
- 前两行：把传进来的策略函数存进字段。
- **后三行是惯用法**：`new Promise((resolve) => {...})` 里，executor 函数会**立刻同步执行**并收到 `resolve` 函数（调用它就能兑现这个 Promise）。这里不立即 resolve，而是**把 resolve 存进字段**——将来任何时刻调用 `this.resolveFinalResult(x)` 都能让 `finalResultPromise` 变为已兑现。这就是"手动控制一个 Promise 的兑现时机"，也是字段上那个 `!` 断言的兑现。

### 3.3 push() 与 end()：生产者一侧

```ts
    push(event: T): void {
        if (this.done) return;
        if (this.isComplete(event)) {
            this.done = true;
            this.resolveFinalResult(this.extractResult(event));
        }
        const waiter = this.waiting.dequeue();
        if (waiter) {
            waiter({ value: event, done: false });
        } else {
            this.queue.enqueue(event);
        }
    }
```

push 做两件事：

1. **完成检测**：问策略函数 `isComplete(event)`（对 LLM 流就是 `type === "done" || type === "error"`）。是完成事件 → 标记 `done`，并用另一个策略 `extractResult` 从事件里取出最终结果（R），兑现 `finalResultPromise`——从此 `await stream.result()` 的等待方全部放行。
2. **投递**：从 `waiting` 队列弹出一个回调。有等待的消费者 → **直接调用它的回调**把事件递过去（消费者那边挂着的 await 立刻恢复）；没有 → 事件进 `queue` 缓存，等消费者以后来取。

注意：`waiter` 的类型是 `函数 | undefined`（dequeue 可能返回 undefined），`if (waiter)` 既判空又**类型收窄**——分支内 TS 知道它是函数，可以直接调用。

```ts
    end(result?: R): void {
        this.done = true;
        if (result !== undefined) {
            this.resolveFinalResult(result);
        }
        while (this.waiting.length > 0) {
            const waiter = this.waiting.dequeue()!;
            waiter({ value: undefined as any, done: true });
        }
    }
```

- `result?: R`：**可选参数**（`?` 在参数名后）——调用时可以不传。
- 逐个唤醒所有等待者，发 `{ done: true }` 让它们的 for await 正常结束。
- `undefined as any`：`as` 是类型断言（"把它当作 any 类型"），`any` 关闭所有检查——因为协议要求 done 时 value 必须是 T 类型，实际却是 undefined，只能用 any 逃生。（标准协议规定消费者看 `done: true` 就不该碰 value，所以安全。）

### 3.4 async *[Symbol.asyncIterator]()：消费者一侧（最难也最重要）

```ts
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        while (true) {
            if (this.queue.length > 0) {
                yield this.queue.dequeue()!;
            } else if (this.done) {
                return;
            } else {
                const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.enqueue(resolve));
                if (result.done) return;
                yield result.value;
            }
        }
    }
```

先拆语法，再讲机制：

**语法点**：

- `[Symbol.asyncIterator]`：**计算成员名**——方法名放在方括号里，取 `Symbol.asyncIterator` 这个全局唯一符号的值。这是 JS 的协议约定：任何对象有这个名字的方法，就能被 `for await...of` 消费（就像 Python 的 `__aiter__`、Go 的没有协议全靠 range 语义）。
- `async *`：**异步生成器方法**。`*` 表示生成器（可以 `yield`），`async` 表示可以 `await`。两者组合 = 异步生产序列。
- `yield x`：产出一个值，**暂停在这里**，等消费者拿走并要下一个时才继续。生成器函数被调用时不执行body，返回迭代器（惰性）。
- `return;`：提前终止生成器（消费者侧表现为 for await 循环正常结束）。

**机制**（对照 push 一侧看）：

```
消费者 for await                    生产者 push(event)
────────────────                    ─────────────────
循环第 1 圈: queue 非空?
├─ 有 → yield 事件给循环体           （事件是之前缓冲的）
├─ 没有且 done → return 结束
└─ 没有且未 done ↓
   await new Promise(resolve =>
       waiting.enqueue(resolve))    push 到来:
   ↑ 挂起（不占线程，事件循环去跑别的）  waiter = waiting.dequeue()
                                     waiter({value: event, done:false})
                                     → resolve 被调用
   await 返回 result ←───────────────┘
   result.done? → return
   否则 yield result.value → 循环体处理 → 回到循环第 1 圈
```

**点睛之笔是第 79 行**：`new Promise((resolve) => this.waiting.enqueue(resolve))`——创建一个**永不自我兑现**的 Promise，把它的 resolve 函数排队交给生产者，然后 await 挂起。生产者 push 时调用这个 resolve，消费者的 await 才恢复。**这就是没有 channel 的世界里"在队列上阻塞"的实现方式**（Go 里 `ch <- / <-ch` 一个关键字的事，这里要拆成"回调队列 + Promise"）。这个模式和 `lazy.ts` 的 lazyStream、Node.js 全部异步 API 同宗同源。

另外注意 `waiting` 为什么是 **FifoQueue（队列）而不是单个槽位**：多个消费者同时 for await 时各自的 resolve 排队，先来先服务。实践中单消费者居多，但实现天然支持多消费者。

### 3.5 result()：等最终结果

```ts
    result(): Promise<R> {
        return this.finalResultPromise;
    }
```

返回构造器里创建的那个 Promise。`await stream.result()` 会挂到完成事件（done/error）到达、`resolveFinalResult` 被调用为止。**agent 主循环的写法**：`for await` 消费完事件后调 `await response.result()` 拿最终的 `AssistantMessage`——事件流和最终结果两条通道共享同一次驱动。

## 4. AssistantMessageEventStream：具体化 + 策略注入（91-105 行）

```ts
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
    constructor() {
        super(
            (event) => event.type === "done" || event.type === "error",
            (event) => {
                if (event.type === "done") {
                    return event.message;
                } else if (event.type === "error") {
                    return event.error;
                }
                throw new Error("Unexpected event type for final result");
            },
        );
    }
}
```

- `extends`：继承。`EventStream<AssistantMessageEvent, AssistantMessage>` 把父类两个泛型**钉死**：事件是 `AssistantMessageEvent`（那 12 种可辨识联合事件），最终结果是 `AssistantMessage`。
- `super(...)`：调父类构造器，传两个**箭头函数**——这就是第 3.1 节说的策略注入：
  - 什么算完成：`type === "done" || type === "error"`
  - 怎么提取结果：done 取 `message` 字段，error 取 `error` 字段（两者都是 AssistantMessage）
- **注意类型收窄在起作用**：`if (event.type === "done")` 分支内，编译器自动把 event 收窄成 done 变体，所以 `event.message` 合法；else if 里是 error 变体，`event.error` 合法——不用任何断言。
- `throw new Error("...")`：防御性兜底。逻辑上到不了（isComplete 已过滤），但 extractResult 的类型要求必须返回 R，这条分支让编译器和审计都安心。`new Error(...)` 创建异常对象（≈ Go 的 errors.New + panic，Java 的 throw）。

一句话总结这一层：**111 行里的泛型机器，被两行策略函数变成"LLM 事件流"**。

## 5. 工厂函数（107-110 行）

```ts
/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
    return new AssistantMessageEventStream();
}
```

普通导出函数，new 一下返回。JSDoc 说明了存在理由：给扩展用（扩展拿不到类的直接引用时，工厂函数是更稳定的 API 形态——将来内部改成别的实现也不破坏调用方）。

## 6. 它在项目里的位置

```
pi-ai 适配器（如 anthropic-messages.ts）
   │ 解析 SSE → stream.push({type:"text_delta", ...})   ← 生产者
   ▼
AssistantMessageEventStream（本文件）
   │ for await event of stream   ← 消费者1：agent-loop.ts:315 逐事件 emit 给 UI
   │ await stream.result()       ← 消费者2：拿最终 AssistantMessage（usage/stopReason）
   ▼
agent 包 → coding-agent → tui 渲染
```

`lazy.ts`（②号文件）的 `lazyStream` 也是它的消费者：先 new 一个空流同步返回，背后异步拿到真流后把事件逐个 `push` 进去。

## 7. 本文件语法速查表

| 行号 | 语法 | 含义 |
|---|---|---|
| :1 | `import type` | 只导入类型，编译后消失 |
| :3 | `class X<T>` | 泛型类 |
| :4 | `private f: T[] = []` | 私有字段 + 数组类型 + 初始化 |
| :7 | `get length()` | getter 访问器（当字段用） |
| :15 | `T \| undefined` | "可能是 T 或没有" 的 union |
| :18 | `expr!` | 非空断言（运行时无效果） |
| :26 | `class X<T, R = T> implements I` | 泛型默认参数 + 接口实现 |
| :28 | `FifoQueue<(v) => void>` | 泛型参数是函数类型（回调队列） |
| :31 | `field!:` | definite assignment 断言（构造器里会赋值） |
| :32-33 | 函数字段 | 策略注入 |
| :35 | `constructor` | 构造器 |
| :38-40 | `new Promise(resolve => ...)` | 留住 resolve 手动兑现 |
| :43-58 | push / waiter 模式 | 生产者：唤醒或缓冲 |
| :60 | `result?: R` | 可选参数 |
| :68 | `undefined as any` | 类型断言逃生舱 |
| :72 | `async *[Symbol.asyncIterator]()` | 异步生成器实现迭代协议 |
| :75/:79 | `yield` / `await new Promise` | 挂起产出 / 排队 resolve 等唤醒 |
| :91 | `extends Parent<A, B>` | 继承并钉死泛型 |
| :93 | `super(箭头函数, 箭头函数)` | 策略模式注入 |
| :96 | if 收窄 | 分支内自动识别联合变体 |

## 8. 动手实验（强烈建议）

在仓库根目录建个 `/tmp/stream-demo.ts` 玩一下（`npx tsx /tmp/stream-demo.ts` 运行）：

```ts
import { AssistantMessageEventStream } from "./packages/ai/src/utils/event-stream.ts";

const stream = new AssistantMessageEventStream();

// 生产者：每 300ms push 一个事件（模拟 token 流）
let i = 0;
const timer = setInterval(() => {
    if (i < 3) {
        stream.push({ type: "text_delta", contentIndex: 0, delta: `块${i} `, partial: null as any });
        i++;
    } else {
        stream.push({ type: "done", reason: "stop", message: null as any });
        clearInterval(timer);
    }
}, 300);

// 消费者：for await 逐个收
for await (const event of stream) {
    console.log("收到:", event.type);
}
console.log("完成，结果:", await stream.result());
```

改两处体会机制：① 把消费者的 `for await` 注释掉——会发现 push 全进了 queue 缓冲（生产者永不阻塞）；② 在 push 完成事件前调 `end()`——观察所有等待者被 done 唤醒。

---

读完后接着看 ②号文件 `packages/ai/src/api/lazy.ts`（99 行），它把本文件的流原语用成了"同步返回 + 异步准备"模式。
