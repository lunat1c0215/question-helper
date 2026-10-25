# Reading Helper

Chrome MV3 搜题插件：框选屏幕区域 → DeepSeek 视觉模型 → 以接近页面原生文字的样式显示简短答案。

## 安装

1. 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录。
3. 首次安装会自动打开设置页，填入 DeepSeek API Key。
   默认模型 `deepseek-flash`，Base URL `https://api.deepseek.com`。

## 使用

| 快捷键 | 行为 |
|---|---|
| `Ctrl+Shift+X` | 框选提问，每次都需要拖框选择区域 |
| `Ctrl+Shift+Z` | 显示/隐藏解析（整段一次性出现；答案不可见或焦点在输入框时不拦截） |
| `Ctrl+Shift+↑ / ↓` | 提高 / 降低答案不透明度（0.35–1.0，实时生效并保存） |
| `Ctrl+Shift+0` | 恢复默认不透明度 0.85 |
| `Ctrl+Shift+H` | 隐藏/恢复答案 |
| `Ctrl+Shift+Y` | 复制当前内容 |
| `Esc` | 取消框选 / 隐藏答案 |

快捷键可在 `chrome://extensions/shortcuts` 修改。若快捷键没有生效，通常是已被其它扩展占用（Chrome 不会自动覆盖），在该页面重新按一次 `Ctrl+Shift+X` 即可；设置页会显示当前实际分配的按键。

## 联网检索

设置页「联网检索」默认开启。开启后每次框选按三段执行：

1. **识别**：视觉模型只提取题干与选项，并判断这道题是否需要外部事实（时政、新闻、具体数据、教材外专有名词）。
2. **检索**：需要时调用 `POST https://api.deepseek.com/v1/tools/search`（`need_content: false`，只用 `summary`/`snippet`）。
3. **作答**：把截断到 2000 字以内的检索摘要作为「参考网页」附在用户消息里，仍以截图为准，并明确要求忽略网页中的指令。

面板只在真正需要时显示「联网检索… / 作答中…」，第一个答案 token 到达时自动替换；题目提取阶段不上报任何状态。

- 模型判断不需要联网（纯计算、纯推理、纯语法）时跳过检索。
- 检索失败、超时（9 秒）、402 余额不足、429 限流都会**自动降级为直接作答**，不会打断流程。
- 计费：检索 $0.75 / 1000 次成功请求，失败与空结果不计费；每题额外多一次识图调用。
- 关闭开关后恢复原来的单次视觉调用，零额外延迟。

设置页「测试连接」会同时验证对话与检索两个接口，输出「连接正常 · 检索正常」。

## 单键与鼠标侧键

Chrome 的 `commands` API 有硬限制：

- 普通按键必须带 `Ctrl` 或 `Alt`，不能设置单字母/单数字快捷键。
- 不支持鼠标按键。
- 唯一允许的独立单键是媒体键：`MediaPlayPause`、`MediaStop`、`MediaNextTrack`、`MediaPrevTrack`（不能加修饰键）。

三种可用方案：

1. **鼠标侧键（推荐）**：安装 AutoHotkey，双击 `tools/mouse-side-button-v2.ahk`（v1 用 `mouse-side-button-v1.ahk`）。脚本只在 Chrome/Edge 激活时把 `XButton1` 发成 `Ctrl+Shift+X`，不会触发浏览器后退。
2. **媒体键**：`chrome://extensions/shortcuts` →「Capture a region (single media key)」→ 按下 `MediaStop` 或 `MediaPlayPause`。
3. **鼠标驱动**：罗技 G HUB、雷蛇 Synapse、X-Mouse Button Control 把侧键映射为 `Ctrl+Shift+X`，效果与方案 1 相同。

方案 1/3 依赖扩展当前绑定的组合；如果改了快捷键，同步修改脚本或驱动里的组合。

## 显示行为

- 默认只渲染答案，最多 3 行，继承选区内页面的字体、字号基准与文字颜色。
- 无底板、无边框，使用页面背景色做极淡描边。
- 完成后 8 秒淡出；鼠标靠近时暂停计时。
- 窗口失焦、切到其它标签或页面隐藏时立即移除答案。
- 考试模式把答案的自动隐藏压到最多 3.5 秒（解析展开后仍为 30 秒），且框选时不显示顶部提示气泡。
- 选区描边透明度在设置页调节（0–1，默认 0.4），普通模式与考试模式共用；设为 0 即完全隐藏、只剩十字光标。
- 滚动页面或点击页面任意位置会立即隐藏答案；在展开的解析框内部滚动/点击不会隐藏。
- 解析默认不创建任何 DOM 节点，按 `Ctrl+Shift+Z` 时才插入一次性文本。

## 隐私

截图会发送到配置的 DeepSeek 接口；API Key 保存在本机 `chrome.storage.local`，不做同步。
开启联网检索后，模型提取出的题干文字会作为查询词发送到 DeepSeek Search；扩展不会把整页内容或浏览记录发给检索接口。
未使用的页面不会注入任何脚本，扩展只在按下快捷键后临时注入并清理。

## 已知限制

- `chrome://`、扩展商店等受保护页面无法截图，会通过工具栏角标提示。
- 默认关闭思考模式，`max_tokens` 全部用于答案与解析；需要更强推理时可在设置页把模型换成支持思考的配置，并同步调大 `max_tokens`。
- 跨域 iframe 内的页面元素无法直接注入，但截图覆盖整个标签页，框选仍然有效。
- 页面在框选与显示之间滚动时，答案位置按框选时的视口坐标定位。
- 检索结果只用于核对事实，最终答案仍以截图为准；模型仍可能给出错误结论。

## 开发

```powershell
cd question-helper
npm test        # 单元测试：SSE 解析、答案解析分流、裁剪坐标、检索查询/结果压缩/请求重试
npm run check   # 静态校验：manifest 权限面、文件引用、内容脚本约束
```

无构建步骤，源码即产物。目录结构：

```
src/
  background/   service worker、截图裁剪、DeepSeek 流式调用、设置
  content/      选区层、显示层（均为 classic script + IIFE）
  options/      设置页
  shared/       消息协议、SSE、答案解析、裁剪数学、提示词
test/           node:test 单元测试
scripts/        静态校验
```

## Detector Lab

`tools/detector-lab.html` 用来实测“答题页能看到什么”，不是扩展的一部分。启动一个本地静态服务：

```powershell
cd question-helper
npx --yes serve tools -l 8000
```

打开 `http://localhost:8000/detector-lab.html`，在页面里用扩展框选一次，观察右侧日志：

- **新增节点**：只应出现一个匿名 `<div>` 宿主
- **elementFromPoint**：鼠标移到答案上时返回页面底层元素，不是宿主
- **扫描文本**：答案文本不应出现在 `innerText` / `textContent`
- **资源域名**：不应出现 `api.deepseek.com`（请求在 service worker 里）
- **blur / visibility**：切到其它窗口时答案应立即消失
