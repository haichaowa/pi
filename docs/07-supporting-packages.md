# 周边包速览：chord / telemetry / protocol / client / server / evals / sqlite-node

> 这些包围绕四大主角（ai / agent / coding-agent / tui）存在。先读 `docs/01-architecture.md` 建立全局图景，再按需深入。
> 各包 README 的中文翻译在 `docs/translations/packages/` 下。

## 0. 先记住一个全景：pi 有两条运行路径

**稳定路径（默认，无网络）**：TUI 进程内直接持有 `AgentSession`（agent + tui + coding-agent 主路径），**和本章这些包完全无关**。

**experimental 路径**（`PI_EXPERIMENTAL=1`，代码全在 `packages/coding-agent/src/experimental/`）：client/server 分离架构——TUI 进程（client）与真正的 agent 会话进程（server/worker）分离，通过字节流协议通信：

```
pi client (TUI 进程)                     Unix socket / WebSocket relay          server 进程
┌─────────────────────────┐   分帧 CBOR 字节流   ┌─────────────────────────────┐      ┌──────────────────┐
│ client-tui.ts           │ ◄──────────────────► │ server.ts (pi-server)       │      │ session-worker   │
│  └ Client (pi-client)   │   pi-protocol 消息   │  └ SessionRouter            │─────│  (子进程, 真正的 │
│  └ chord RemoteService  │                      │  └ ServerHost (应用实现)    │ 私有 │   AgentSession/ │
│    Binding → 类型化     │                      │ coordinator.ts: 常驻路由器, │ 协议 │   Harness)      │
│    service facade       │                      │ server 进程可热替换         │      │ FacetHost(chord) │
└─────────────────────────┘                      └─────────────────────────────┘      └──────────────────┘
```

分层说话：
1. **字节层（pi-protocol）**：hello 握手、`request`/`response`/`cancel`（按 id 关联）、`service_update`（订阅推送）、`attachment`（路由变更通知）；4 字节长度前缀 + CBOR。
2. **语义层（chord）**：payload 是 chord `ServiceCall`，订阅走 `$chord.service` 控制词汇；replicated state（如 Transcript）以「完整 snapshot + delta ops 流」复制。
3. **应用层（coding-agent experimental/services/）**：`SessionDirectory`、`Models`、`AgentController`、`Transcript` 等服务，目录由各 facet host 从 `env.provide()` 自动生成，client 按需绑定。

关键点：连接的会话对象（`Session` / `AgentHarness`）**从不过进程边界**——过界的只有 opaque JSON 调用和状态流。

## 1. chord —— 应用组合运行时

- **定位**：插件（facet）、类型化服务、复制状态、传输无关 RPC 的通用机制。**它不是 Pi 专属**：零 Pi 依赖（唯一运行时依赖 esbuild），可被无关应用独立使用。
- **核心概念**：
  - **Facet**：插件单元，`setup(env)` 里声明 `env.provide()` / `env.use()` / `env.observe()` / `env.replicatedState()`；一个插件可拆成多个 facet 跑在不同进程（backend / TUI / browser）。
  - **Service**：类型化稳定 token；`local: boolean` 区分进程内服务与可远程暴露服务；singleton / keyed 两种模式。
  - **ReplicatedState**：生产者改 `state` proxy 后 `publish(context)`；消费者订阅拿不可变快照 + delta 增量。
  - **RemoteServiceTransport**：framing/routing/envelope 全不管，应用自己实现传输；chord 只约束「过界必须是 strict JSON」。
- **关键文件**：`packages/chord/src/types.ts`（261 行，全包最重要）、`src/api.ts`（`createFacetHost` 组装入口）、`src/facets/host.ts`（906 行：依赖图验证、provider 先于 consumer 激活、逆序销毁、`reload()` 热替换）、`src/delta/index.ts`（1267 行）、`src/context/index.ts`（Go 风格 Context：cancellation + invocation-scoped values——Go 开发者会觉得很眼熟）。
- **在 monorepo 里的使用**：只有 coding-agent 的 experimental 目录用（20 个文件，全在 `packages/coding-agent/src/experimental/`）。
- **学习优先级：中**（要读 experimental 架构则升为高）。路线：README → `types.ts` → `api.ts`，跳过 delta 实现细节。

## 2. telemetry —— 遥测契约

- **定位**：vendor-neutral 的遥测契约（span 抽象 + schema 类型推导），不含任何具体 exporter（noop + 内存实现 + 一致性测试套件）。
- **核心文件**：`packages/telemetry/src/index.ts`（357 行）——`TelemetryContext` / `TelemetrySpan` 接口（`startSpan(options, callback)` 模式）+ `defineTelemetrySchema()` / `createTypedSpanStarter()`；80% 是类型体操：从 schema 定义推导出每个 span 的 start/end attributes 和 events 的**精确**类型（多余属性直接编译报错）。
- **使用方**：`packages/agent/src/harness/telemetry.ts` 定义 `AI_TELEMETRY_SCHEMA`（含 `pi.ai.request` 等 span）；`packages/agent/src/harness/context.ts` 提供 `withTelemetryContext` / `getTelemetryContext`；packages/ai 用 `TelemetryContext` 作请求可选参数。
- **学习优先级：低**（除非做 observability；但作为「接口极简 + 类型安全」的设计范本值得一瞥）。

## 3. protocol —— 线协议

