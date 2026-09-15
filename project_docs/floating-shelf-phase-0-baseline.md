# Floating Shelf Phase 0：基线冻结与视觉验收记录

本文件记录 [Issue #61](https://github.com/ShadyUnderLight/promptarium/issues/61)
要求的当前 UI 基线。Phase 0 只记录现状和验收边界，不修改产品行为、用户
数据、Prompt 文件、Rust filesystem 或 Tauri 窗口配置。

## 基线元数据

- 目标提交：`8f2f11b88f4263e056f86990efc292c6e21259c1`
- 基线提交标题：`fix(ui): close macOS glass review gaps (#59)`
- 基线关系：`HEAD == origin/main == 8f2f11b...`
- 采集日期：2026-09-15
- 运行环境：macOS，Darwin 27.0.0；浏览器开发预览
- 开发入口：`pnpm dev --host 127.0.0.1`
- 浏览器数据：`src/lib/api.ts` 中的 in-memory fixture；不会写入用户项目
- Tauri 窗口约束：默认 `1440×900`，最小 `900×600`
- 工作区状态：本 Phase 0 worktree 从上述提交创建时无代码改动

原始工作区中已有的 `.workbuddy/memory/*.md` 未跟随到本 worktree，也不属于
本次基线或产品代码变更。采集基线时不删除、不提交这些外部工作区文件。

## 证据等级

- **运行时测量**：通过浏览器 viewport、DOM bounding box、computed style 和
  document overflow 读取。
- **可访问性快照**：确认控件、区域、状态和用户入口实际挂载。
- **代码/测试契约**：用于无法在浏览器 fixture 中安全复现的 Tauri、filesystem
  和异步边界；不替代真实打包 App 的手工验收。

截图命名规则统一为：

`phase0/<viewport>-<theme>-<locale>-<state>.png`

例如：`phase0/1440x900-dark-zh-CN-browse.png`。截图如果作为附件保存，
必须同时记录对应的提交、视口、主题、locale 和状态；不能只用连续编号。

## 当前 Shell 和区域边界

当前实现仍是三栏工作区，不是 A 方案的 Rail + Floating Shelf：

```text
library-topbar
└── library-workspace
    ├── ProjectSidebar
    ├── pane-resizer
    ├── PromptLibrary
    ├── pane-resizer
    └── PromptDetail
```

当前基线中的关键区域：

- 顶栏：`library-topbar`，普通流布局，不跟随内容滚动。
- 左栏：`ProjectSidebar`，有边距、圆角、边框、阴影和 regular glass enhancement。
- 中栏：`PromptLibrary`，包含 sticky `PromptToolbar` 和可滚动 Prompt 列表。
- 右栏：`PromptDetail`，包含 Preview/Edit/History 和 Prompt-specific sections。
- Overlay：`ProjectMenu`、`NamePromptDialog`、`ConfirmDialog`、Compare 和
  Update Banner。
- 内容层：Prompt row、Markdown、Editor、History、Diff 使用实体内容背景，
  不使用逐行 `backdrop-filter`。

## 视口测量结果

### 1440×900

采集组合：Light/English 和 Dark/简体中文；普通媒体设置。

- 顶栏：`x=0, y=0, width=1440, height=68`
- 工作区：`y=68, width=1440, height=773.08`
- 侧栏外框：`x=12, width=232`
- Prompt 列表：`x=250, width=362`
- Detail：`x=618, width=822`
- `document` 和 `body` 均无横向或纵向 overflow。
- 浏览器可访问性树包含 Search、Language、Theme、New、Refresh、Projects、
  Smart Views、Folders、Tags、List/Grid、Prompt rows 和 Detail region。

### 1180×720

采集组合：Dark/简体中文；普通媒体设置。

- 顶栏：`width=1180, height=68`
- 侧栏外框：`x=12, width=232`
- Prompt 列表：`x=250, width=362`
- Detail：`x=618, width=562`
- `document` 和 `body` 均无横向或纵向 overflow。
- 三个主要区域仍然同时可见；此尺寸尚未进入 `max-width: 980px` 规则。

### 900×600

采集组合：Light/English；同时启用
`prefers-reduced-transparency: reduce`、`prefers-contrast: more` 和
`prefers-reduced-motion: reduce`。

- 顶栏：`width=900, height=68`
- 侧栏外框：`x=12, width=188`
- Prompt 列表：`x=206, width=384`
- Detail：`x=596, width=304`
- `document` 和 `body` 无 overflow，但 Detail 内部存在基线问题：
  - `.detail-toolbar` 的 `clientWidth` 约为 `261px`，`scrollWidth` 约为
    `590px`。
  - `.detail-actions` 的右边界约为 `x=1207.6`，超出当前 Detail 可视区域
    `x=900`。
  - 因此 Preview/Edit/History 右侧操作在最小窗口不能同时显示，属于后续
    Detail/Shell 阶段必须保留的已知回归基线；Phase 0 不在此修复。

### 720×600 断点

采集组合：Light/English；与上一个样本相同的 reduced 系统设置。

- 顶栏高度约 `97.8px`，`flex-wrap: wrap` 生效。
- Search 独占第二行：`x≈11.2, width≈697.6, height=32`。
- 侧栏外框：`x=12, width=172`。
- Prompt 列表：`x=190, width=530`。
- Detail 的 computed `display` 为 `none`，第二个 pane resizer 也隐藏。
- `document` 和 `body` 无 overflow。
- 该样本验证的是浏览器/CSS 断点；由于 Tauri `minWidth=900`，不能把它
  解释为打包 App 的实际窗口尺寸。

## 系统设置验证

在 `900×600` Light/English 样本中，三个系统设置同时设置为 `reduce/more/reduce`：

- `prefers-reduced-transparency`：命中；Prompt Toolbar 和 Project Sidebar
  的 `backdrop-filter` 为 `none`，仍保留实体背景和边框。
- `prefers-contrast: more`：命中；边框和弱文本使用增强后的语义 token。
- `prefers-reduced-motion: reduce`：命中；transition/animation 被压缩到
  `0.01ms`，页面仍保持可用。
- document/body 没有新增 overflow。

这些是现有 CSS 的运行时结果，不代表未来 Rail/Shelf 的验收已经完成。

## 功能状态与不可回归边界

### 已在基线浏览预览中看到的入口

- 多项目：`engineering`、`writing`、`research`。
- All Projects、All、Needs Attention、Favorites、Draft、Archived。
- Folder tree、派生 Tag 列表和数量。
- Search、Sort、Model Filter、List/Grid。
- Prompt row 的名称、描述、标签、状态、变量数和修改时间。
- Prompt Detail 的 Preview、Edit、History、Compare、Copy、Reveal 和管理动作。
- English/简体中文切换不会替换用户项目名、Prompt 名称或标签内容。

### 由现有代码和回归测试锁定的状态

以下状态在 Phase 0 记录为“行为契约”，不在浏览器 fixture 中人为伪造用户
文件：

- 无项目、空列表、无匹配、loading、refreshing 和项目错误。
- missing project、Locate Folder、Forget Project。
- invalid frontmatter、Health、Variables、Related、Variants、Examples。
- dirty editor、Reload/Keep editing、save conflict 和 external file missing。
- Project Menu、Name Prompt、Confirm、Compare、Update Banner。
- Cmd/Ctrl+N、Cmd/Ctrl+F、Cmd/Ctrl+S、Escape、Enter。
- Tauri 下 app-owned NamePromptDialog/ConfirmDialog 路由以及 Overlay
  titlebar/drag region 契约。

对应证据入口：

- `tests/tauri-dialog-routing.test.ts`
- `tests/titlebar-contract.test.ts`
- `tests/modal-shortcuts.test.ts`
- `tests/unsaved-navigation.test.ts`
- `tests/missing-project-recovery.test.ts`
- `tests/core-ui-localization.test.ts`
- `tests/full-ui-localization.test.ts`

浏览器 fixture 适合验证正常浏览、筛选和编辑显示，但不包含真实
invalid-frontmatter、missing-folder、filesystem conflict 等全部异常状态。
这些状态的后续手工验收必须使用隔离的临时项目或打包 App，不能修改仓库内
用户 Prompt 文件。

## 后续阶段必须保持的行为

- Project path 是 Project 身份；relative Markdown path 是 Prompt 身份。
- Search、Project、Folder、Tag、Smart View、Sort、List/Grid、Batch 和 pane
  resize 语义不变。
- Preview/Edit/History 保持在 Prompt Detail 内；Compare 仍是临时视图。
- dirty editor、冲突检测、Reload/Keep editing、missing project 恢复路径不变。
- Tauri 路径继续使用 app-owned Dialog，不重新引入浏览器原生
  `window.prompt`/`window.confirm`。
- locale 切换不清空 selection、filter、search、editor draft 或 dirty state。
- 不修改 Prompt、Project、Folder、Tag、Markdown、Git 内容，也不新增 sidecar。
- 内容层不使用逐行 blur；Reduce Transparency 时所有功能层仍然可读。

## Phase 0 边界

本记录不包含以下实现：

- Navigation Rail、Floating Project Shelf 或新的 Shell 状态。
- Design token 重构、布局重排、Detail Inspector 重构或 Overlay 重写。
- Rust、IPC、filesystem、watcher、search index、save/conflict 逻辑变更。
- 新的 UI 框架、截图测试框架、feature flag、migration 或兼容 wrapper。
- Tauri 打包发布、签名、updater artifact 和安装覆盖验证；这些属于后续
  发布阶段。

## 自动验证

Phase 0 不新增测试文件。实现分支应通过项目现有检查：

```sh
pnpm check
pnpm test:smoke
pnpm build
cd src-tauri && cargo test --lib
git diff --check
```

本分支实际验证结果（2026-09-15）：

- `pnpm check`：通过，0 errors / 0 warnings。
- `pnpm test:smoke`：通过，16 个 Vitest 文件、168 个测试，以及全部
  `.mjs` contract scripts 通过。
- `pnpm build`：通过；Vite 报告的 `INEFFECTIVE_DYNAMIC_IMPORT` 来自现有
  `src/lib/api.ts` 与 Tauri API 的混合导入，本次没有改动相关代码。
- `cd src-tauri && cargo test --lib`：通过，143 passed / 0 failed；保留
  现有 `src/prompts/store.rs:1974 unused_mut` warning。
- `git diff --check`：通过。

视觉证据仍需结合本文的运行时测量和后续阶段的浏览器/打包 App 手工 smoke；
自动化检查通过不能替代 viewport、主题、系统设置和 macOS 窗口验收。
