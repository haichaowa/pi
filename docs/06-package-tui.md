# pi-tui 包解析：差分渲染终端 UI 库

> 对应包：`packages/tui`（`@earendil-works/pi-tui`，43 个源文件 / 约 1.8 万行）。运行时依赖只有 `marked`（Markdown 解析）和 `get-east-asian-width`（CJK 宽度）。
> 复杂度集中在 4 个文件：`components/editor.ts`(2461)、`tui-alt-screen.ts`(1721)、`tui.ts`(1456)、`keys.ts`(1401)——合计约 7000 行。

## 1. 定位与对外 API

coding-agent 交互模式的**全部 UI 层**——coding-agent 自己不写任何终端 escape sequence。`src/index.ts`（156 行纯 re-export）按 8 组导出：

| 分组 | 代表导出 |
|---|---|
| 终端抽象 | `Terminal` 接口、`ProcessTerminal` |
| 渲染器 | `TUI` 接口、`TuiMainScreen`（主屏/聊天流）、`TuiAltScreen`（备用屏/全屏） |
| 核心类型 | `Component`、`Container`、`Focusable`、`CURSOR_MARKER`、overlay 全家桶 |
| 组件 | `Editor`、`Markdown`、`SelectList`、`ScrollView`、`Text`、`Box`、`VStack`/`HStack`、`Loader`、`Image`… |
| 键盘 | `Key`、`KeyId`、`matchesKey`、`parseKey`、`isKittyProtocolActive` |
| 键位绑定 | `KeybindingsManager`、`TUI_KEYBINDINGS` |
| 输入/补全 | `StdinBuffer`、`AutocompleteProvider`、`fuzzyMatch` |
| 终端能力 | Kitty/iTerm2 图片协议、OSC 11 背景色探测、剪贴板、`visibleWidth`/`truncateToWidth`/`wrapTextWithAnsi` |

## 2. 核心抽象：Component 模型（`src/tui.ts:111`）

```ts
interface Component {
    render(width: number): string[];   // 纯函数式：给定宽度返回行数组
    handleInput?(data: string): void;  // 获得焦点时收到原始按键序列
    invalidate(): void;                // 使缓存失效（主题变化等）
}
interface Focusable { focused: boolean }  // 有 "focused" 字段即视为可聚焦
```

**拉取式渲染**：没有 reactive 状态、没有虚拟 DOM。每帧由渲染器主动调用 `render(width)` 把整棵组件树重新生成为 `string[]`，再对字符串做行级比较。组件必须让 render 便宜（昂贵组件如 Markdown 自行 memoize）。

两个值得注意的细节：
- **硬件光标定位 hack**：`CURSOR_MARKER = "\x1b_pi:c\x07"`（APC 序列，终端忽略、零宽）。聚焦组件在光标位置嵌入该标记，渲染器找到并剥离后把真终端光标移过去——目的是让 **IME 候选窗口**（中文输入法！）出现在正确位置。
- **每行末尾强制 reset**（`\x1b[0m` + OSC 8 链接 reset），根治样式/超链接泄漏到下一行。

## 3. 渲染调度（`src/tui.ts:944`）

- `requestRender()`：设标志 → nextTick → 距上次渲染不足 **16ms（约 60fps）则 setTimeout 补齐**——帧合并机制，同 tick 内多次请求合成一帧
- `requestImmediateRender()`：键盘输入专用快路径，绕过节流（注释点名 Windows 的 setTimeout(0) 可能吃掉整整 16ms）
- `renderNow(force)`：强制全量重绘

## 4. 两个渲染器

| | TuiMainScreen（tui-main-screen.ts） | TuiAltScreen（tui-alt-screen.ts） |
|---|---|---|
| 场景 | "聊天流"模式，**保留 scrollback** | 全屏应用（`?1049h` 备用屏） |
| 滚动 | 终端管，老内容滚进回滚历史 | **应用自管**（固定高度 viewport + 滚动条拖拽） |
| 额外能力 | — | 文本选择（字符/词/行粒度、双击、拖选自动滚动）、transcript 搜索（ctrl+shift+f）、OSC 52 复制 |
| 退出行为 | — | 切回主屏并把最终文档完整打印到 scrollback |

**差分渲染的实现（重点：没有行级脏标记）**。脏追踪只存在于帧级（renderRequested 布尔）和组件级（组件内部缓存）；行级 diff 就是朴素的**逐行字符串比较** `previousLines[i] !== newLines[i]`，取 firstChanged/lastChanged 区间重写。每帧输出包在 **CSI 2026 同步输出**里（终端原子应用，无闪烁），并按 **1 MiB 分块**写出（防巨型字符串超 V8 上限）。

