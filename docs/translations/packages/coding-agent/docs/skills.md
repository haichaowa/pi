> 译注：本文是 `packages/coding-agent/docs/skills.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

> pi 可以创建 skill。可以让它为你的用例构建一个。

# Skills

Skill 是按需加载的自包含能力包。一个 skill 为特定任务提供专门的工作流、安装说明、辅助脚本和参考文档。

Pi 实现了 [Agent Skills 标准](https://agentskills.io/specification)，对大多数违规项只给出警告，但保持宽松。Pi 允许 skill 名称与其父目录名不同，尽管标准不允许这样做；这条规则对于跨多个 agent harness 共享的 skill 目录来说并不理想。

## 目录

- [位置](#locations)
- [Skill 的工作方式](#how-skills-work)
- [Skill 命令](#skill-commands)
- [Skill 结构](#skill-structure)
- [Frontmatter](#frontmatter)
- [校验](#validation)
- [示例](#example)
- [Skill 仓库](#skill-repositories)

## 位置

> **安全提示：** skill 可以指示模型执行任何操作，并且可能包含模型会调用的可执行代码。使用前请审查 skill 内容。

Pi 从以下位置加载 skill：

- 全局：
  - `~/.pi/agent/skills/`
  - `~/.agents/skills/`
- 项目（仅在项目受信任之后）：
  - `.pi/skills/`
  - `cwd` 及其祖先目录中的 `.agents/skills/`（最高到 git 仓库根目录；不在仓库中时则为文件系统根目录）
- 包：`skills/` 目录或 `package.json` 中的 `pi.skills` 条目
- 设置：`skills` 数组，可包含文件或目录
- CLI：`--skill <path>`（可重复；即使指定了 `--no-skills` 也照样加载）

发现规则：
- 在 `~/.pi/agent/skills/` 和 `.pi/skills/` 中，位于根目录的 `.md` 文件只要带有含非空 `description` 的有效 skill frontmatter，就会被发现为独立的 skill
- 在所有 skill 位置中，包含 `SKILL.md` 的目录会被递归发现
- 在 `~/.agents/skills/` 和项目 `.agents/skills/` 中，根目录的 `.md` 文件会被忽略，但分组文件夹中嵌套的 `.md` 文件只要声明了 skill frontmatter 就会被发现
- 除 `SKILL.md` 之外、看起来不像 skill 的根级 Markdown 文件会被静默忽略

使用 `--no-skills` 可禁用发现机制（显式指定的 `--skill` 路径仍会加载）。

### 使用来自其他 harness 的 skill

要使用来自 Claude Code 或 OpenAI Codex 的 skill，请把它们的目录加入设置：

```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

对于项目级 Claude Code skill，请在 `.pi/settings.json` 中添加：

```json
{
  "skills": ["../.claude/skills"]
}
```

## Skill 的工作方式

1. 启动时，pi 扫描各个 skill 位置并提取名称和描述
2. 系统 prompt 按照[规范](https://agentskills.io/integrate-skills)以 XML 格式包含可用的 skill
3. 当任务匹配时，agent 会使用 `read`（在 `read` 不可用时则用 `bash`）加载完整的 SKILL.md（模型并不总是这么做；可以通过 prompt 引导或使用 `/skill:name` 来强制加载）
4. agent 遵循其中的指令，并使用相对路径引用脚本和资源

这就是渐进式披露（progressive disclosure）：上下文中始终只有描述，完整指令按需加载。

## Skill 命令

Skill 会注册为 `/skill:name` 命令：

```bash
/skill:brave-search           # Load and execute the skill
/skill:pdf-tools extract      # Load skill with arguments
```

命令后面的参数会以 `User: <args>` 的形式追加到 skill 内容之后。

可以在交互模式中通过 `/settings`、或在 `settings.json` 中开关 skill 命令：

```json
{
  "enableSkillCommands": true
}
```

## Skill 结构

一个 skill 就是一个包含 `SKILL.md` 文件的目录。其余内容均可自由组织。

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/
    └── template.json
```

### SKILL.md 格式

````markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
```bash
cd /path/to/skill && npm install
```

## Usage

```bash
./scripts/process.sh <input>
```
````

请使用相对于 skill 目录的路径：

```markdown
See [the reference guide](references/REFERENCE.md) for details.
```

## Frontmatter

依据 [Agent Skills 规范](https://agentskills.io/specification#frontmatter-required)：

| 字段 | 必填 | 描述 |
|-------|----------|-------------|
| `name` | 是 | 最长 64 个字符。小写字母 a-z、数字 0-9 和连字符。与标准不同，Pi 不要求该名称与父目录名一致，因为标准的这一要求对共享 skill 目录并不理想。 |
| `description` | 是 | 最长 1024 个字符。skill 做什么以及何时使用。 |
| `license` | 否 | 许可证名称，或对随附文件的引用。 |
| `compatibility` | 否 | 最长 500 个字符。环境要求。 |
| `metadata` | 否 | 任意键值映射。 |
| `allowed-tools` | 否 | 以空格分隔的预先批准工具列表（实验性）。 |
| `disable-model-invocation` | 否 | 为 `true` 时，该 skill 会从系统 prompt 中隐藏。用户必须使用 `/skill:name`。 |

### 命名规则

- 1-64 个字符
- 仅限小写字母、数字和连字符
- 不能以连字符开头或结尾
- 不能有连续连字符
Pi 不要求名称与父目录名一致。Agent Skills 标准有此要求，但该要求对多个工具共用的 skill 目录来说并不理想。

有效：`pdf-processing`、`data-analysis`、`code-review`
无效：`PDF-Processing`、`-pdf`、`pdf--processing`

### 描述的最佳实践

描述决定了 agent 何时加载该 skill。请写得具体一些。

好的写法：
```yaml
description: Extracts text and tables from PDF files, fills PDF forms, and merges multiple PDFs. Use when working with PDF documents.
```

差的写法：
```yaml
description: Helps with PDFs.
```

## 校验

Pi 会依据 Agent Skills 标准校验 skill。大多数问题只会产生警告，skill 仍会加载：

- 名称超过 64 个字符或包含无效字符
- 名称以连字符开头/结尾，或包含连续连字符
- 描述超过 1024 个字符

未知的 frontmatter 字段会被忽略。

缺少描述的已声明 skill 不会被加载。格式有误的 `SKILL.md` 文件以及没有描述的 `SKILL.md` 文件会产生警告且不会被加载。其他没有有效 skill frontmatter 的 Markdown 文件会被忽略。

名称冲突（来自不同位置的同名 skill）会产生警告，并保留最先找到的那个 skill。

## 示例

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

**SKILL.md:**
````markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

```bash
cd /path/to/brave-search && npm install
```

## Search

```bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
```

## Extract Page Content

```bash
./content.js https://example.com
```
````

## Skill 仓库

- [Anthropic Skills](https://github.com/anthropics/skills) - 文档处理（docx、pdf、pptx、xlsx）、Web 开发
- [Pi Skills](https://github.com/badlogic/pi-skills) - Web 搜索、浏览器自动化、Google API、转录
