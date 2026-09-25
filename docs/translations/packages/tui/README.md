> 译注：本文是 `packages/tui/README.md` 的中文翻译（AI 生成，仅供学习参考；内容以英文原文为准）。

# @earendil-works/pi-tui

一个极简的终端 UI 框架，具备差分渲染（differential rendering）与同步输出能力，用于构建无闪烁的交互式 CLI 应用。

## 特性

- **可互换的 renderer**：共享的 `TUI` 接口，提供主屏幕（main-screen）与备用屏幕（alternate-screen）两种实现
- **差分渲染**：只更新发生变化的行或 viewport 行
- **由应用掌管的滚动**：备用屏幕 viewport 支持鼠标、触控板和键盘导航
- **同步输出**：使用 CSI 2026 实现原子化的屏幕更新（无闪烁）
- **括号粘贴模式（Bracketed Paste Mode）**：正确处理大段粘贴，超过 10 行的粘贴会带有标记
- **基于 Component**：简单的 Component 接口和 render() 方法
- **主题支持**：组件接受主题接口，可自定义样式
- **内置组件**：Text、TruncatedText、Input、Editor、Markdown、Loader、SelectList、SettingsList、MouseRegion、Spacer、Image、Box、Container、VStack、HStack、ScrollView
- **内联图片**：在支持 Kitty 或 iTerm2 图形协议的终端中渲染图片
- **自动补全支持**：文件路径和斜杠命令

## 快速开始

```typescript
import { type TUI, Text, Editor, ProcessTerminal, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";

// Create terminal
const terminal = new ProcessTerminal();

// Create the default main-screen renderer through the shared TUI interface
const tui: TUI = new TuiMainScreen(terminal);

// Add components
tui.addChild(new Text("Welcome to my app!"));

import { defaultEditorTheme as editorTheme } from './test/test-themes.ts';
const editor = new Editor(tui, editorTheme);
editor.onSubmit = (text) => {
  console.log("Submitted:", text);
  tui.addChild(new Text(`You said: ${text}`));
};
tui.addChild(editor);

// Focus the editor so it receives keyboard input
tui.setFocus(editor);

// In raw mode Ctrl+C doesn't send SIGINT — intercept it here to allow exit
tui.addInputListener((data) => {
  if (matchesKey(data, 'ctrl+c')) {
    tui.stop();
    process.exit(0);
  }
});

// Start
tui.start();
```

## 核心 API

### TUI 接口与 renderer

`TUI` 是组件管理、focus、overlay、输入、生命周期、终端查询和渲染的共享接口。只有在构建应用时才需要选择具体的 renderer：

- `TuiMainScreen` 渲染到主终端缓冲区，并保留终端的 scrollback。
- `TuiAltScreen` 在备用终端缓冲区中渲染一个固定高度的 viewport，滚动由应用掌管。停止时会恢复主缓冲区，并输出完整的最终文档。

```typescript
import { type TUI, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";

const tui: TUI = new TuiMainScreen(terminal);
// To use an application-owned viewport in the alternate terminal buffer instead:
// const tui: TUI = new TuiAltScreen(terminal);

tui.addChild(component);
tui.removeChild(component);
tui.start();
tui.stop();
tui.requestRender(); // Request a re-render

// Global debug key handler (Shift+Ctrl+D)
tui.onDebug = () => console.log("Debug triggered");
```

### 备用屏幕的 viewport 布局

`TuiAltScreen` 可以渲染显式的终端高度布局。`VStack` 和 `HStack` 负责分配受限区域，而 `ScrollView` 掌管其中一个区域的滚动。这些语义在 `TuiMainScreen` 上被刻意不提供，因为在那里 scrollback 由终端掌管。

```typescript
import {
  Container,
  isViewportTUI,
  ScrollView,
  Text,
  VStack,
} from "@earendil-works/pi-tui";

const transcript = new Container();
transcript.addChild(new Text("History"));

const editorAndFooter = new VStack([
  editor,
  new Text("status"),
]);

if (isViewportTUI(tui)) {
  tui.setLayoutRoot(new VStack([
    {
      component: new ScrollView(transcript, {
        follow: "end",
        primary: true,
        overscroll: "chain",
      }),
      basis: 0,
      grow: 1,
      minSize: 1,
    },
    {
      component: editorAndFooter,
      basis: "auto",
      shrink: 1,
      minSize: 1,
    },
  ]));
}
```

