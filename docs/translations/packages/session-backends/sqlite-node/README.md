> 译注：本文是 `packages/session-backends/sqlite-node/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-session-backend-sqlite-node

面向 `@earendil-works/pi-agent-core` 的 Node `node:sqlite` Session 后端。

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from "@earendil-works/pi-session-backend-sqlite-node";

const repository = new SqliteSessionRepo({
  directory: "/var/lib/pi/sessions",
  databaseFactory: createNodeSqliteFactory(),
});

const session = await repository.create({}, BACKGROUND_CONTEXT);
const main = await session.createBranch("main", null, BACKGROUND_CONTEXT);
await main.appendMessage(
  { role: "user", content: "hello", timestamp: Date.now() },
  BACKGROUND_CONTEXT,
);
await session.close(BACKGROUND_CONTEXT);
await repository.close(BACKGROUND_CONTEXT);
```

默认布局会在 `directory` 下为每个 Session 创建一个文件。仅包含 ASCII 字母、数字、`_` 和 `-` 的 ID 保留 `{sessionId}.sqlite` 形式；其余 ID 使用以 `~` 为前缀、对其 UTF-16 code unit 做 base64url 编码的形式。持久 ID 保持不变，返回/列出的元数据包含规范的物理路径。传入 `databasePath` 可以把多个 Session 放进一个受支持的共享容器；必要时会创建其父目录。

数据库工厂区分有意创建、不创建的读写打开，以及不创建的只读打开。Session 的 `open()` 和删除会拒绝配置仓库之外的元数据，且绝不创建缺失的数据库。列出是只读且尽力而为的。fork 特意允许外来的源元数据路径：它会只读地读取那个确切的既有容器，并且绝不会用相同 ID 的活跃本地 Session 顶替。

保证每个 Session 只有一个可写所有者的是宿主生命周期，而不是这个后端。在另一个进程中直接以写方式打开同一 Session 是不受支持的。仓库会拒绝针对同一 ID 的重叠本地 create/open/fork/delete 所有权，但不实现任何跨进程的 lease、lock、fence、heartbeat 或接管。宿主必须在删除之前关闭 worker。

对在同一仓库中处于打开状态的源进行 fork 时，其 snapshot 会排在该源的提交队列上。任何其他源（包括由活跃 Session worker 保持打开的源）都会使用独立的只读连接和一个 deferred WAL 事务；在该 snapshot 保持打开期间，worker 后续的提交可能已经完成。共享容器的删除只移除选定 Session 的行。仓库关闭会等待每个打开 Session 的清理尝试完成后再报告错误。本包不导出搜索 service 或 FTS 索引；搜索是单独的 S3 投影。