全量重绘的触发条件：首帧 / 宽度变化 / 高度变化 / 改动位置滚出可视区够不着 / clearOnShrink。

## 5. 布局引擎（`src/layout.ts`，仅 AltScreen 用）

组件实现 `[LAYOUT_NODE]()` symbol 暴露布局语义：
- vstack/hstack：类 flexbox——basis（数值或 "auto" 走测量）、grow/shrink/min/max
- 流程：**measure（带每帧 renderCache：同帧同宽度只 render 一次）→ layout（LayoutBox 树，含裁剪矩形）→ paint（行合成，含 Kitty 图片裁剪、滚动条）**
- `getLayoutBoxesAt` 提供坐标反查（鼠标命中测试）

## 6. 键盘事件处理链（三个文件协作）

```
process.stdin "data"
  → StdinBuffer（stdin-buffer.ts）：把被 TCP/SSH 拆碎的转义序列按 CSI/OSC/DCS/APC 语法重组，
    再拆成单条序列逐个 emit（matchesKey 正确工作的前提）；lone ESC 超时 10ms（SSH 下 100ms）
  → ProcessTerminal（terminal.ts）：拦截 Kitty 协商序列；Apple Terminal/Windows 下用原生模块
    查 shift 状态，把 \r 修正为 shift+enter
  → TuiBase.handleTerminalInput（tui.ts:1006）：
      1. 消费终端查询响应（OSC 11 背景色、色系、像素 cell size）
      2. inputListeners 链（可 consume 或改写）
      3. Shift+Ctrl+D 调试钩子
      4. overlay 可见性校验 + 焦点恢复状态机
      5. focusedComponent.handleInput(data)
      6. requestImmediateRender()
  → Editor.handleInput（editor.ts:683）：keybindings 匹配语义键位 → 编辑动作
```

**Kitty 键盘协议协商**：启动时发 `CSI >7u`（disambiguate + 事件类型 + alternate keys）+ 哨兵探测；终端不认识则 fallback 到 modifyOtherKeys。**keys.ts 的 `KeyId` 是递归字面量联合类型**（编译期防拼写错误），覆盖 Kitty CSI-u、数字小键盘、完整 legacy 表；还处理非拉丁布局（用 base layout key 让 Ctrl+西里尔字母-С 匹配 ctrl+c，但有防 Dvorak 误匹配的守卫）。

**键位绑定**（keybindings.ts）：语义 ID（如 `tui.editor.deleteWordBackward`）与物理键解耦；Keybindings 接口用 declaration merging 让下游包追加键位。

## 7. 编辑器组件（`components/editor.ts`，2,461 行）

生产级多行文本编辑器，pi 的主输入框：
- 逻辑坐标（lines + cursorLine/Col）与视觉折行分离；**grapheme 级编辑**（基于 Intl.Segmenter，emoji/ZWJ/CJK 按用户感知字符移动删除）
- **大粘贴折叠**：超过 10 行的粘贴替换为 `[paste #1 +123 lines]` 原子标记，提交时还原
- UndoStack 快照撤销、**Emacs KillRing**（ctrl+k 切杀 / ctrl+y yank / alt+y yank-pop）、输入历史
- 自动补全：20ms debounce + AbortController 取消过期请求 + SelectList 下拉
- 可替换：`src/editor-component.ts` 定义 EditorComponent 接口，扩展可提供 vim 模式编辑器

## 8. 原生模块（`native/`）

每平台一个小 N-API 模块（darwin 用 Objective-C/AppKit、linux 用 C/libxcb、win32 用 Win32 API），**预编译产物随 npm 包发布**，运行时动态加载，不依赖 node-gyp。三个用途：

1. **剪贴板读写（文本+图像）**——Node 无内置剪贴板 API，OSC 52 只能写且终端支持不一
2. **isModifierPressed 实时修饰键状态**——Apple Terminal/Windows 不支持 Kitty 协议，收到 `\r` 时查原生 shift 状态改写成 shift+enter
3. **Windows enableVirtualTerminalInput**——否则 Shift+Tab 退化成 Tab

加载失败全程 try/catch 安全降级（Linux 剪贴板退回 wl-paste/xclip 命令）。

## 9. 调试手段（学 UI 代码必备）