Stack 条目支持 `basis`、`grow`、`shrink`、`minSize`、`maxSize`，以及响应式的 `visible` 回调。默认情况下，鼠标滚轮输入作用于指针下方的 scroll view，未用完的 delta 会链式传递给外层 scroll view。主 scroll view 接收备用屏幕的键盘导航操作，以及非可滚动区域上的滚轮输入。它还可以在 OSC 133 语义 prompt 标记之间跳转，与常见终端的 prompt 导航快捷键一致。按 `Ctrl+Shift+F` 可打开或关闭其带边框的搜索面板。面板会显示配置的上一个/下一个快捷键，并提供可点击的箭头控件；默认情况下，`Enter`/`Ctrl+G` 和 `Shift+Enter`/`Ctrl+Shift+G` 在匹配项之间移动，`Escape` 也可关闭搜索。`TuiAltScreenOptions.searchMatchStyle` 和 `searchCurrentMatchStyle` 自定义匹配高亮，而 `searchNavigationButtonStyle` 为每个箭头按钮设置样式并接收其 hover 状态。`TuiAltScreenOptions.scrollToEndIndicator` 会在 `follow: "end"` 的主 scroll view 滚动离开末尾时，在其最后一行居中渲染一个可点击标签；点击它会恢复跟随末尾。

布局几何结构会在每个请求的帧中重建。有状态的 component 会被保留，其已有的渲染行缓存仍然有效。直接在这些布局 component 上调用 `render(width)` 会生成一个无边界的文档；alt 模式恢复主屏幕时也使用该文档。

### Overlays

Overlay 可以将 component 渲染在现有内容之上而不替换它们。适用于对话框、菜单和模态 UI。

```typescript
// Show overlay with default options (centered, max 80 cols)
const handle = tui.showOverlay(component);

// Show overlay with custom positioning and sizing
// Values can be numbers (absolute) or percentage strings (e.g., "50%")
const handle = tui.showOverlay(component, {
  // Sizing
  width: 60,              // Fixed width in columns
  width: "80%",           // Width as percentage of terminal
  minWidth: 40,           // Minimum width floor
  maxHeight: 20,          // Maximum height in rows
  maxHeight: "50%",       // Maximum height as percentage of terminal

  // Anchor-based positioning (default: 'center')
  anchor: 'bottom-right', // Position relative to anchor point
  offsetX: 2,             // Horizontal offset from anchor
  offsetY: -1,            // Vertical offset from anchor

  // Percentage-based positioning (alternative to anchor)
  row: "25%",             // Vertical position (0%=top, 100%=bottom)
  col: "50%",             // Horizontal position (0%=left, 100%=right)

  // Absolute positioning (overrides anchor/percent)
  row: 5,                 // Exact row position
  col: 10,                // Exact column position

  // Margin from terminal edges
  margin: 2,              // All sides
  margin: { top: 1, right: 2, bottom: 1, left: 2 },

  // Responsive visibility
  visible: (termWidth, termHeight) => termWidth >= 100  // Hide on narrow terminals

  // Focus behavior
  nonCapturing: true       // Don't auto-focus when shown
});

// OverlayHandle methods
handle.hide();              // Permanently remove the overlay
handle.setHidden(true);     // Temporarily hide (can show again)
handle.setHidden(false);    // Show again after hiding
handle.isHidden();          // Check if temporarily hidden
handle.focus();             // Focus and bring to visual front
handle.unfocus();           // Release focus to normal fallback
handle.unfocus({ target: baseComponent }); // Release this overlay to a specific component
handle.unfocus({ target: null });   // Release this overlay and leave focus empty
handle.isFocused();         // Check if overlay has focus
handle.getBounds();         // Get last rendered terminal-relative bounds

handle.unfocus();
// Overlay loses focus; TUI falls back to another visible capturing overlay or the previous focus target.

handle.unfocus({ target: null });
// Overlay loses focus; no component receives input until focus is set again.

// A focused visible overlay reclaims keyboard input after temporary replacement UI
// releases focus. If you want a specific component to receive input while overlays remain
// visible, call handle.unfocus({ target: component }).

// Hide topmost overlay
tui.hideOverlay();

// Check if any visible overlay is active
tui.hasOverlay();
```

**Anchor 取值**：`'center'`、`'top-left'`、`'top-right'`、`'bottom-left'`、`'bottom-right'`、`'top-center'`、`'bottom-center'`、`'left-center'`、`'right-center'`

