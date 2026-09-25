> 译注：本文是 `packages/coding-agent/docs/sessions.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# Sessions

Pi 会把对话保存为 session，这样你既可以继续之前的工作、从更早的轮次分叉，也可以回顾先前的路径。

## session 存储

session 会自动保存到 `~/.pi/agent/sessions/`，按工作目录组织。每个 session 都是一个具有树状结构的 JSONL 文件。

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse and select from past sessions
pi --no-session        # Ephemeral mode; do not save
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Use a specific session file or partial session ID
pi --fork <path|id>    # Fork a session file or partial session ID into a new session
```

在交互模式中使用 `/session` 可以查看当前 session 文件、session ID、消息数、token 数和费用。

关于 JSONL 文件格式和 SessionManager API，参见 [Session 格式](session-format.md)。

## session 命令

| 命令 | 描述 |
|---------|-------------|
| `/resume` | 浏览并选择过去的 session |
| `/new` | 开始一个新 session |
| `/name <name>` | 设置当前 session 的显示名称 |
| `/session` | 显示 session 信息 |
| `/tree` | 浏览当前 session 树 |
| `/fork` | 从之前的某条用户消息创建新 session |
| `/clone` | 把当前活动分支复制到一个新 session |
| `/compact [prompt]` | 总结较旧的上下文；参见 [Compaction](compaction.md) |
| `/export [file]` | 将 session 导出为 HTML |
| `/share` | 上传为私有 GitHub gist，并附可分享的 HTML 链接 |

## 恢复与删除 session

`/resume` 会为当前项目打开一个交互式 session 选择器。`pi -r` 则在启动时打开同样的选择器。

在选择器中你可以：

- 通过输入进行搜索
- 用 Ctrl+P 切换路径显示
- 用 Ctrl+S 切换排序方式
- 用 Ctrl+N 只显示已命名的 session
- 用 Ctrl+R 重命名
- 用 Ctrl+D 删除，然后确认

在可用时，pi 会使用 `trash` CLI 进行删除，而不是永久移除文件。

## 为 session 命名

使用 `/name <name>` 设置一个便于阅读的 session 名称：

```text
/name Refactor auth module
```

启动时用 `--name` 或 `-n` 设置名称：

```bash
pi --name "Refactor auth module"
pi --name "CI audit" -p "Review this build failure"
```

已命名的 session 在 `/resume` 和 `pi -r` 中更容易找到。

## 使用 `/tree` 分支

session 以树的形式存储。每个条目都有 `id` 和 `parentId`，当前位置即为活动叶子（active leaf）。`/tree` 让你跳转到任意先前的位置并从那里继续，而无需创建新文件。

<p align="center"><img src="images/tree-view.png" alt="Tree View" width="600"></p>

示例形状：

```text
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

### 树形控件

| 按键 | 操作 |
|-----|--------|
| ↑/↓ | 在可见条目之间移动 |
| ←/→ | 上/下翻页 |
| Ctrl+←/Ctrl+→ 或 Alt+←/Alt+→ | 折叠/展开，或在分支段之间跳转 |
| Shift+L | 为选中条目设置或清除标签 |
| Shift+T | 切换标签时间戳 |
| Enter | 选中条目 |
| Escape/Ctrl+C | 取消 |
| Ctrl+O | 循环切换过滤模式 |

过滤模式包括：default、no-tools、user-only、labeled-only 和 all。可在[设置](settings.md)中通过 `treeFilterMode` 配置默认值。

### 选中行为

选中用户消息或自定义消息时：

1. 把叶子移动到所选消息的父节点。
2. 把所选消息的文本放入编辑器。
3. 让你编辑并重新提交，从而创建新分支。

选中 assistant、tool、compaction 或其他非用户条目时：

1. 把叶子移动到该条目。
2. 编辑器保持为空。
3. 让你从该点继续。

选中根用户消息会把叶子重置为空对话，并把最初的 prompt 放入编辑器。

## `/tree`、`/fork` 与 `/clone`

| 特性 | `/tree` | `/fork` | `/clone` |
|---------|---------|---------|----------|
| 输出 | 同一个 session 文件 | 新 session 文件 | 新 session 文件 |
| 视图 | 完整树 | 用户消息选择器 | 当前活动分支 |
| 典型用途 | 就地探索不同方案 | 从更早的 prompt 开始新 session | 在继续之前复制当前工作 |
| 总结 | 可选的分支总结 | 无 | 无 |

如果想把不同方案放在一起，就用 `/tree`。如果想要一个独立的 session 文件，就用 `/fork` 或 `/clone`。

## 分支总结

当 `/tree` 从一个分支切换到另一个分支时，pi 可以总结被放弃的分支，并把该总结附加到新位置。这样既能保留你离开的那条路径中的重要上下文，又无需重放整个分支。

出现提示时，可选择以下之一：

1. 不生成总结
2. 使用默认 prompt 总结
3. 使用自定义的关注点指示进行总结

关于分支总结的内部机制和扩展钩子，参见 [Compaction](compaction.md)。

## session 格式

session 文件为 JSONL 格式，包含消息条目、模型变更、thinking 级别变更、标签、compaction、分支总结以及扩展条目。

关于解析器、扩展、SDK 用法以及完整的 SessionManager API，参见 [Session 格式](session-format.md)。
