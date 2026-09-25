> 译注：本文是 `packages/chord/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/chord

Chord 是一个应用组合（application-composition）运行时，面向由插件/扩展组装而成的系统。它提供 facet、service、replicated state（复制状态），以及可插拔的远程 service 边界。它作为 Pi monorepo 中的一个独立包进行开发，但它并不是一个 Pi 包：它不依赖任何其他 Pi workspace 包，也可以被毫无关联的应用程序使用。

## Chord 的用途

单个应用特性可能需要在多种环境中运行：例如 agent worker、终端 UI，以及远程 WebUI。Chord 提供通用的机制，让你能以对人类和 agent 都同样友好的方式编写这类扩展。

这个设计由几个相互关联的部分组成：

- **插件（Plugin）**是同步的装配单元，会声明自己提供和需要的 service。当所有插件都声明完自身的形态后，host 会校验完整的依赖图、绑定 service、先于消费者激活 provider，并按依赖的逆序释放资源。这些单元被称为 *facet*。

- **Facet** 是插件的组成部分。每个 facet 会被单独打包，并在它应当运行所在的进程或环境中运行。你可以用 facet 把一个插件拆分成多个独立的部分，分别加载到不同的进程和环境（例如后端、浏览器、TUI 等）。

- **Service** 是带类型的稳定 token，要么只有一个 provider（**singleton**），要么是动态的按 key 实例（**keyed**）。service 可以是进程本地的（拥有不受限制的 JavaScript 契约），也可以是可远程暴露的。当 provider 断开或被替换时，消费者仍持有一个稳定的 facade。

- **Replicated state（复制状态）**把权威状态暴露给本地和远程的已连接消费者。生产者修改受追踪的 `state` proxy 并调用 `publish(context)`；消费者收到完整的不可变值。Chord 在每次发布时刷出一个解码后的操作批次，而每个远程客户端/状态流拥有独立的 path codec 状态。副本在断开或被替换时会变为未就绪，直到被重新水合（rehydrate）。

- **Delta tracking（增量追踪）**在刷出（flush）时从受追踪的普通 JSON 推导出紧凑的操作。它保留字符串追加/前端截断以及数组追加的行为，但不保留修改历史；它支持持久化的基础批次，并在应用不可信操作时对其进行校验。

- **Remote service source（远程 service 源）**对外宣告 facet host 之外可用的 service，并为其 facet 所需的 service 打开绑定。绑定通过应用提供的 adapter 传递逻辑调用与 subscription。Chord 要求参数、结果、snapshot、更新和 catalogue 都是严格 JSON，但不规定 framing、路由、transport，也不规定应用层的 wire 封套。`JsonRepresentation<T>` 可以为带有未知 payload 的应用数据推导出 wire 安全的类型，而 `isJsonValue()` 则在 adapter 边界处校验收到的值。对称的 RPC 对等端计划作为该边界的一种可选实现。

- **Context** Chord 提供一套类似 Go 的 context 系统，用于取消以及调用范围内的应用值。应用程序可以通过这些值携带权限或遥测，而 Chord 不必依赖其中任何一方。

当前运行时从 `@earendil-works/chord` 导出 service token、singleton 与 keyed provider、远程绑定、replicated state、facet host 和 facet loader。公共类型和通用运行时 API 从包根导入。Context 相关常量和函数位于 `@earendil-works/chord/context`，因为它们的通用名称不应污染根 API。
Chord 自有的标识符使用 `chord.*` 命名空间，其保留的 service 前缀是 `$chord.*`。

## 远程 service adapter

Chord 拥有自己与 transport 无关的 service wire 语法。消费者侧 adapter 使用 `createServiceCatalogueCall()`、`createServiceSubscribeCall()` 和 `createServiceUnsubscribeCall()` 来构造 `$chord.service` 控制调用。
`createRemoteServiceEndpoint()` 为单个 provider 消费者处理这些调用，包括 subscription 的激活与清理。`parseServiceCall()`、`parseServiceCatalogue()` 以及解码/wire 形态的 snapshot 与更新解析器，会在 adapter 建立起严格 JSON 边界之后校验 Chord 语义。`RemoteServiceErrorCode` 和 `REMOTE_SERVICE_ERROR_CODES` 定义了可以跨越该边界的 service 错误。

Replicated state 操作在 provider 侧为每个 subscription 使用一个 `createServiceStateEncoder()`，在消费者侧使用一个 `createServiceStateDecoder()`。这些注册表会为每个实例/成员状态创建独立的 Delta 路径字典，并在替换、不可用、关闭或全新水合时重置它。应用程序可以把这些值放进任何路由、请求、响应或事件封套中；Chord 不规定这个外层协议。

## 追踪 JSON delta

从 `@earendil-works/chord/delta` 导入独立的 delta 原语：

```ts
import { apply, track } from "@earendil-works/chord/delta";