**解析顺序**：
1. `minWidth` 在宽度计算完成后作为下限应用
2. 位置优先级：绝对值 `row`/`col` > 百分比 `row`/`col` > `anchor`
3. `margin` 将最终位置限制在终端边界内
4. `visible` 回调决定 overlay 是否渲染（每帧调用）

### Component 接口

所有 component 都实现：

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined;
  invalidate?(): void;
}
```

| 方法 | 说明 |
|--------|-------------|
| `render(width)` | 返回一个字符串数组，每行对应一个元素。每行**不得超过 `width`**，否则 TUI 会报错。请使用 `truncateToWidth()` 或手动换行来确保这一点。 |
| `handleInput?(data)` | 当 component 拥有 focus 并收到键盘输入时调用。`data` 字符串包含原始终端输入（可能包含 ANSI 转义序列）。 |
| `handleMouse?(event)` | 由 `TuiAltScreen` 调用，传入指向该 component 的、经过规范化处理的指针输入。 |
| `invalidate?()` | 调用后会清除所有缓存的渲染状态。component 应在下一次 `render()` 调用时从头重新渲染。 |

TUI 会在每行渲染输出的末尾追加完整的 SGR reset 和 OSC 8 reset。样式不会跨行保留。如果要输出带样式的多行文本，请逐行重新应用样式，或使用 `wrapTextWithAnsi()`，以保证每个换行后的行都保留样式。

### 鼠标输入

`TuiAltScreen` 会对 SGR 鼠标输入做规范化处理，并对 component 和 overlay 进行命中测试（hit-test）。Event 包含 component 局部的 `x`/`y`、绝对的 `screenX`/`screenY`、bounds、button、modifiers、点击次数以及滚轮 delta。`TuiMainScreen` 不捕获鼠标输入，因为终端掌管着自己的 scrollback。

```typescript
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
  if (event.type === "click" && event.button === "left") {
    this.expanded = !this.expanded;
    return { handled: true };
  }
  if (event.type === "press" && event.button === "left") {
    return { handled: true, capture: true, focus: true };
  }
  if (event.type === "drag") {
    this.updateFromPointer(event.x, event.y);
    return { handled: true, render: true };
  }
  return undefined;
}
```

返回 `handled` 会抑制 renderer 层面的回退行为。`capture` 让后续的 drag 和 release event 继续路由到同一个 component。`focus` 请求键盘 focus。可选的 `render` 标志控制是否重绘：press、click、drag 和 wheel 默认会触发渲染；move 和 release 不会。对于可见发生变化的 hover 状态设置 `render: true`，对于已处理但无实际操作的情况设置 `render: false`。渲染请求会被合并，终端输出仍保持差分。

未被处理的手势保持备用屏幕的默认行为：滚轮输入滚动最近的 `ScrollView` 并将未用完的 delta 链式传递；主键拖拽选择文本；OSC 8 链接在父级 click handler 之前打开；未被处理的右键点击保留已配置的粘贴行为。只有 press/release 在没有发生拖拽的情况下完成时，才会发出 click。

使用 `MouseRegion` 可以在不改变 component 渲染的情况下添加鼠标行为：

```typescript
const collapsible = new MouseRegion(content, (event) => {
  if (event.type !== "click" || event.button !== "left") return undefined;
  expanded = !expanded;
  return { handled: true };
});
```

`Container` 和 `Box` 使用上一渲染帧记录的几何信息将 event 路由给嵌套的子 component，因此指针移动不会为了命中测试而重新渲染子 component。显式的 `VStack`、`HStack` 和 `ScrollView` 布局则直接使用备用屏幕的布局帧。

### Focusable 接口（IME 支持）

显示文本光标且需要 IME（输入法编辑器）支持的 component 应实现 `Focusable` 接口：

```typescript
import { CURSOR_MARKER, type Component, type Focusable } from "@earendil-works/pi-tui";

class MyInput implements Component, Focusable {
  focused: boolean = false;  // Set by TUI when focus changes
  