- **定位**：client-server 之间传输无关的线协议——路由信封 + CBOR 编码 + 字节流分帧。`PROTOCOL_VERSION = 8`。
- **关键文件**：`packages/protocol/src/protocol.ts`（110 行，全部消息的 typebox schema，额外属性一律拒绝——**小而关键，读懂它才能读懂 client/server**）；`src/framing.ts`（4 字节 big-endian 长度前缀 + definite-length CBOR；`FrameDecoder` 增量切流，容忍任意分包/粘包，默认 16 MiB 上限）；`src/cbor/`（自研 CBOR encoder/decoder）。
- **消息清单**：
  - Client → Server：`hello`（必须首帧，带 version）、`request`（`{id, target, call}`）、`cancel`（按 id 取消）
  - Server → Client：`hello`（version + serverId）、`hello_error`、`response`（`{id, ok, result|error}`）、`service_update`（按 subscriptionId 推送）、`attachment`（out-of-band 通知当前绑定的 Session 路由）
  - **三重地址路由**：server 级 `{serverId}`；session 级 `{serverId, sessionId, attachmentId}`——防止跨 server/跨 session 误路由，attachmentId 拒绝切换后的迟到帧
  - payload 对 protocol 是 **opaque** 的：只校验是 strict JSON，语义由 chord 适配层解析
- **学习优先级：高**（experimental 三件套之首）。

## 4. client —— 协议客户端

- **定位**：上述协议的传输无关客户端——把「字节流 transport」抽象出来，提供 RPC、服务订阅、attach 路由管理。
- **关键文件**：`packages/client/src/client.ts`（479 行，`Client` 类：`connect()` / `request(target, call)` / `subscribeService()`；握手时验证物理端点报告的逻辑 serverId 一致）；`src/connection.ts`（连接状态机）；`src/transport.ts`（18 行核心抽象 `ByteTransportFactory`——WebSocket、Unix socket 或任何有序字节流皆可）；`src/unix.ts`（Unix socket transport + `discoverUnixServers()` 扫描 `<serverId>.sock`）。
- **行为要点**：订阅流程是「收到完整 provider snapshot → 应用装好 → `start()` 才放行缓冲的 update」；client **不**自动重连、不重放请求。
- **学习优先级：高**（与 protocol、server 一起读）。

## 5. server —— 实验性服务端

- **定位**：把 chord facet 服务通过 pi-protocol 暴露给字节流连接，管理「多 presentation 连接 attach 到同一 Session」的路由。**不是 HTTP**——是长度前缀 CBOR 字节流，内置 transport 只有 Unix domain socket（远程 WebSocket relay 在 coding-agent 的 `experimental/radius-relay.ts`）。
- **关键文件**：`packages/server/src/server.ts`（576 行，`Server<SessionMetadata>`：监听器组合、握手、连接生命周期）；`src/session-router.ts`（312 行：attach/detach/release、attachmentId 生成、out-of-band attachment 推送）；`src/types.ts`（应用要实现的 `ServerHost` 接口）；`src/transports/unix/`。
- **「端点」**：没有 REST endpoint。两种 RPC 路由——server 级 / session 级 call；server 对业务 payload 不解码（opaque 直通），只校验路由合法性。
- **学习优先级：高**。

## 6. evals —— 行为评测框架

- **定位**：起**真实** AgentSession 跑端到端任务，比较 prompt/tools/skills/models 配置的差异（判分支持确定性规则或 model-backed judge）。
- **用法**：
  ```bash
  npm run eval -- --provider openai --model gpt-5.6-sol
  npm run eval -- src/docs.eval.ts -t "session-format\.md"   # 过滤
  npm run eval -- ... --repetitions 5                        # 对比型评测
  ```
- **关键文件**：`packages/evals/src/pi-harness.ts`（`createPiCodingAgentHarness()`：临时 project/agent 目录 + 真实 `createAgentSessionFromServices` + 跑完快照 session JSONL）；评测集都在 `packages/evals/src/`（`smoke.eval.ts` / `extensions.eval.ts` / `models.eval.ts` / `providers.eval.ts` / `docs.eval.ts`）；`src/vitest-evals/`（`evalHarnessTable()` baseline vs candidate 配对对比，产出 `.eval/` 下的报告）。
- **学习优先级：中**（要给 pi 写行为回归/对比评测时必读；纯学架构可跳过）。

## 7. session-backends/sqlite-node —— 可选的 SQLite 会话后端

- **定位**：pi-agent-core `SessionRepo` 接口（`packages/agent/src/harness/session/types.ts:592`：`create/open/list/delete/fork`）的 Node `node:sqlite` 持久化实现。agent 包内置只有 `MemorySessionRepo` / `JsonlSessionRepo`；需要可靠单文件持久化、branch 索引、usage 台账时用这个。
- **关键文件**：`src/index.ts`（`SqliteDatabaseFactory` 适配器）、`src/sqlite/repo.ts`（默认一 session 一文件 `<id>.sqlite`）、`src/sqlite/migrations.ts`。
- **边界**：不做跨进程锁/租约（单写者由 host 生命周期保证）；不提供搜索/FTS。
- **注意**：**monorepo 内无人 import 它**——独立发布、供外部部署使用的可选件（coding-agent 目前仍用 JSONL session）。
- **学习优先级：低**（要换 session 存储时再读）。

## 8. 依赖关系小结与阅读顺序

```
chord（零 Pi 依赖）← protocol ← client / server ← coding-agent(experimental)
telemetry ← agent / ai（与协议栈无交集）
sqlite-node 独立（实现 agent-core 的 SessionRepo 契约）
evals 独立叶子（依赖 ai + coding-agent）
```

要啃 experimental 架构时的推荐顺序：`protocol`（110 行消息定义）→ `client` README + `client.ts` → `server` README + `types.ts` + `session-router.ts` → `chord` README + `types.ts` → `packages/coding-agent/src/experimental/services/README.md`（这张全景表的文字版，写得很全）。