| 开关 | 效果 |
|---|---|
| `PI_TUI_DEBUG=1` | 每帧 dump diff 详情到 /tmp/tui/render-*.log |
| `PI_TUI_DEBUG_REDRAW=1` | 每次全量重绘的原因写日志 |
| `PI_TUI_WRITE_LOG=<dir>` | 记录所有终端写入 |
| 内建 crash log | 渲染行超宽时写 pi-tui-crash.log 后抛带修复建议的异常 |
| Shift+Ctrl+D | 应用层调试钩子（coding-agent 用来 dump 状态） |

## 10. 一帧的完整渲染流程（TuiMainScreen）

```
组件状态变化 → tui.requestRender()
  → (16ms 节流/合并) → doRender()                    tui-main-screen.ts:247
    1. newLines = render(width)                       // Container 递归拼接
    2. compositeOverlays(newLines)                     // overlay 按 focusOrder 合成
    3. extractCursorPosition(newLines)                 // 找 CURSOR_MARKER
    4. applyLineResets(newLines)                       // 每行 normalize + 尾部 reset
    5. 全量重绘判定 → 否则逐行比较取 [firstChanged, lastChanged]
       - 光标移动到 firstChanged → 逐行 \x1b[2K + 内容（1MiB 分块写）
       - Kitty 图片行占多行 → 扩展 changed 区间
    6. 更新 previousLines / hardwareCursorRow
    7. positionHardwareCursor()                        // IME 定位
```

## 11. 推荐阅读顺序（12 个文件）

| # | 文件 | 说明 |
|---|---|---|
| 1 | `packages/tui/src/index.ts` | API 全景，2 分钟建立词汇表 |
| 2 | `packages/tui/src/terminal.ts` | Terminal 接口、Kitty 协商、paste 处理 |
| 3 | `packages/tui/src/tui.ts` | 心脏：Component/Container/TuiBase、焦点、overlay 栈、渲染调度 |
| 4 | `packages/tui/src/tui-main-screen.ts` | 差分渲染核心算法（读懂 doRender 分支树） |
| 5 | `packages/tui/src/stdin-buffer.ts` | 输入序列重组，最自包含的小模块 |
| 6 | `packages/tui/src/keys.ts` | 键盘协议解析、KeyId 类型 |
| 7 | `packages/tui/src/keybindings.ts` | 语义键位层与 declaration merging 扩展点 |
| 8 | `packages/tui/src/components/editor.ts` | 最复杂组件：word wrap、paste marker、undo/kill-ring |
| 9 | `packages/tui/src/layout.ts` + `layout-node.ts` | 布局引擎三段式 |
| 10 | `packages/tui/src/tui-alt-screen.ts` | 全屏渲染器（最难，放最后） |
| 11 | `packages/tui/src/utils.ts` | visibleWidth 等 ANSI 感知工具 |
| 12 | `packages/tui/test/virtual-terminal.ts` + `tui-render.test.ts` | 用 @xterm/headless 真实模拟终端验证渲染，兼作使用示例 |

## 12. 设计决策与坑

**设计决策**：
1. **拉取式全量重渲染 + 字符串 diff**（而非组件级脏标记树）——简单可预测，代价是组件 render 必须廉价
2. **CSI 2026 同步输出 + 1MiB 分块**——无闪烁的两根支柱
3. **键盘延迟优先**——专用 immediate 路径绕过 16ms 节流
4. 大量真实世界兼容性特判（Termux、WezTerm 拼接怪癖、SSH 100ms ESC 超时…），每个特判几乎都有对应 regression test
5. overlay 焦点恢复是精细状态机（tui.ts:558）——tui 里最难读的部分，改动需谨慎

**坑**：
1. **渲染超宽行 = 直接崩溃**（写 crash log 后 throw）。自定义组件必须用 `visibleWidth`/`truncateToWidth` 保证输出不超宽——库的硬性契约
2. CJK/emoji 双宽字符贯穿所有计算；自己拼字符串的地方都要走 utils，否则光标错位（相关 regression 测试就是历史伤疤）
3. 组件 render 不是纯调用（Editor 会顺手更新布局缓存），依赖"每帧恰好一次"的调用节奏

**为什么测试用 node --test 而非 vitest**：该包 engines 要求 node>=22.19（原生跑 TS，零构建），测试直接 `import "../src/tui.ts"`；作为独立发布的库 devDependencies 越少越好；测试策略是"真终端模拟"（@xterm/headless 把渲染输出喂给真实终端模拟器再断言屏幕状态），不需要 vitest 的 mock 体系。