  render(width: number): string[] {
    const marker = this.focused ? CURSOR_MARKER : "";
    // Emit marker right before the fake cursor
    return [`> ${beforeCursor}${marker}\x1b[7m${atCursor}\x1b[27m${afterCursor}`];
  }
}
```

当 `Focusable` component 拥有 focus 时，TUI 会：
1. 将 component 的 `focused` 设为 `true`
2. 在渲染输出中扫描 `CURSOR_MARKER`（一个零宽的 APC 转义序列）
3. 将硬件终端光标定位到该位置
4. 仅在 `showHardwareCursor` 启用时显示硬件光标

光标默认保持隐藏。这样既保留了假光标的渲染，又会为那些在光标隐藏状态下跟踪 IME 候选窗口的终端定位硬件光标。有些终端需要可见的硬件光标才能定位 IME；可通过 renderer 构造函数的 `showHardwareCursor` 参数或 `setShowHardwareCursor(true)` 启用。内置组件 `Editor` 和 `Input` 已经实现了该接口。

**包含内嵌输入框的容器组件：** 当容器 component（对话框、选择器等）包含 `Input` 或 `Editor` 子组件时，容器必须实现 `Focusable` 并将 focus 状态传播给子组件：

```typescript
import { Container, type Focusable, Input } from "@earendil-works/pi-tui";

class SearchDialog extends Container implements Focusable {
  private searchInput: Input;

  // Propagate focus to child input for IME cursor positioning
  private _focused = false;
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor() {
    super();
    this.searchInput = new Input();
    this.addChild(this.searchInput);
  }
}
```

没有这个传播，使用 IME（中文、日文、韩文等）输入时候选窗口会显示在错误的位置。

## 内置组件

### Container

将子 component 分组。

```typescript
const container = new Container();
container.addChild(component);
container.removeChild(component);
```

### Box

为所有子组件应用 padding 和背景色的 Container。

```typescript
const box = new Box(
  1,                              // paddingX (default: 1)
  1,                              // paddingY (default: 1)
  (text) => chalk.bgGray(text)   // optional background function
);
box.addChild(new Text("Content"));
box.setBgFn((text) => chalk.bgBlue(text));  // Change background dynamically
```

### Text

显示多行文本，支持自动换行和 padding。

```typescript
const text = new Text(
  "Hello World",                  // text content
  1,                              // paddingX (default: 1)
  1,                              // paddingY (default: 1)
  (text) => chalk.bgGray(text)   // optional background function
);
text.setText("Updated text");
text.setCustomBgFn((text) => chalk.bgBlue(text));
```

### TruncatedText

单行文本，会截断以适应 viewport 宽度。适用于状态行和标题栏。

```typescript
const truncated = new TruncatedText(
  "This is a very long line that will be truncated...",
  0,  // paddingX (default: 0)
  0   // paddingY (default: 0)
);
```

### Input

支持水平滚动的单行文本输入框。

```typescript
const input = new Input();
input.onSubmit = (value) => console.log(value);
input.setValue("initial");
input.getValue();
```

在备用屏幕模式下，点击可定位光标并让输入框获得键盘 focus。

**Key Bindings：**
- `Enter` - 提交
- `Ctrl+A` / `Ctrl+E` - 行首/行尾
- `Ctrl+W` 或 `Alt+Backspace` - 向前删除一个词
- `Ctrl+U` - 删除到行首
- `Ctrl+K` - 删除到行尾
- `Ctrl+Left` / `Ctrl+Right` - 按词移动
- `Alt+Left` / `Alt+Right` - 按词移动
- 方向键、Backspace、Delete 的行为符合预期

### Editor

多行文本编辑器，支持自动补全、文件路径补全、粘贴处理，以及内容超出终端高度时的垂直滚动。

```typescript
interface EditorTheme {
  borderColor: (str: string) => string;
  selectList: SelectListTheme;
}

interface EditorOptions {
  paddingX?: number;  // Horizontal padding (default: 0)
}