const changes = track({ output: "", count: 0 });
changes.flush(); // opening base batch
changes.state.output += "done\n";
changes.state.count += 1;

const ops = changes.flush();
const replica = apply({ output: "", count: 0 }, ops);
```

第一次 flush 总是完整的基础批次。之后的 flush 包含基于路径的变更。`applyImmutable()` 在应用这些批次的同时保留副本先前的修订版本。`replicatedState(initial)` 直接使用追踪功能：

```ts
const status = env.replicatedState({ output: "", count: 0 });
status.state.output += "done\n";
status.state.count += 1;
status.publish(context);
```

`publish()` 只刷出一次；远程连接管道会为每一对客户端/状态独立编码该操作批次。字符串赋值会把纯追加和滚动窗口移动保留为追加和前端截断操作；无关的重写则回退为 set。插入受追踪状态中的值会成为 tracker 所有，之后只能通过 `state` 修改。变更、数组、生命周期以及消费者所有权规则参见 [Delta 指南](src/delta/README.md)。

## 打包与加载 facet

`@earendil-works/chord/bundler` 使用 esbuild 把 ESM 或 TypeScript 的应用入口转换成相互独立、按内容寻址的 CommonJS 文件。包级 API 从 `package.json` 读取插件标识和构建配置，然后应用宿主应用提供的 facet 路径约定：

```json
{
  "name": "@example/my-plugin",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": {
    "@earendil-works/chord": "^0.84.4"
  },
  "chord": {
    "facets": {
      "worker": "./src/custom-worker.ts",
      "presentation": false
    }
  }
}
```

```ts
import { bundleFacetPackage } from "@earendil-works/chord/bundler";

await bundleFacetPackage({
	packagePath: "/path/to/my-plugin",
	outdir: "/application-owned/plugin-builds/my-plugin",
	defaultFacets: {
		worker: "src/worker.ts",
		presentation: "src/presentation.ts",
	},
});
```

已存在的约定文件会成为入口，除非 `chord.facets` 覆盖或禁用了它们。peer dependency 会被外部化，并在加载时向宿主解析。Chord 从不安装依赖，也不运行包生命周期脚本。`bundleFacets()` 仍作为更低层的 API 保留，供已经拥有显式插件标识和入口映射的调用方使用。

输出目录中每个入口对应一个 `.cjs` 文件，外加一个 `chord-facets.json`。通过仅限 Node 的 loader 加载一个由应用选定的入口：

```ts
import { createFacetBundleLoader } from "@earendil-works/chord/node";

const loader = createFacetBundleLoader({
	manifestPath: "/application-owned/plugin-builds/my-plugin/chord-facets.json",
	entry: "worker",
	resolveExternal: (specifier) => import.meta.resolve(specifier),
});
const loaded = await loader.load();
```

每次 `load()` 都会校验 SHA-256 完整性，并用 `node:vm` 直接编译 CommonJS 主体，而不是把插件放入 Node 的 CommonJS 或 ESM 模块缓存。外部依赖由宿主解析，并通过受限的 `require` 加载；esbuild 会把动态 import 降级改写，使其走同样的路径。释放一个退役的 generation 会解除 loader 对 facet 的引用，一旦插件自有的资源也已释放，其编译产物便可被垃圾回收。

若要传输到另一个 Node 宿主，`readFacetBundleArtifact()` 会把一个经过校验的 manifest 条目连同其源码打包，`createFacetBundleArtifactLoader()` 则会在向接收宿主解析外部依赖的同时，物化出全新的临时 generation。

热重载的流程是：加载一个候选，把它的 facet 传给 `FacetHost.reload()`，失败则释放该候选，而退役的 `LoadedFacets` 只有在成功切换之后才释放。在旧 provider 仍保持路由的情况下，host 会激活并校验候选，然后直接替换每个 singleton，期间没有不可用窗口。因此在普通重载过程中，稳定的 service 句柄不会断开。Keyed 实例保持与具体 incarnation 绑定，替换后获得全新的 generation。bundler 会先写完一个完整的临时目录，再替换先前的输出，因此 loader 不会看到构建到一半的 generation。

更宏观的 RPC 与 generation 加载架构参见 [PLANNING.md](PLANNING.md)。
