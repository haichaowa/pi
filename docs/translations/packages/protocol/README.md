> 译注：本文是 `packages/protocol/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-protocol

面向实验性 Pi 协议的运行时中立路由封套（envelope）、CBOR 编码与字节流 framing。

协议版本 `8` 定义了：

- 识别逻辑 `serverId` 的版本握手；
- 显式的 server 与 Session 请求目标；
- 彼此关联的请求与响应，其 payload 为不透明的严格 JSON；
- 请求取消、不透明的 subscription 更新，以及带外的 attachment 变更；
- 非空的不透明错误码，以及有长度上限的 transport 消息。

server 目标包含 `{ serverId }`；Session 目标包含 `{ serverId, sessionId, attachmentId }`。组合后的路由把调用围栏（fence）在一个逻辑 server、持久 Session 和活跃 presentation attachment 之内。管理类的 `attach()` 和 `detach()` 不返回路由标识符；server 会通过带外的 `attachment` 消息发布选定的活跃路由。断开连接时，只有在已受理调用结算完成后，才会释放该 presentation 的 attachment。

这些封套内部承载的 payload 语义归 Chord 所有：`{ serviceId, instance?, member, args }` 调用、`$chord.service` 控制词汇、service catalogue、subscription snapshot 与更新、service 错误码，以及 replicated state 各自独立的 Delta 路径 codec。`pi-protocol` 只校验每个不透明 payload 是严格 JSON，但既不校验也不导出其 Chord 语法。客户端和服务器在 service adapter 边界通过 `@earendil-works/chord` 解析这些值。

Session 目录状态、管理结果、transcript、模型、插件，以及所有其他应用值，仍然是不透明的 service 数据。真实的 `Session` 和 `AgentHarness` 仍是进程本地的。server 与 Session 调用被不透明地路由到其所属 provider，由 Chord 和应用程序在那里进行校验并调用。

server 与 worker 生命周期被有意排除在这个公开协议之外。实验性的本地 coordinator 只是一个不透明的消息路由器；每个可替换的 server 进程拥有自己的私有生命周期协议。

每个 wire frame 由一个四字节无符号大端 payload 长度加一个 definite-length CBOR 项组成。`encodeClientMessage()` 和 `encodeServerMessage()` 负责校验并编码完整 frame。`ClientMessageDecoder` 和 `ServerMessageDecoder` 可以接受任意形式的流分片与合并。

```ts
import {
  PROTOCOL_VERSION,
  encodeClientMessage,
  ServerMessageDecoder,
  type ClientHello,
} from "@earendil-works/pi-protocol";

const hello: ClientHello = { type: "hello", version: PROTOCOL_VERSION };
transport.send(encodeClientMessage(hello));

const decoder = new ServerMessageDecoder({ maxFrameLength: 1024 * 1024 });
for (const message of decoder.push(incomingChunk)) handleServerMessage(message);
decoder.end();
```

所有封套 schema 都拒绝未知对象属性，codec 会递归拒绝非 JSON 的不透明 payload，包括非有限数、字节数组、`undefined`、prototype 和循环引用。封套违规、畸形 CBOR 和非法 framing 会抛出 `ProtocolValidationError`。特定 payload 的 adapter 必须在解码后自行做语义校验。transport 必须保持字节顺序。对等端认证和经过认证的 service context 不由实验性 transport 实现。

默认限制为：每个 CBOR payload/frame 16 MiB，1,000,000 个数组元素或 map 条目，以及 64 层嵌套。该协议是实验性的，不提供任何兼容性保证。
