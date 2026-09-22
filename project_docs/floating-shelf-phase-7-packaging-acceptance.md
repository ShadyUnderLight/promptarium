# Floating Shelf Phase 7：Tauri 打包与发布前验收记录

本文件记录 [Issue #68](https://github.com/ShadyUnderLight/promptarium/issues/68)
要求的 macOS 打包态验收。Phase 7 不修改产品代码、Rust/IPC/数据模型或
signing/updater 配置；它记录一次可复核的真实 `.app` 构建与运行时抽查证据。

> **本版修订说明**（第二版之后的第二次修订，针对 PR 评审）。四条评审意见逐条处理：
> ① 构建改为**独立临时 `CARGO_TARGET_DIR`**，并按新产物重跑了全部运行时抽查（本版所有
> 截图都来自该隔离构建，不是复用暖缓存的产物）；② 契约测试由 `packaged min-window
> contract` **改名**为 `min-window config contract`，范围收窄为「只锁配置」；
> ③ 拆分了项目列表与扫描结果两类数据来源；④ 900×600 的 Shelf 结论改为「默认折叠」
> 并补了展开态实测截图。上一版复用 `src-tauri/target` 的结果已被本版取代。

## 0. 被测对象

| 项 | 值 |
|---|---|
| Exact head | `78c4055bfd0567dec758894615295c86790263b9`（PR #75 的 merge，即 Phase 6 收口点） |
| 构建时间 | 2026-09-22 14:51:13 (+0800) |
| 构建命令 | `CARGO_TARGET_DIR=/private/tmp/promptarium-phase7-target pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'` |
| 主机 | macOS 27.0，`arm64` |
| 工具链 | cargo 1.95.0 (f2d3ce0bd 2026-03-21) / rustc 1.95.0 (59807616e 2026-04-14) / pnpm 11.9.0 / node v22.22.2 |
| 产物 | `/private/tmp/promptarium-phase7-target/release/bundle/macos/Promptarium.app` |
| 显示环境 | 内建 Retina 屏（逻辑 1728×1117，**2x**）；外接 2560×1440 屏是 **1x** |

### 构建隔离（按 #68 技术方案，不再复用仓库 target）

#68 的技术方案要求「构建产物使用**独立临时 `CARGO_TARGET_DIR`**，避免陈旧 target cache
指向其他 checkout」。**本版照做**：`CARGO_TARGET_DIR=/private/tmp/promptarium-phase7-target`，
该目录在构建前被删除，是一次全新构建。

证明它是**真编译**而不是某种缓存捷径（三条，都不依赖 build exit code）：

1. **没有任何编译器缓存参与**：`which sccache` → 未安装；环境无 `RUSTC_WRAPPER`/`SCCACHE`；
   `~/.cargo/config.toml` 与 `src-tauri/.cargo/config.toml` 都不存在。
2. **编译规模**：构建日志有 **302 条 `Compiling`**，新 target 里产生 **384 个 `.rlib`**
   （仓库暖缓存那份是 419 个）——即整棵依赖树被重新编译，`Finished release profile
   [optimized] target(s) in 59.25s`。59 秒是机器并行度的结果，不是复用了产物。
3. **产物指纹不同**：新二进制 SHA-256 `31a00843a7605e1d852f499feacdf50f33165f3de62b6bfd4896c2b566c591fe`，
   与上一版（复用暖缓存）的 `e8de23118f57fd453256259fd225f5542292708c6dad1fffad2a6746f448eb9b`
   **不同**。

作为补充事实，上一版担心的「缓存指向其他 checkout」在本次也被直接查过：`target/release/deps/*.d`
与 `target/release/.fingerprint/` 中出现的 `/Users/lmz` 路径只有 `~/.cargo/` 与
`/Users/lmz/Documents/Vibe Coding/Promptarium/`（含转义写法），**没有任何 Worktrees / 其他
clone 路径**。这条只作为旁证；本版结论不依赖它，因为本版本来就是隔离构建。

## 1. 产物身份

| 检查 | 实测（本版，隔离构建） | 上一版（复用暖缓存） | A 方案落地前的旧产物 |
|---|---|---|---|
| `Contents/MacOS/promptarium` | 2026-09-22 14:51:13，**16780176 B** | 2026-09-21 15:01:46，16763664 B | 2026-09-15 11:47:21，16747152 B |
| SHA-256 | `31a00843…` | `e8de2311…` | — |
| `file` | `Mach-O 64-bit executable arm64` | 同 | 同 |
| `CFBundleShortVersionString` / `CFBundleVersion` | `0.3.3` / `0.3.3` | 同 | 同 |
| `CFBundleIdentifier` | `com.shadyunderlight.promptarium` | 同 | 同 |
| `LSMinimumSystemVersion` | `10.13` | 同 | 同 |
| `codesign -dv` | `Identifier=promptarium-172d4104aa938eae`、`Signature=adhoc`、`TeamIdentifier=not set`、`Info.plist=not bound`、`Sealed Resources=none` | 同 | 同 |

三个时间戳与字节数都互不相同，可以排除「复用了上一版或 2026-09-15 那份二进制」。
磁盘上原有的 `.app` 生成于 A 方案任何代码落地**之前**（PR #69 合并于 2026-09-15 18:58，
PR #70–#75 在其后），所以 A 方案第一次真正进入打包态是上一版，本版是在隔离构建下复现。

## 2. 自动化检查（exact head `78c4055`）

| 命令 | 结果 |
|---|---|
| `pnpm check` | `svelte-check found 0 errors and 0 warnings` |
| `pnpm test:smoke` | 18 个 `tsx` 契约脚本全部通过 + vitest **23 files / 230 tests passed** |
| `pnpm build` | 成功（`adapter-static` 写入 `build`） |
| `cd src-tauri && cargo test --lib` | `143 passed; 0 failed` |
| `git diff --check` | 干净（exit 0，无输出） |

上述五项在 head `78c4055` 上测得。**本 PR 分支**（含本节新增的契约测试）另跑过一次
`svelte-check`（0 errors / 0 warnings）与 vitest **23 files / 231 tests passed**，
即比 head 多一条新增测试。

关键日志行（原始日志在 `/private/tmp/promptarium-phase7-evidence/`，`/private/tmp` 易失，
因此把可复核的行内联在此）：

```
$ pnpm check
svelte-check found 0 errors and 0 warnings

$ pnpm test:smoke
All library scope refresh tests passed.
 Test Files  23 passed (23)
      Tests  230 passed (230)

$ pnpm build
> Using @sveltejs/adapter-static
  Wrote site to "build"
  ✔ done

$ cd src-tauri && cargo test --lib
test result: ok. 143 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s

$ CARGO_TARGET_DIR=/private/tmp/promptarium-phase7-target \
    pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
   Compiling …                                   ← 共 302 条
   Compiling promptarium v0.3.3 (<repo>/src-tauri)
    Finished `release` profile [optimized] target(s) in 59.25s
       Built application at: /private/tmp/promptarium-phase7-target/release/promptarium
    Bundling Promptarium.app (/private/tmp/promptarium-phase7-target/release/bundle/macos/Promptarium.app)
    Finished 1 bundle at:
        /private/tmp/promptarium-phase7-target/release/bundle/macos/Promptarium.app
```

## 3. 配置未被改写（静态证据）

| 文件 | 最后一次改动 | 本次 head 的 diff |
|---|---|---|
| `src-tauri/tauri.conf.json` | 2026-09-09（Issue #44） | 无 |
| `src-tauri/capabilities/default.json` | 2026-09-10（PR #51） | 无 |

整个 A 方案（Phase 1–6）从未触碰这两个文件，因此「签名/更新配置没有被 UI 重构
改写」这条**不需要打包就能证明**——`git log -- <path>` 加既有的
`tests/titlebar-contract.test.ts`（已断言 `titleBarStyle=Overlay`、`hiddenTitle`、
`trafficLightPosition={x:16,y:26}`、topbar title 块的 `data-tauri-drag-region`、
capability 含 `core:window:allow-start-dragging`）就是完整证据。本次构建全程只通过
CLI `--config` 覆盖，没有回写仓库配置；构建后 `git status` 只剩未跟踪的
`.workbuddy/`。

同一份契约测试现在还锁住 `minWidth: 900` / `minHeight: 600`（`min-window config
contract`）——此前改配置会让「720px 断点不可达」静默失效而不挂任何测试。

**这个测试的范围只有配置，别把它读成打包态测试**：它不验证构建出的 `.app` 实际用了
这份配置（CLI `--config` 覆盖发生在构建期，对它不可见），也不验证真实窗口是否被夹紧
——后者是第 4 节的 AX 实测结果，**不是**自动化断言。打包态目前没有可用的自动化通道
（release 构建不带 devtools；WKWebView 的 DOM 不经 AX 暴露，见第 6 节方法边界），
所以这里如实收窄范围，而不是用配置测试冒充打包态测试。

## 4. 运行时抽查

运行方式：直接执行 bundle 内的可执行文件（不是 `open`——`open --env` **不会**把环境
变量传进被启动进程，这一点在本次验收中实测确认过），把 `PROMPTARIUM_DATA_DIR` 指向
隔离目录，使验收不接触用户真实项目清单：

```
PROMPTARIUM_DATA_DIR=/private/tmp/promptarium-phase7-qa \
  "/private/tmp/promptarium-phase7-target/release/bundle/macos/Promptarium.app/Contents/MacOS/promptarium"
```

每次抓图前用 AX 把窗口**移动到主显示器 (120,65)** 再设定尺寸：macOS 会按应用恢复上次
窗口位置，实测本次首次启动落在外接屏的 `118,-1282`，而外接屏是 **1x**，会静默改变截图
的像素尺度（同一命令在外接屏得到 1440×900 像素、在内建屏得到 2880×1800）。固定位置后
全部截图都是稳定的 **2x**。

### 隔离方式与 fixture manifest

三个目录各自负责一件事，别混淆：

| 目录 | 作用 |
|---|---|
| `/private/tmp/promptarium-phase7-fixtures/` | fixture 项目文件本体（被登记为项目的目录） |
| `/private/tmp/promptarium-phase7-qa/` | 数据目录（含预写的 `prompts-state.json`） |
| `/private/tmp/promptarium-phase7-firstrun/` | **空**数据目录，用于「首次无项目」 |

截图顺序，以及「同一份 fixture 怎么会先空、后有三个项目」的答案：

1. **首次无项目** → 数据目录指向 `…-firstrun`（空目录、无清单文件）。
2. **多项目 + 选中态 + Shelf 展开** → 数据目录指向 `…-qa`，其 `prompts-state.json` 的
   `active` 为 `/private/tmp/promptarium-phase7-fixtures/alpha`。
3. **missing project** → 仍是 `…-qa`，只把 `active` 改成不存在的
   `/private/tmp/promptarium-phase7-fixtures/ghost-missing`。

fixture 目录树（`alpha` 是 git 仓库、两次提交；`beta` 故意不是仓库）：

```
…-fixtures/alpha/prompt-one.md
…-fixtures/alpha/prompt-二.md
…-fixtures/alpha/nested/deep-prompt.md
…-fixtures/beta/beta-prompt.md
```

`…-qa/prompts-state.json` 全文：

```json
{
  "projects": [
    {
      "name": "Alpha",
      "path": "/private/tmp/promptarium-phase7-fixtures/alpha",
      "color": null
    },
    {
      "name": "Beta",
      "path": "/private/tmp/promptarium-phase7-fixtures/beta",
      "color": null
    },
    {
      "name": "Ghost",
      "path": "/private/tmp/promptarium-phase7-fixtures/ghost-missing",
      "color": null
    }
  ],
  "active": "/private/tmp/promptarium-phase7-fixtures/alpha"
}
```

提示词内容摘要（决定截图里能看到什么）：

- `alpha/prompt-one.md`：frontmatter `title: Alpha prompt one` /
  `description: A prompt with frontmatter, tags and a variable.` /
  `tags: [writing, alpha]` / `status: active` / `favorite: true` /
  `models: [deepseek-chat]`；正文含 `{{topic}}` 与 `{{tone}}` —— 这是**转义**写法，
  见第 7 节，所以列表显示 0 个变量。该文件有两次提交，用于 History。
- `alpha/nested/deep-prompt.md`：`status: draft`，用于验证嵌套文件夹树与草稿标记。
- `alpha/prompt-二.md`：无 frontmatter，长中文标题 + emoji，用于窄窗口下的截断与换行。
- `beta/beta-prompt.md`：非 git 仓库项目，用于 History 的「非仓库」路径。

### 抽查结果

| 状态 | 结果 | 证据 |
|---|---|---|
| 启动 | 正常，无 panic | — |
| 首次无项目 | 「0 个提示词」+ 空态引导文案正确 | `1440x900-dark-zh-CN-first-run.png` |
| 多项目 + 真实扫描 | 侧栏 3 个项目、`nested` 文件夹树、`#alpha`/`#writing` 标签、收藏 1 / 草稿 1、真实 mtime 全部正确 | `1440x900-dark-zh-CN-multi-project.png` |
| missing project | 「项目文件夹未找到」+ 显示真实路径 + 「重新定位文件夹」/「移除」 | `1440x900-dark-zh-CN-missing-project.png` |
| 最小窗口 900×600 | Rail / List / Detail / Toolbar 可达，无 document 级横向溢出；**Shelf 默认折叠**（见下「Shelf 折叠」小节） | `900x600-dark-zh-CN-min-window.png` |
| 最小窗口 + 展开 Shelf | 点 Rail 底部的折叠按钮（`sidebar.rail.expandShelf`）后 Shelf 展开：项目（全部项目 / Alpha / Beta / Ghost）、智能视图（全部提示词 3 / 需要处理 / 收藏 1 / 草稿 1 / 已归档）、文件夹、标签分区全部渲染 | `900x600-dark-zh-CN-shelf-expanded.png` |
| 最小窗口 + 选中态 | 在 900×600（Shelf 展开）下点选 `prompt one`，Detail 完整渲染：`prompt-one.md`、状态/标签/模型/描述等元数据、操作行（比较…/创建副本/创建变体副本/重命名/移动/删除）与正文预览 | `900x600-dark-zh-CN-min-window-selected.png` |

#### Shelf 折叠：900×600 下的真实行为

`900x600` 截图中**没有 Shelf 列**，这不是缺陷，也不是「Rail/List/Detail 之外还额外显示了
Shelf」：

- `PromptsView.svelte:142-143` — `shelfMediaQuery = window.matchMedia('(max-width: 980px)')`、
  `shelfExpanded = !shelfMediaQuery.matches`，即 **≤980px 时 Shelf 默认折叠**。
- `PromptsView.svelte:610` — 折叠时给 `.library-workspace` 加
  `library-workspace--shelf-collapsed`，对应 `src/app.css:3015` 把 sidebar 列宽置 0。
- `PromptsView.svelte:623` — Rail 底部的按钮 `onToggleShelf` 可随时展开，`aria-expanded`
  反映状态（`LibraryRail.svelte:117-127`）。

因此上一版写的「Rail / Shelf / List / Detail / Toolbar **全部可达**」不准确：900×600 下**默认
可见的**是 Rail + List + Detail，Shelf 是**折叠**的。本版补了展开态截图，把这条
从「未验证」变成「已验证」——展开后四栏同时在 900×600 下渲染。

### 项目列表与扫描结果的来源不同

多项目那一项同时构成**真实 IPC + filesystem** 的证据，但两类数据来源不同，不能混为
一谈：

- **项目名、项目路径、active / missing 状态**来自数据目录里的 **`prompts-state.json`
  清单文件**，不是扫描结果：`appstate::list_projects()` → `load(root)` →
  `state.projects`（`src-tauri/src/prompts/appstate.rs:83-89`）。
- **文件夹树、标签、修改时间、提示词正文**来自 Rust 对磁盘上真实 `.md` 文件（隔离目录
  `…-fixtures/`）的 filesystem 扫描，经 IPC 返回前端。

本次能同时验证这两条，是因为 fixture 的清单文件与磁盘文件都是我预置的、内容互相一致。

### 截图清单与像素尺度

所有窗口图由 `screencapture -x -o -l <windowid>` 抓窗口自身缓冲区（不受遮挡影响），
**都是 2x 设备像素**。下表的「逻辑尺寸」才是窗口坐标；正文里的像素换算请用逻辑尺寸。

| 文件 | 逻辑尺寸 | 像素尺寸 |
|---|---|---|
| `1440x900-dark-zh-CN-first-run.png` | 1440×900 | 2880×1800 |
| `1440x900-dark-zh-CN-multi-project.png` | 1440×900 | 2880×1800 |
| `1440x900-dark-zh-CN-missing-project.png` | 1440×900 | 2880×1800 |
| `900x600-dark-zh-CN-min-window.png` | 900×600 | 1800×1200 |
| `900x600-dark-zh-CN-shelf-expanded.png` | 900×600 | 1800×1200 |
| `900x600-dark-zh-CN-min-window-selected.png` | 900×600 | 1800×1200 |
| `1440x900-dark-zh-CN-topbar-traffic-lights.png` | 210×30（裁切） | 420×60 |

最后一张是从 `multi-project` 那张窗口图的**左上角 (0,0) 起裁 420×60 像素**
（即逻辑 210×30），因此交通灯的 15/38/61px 与标题起点的 84px 都能直接在这张图上量。

### macOS 窗口几何（AX 实测，非 CSS 代理）

| 项 | 实测 |
|---|---|
| 窗口（本版钉位后） | `900x600`/`1440x900` 均实测，位置 `120,65`，`AXWindowCount=1` |
| close | 窗口原点 + 15px（1440×900 下屏幕坐标 `135,81`）16×16 |
| minimize | 窗口原点 + 38px（`158,81`）16×16 |
| zoom / fullscreen | 窗口原点 + 61px（`181,81`）16×16 —— **同一颗绿色按钮的两个 AX 属性**：`kAXZoomButton` 与 `kAXFullScreenButton` 经 `CFEqual` 判定为同一元素（`zoomIsFullscreenButton=true`），所以交通灯是三颗而不是四颗 |
| 标题块起点 | `[data-platform='macos'] .library-topbar { padding-left: 5.25rem }` = 84px（`src/app.css:348-350`；全仓未设 `html { font-size }`，root 为 16px） |
| 结论 | 交通灯最右缘 ≈77px < 84px，**标题未被覆盖**，间隙约 7px |

`1440x900-dark-zh-CN-topbar-traffic-lights.png` 是顶栏的放大裁切，尺度见上表，可直接对照。

### 最小窗口约束（可证伪 720px 断点）

| 请求尺寸 | 实际尺寸（本版，隔离构建） |
|---|---|
| 900×600 | `900x600` |
| 720×600 | **`900x600`**（被夹回） |
| 800×500 | **`900x600`**（被夹回） |

`tauri.conf.json` 的 `minWidth: 900` / `minHeight: 600` 在真实窗口上强制生效，因此
`src/app.css` 的 `@media (max-width: 720px)` 分支（该分支会 `display: none` 掉
Detail 与 pane resizer）**在打包态不可达**。900×600 命中的是
`@media (max-width: 980px)`，它保留 Detail（已在选中态截图中验证）。

结论：**720px 断点在打包态不可达**，属于「已定性」，不是待办。它的**配置前提**由第 3 节的
`min-window config contract` 锁住；而「真实窗口确实被夹回」这一条**没有自动化断言**，
依据是上表的 AX 实测（本版在隔离构建的产物上复测过）。

## 5. 环境限制（如实记录，未修改配置）

- **本地未签名**：产物为 ad-hoc 签名（`Identifier=promptarium-172d4104aa938eae`、
  `Signature=adhoc`、`Info.plist=not bound`、`TeamIdentifier=not set`、
  `Sealed Resources=none`）。本次没有引入私钥，也没有改 `bundle.macOS`、
  `updater.endpoints` 或 `pubkey`。
- 应用确实有一处**依赖 macOS Keychain** 的能力：AI 命名通过 `keyring` crate 读写
  `com.shadyunderlight.promptarium` / `deepseek-api-key`
  （`src-tauri/Cargo.toml:34-37` 的 macOS-target 依赖；`src-tauri/src/ai/deepseek.rs:8-11,275`；
  前端错误映射见 `src/lib/components/library/NewPromptDialog.svelte:88,109` 与 i18n key
  `newPrompt.aiNaming.error.keychain`）。macOS 的 Keychain 访问控制与代码签名绑定，
  因此**未签名 bundle 下的该行为不代表正式签名版**——本次未在打包态抽查 AI 命名，
  该项记为「环境限制/未判」，不作为失败。
- **打包态没有 devtools 通道**：WKWebView 的前端 `console.error` 既不进 stdout 也不进
  stderr（本次 `app-run.log` 亦为 0 字节）。所以「没有 console error」这条验收标准
  **本次未采集**，第 8 节按未采集记，不用「stderr 为空」冒充证据。
- **updater artifact 按 Issue 要求关闭**：CLI 覆盖 `createUpdaterArtifacts=false`，
  本次没有产出新的 `.app.tar.gz`；仓库 `src-tauri/target`（上一版构建位置）里的那份
  `Promptarium.app.tar.gz` mtime 为 2026-09-15 11:47，是遗留物。隔离构建目录里没有它。
- **未安装/未覆盖** `/Applications/Promptarium.app`（仍为 2026-09-15 11:50 那份，
  16747152 B，mtime 未变）；验收实例全程用隔离数据目录，用户真实
  `~/.promptarium/prompts-state.json` mtime 保持 2026-09-11 10:22 未变。
- **显示配置会影响截图尺度**：内建 Retina 屏 2x、外接屏 1x。本次通过 AX `move` 把窗口钉到
  内建屏后再抓图，所以尺度统一为 2x；若换机器或换显示器布局，尺度可能变化，需重新量。
- **临时目录易失**：隔离构建产物位于 `/private/tmp/promptarium-phase7-target`（约 1.2 GB），
  与所有日志、fixture 一样可能被清理；持久证据是本文件内联的日志行、产物指纹与截图。

## 6. 本次未覆盖（不应按「通过」计）

这些项目前由 [Issue #83](https://github.com/ShadyUnderLight/promptarium/issues/83)
承载，不在本文件的「已验」范围内。

| 项 | 为什么没覆盖 | 移交 |
|---|---|---|
| drag region 拖拽窗口、以及它不拦截控件 | 需要真实鼠标拖拽与点击；本次只有窗口几何与 AX 读取（外加选中态与 Shelf 展开的两次合成点击） | #83 |
| 真机 macOS 三个开关（减弱透明度 / 提高对比度 / 减弱动态效果） | 需要改系统设置；本次没有触碰用户系统偏好 | #83 |
| 原生 `plugin-dialog`（`ask`/`confirm`、文件夹选择器） | 需要打开 Project Menu 等交互路径 | #83 |
| Light 主题、Edit / History / Compare / Search / Batch 等交互态 | 需要交互驱动；这些状态沿用 Issue #67 的浏览器侧 QA 证据，本次未在打包态重放 | #83 |
| 1180×720 窗口、单项目与 All Projects 两种粒度 | 本次只抓了 1440×900 与 900×600，项目粒度只覆盖「多项目（3 个）」与 missing | #83 |
| Update Banner 的安装/重启路径 | 只观察，不点安装与重启 | #83 |

方法边界：本次运行验收基于 `screencapture -l <windowid>`（窗口自身缓冲区，不受遮挡
影响）、CGWindowList / AX API 读写（含 `AXSetPosition`/`AXSetSize` 钉位与 2 次
CGEvent 合成点击：展开 Shelf、选中列表行），以及 JSON 清单与磁盘 fixture 的预置。
**WKWebView 的 DOM 不暴露在 AX 树里**（AX 遍历只见到 241 个节点，无 web 内容），
所以本次**没有**做 DOM 级断言，也没有冒充成逐像素快照门槛。

## 7. 非缺陷说明：`{{…}}` 是转义语法，不是变量

多项目与最小窗口截图里，`alpha/prompt-one.md` 的 `description` 写着
「A prompt with frontmatter, tags and a variable.」，而它的列表行显示 **0 个变量**，
Detail 正文预览里 `{{topic}}` / `{{tone}}` 也原样保留。**这是正确渲染，不是缺陷。**

Promptarium 的变量语法是**单花括号** `{name}`；`{{` / `}}` 是**转义**，表示字面量花括号：

- `src/lib/variables/variables.ts:71` — `const VAR_AT = /^\{([A-Za-z0-9_-]+)\}/;`（单个 `{`）
- `src/lib/variables/variables.ts:87-89` —
  `if (pair === '{{' || pair === '}}') { literal += text[i]; i += 2; }`（`{{` → `{`，消费两个字符）
- `README.md:59-60` — 「`{name}` placeholders are detected … `{{name}}` escapes.」
- `tests/variable_contract.mjs:56` —
  `'escaped {{name}} is not a variable, so its annotation is stale'`

用仓库自己的解析器实测（`parseVariables(text: string)`，`src/lib/variables/variables.ts:111`）：

```
$ ./node_modules/.bin/tsx -e "
import { parseVariables } from './src/lib/variables/variables.ts';
console.log(parseVariables('Write a summary of {{topic}} in {{tone}} tone.').map(v => v.name));
console.log(parseVariables('Write a summary of {topic} in {tone} tone.').map(v => v.name));"
[]
[ 'topic', 'tone' ]
```

列表计数链路是 `PromptLibrary.variableCount()` → `library.svelte.ts` 的
`promptVariableCount()` → 索引条目的
`src/lib/library/search-index.ts:172` `const variables = parseVariables(document.body);`
与 `:178` `variableCount: variables.length,`。fixture 正文用的正是 Handlebars 风格的
`{{topic}}`，所以 0 是**该语法的预期结果**：它既与打包层无关，也与 Rust 的索引无关
（`src-tauri/src/prompts/store.rs:2` 明确写了 "Prompt variables remain a frontend
concern; Rust never parses them."）。

**不需要为它开 follow-up issue**——按「待查缺陷」记录会把一条正确行为固化成排查负担。
若后续想用截图展示变量徽标，fixture 正文应改用 `{topic}` 这种单花括号写法。

> 本文件先前的版本把这条记成「观测异常（未定性）」，并声称「在打包态之外无法复现」。
> 该表述不准确：任何用 `{{x}}` 的输入都会得到 0 个变量，且该语义已由契约测试锁住。
> 现已按上述链路定性为**非缺陷**并更正。

## 8. 与 Issue #68 验收清单的对照

| 验收标准 | 本阶段结论 |
|---|---|
| frontend check / smoke / build / Rust tests / diff check 全通过 | 通过（见第 2 节） |
| Tauri arm64 `.app` 构建成功，版本/identifier/executable 可复核 | 通过（见第 1 节） |
| 构建使用独立临时 `CARGO_TARGET_DIR` | 通过（见第 0 节构建隔离；本版按技术方案执行） |
| 1440×900、1180×720、900×600 与 720px 断点手工验收 | 1440×900 与 900×600（折叠 / 展开 / 选中态）已实测留图；**1180×720 未单独抓图**（→ #83）；**720px 已证不可达**（见第 4 节） |
| 首次无项目 / 单项目 / 多项目 / All Projects / missing project 抽查 | 首次无项目、多项目（3 个）、missing project 已实测留图；**单项目与 All Projects 未覆盖**（→ #83） |
| Light/Dark、English/简中、长标题、emoji、空/错误/missing/dirty/conflict | 简中 + Dark + 长中文标题 + emoji 已见；Light / English / dirty / conflict **未在打包态覆盖**（→ #83） |
| Rail / Shelf / List / Detail / Inspector / Project Menu / Name / Confirm / Compare / Update Banner | Rail / List / Detail 默认可见且已验证；**Shelf 在 ≤980px 默认折叠，展开态已补测**（第 4 节）；其余**未覆盖**（→ #83） |
| Search / Project·Folder·Tag / List·Grid / Batch / pane resize / Preview·Edit·History / Save·Copy·Reveal | 未在打包态驱动（见第 6 节） |
| traffic lights / drag region / 关闭·最小化·全屏·缩放 | 几何与最小尺寸已实测（含 zoom 与 fullscreen 为同一控件的实证）；**点击行为与 drag region 交互未覆盖**（→ #83） |
| 无 console error / overflow / 白底闪烁 / 滚动卡顿 / modal 遮挡 | 1440×900 与 900×600 均无 document 级横向溢出；**console error 未采集**（打包态无 devtools 通道，`console.error` 不进 stderr，见第 5 节）；白底闪烁 / 滚动卡顿 / modal 遮挡未覆盖 |
| 签名/更新配置未被改写；ad-hoc 限制已单独记录 | 通过（见第 3、5 节） |
| 最终 PR 附 exact base/head、改动范围、命令、截图、已知限制 | 本文件 + PR #82 |

**结论**：打包态在**启动、窗口镀铬、最小尺寸约束、真实 IPC/filesystem 扫描、
空态、多项目、missing project、900×600 折叠/展开 Shelf 与选中态**这些维度上通过；
`drag region` 交互、真机系统偏好、原生 dialog、1180×720 与单项目/All Projects 粒度、
以及各交互态未在本次覆盖（移交 #83），需人工确认后方可宣告 Phase 7 完成。
本文件的证据来自**独立临时 `CARGO_TARGET_DIR` 的构建产物**，不复用仓库暖缓存。
