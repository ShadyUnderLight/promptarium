# Floating Shelf Phase 7：Tauri 打包与发布前验收记录

本文件记录 [Issue #68](https://github.com/ShadyUnderLight/promptarium/issues/68)
要求的 macOS 打包态验收。Phase 7 不修改产品代码、Rust/IPC/数据模型或
signing/updater 配置；它记录一次可复核的真实 `.app` 构建与运行时抽查证据。

## 被测对象

| 项 | 值 |
|---|---|
| Exact head | `78c4055bfd0567dec758894615295c86790263b9`（PR #75 的 merge，即 Phase 6 收口点） |
| 构建时间 | 2026-09-21 15:01:46 (+0800) |
| 构建命令 | `pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` |
| 主机 | macOS，Darwin 27.0.0，`arm64` |
| 工具链 | cargo 1.95.0 / rustc 1.95.0 / pnpm 11.9.0 / Node 22.x |
| 产物 | `src-tauri/target/release/bundle/macos/Promptarium.app` |

构建复用了仓库既有的 `src-tauri/target` release 缓存（同 checkout 的增量重编，
本次只重编 `promptarium` crate 本身，17.83s 完成），未使用独立临时
`CARGO_TARGET_DIR`。这样做的代价与收益：收益是免去一次冷编译；风险是可能命中陈旧
缓存，因此下节用二进制 mtime/字节数（而不是 build exit code）来证伪陈旧产物。

## 1. 产物身份

| 检查 | 实测 |
|---|---|
| `Contents/MacOS/promptarium` | 2026-09-21 15:01:46，**16763664 B** |
| 上一次打包（Phase 0 之前） | 2026-09-15 11:47:21，16747152 B |
| `file` | `Mach-O 64-bit executable arm64` |
| `CFBundleShortVersionString` / `CFBundleVersion` | `0.3.3` / `0.3.3` |
| `CFBundleIdentifier` | `com.shadyunderlight.promptarium` |
| `LSMinimumSystemVersion` | `10.13` |
| `codesign -dv` | `Signature=adhoc`、`TeamIdentifier=not set`、`Info.plist=not bound`、`Sealed Resources=none` |

时间戳与字节数都与上一次产物不同，可以排除"复用了 2026-09-15 那份二进制"。
磁盘上原有的 `.app` 生成于 A 方案任何代码落地**之前**（PR #69 合并于
2026-09-15 18:58，PR #70–#75 在其后），所以本次是 A 方案第一次真正进入打包态。

## 2. 自动化检查（exact head `78c4055`）

| 命令 | 结果 |
|---|---|
| `pnpm check` | `svelte-check found 0 errors and 0 warnings` |
| `pnpm test:smoke` | 18 个 `tsx` 契约脚本全部通过 + vitest **23 files / 230 tests passed** |
| `pnpm build` | 成功（`adapter-static` 写入 `build`） |
| `cd src-tauri && cargo test --lib` | `143 passed; 0 failed` |
| `git diff --check` | 干净（exit 0，无输出） |

## 3. 配置未被改写（静态证据）

| 文件 | 最后一次改动 | 本次 head 的 diff |
|---|---|---|
| `src-tauri/tauri.conf.json` | 2026-09-09（Issue #44） | 无 |
| `src-tauri/capabilities/default.json` | 2026-09-10（PR #51） | 无 |

整个 A 方案（Phase 1–6）从未触碰这两个文件，因此"签名/更新配置没有被 UI 重构
改写"这条**不需要打包就能证明**——`git log -- <path>` 加既有的
`tests/titlebar-contract.test.ts`（已断言 `titleBarStyle=Overlay`、`hiddenTitle`、
`trafficLightPosition={x:16,y:26}`、topbar title 块的 `data-tauri-drag-region`、
capability 含 `core:window:allow-start-dragging`）就是完整证据。本次构建全程只通过
CLI `--config` 覆盖，没有回写仓库配置；构建后 `git status` 只剩未跟踪的
`.workbuddy/`。

## 4. 运行时抽查

运行方式：直接执行 bundle 内的可执行文件（不是 `open`），并把
`PROMPTARIUM_DATA_DIR` 指向隔离目录，使验收不接触用户真实项目清单：

```
PROMPTARIUM_DATA_DIR=/private/tmp/promptarium-phase7-qa \
  "<repo>/src-tauri/target/release/bundle/macos/Promptarium.app/Contents/MacOS/promptarium"
```

隔离 fixture：三个注册项目（`alpha` 为 git 仓库、`beta` 非仓库、`Ghost` 指向不存在的
文件夹），`alpha` 内含嵌套子目录与带 frontmatter 的提示词。

| 状态 | 结果 | 证据 |
|---|---|---|
| 启动 | 正常，stdout/stderr 无输出，无 panic | — |
| 首次无项目 | "0 个提示词" + 空态引导文案正确 | `1440x900-dark-zh-CN-first-run.png` |
| 多项目 + 真实扫描 | 侧栏 3 个项目、`nested` 文件夹树、`#alpha`/`#writing` 标签、收藏 1 / 草稿 1、真实 mtime 全部正确 | `1440x900-dark-zh-CN-multi-project.png` |
| missing project | "项目文件夹未找到" + 显示真实路径 + "重新定位文件夹"/"移除" | `1440x900-dark-zh-CN-missing-project.png` |
| 最小窗口 | 900×600 下 Rail / Shelf / List / Detail / Toolbar 全部可达，无 document 级横向溢出 | `900x600-dark-zh-CN-min-window.png` |

多项目那一项同时构成**真实 IPC + filesystem** 的证据：项目列表、文件夹树、标签与
修改时间都来自隔离目录里真实的 `.md` 文件，经 Rust 后端扫描后返回前端。

### macOS 窗口几何（AX 实测，非 CSS 代理）

| 项 | 实测 |
|---|---|
| 初始窗口 | `1440x900`，位置 `144,65`，`AXWindowCount=1` |
| close | `159,81` 16×16 |
| minimize | `182,81` 16×16 |
| zoom | `205,81` 16×16 |
| fullscreen | `205,81` 16×16 |
| 相对窗口左上角偏移 | close 15px / minimize 38px / zoom 61px，纵向 16px |
| 标题块起点 | `[data-platform='macos'] .library-topbar { padding-left: 5.25rem }` = 84px |
| 结论 | 交通灯最右缘 ≈77px < 84px，**标题未被覆盖**，间隙约 7px |

`1440x900-dark-zh-CN-topbar-traffic-lights.png` 是顶栏的放大裁切，可直接对照。

### 最小窗口约束（可证伪 720px 断点）

| 请求尺寸 | 实际尺寸 |
|---|---|
| 900×600 | `900x600` |
| 720×600 | **`900x600`**（被夹回） |
| 800×500 | **`900x600`**（被夹回） |

`tauri.conf.json` 的 `minWidth: 900` / `minHeight: 600` 在真实窗口上强制生效，因此
`src/app.css` 的 `@media (max-width: 720px)` 分支（该分支会 `display: none` 掉
Detail 与 pane resizer）**在打包态不可达**。900×600 命中的是
`@media (max-width: 980px)`，它保留 Detail。

## 5. 环境限制（如实记录，未修改配置）

- **本地未签名**：产物为 ad-hoc 签名、`Info.plist` 未绑定、`Sealed Resources=none`。
  本次没有引入私钥，也没有改 `bundle.macOS`、`updater.endpoints` 或 `pubkey`。
  macOS Keychain 的访问控制与代码签名绑定，因此**未签名 bundle 下的 Keychain 行为
  不代表正式签名版**；凡涉及此类行为应记为"环境限制/未判"，不作为失败。
- **updater artifact 按 Issue 要求关闭**：CLI 覆盖 `createUpdaterArtifacts=false`，
  本次没有产出新的 `.app.tar.gz`；bundle 目录里那份 `Promptarium.app.tar.gz`
  mtime 为 2026-09-15 11:47，是上一轮构建的遗留物。
- **未安装/未覆盖** `/Applications/Promptarium.app`（仍为 2026-09-15 11:50 那份，
  mtime 未变）；验收实例全程用隔离数据目录，用户真实 `~/.promptarium/prompts-state.json`
  mtime 保持 2026-09-11 10:22 未变。

## 6. 本次未覆盖（需人工或系统设置，不应按"通过"计）

| 项 | 为什么没覆盖 |
|---|---|
| drag region 拖拽窗口、以及它不拦截控件 | 需要真实鼠标拖拽/点击；本次只有窗口几何与 AX 读取，没有合成输入 |
| 真机 macOS 三个开关（减弱透明度 / 提高对比度 / 减弱动态效果） | 需要改系统设置；本次没有触碰用户系统偏好 |
| 原生 `plugin-dialog`（`ask`/`confirm`、文件夹选择器） | 需要打开 Project Menu 等交互路径 |
| Light 主题、Edit / History / Compare / Search / Batch 等交互态 | 需要交互驱动；这些状态沿用 Issue #67 的浏览器侧 QA 证据，本次未在打包态重放 |
| 720px 断点 | 已证明在打包态不可达（见上） |

方法边界：本次运行验收基于 `screencapture -l <windowid>`（窗口自身缓冲区，不受遮挡
影响）与 Chromium 之外的 CGWindowList / AX API 读取。**WKWebView 的 DOM 不暴露在 AX
树里**（AX 遍历只见到 241 个节点，无 web 内容），所以本次**没有**做 DOM 级断言，
也没有冒充成逐像素快照门槛。

## 7. 观测异常（未定性，不阻塞本阶段）

隔离 fixture 里 `alpha/prompt-one.md` 的正文含 `{{topic}}` 与 `{{tone}}`，但列表行
显示 **0 个变量**；数分钟后复拍仍为 0。相关代码路径：
`PromptLibrary.variableCount()` → `library.svelte.ts:promptVariableCount()` →
索引条目的 `variableCount: parseVariables(document.body).length`
（`src/lib/library/search-index.ts:178`）。

- 该项**在打包态之外无法复现**：dev 模式的浏览器 fixture 用的是内存数据，没有指向
  同一批真实文件的等价 A/B，所以无法据此判定它是"打包态回归"还是"真实文件下才暴露
  的既有问题"。
- Rust 侧明确不解析变量（`src-tauri/src/prompts/store.rs:2`：
  "Prompt variables remain a frontend concern; Rust never parses them."），
  所以它与打包层无关，**不构成本阶段的失败项**。
- 需要单独的一次定位（在真实文件上核对索引的 body 读取与计数）才能定性。

另有一处未识别窗口：CGWindowList 里该进程存在一个 `500x500` 的 layer-0 surface
（`AXWindowCount` 仍为 1）。它没有影响任何可达交互，仅作为测量记录留档。

## 8. 与 Issue #68 验收清单的对照

| 验收标准 | 本阶段结论 |
|---|---|
| frontend check / smoke / build / Rust tests / diff check 全通过 | 通过（见第 2 节） |
| Tauri arm64 `.app` 构建成功，版本/identifier/executable 可复核 | 通过（见第 1 节） |
| 1440×900、1180×720、900×600 与 720px 断点手工验收 | 1440×900 与 900×600 已实测；1180×720 未单独抓图；**720px 已证不可达** |
| Light/Dark、English/简中、长标题、emoji、空/错误/missing/dirty/conflict | 简中 + Dark + 长中文标题 + emoji 已见；Light / English / dirty / conflict 沿用 #67 证据 |
| Rail / Shelf / List / Detail / Inspector / Project Menu / Name / Confirm / Compare / Update Banner | Rail / Shelf / List / Detail 已在打包态确认渲染；其余沿用 #67 证据 |
| Search / Project·Folder·Tag / List·Grid / Batch / pane resize / Preview·Edit·History / Save·Copy·Reveal | 未在打包态驱动（见第 6 节） |
| traffic lights / drag region / 关闭·最小化·全屏·缩放 | 几何与最小尺寸已实测；**drag region 交互未覆盖** |
| 无 console error / overflow / 白底闪烁 / 滚动卡顿 / modal 遮挡 | 启动无 stderr 输出；900×600 无横向溢出；其余未覆盖 |
| 签名/更新配置未被改写；ad-hoc 限制已单独记录 | 通过（见第 3、5 节） |
| 最终 PR 附 exact base/head、改动范围、命令、截图、已知限制 | 本文件即该项 |

**结论**：打包态在**启动、窗口镀铬、最小尺寸约束、真实 IPC/filesystem 扫描、
空态、多项目、missing project** 这些维度上通过；`drag region` 交互、真机系统偏好、
原生 dialog 与各交互态未在本次覆盖，需人工确认后方可宣告 Phase 7 完成。
