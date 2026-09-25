> 译注：本文是 `packages/server/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-server

面向新的持久 Session 与 Agent Harness 接口的实验性本地 server。

当前的切片支持 server 与 Session 范围的 facet-service 路由，以及多 presentation attachment。`RoutedServerServiceHost.attachClient()` 创建一个连接范围的 server service 端点，具备收窄的 attachment 管理能力。`RoutedSessionHandle.attachClient()` 返回一个 presentation 范围的 Session 能力。它的 `invokeService()` 把不透明的 service/member 封套转发给选定的 Session 端点；server 校验 attachment 路由，但不加载 facet 契约。

- server service 调用与 subscription 通过连接的 `RoutedServerServiceAttachment` 不透明地路由；
- 应用自有的 `SessionDirectory` 把私有目录投影为复制后的 presentation 安全状态；
- 应用自有的 `SessionManagement` 创建、移除、attach 和 detach Session，且不在业务结果中暴露路由 ID；
- attachment 变更在路由器安装或清除活跃路由之后以带外方式发布；
- Session service 调用通过 `invokeService` 路由，server 端不解码业务 payload；
- service subscription 更新始终限定在发起请求的 attachment 之内；
- 诸如 transcript 之类的应用观测作为普通 service 状态路由，没有 server 自有的业务 schema。

一个 Session 可以有多个 presentation attachment。从同一连接重复 `attach` 是幂等的；每个成功的 attachment 都有一个 server 生成的 `attachmentId`，且只作为路由控制数据传递。Session 请求携带 `{ serverId, sessionId, attachmentId }`，server 会拒绝过期或不匹配的路由。连接丢失会 reject 该连接的本地响应，但只有在已受理的 service 调用结算之后才释放其 attachment。由 host 决定在 presentation 需求为零且 worker 本地 Harness 无活动时，是否允许 worker 退役。server 关闭时会关闭每个被路由的 Session 句柄，释放其 worker 与 Session 写入者所有权。

```ts
import { randomUUID } from "node:crypto";
import { MemorySessionRepo, type Session } from "@earendil-works/pi-agent-core";
import {
  type RoutedServerServiceHost,
  type RoutedSessionHandle,
  type ServerHost,
  SessionAmbiguousError,
  SessionNotFoundError,
} from "@earendil-works/pi-server";
import { createUnixServer, getUnixSocketPath } from "@earendil-works/pi-server/unix";

async function startServer(
  serverServices: RoutedServerServiceHost,
  openRoutedSession: (session: Session) => Promise<RoutedSessionHandle>,
) {
  const sessions = new MemorySessionRepo();
  const host: ServerHost = {
    serverServices,
    async resolveSession(sessionId, context) {
      const matches = (await sessions.list(undefined, context))
        .filter((metadata) => metadata.id === sessionId);
      if (matches.length === 0) {
        throw new SessionNotFoundError(`Unknown session: ${sessionId}`);
      }
      if (matches.length > 1) throw new SessionAmbiguousError();
      return matches[0];
    },
    async openSession(metadata, context) {
      const session = await sessions.open(metadata, context);
      try {
        return await openRoutedSession(session);
      } catch (error) {
        try {
          await session.close(context);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Harness creation and Session cleanup failed",
          );
        }
        throw error;
      }
    },
  };

  const serverId = randomUUID();
  const server = createUnixServer(host, {
    serverId,
    path: getUnixSocketPath(serverId, "/run/user/1000/pi"),
  });
  await server.start();
  return server;
}
```

应用程序提供必需的 server service host、一个有边界的 Session 解析器，以及一个带路由的 Session 工厂。Session 发现与管理是应用自有的 service；协议 server 只在为 attachment 路由时向解析器查询元数据。获取 worker 本地的 Session 与 Harness 由 host 负责。失败会在该 worker 内清理。无论是打开中的 JavaScript Session 还是 Harness，都不会跨越进程边界。

`serverId` 是由启动器提供的逻辑标识，不是 socket 地址。Unix 预设要求显式的物理 `path`；`getUnixSocketPath()` 会从调用方选择的目录推导出一个。请选择一个短小且私有的运行时目录，而不要从无上限的 home 目录路径推导路由。长期运行的启动器在替换 server 进程时可以复用相同的 ID 和路径。

`Server` 通过 `ServerListener` 组合 transport；对等端认证仍属于应用策略，实验性 Unix transport 不实现它。Unix 子模块提供 `createUnixListener()` 和 `createUnixServer()`。低层路由封套校验、CBOR 和 framing 来自 `@earendil-works/pi-protocol`；service 控制解析、错误码、snapshot 与更新，以及每个 subscription 的 replicated state 编码器归 Chord 所有。

server 与 worker 生命周期在公开的 Pi 协议之外管理。可替换的应用 server 把连接 attachment 转换为私有的需求（demand）更新；worker 把带 generation 标记的需求与权威的 Harness 活动相结合。实验性 coordinator 只提供稳定路由，并上报通用化的 server generation 连接变更。
