> 译注：本文是 `packages/client/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-client

面向实验性 Pi service 协议的、与 transport 无关的客户端。

```ts
import { Client, type ByteTransportFactory } from "@earendil-works/pi-client";

const transportFactory: ByteTransportFactory = async (handlers) => {
  // Connect using WebSocket, Unix socket, or another ordered byte transport.
  return {
    async send(chunk) {
      // Deliver bytes in invocation order and honor backpressure.
    },
    close() {},
  };
};

const client = await Client.connect({
  serverId: "01234567-89ab-4def-8123-456789abcdef",
  transportFactory,
});
const result = await client.request(
  { serverId: client.hello.serverId },
  { serviceId: "example.service", member: "read", args: [] },
);
```

客户端会校验物理端点报告的正是预期的逻辑 `serverId`。server 级请求携带该 ID，而每个 Session 请求都携带完整的活跃目标 `{ serverId, sessionId, attachmentId }`。这个组合的持久地址可以防止跨 server 或跨 Session 的误路由；server 生成的 attachment ID 会在切换或重新 attach 之后拒绝迟到的 frame。

带类型的 server 与 Session API 由应用自有的 Chord service binding 提供。`createClientServiceTransport()` 把延迟解析的 server 或 Session 路由适配成 Chord transport；`request()` 和 `subscribeService()` 仍是它的底层原语。客户端使用 Chord 的 service 控制解析器和每个 subscription 独立的状态解码器；`pi-protocol` 只校验路由封套和严格 JSON 边界。service subscription 返回完整的 provider snapshot；binding 先安装它，然后调用 `start()` 释放水合期间缓冲的更新。`Client` 会按序应用带外的 attachment 变更，但刻意不去构造带类型的 service proxy，也不解释应用契约。

诸如 coding agent 的 `Transcript` 之类的应用观测 API 是普通的 Chord service。客户端不解释它们的 snapshot 或更新。

断开连接或销毁时，未决请求会在本地 reject，但已被受理的工作在 attachment 释放之前仍可能在远端完成。客户端会清空自己的活跃 attachment 路由。它从不自动重连或重放请求。断开之后，请调用 `reconnect()`，再次通过应用的管理 service attach，并且只显式重复那些已知安全的操作。

实验性的本地 coordinator 只提供稳定的端点并转发流量。可替换的 server 进程在公开客户端协议之外拥有 Session 与 worker 生命周期。

transport handler 的调用方式如下：

- `handlers.onData(chunk)` 处理入站字节；
- `handlers.onClose()` 处理有序的终止关闭；
- `handlers.onError(error)` 处理 transport 故障。

transport 工厂在每次尝试时都会创建一条全新的已认证连接。请求通过 ID 关联，server 故障以 `ServerError` 暴露。

## Unix domain socket

Node.js 和 Bun 消费者可以使用独立的 Unix transport：

```ts
import { Client } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";

const client = new Client({
  serverId: "01234567-89ab-4def-8123-456789abcdef",
  transportFactory: createUnixTransportFactory({ path: "/tmp/pi.sock" }),
});
await client.connect();
```

Unix 发现机制会扫描一个显式的物理路由目录，从文件名推导每个预期的 server ID，并通过现有的握手进行校验：

```ts
import { discoverUnixServers } from "@earendil-works/pi-client/unix";

const routes = await discoverUnixServers({ directory: "/run/user/1000/pi" });
// [{ serverId: "...", path: "/run/user/1000/pi/<serverId>.sock" }]
```

畸形条目、非 socket 文件、过期或无响应的端点，以及 server ID 不匹配都会被忽略。发现过程是只读的，最多并发探测 16 个 socket。意外的文件系统与 socket 错误会让 discovery reject。可传入 `timeoutMs` 覆盖默认的探测超时。

`ClientOptions.maxFrameLength` 限定协议 payload 的大小。`maxPendingBytes` 限定排队中的 Unix transport 输出。请在两端配置相互匹配的限制。