const editor = new Editor(tui, theme, options?);  // tui is required for height-aware scrolling
editor.onSubmit = (text) => console.log(text);
editor.onChange = (text) => console.log("Changed:", text);
editor.disableSubmit = true; // Disable submit temporarily
editor.setAutocompleteProvider(provider);
editor.borderColor = (s) => chalk.blue(s); // Change border dynamically
editor.setPaddingX(1); // Update horizontal padding dynamically
editor.getPaddingX();  // Get current padding
```

**特性：**
- 在备用屏幕模式下支持点击定位光标，自动补全行可点击
- 多行编辑，支持自动换行
- 斜杠命令自动补全（输入 `/`）
- 文件路径自动补全（按 `Tab`）
- 大段粘贴处理（超过 10 行会创建 `[paste #1 +50 lines]` 标记）
- 编辑器上方/下方的水平线
- 假光标渲染（隐藏真实光标）

**Key Bindings：**
- `Enter` - 提交
- `Shift+Enter`、`Ctrl+Enter` 或 `Alt+Enter` - 换行（取决于终端，Alt+Enter 最可靠）
- `Tab` - 自动补全
- `Ctrl+K` - 删除到行尾
- `Ctrl+U` - 删除到行首
- `Ctrl+W` 或 `Alt+Backspace` - 向前删除一个词
- `Alt+D` 或 `Alt+Delete` - 向后删除一个词
- `Ctrl+A` / `Ctrl+E` - 行首/行尾
- `Ctrl+]` - 向前（朝行尾方向）跳转到字符（等待下一次按键，然后将光标移动到首个出现的位置）
- `Ctrl+Alt+]` - 向后（朝行首方向）跳转到字符
- 方向键、Backspace、Delete 的行为符合预期

### Markdown

渲染 markdown，支持语法高亮和主题定制。

```typescript
interface MarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];
}

interface DefaultTextStyle {
  color?: (text: string) => string;
  bgColor?: (text: string) => string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
}

const md = new Markdown(
  "# Hello\n\nSome **bold** text",
  1,              // paddingX
  1,              // paddingY
  theme,          // MarkdownTheme
  defaultStyle    // optional DefaultTextStyle
);
md.setText("Updated markdown");
```

**特性：**
- 标题、粗体、斜体、代码块、列表、链接、引用块
- HTML 标签按纯文本渲染
- 可选的语法高亮（通过 `highlightCode`）
- 支持 padding
- 渲染缓存以提升性能

### Loader

带动画的加载指示器（spinner）。

```typescript
const loader = new Loader(
  tui,                              // TUI instance for render updates
  (s) => chalk.cyan(s),            // spinner color function
  (s) => chalk.gray(s),            // message color function
  "Loading..."                      // message (default: "Loading...")
);
loader.start();
loader.setMessage("Still loading...");
loader.stop();
```

### CancellableLoader

在 Loader 基础上扩展了 Escape 按键处理和用于取消异步操作的 AbortSignal。

```typescript
const loader = new CancellableLoader(
  tui,                              // TUI instance for render updates
  (s) => chalk.cyan(s),            // spinner color function
  (s) => chalk.gray(s),            // message color function
  "Working..."                      // message
);
loader.onAbort = () => done(null); // Called when user presses Escape
doAsyncWork(loader.signal).then(done);
```

**属性：**
- `signal: AbortSignal` - 用户按下 Escape 时被 abort
- `aborted: boolean` - loader 是否已被中止
- `onAbort?: () => void` - 用户按下 Escape 时的回调

### SelectList

支持键盘导航的交互式选择列表。

```typescript
interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

const list = new SelectList(
  [
    { value: "opt1", label: "Option 1", description: "First option" },
    { value: "opt2", label: "Option 2", description: "Second option" },
  ],
  5,      // maxVisible
  theme   // SelectListTheme
);

list.onSelect = (item) => console.log("Selected:", item);
list.onCancel = () => console.log("Cancelled");
list.onSelectionChange = (item) => console.log("Highlighted:", item);
list.setFilter("opt"); // Filter items
```

**操作方式：**
- 鼠标移动/滚轮：在备用屏幕模式下高亮行
- 点击：选中某一行
- 方向键：导航
- Enter：选中
- Escape：取消

### SettingsList

支持值循环切换和子菜单的设置面板。

```typescript
interface SettingItem {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];  // If provided, Enter/Space cycles through these
  submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
}

interface SettingsListTheme {
  label: (text: string, selected: boolean) => string;
  value: (text: string, selected: boolean) => string;
  description: (text: string) => string;
  cursor: string;
  hint: (text: string) => string;
}

const settings = new SettingsList(
  [
    { id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light"] },
    { id: "model", label: "Model", currentValue: "gpt-4", submenu: (val, done) => modelSelector },
  ],
  10,      // maxVisible
  theme,   // SettingsListTheme
  (id, newValue) => console.log(`${id} changed to ${newValue}`),
  () => console.log("Cancelled")
);
settings.updateValue("theme", "light");
```

**操作方式：**
- 鼠标移动/滚轮：在备用屏幕模式下高亮行
- 点击：激活某一行
- 方向键：导航
- Enter/Space：激活（循环切换值或打开子菜单）
- Escape：取消

### Spacer

用于垂直留白的空行。

```typescript
const spacer = new Spacer(2); // 2 empty lines (default: 1)
```

### Image

在支持 Kitty 图形协议（Kitty、Ghostty、WezTerm）或 iTerm2 内联图片的终端中内联渲染图片。在不支持的终端上回退为文本占位符。

```typescript
interface ImageTheme {
  fallbackColor: (str: string) => string;
}

interface ImageOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  filename?: string;
}

const image = new Image(
  base64Data,       // base64-encoded image data
  "image/png",      // MIME type
  theme,            // ImageTheme
  options           // optional ImageOptions
);
tui.addChild(image);
```

支持的格式：PNG、JPEG、GIF、WebP。尺寸会自动从图片头中解析。

#### 备用屏幕下的图片兼容性

`TuiAltScreen` 在实现了 Kitty 图形协议的终端（包括 Kitty 和 Ghostty）中支持内联图片以及 viewport 局部裁剪。iTerm2 的内联图片协议没有提供删除已有图片放置（placement）或在滚动时裁剪其源图的操作。为防止残留的旧图片覆盖重绘后的内容，`TuiAltScreen` 在 iTerm2 中将图片组件渲染为文本占位符。`TuiMainScreen` 仍会正常渲染 iTerm2 内联图片。

## 自动补全

### CombinedAutocompleteProvider

同时支持斜杠命令和文件路径。

```typescript
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

const provider = new CombinedAutocompleteProvider(
  [
    { name: "help", description: "Show help" },
    { name: "clear", description: "Clear screen" },
    { name: "delete", description: "Delete last message" },
  ],
  process.cwd() // base path for file completion
);

editor.setAutocompleteProvider(provider);
```

**特性：**
- 输入 `/` 查看斜杠命令
- 按 `Tab` 进行文件路径补全
- 支持 `~/`、`./`、`../` 和 `@` 前缀
- 对 `@` 前缀只过滤出可附加（attach）的文件

## 按键检测

使用 `matchesKey()` 配合 `Key` 辅助对象来检测键盘输入（支持 Kitty 键盘协议）：

```typescript
import { matchesKey, Key } from "@earendil-works/pi-tui";

if (matchesKey(data, Key.ctrl("c"))) {
  process.exit(0);
}

if (matchesKey(data, Key.enter)) {
  submit();
} else if (matchesKey(data, Key.escape)) {
  cancel();
} else if (matchesKey(data, Key.up)) {
  moveUp();
}
```

**按键标识符**（可使用 `Key.*` 获得自动补全，或使用字符串字面量）：
- 基本按键：`Key.enter`、`Key.escape`、`Key.tab`、`Key.space`、`Key.backspace`、`Key.delete`、`Key.home`、`Key.end`
- 方向键：`Key.up`、`Key.down`、`Key.left`、`Key.right`
- 带修饰键：`Key.ctrl("c")`、`Key.shift("tab")`、`Key.alt("left")`、`Key.ctrlShift("p")`
- 字符串格式同样可用：`"enter"`、`"ctrl+c"`、`"shift+tab"`、`"ctrl+shift+p"`

## 渲染模式

`TuiMainScreen` 使用三种渲染策略：

1. **首次渲染**：输出所有行，不清除 scrollback
2. **宽度变化或 viewport 上方内容变化**：清屏并完整重绘
3. **常规更新**：将光标移动到第一个发生变化的行，清除到末尾，然后渲染发生变化的行

`TuiAltScreen` 拥有一个终端高度的 viewport。没有显式布局根（layout root）时，它保留旧版的单文档滚动行为。通过 `setLayoutRoot()`，`VStack`、`HStack` 和嵌套的 `ScrollView` 组件可以保留固定区域，并独立滚动受限区域。它会原地更新发生变化的 viewport 行；在处于底部时跟随流式输出；在内容增长时保留手动选择的滚动位置。鼠标滚轮和可配置的键盘导航进行滚动时不会修改终端 scrollback，包括在 OSC 133 语义 prompt 标记之间跳转。滚动条支持 hover 展开、拖动滑块（thumb）以及点击轨道跳转。点击 OSC 8 超链接会通过配置的 URL handler 打开它。按住鼠标主键拖拽可选择文本，并且除非 `TuiAltScreenOptions.copyOnSelect` 为 `false`，会通过 OSC 52 复制到剪贴板；在 scroll view 的顶部或底部边缘按住拖拽不放会自动滚动，并把选区延伸到屏幕外的内容。Kitty 图片支持 viewport 垂直裁剪；iTerm2 内联图片则回退为文本，因为 iTerm2 协议无法在 viewport 重绘期间删除或裁剪图片放置。

两个 renderer 都会用**同步输出**（`\x1b[?2026h` ... `\x1b[?2026l`）包裹更新，实现原子化、无闪烁的渲染。

## Terminal 接口

TUI 可以与任何实现了 `Terminal` 接口的对象协同工作：

```typescript
interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  get columns(): number;
  get rows(): number;
  moveBy(lines: number): void;
  hideCursor(): void;
  showCursor(): void;
  clearLine(): void;
  clearFromCursor(): void;
  clearScreen(): void;
}
```

**内置实现：**
- `ProcessTerminal` - 使用 `process.stdin/stdout`
- `VirtualTerminal` - 用于测试（使用 `@xterm/headless`）

## 工具函数

```typescript
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Get visible width of string (ignoring ANSI codes)
const width = visibleWidth("\x1b[31mHello\x1b[0m"); // 5

// Truncate string to width (preserving ANSI codes, adds ellipsis)
const truncated = truncateToWidth("Hello World", 8); // "Hello..."

// Truncate without ellipsis
const truncatedNoEllipsis = truncateToWidth("Hello World", 8, ""); // "Hello Wo"

// Wrap text to width (preserving ANSI codes across line breaks)
const lines = wrapTextWithAnsi("This is a long line that needs wrapping", 20);
// ["This is a long line", "that needs wrapping"]
```

## 创建自定义组件

创建自定义 component 时，**`render()` 返回的每一行都不得超过 `width` 参数**。如果任何一行宽于终端，TUI 会报错。

### 处理输入

使用 `matchesKey()` 配合 `Key` 辅助对象处理键盘输入：

```typescript
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

class MyInteractiveComponent implements Component {
  private selectedIndex = 0;
  private items = ["Option 1", "Option 2", "Option 3"];
  
  public onSelect?: (index: number) => void;
  public onCancel?: () => void;

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    } else if (matchesKey(data, Key.enter)) {
      this.onSelect?.(this.selectedIndex);
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    return this.items.map((item, i) => {
      const prefix = i === this.selectedIndex ? "> " : "  ";
      return truncateToWidth(prefix + item, width);
    });
  }
}
```

### 处理行宽

使用提供的工具函数确保行宽合适：

```typescript
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

class MyComponent implements Component {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  render(width: number): string[] {
    // Option 1: Truncate long lines
    return [truncateToWidth(this.text, width)];

    // Option 2: Check and pad to exact width
    const line = this.text;
    const visible = visibleWidth(line);
    if (visible > width) {
      return [truncateToWidth(line, width)];
    }
    // Pad to exact width (optional, for backgrounds)
    return [line + " ".repeat(width - visible)];
  }
}
```

### ANSI 代码注意事项

`visibleWidth()` 和 `truncateToWidth()` 都能正确处理 ANSI 转义码：

- `visibleWidth()` 在计算宽度时忽略 ANSI 码
- `truncateToWidth()` 在截断时保留 ANSI 码并正确闭合它们

```typescript
import chalk from "chalk";

const styled = chalk.red("Hello") + " " + chalk.blue("World");
const width = visibleWidth(styled); // 11 (not counting ANSI codes)
const truncated = truncateToWidth(styled, 8); // Red "Hello" + " W..." with proper reset
```

### 缓存

出于性能考虑，component 应缓存其渲染输出，只在必要时重新渲染：

```typescript
class CachedComponent implements Component {
  private text: string;
  private cachedWidth?: number;
  private cachedLines?: string[];

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = [truncateToWidth(this.text, width)];

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
```

## 示例

完整聊天界面示例见 `test/chat-simple.ts`，包含：
- 带自定义背景色的 Markdown 消息
- 响应期间的加载指示器
- 支持自动补全和斜杠命令的编辑器
- 消息之间的 Spacer

运行方式：
```bash
npx tsx test/chat-simple.ts
```

## 开发

```bash
# Install dependencies (from monorepo root)
npm install

# Run type checking
npm run check

# Run the demo
npx tsx test/chat-simple.ts
```

### 调试日志

设置 `PI_TUI_WRITE_LOG` 可捕获写入 stdout 的原始 ANSI 流。

```bash
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log npx tsx test/chat-simple.ts
```
