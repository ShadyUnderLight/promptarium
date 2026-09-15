# Floating Shelf Phase 0：基线冻结与视觉验收记录

本文件记录 [Issue #61](https://github.com/ShadyUnderLight/promptarium/issues/61)
要求的当前 UI 基线。Phase 0 只记录现状和验收边界，不修改产品行为、用户
数据、Prompt 文件、Rust filesystem 或 Tauri 窗口配置。

## 基线元数据

- Source app baseline：`origin/main @ 8f2f11b88f4263e056f86990efc292c6e21259c1`
  （提交标题：`fix(ui): close macOS glass review gaps (#59)`）。截图采集时的
  产品代码树与该 baseline 一致。
- Capture worktree / 首次文档提交：`81e1340306b92df27401f2061cdd9732bcd4b381`
  （PR #69 初始提交）；这是采集时的 worktree/documentation commit，不是
  `origin/main` 的替代标识。
- Screenshot artifact introduction：`7121055655e6b51d58a5a827a40daa1aacedb366`
  （PNG 首次进入 repository 的 PR 修订提交）。因此 checkout `81e1340` 不会
  看到这些 PNG；后续复核应同时记录 source app baseline、capture commit 和
  artifact commit。
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

`project_docs/phase0/<viewport>-<theme>-<locale>-<state>.png`

例如：`project_docs/phase0/1440x900-dark-zh-CN-browse.png`。截图如果作为附件保存，
必须同时记录对应的提交、视口、主题、locale 和状态；不能只用连续编号。

## 截图证据与验收矩阵

以下 PNG 是本次修订实际提交到仓库的截图 artifact。所有截图都在 source app
baseline `8f2f11b` 对应的开发预览中采集，采集 worktree/documentation commit
为 `81e1340`，artifact introduction commit 为 `7121055`。逻辑 viewport 是
CDP 设置的 CSS viewport；浏览器 capture path 输出的 19 张 PNG 都是
`2248×2160` physical capture-frame dimensions，不是把各个 CSS viewport 按
同一个 scale 等比放大的结果。捕获 frame 的宿主尺寸/留白不作为几何真值，
几何验收使用下方记录的 CSS viewport、DOM bounding box 和 computed style。
每条记录都明确 source/capture/artifact commit、viewport、theme、locale 和
state，可直接打开链接做人工复核。

### Viewport × theme × locale

- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `1440×900` · Light · English · `browse`：
  [1440x900-light-en-browse.png](phase0/1440x900-light-en-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `1440×900` · Dark · 简体中文 · `browse`：
  [1440x900-dark-zh-CN-browse.png](phase0/1440x900-dark-zh-CN-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `1180×720` · Light · English · `browse`：
  [1180x720-light-en-browse.png](phase0/1180x720-light-en-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `1180×720` · Dark · 简体中文 · `browse`：
  [1180x720-dark-zh-CN-browse.png](phase0/1180x720-dark-zh-CN-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `900×600` · Light · English · `browse`：
  [900x600-light-en-browse.png](phase0/900x600-light-en-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `900×600` · Dark · 简体中文 · `browse`：
  [900x600-dark-zh-CN-browse.png](phase0/900x600-dark-zh-CN-browse.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `720×600` · Light · English · `compact`：
  [720x600-light-en-compact.png](phase0/720x600-light-en-compact.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `720×600` · Dark · 简体中文 · `compact`：
  [720x600-dark-zh-CN-compact.png](phase0/720x600-dark-zh-CN-compact.png)

### 单项 macOS 辅助功能媒体设置

这些样本每次只启用一个媒体特性，避免三项 fallback 同时变化后无法判断
是哪条规则生效：

- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `900×600` · Light · English ·
  `prefers-reduced-transparency: reduce`：
  [900x600-light-en-prefers-reduced-transparency.png](phase0/900x600-light-en-prefers-reduced-transparency.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `900×600` · Light · English · `prefers-contrast: more`：
  [900x600-light-en-prefers-contrast-more.png](phase0/900x600-light-en-prefers-contrast-more.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · `900×600` · Light · English ·
  `prefers-reduced-motion: reduce`：
  [900x600-light-en-prefers-reduced-motion.png](phase0/900x600-light-en-prefers-reduced-motion.png)

### 代表性功能状态截图

这些截图补充了单纯 browse 矩阵无法表达的 selected、dirty、batch、dialog、
History 和 Compare 状态。它们统一在 `900×600`、Light、English、
`prefers-reduced-motion: reduce` 下采集；该媒体设置在这里明确记录，避免把
瞬时 UI 状态与系统设置混淆：

- `source 8f2f11b · capture 81e1340 · artifact 7121055` · selected Prompt + Preview：
  [900x600-light-en-preview-selected.png](phase0/900x600-light-en-preview-selected.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · All Projects + 两项 Batch Select：
  [900x600-light-en-all-projects-batch.png](phase0/900x600-light-en-all-projects-batch.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · Edit + dirty editor：
  [900x600-light-en-edit-dirty.png](phase0/900x600-light-en-edit-dirty.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · Edit + 长摘要/长标签/emoji：
  [900x600-light-en-edit-long-content-emoji.png](phase0/900x600-light-en-edit-long-content-emoji.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · Rename + 长标题/emoji：
  [900x600-light-en-rename-long-title.png](phase0/900x600-light-en-rename-long-title.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · History：
  [900x600-light-en-history.png](phase0/900x600-light-en-history.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · Compare overlay：
  [900x600-light-en-compare.png](phase0/900x600-light-en-compare.png)
- `source 8f2f11b · capture 81e1340 · artifact 7121055` · New Prompt dialog：
  [900x600-light-en-new-prompt.png](phase0/900x600-light-en-new-prompt.png)

代表性状态截图只使用浏览器开发 fixture 和临时表单输入；没有点击 Confirm、
Save、Create、Rename 或任何 filesystem action，不会写入用户 Prompt、Project
或 Markdown 文件。

人工检查结论：上述截图均可打开，文件名中的 viewport、theme、locale 和
state 与采集记录一致；Light/Dark、English/简体中文、720px 换行、900px
Detail action 裁切、独立 prefers-* fallback、selected/batch/dirty/dialog
状态均已逐张检查。截图中的窄窗口 Detail action 裁切是已知缺陷，不作为
后续视觉改造需要保留的正确行为。

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

## A 方案目标信息架构与区域边界

A「Floating Shelf」只重排现有能力，不新增业务主导航。目标结构如下：

```text
Topbar
└── A Shell
    ├── Navigation Rail
    │   ├── Library / All Projects
    │   ├── Search focus
    │   ├── Projects / Folders / Tags focus
    │   ├── History（有选中 Prompt 时可用）
    │   └── Shelf toggle
    ├── Floating Project Shelf
    │   ├── Projects / All Projects
    │   ├── Smart Views
    │   ├── Folder tree
    │   └── Tags
    └── Content workspace
        ├── Prompt List / Browse
        └── Prompt Detail
            ├── Preview
            ├── Edit + Metadata Inspector
            └── History

Overlay plane（位于内容层之上）
├── Project Menu
├── NamePromptDialog / ConfirmDialog
├── Compare
└── Update Banner
```

区域职责和当前实现的映射：

- **Topbar**：保留 `PromptsView.svelte` / `+layout.svelte` 中的 Search、
  Language、Theme、New、Refresh 和 macOS safe area。
- **Rail**：只做现有 action 的快捷入口；不新增 Settings、云同步、聊天或
  Prompt 执行器等没有业务支撑的主 Tab。
- **Floating Project Shelf**：是 `ProjectSidebar.svelte` 的视觉重排，继续
  承载 Project、All Projects、Smart Views、Folder、Tag、Project Menu。
- **Prompt List**：由 `PromptLibrary.svelte` 和 `PromptToolbar.svelte` 承载
  Search 结果、Sort、Model Filter、List/Grid、Batch Select。
- **Prompt Detail**：由 `PromptDetail.svelte` 继续承载 Preview、Edit、
  History、Compare、Variables、Examples、Related、Variants 和 Health。
- **Overlay plane**：保留现有菜单、应用内 prompt/confirm、Compare 和
  Update Banner 的层级与关闭/恢复语义；这里的 “plane” 是视觉 z-layer，
  不表示其中每个成员都是 modal。Update Banner 必须继续保持独立的
  non-modal notification contract。

这张目标图是后续 DOM 重排的边界，不是本 Phase 0 的实现方案；Phase 1
不能在该信息架构、现状矩阵和风险门槛未被接受前开始。

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

采集组合：Light/English 和 Dark/简体中文；普通媒体设置。

- 顶栏：`width=1180, height=68`
- 侧栏外框：`x=12, width=232`
- Prompt 列表：`x=250, width=362`
- Detail：`x=618, width=562`
- `document` 和 `body` 均无横向或纵向 overflow。
- 三个主要区域仍然同时可见；此尺寸尚未进入 `max-width: 980px` 规则。

### 900×600

采集组合：Light/English 和 Dark/简体中文；普通媒体设置。三个
`prefers-*` 特性另行逐项采集，避免把组合 fallback 误当成单项行为。

- 顶栏：`width=900, height=68`
- 侧栏外框：`x=12, width=188`
- Prompt 列表：`x=206, width=384`
- Detail：`x=596, width=304`
- `document` 和 `body` 无 overflow，但 Detail 内部存在基线问题：
  - `.detail-toolbar` 的 `clientWidth` 约为 `261px`，`scrollWidth` 约为
    `590px`。
  - `.detail-actions` 的右边界约为 `x=1207.6`，超出当前 Detail 可视区域
    `x=900`。
- 因此 Preview/Edit/History 右侧操作在最小窗口不能同时显示。这是 Phase 0
  记录的 **known baseline defect**；Phase 0 不修复，但后续 Detail/Shell
  阶段不得恶化，并应按 Epic #60 的窄窗口验收目标消除。

### 720×600 断点

采集组合：Light/English 和 Dark/简体中文；普通媒体设置。另有三张
`900×600` Light/English 的单项 prefers-* 截图，见上面的截图证据。

- 顶栏高度约 `97.8px`，`flex-wrap: wrap` 生效。
- Search 独占第二行：`x≈11.2, width≈697.6, height=32`。
- 侧栏外框：`x=12, width=172`。
- Prompt 列表：`x=190, width=530`。
- Detail 的 computed `display` 为 `none`，第二个 pane resizer 也隐藏。
- `document` 和 `body` 无 overflow。
- 该样本验证的是浏览器/CSS 断点；由于 Tauri `minWidth=900`，不能把它
  解释为打包 App 的实际窗口尺寸。

## 系统设置验证

在 `900×600` Light/English 样本中，三个系统设置分别启用；每次只模拟一个
特性，对应截图见“单项 macOS 辅助功能媒体设置”：

- `prefers-reduced-transparency: reduce`：命中；Prompt Toolbar 和 Project Sidebar
  的 `backdrop-filter` 为 `none`，仍保留实体背景和边框。
- `prefers-contrast: more`：命中；边框和弱文本使用增强后的语义 token。
- `prefers-reduced-motion: reduce`：命中；transition/animation 被压缩到
  `0.01ms`，页面仍保持可用。
- document/body 没有新增 overflow。

这些是现有 CSS 的运行时结果，不代表未来 Rail/Shelf 的验收已经完成。

## 功能状态样本矩阵

本节把 Issue #61 要求的“功能状态样本”写成可执行记录。每条记录都固定为：
**入口 / 呈现 / 取消或失败后的恢复 / 证据**。浏览器 fixture 能安全复现的
状态使用截图；依赖真实文件系统、Tauri 或异步竞态的状态明确标为
`contract test only`，并指向具体测试行为，而不是只列测试文件名。

### Scope、项目和筛选

- **无项目**：入口是将 `library.projects` 置空；呈现应为选择项目的空状态，
  不显示伪造的 Prompt 列表；恢复入口是 Add Project/Locate Folder，locale
  切换只翻译文案；证据为 `tests/core-ui-localization.test.ts` 的
  `no-project empty state renders in English and Chinese`（contract test only）。
- **单项目、多项目、All Projects**：入口分别是 `engineering`、`writing`、
  `research` 和 All Projects；呈现为当前 scope 的选中 tint、项目名称、数量
  和对应列表。切换到具体 Project 会执行 `setActiveProject(path)`：清空当前
  Prompt selection、`externalChangeState`、Folder、Tag，并把 Smart View 重置
  为 `all`；该函数本身不重置 `searchQuery`、`modelFilter` 或 `viewMode`。
  进入 All Projects 会执行 `setAllProjectsScope()`：切换 scope、清空
  `folderFilter` 后刷新全局列表。此时 selected Prompt 是否保留或重载由
  `decideSelectedRefresh` 根据 Prompt 是否仍存在、editor 是否 dirty 和
  `reloadSelected` 决定：不是无条件保留 selection。两条路径都继续经过
  dirty-navigation guard；All Projects + 两项选择的实际观察见
  [Batch 截图](phase0/900x600-light-en-all-projects-batch.png)。证据包括
  `src/lib/library.svelte.ts`、`src/lib/library/refresh-selected.ts`、
  `tests/core-ui-localization.test.ts` 的 sidebar/library states，以及
  `tests/all_projects_search.mjs` 的跨项目同名与 tag 搜索契约。
- **Smart View、Folder、Tag、组合筛选、无匹配**：入口是 All、Needs Attention、
  Favorites、Draft、Archived、Folder/Tag、Search、Sort、Model Filter；
  呈现必须保留 active scope、结果计数、selected row 和 no-matching 提示。
  精确组合规则是：Search 始终独立组合；只有 Needs Attention 可以和 Folder
  或 Tag 组合；Folder 与 Tag 互斥；Favorites、Draft、Archived、All 会清除
  Folder/Tag；在非 Needs Attention 下点击 Folder/Tag 会回到
  `smartView = all`。取消/恢复是清除搜索或筛选回到当前 scope；这些规则以
  `src/lib/library/navigation-state.ts` 和 `tests/navigation_state.mjs` 为
  精确 contract，`prompts-ux.md` 中“combines with ... other filters”属于
  过宽的概要描述；无匹配和空结果证据还包括
  `tests/core-ui-localization.test.ts` 的 `no-prompts-yet and no-matching
  states` 与 `tests/visible_filter.mjs`。

### Prompt 内容和密度

- **普通 Prompt、长标题、长摘要、长标签、emoji**：入口是从列表打开 Prompt
  Detail，或在 Edit 中输入用户内容；呈现优先级为 name > description/body
  excerpt > folder/tags/status > variable count/modified time，用户内容
  `Review 中文 PR 🚀`、中文标签、混合脚本和 emoji 不得被 i18n 覆盖。恢复是
  切换 locale 后保持原值，保存只提交真实字段变化；证据为
  `tests/locale-user-data-isolation.test.ts` 的 multilingual/emoji fixture
  和 locale isolation assertions。长内容的实际窄窗口观察见
  [长内容 Edit 截图](phase0/900x600-light-en-edit-long-content-emoji.png)；
  长标题的输入裁切见
  [长标题 Rename 截图](phase0/900x600-light-en-rename-long-title.png)，其中
  右侧 inspector 和 dialog 的可视边界被记录为后续验收输入。
- **List/Grid、选中、批量选择和批量操作**：入口是 List/Grid 控件、行选择
  按钮和 toolbar 的 Select all；呈现是 row/card 的 selected tint、`2 selected`
  计数、Favorite/Archive/Active/tag/Delete/Cancel action。scope 变化会清空
  `selectedKeys`，结果筛选变化会剔除不可见的 selection；取消是 Cancel 或
  清空选择。批量写入按文件独立执行，允许 partial success，并逐项报告失败的
  project/name path；它不是 all-or-nothing transaction。实际观察见
  [All Projects + Batch 截图](phase0/900x600-light-en-all-projects-batch.png)，
  行为证据为 `src/lib/components/library/PromptLibrary.svelte`、
  `src/lib/library.svelte.ts` 的 `batchUpdate`/`batchDelete`、
  `tests/core-ui-localization.test.ts` 的 `batch toolbar counts translate`
  和现有 smoke contract。

### Detail、编辑和历史

- **Preview**：入口是列表 row，再点击 Prompt Detail 的 Preview tab；呈现为
  selected row、标题/path、Copy/Reveal、Preview selected tab、metadata 和
  Markdown 内容；恢复是切换其他 tab 或返回列表，不清空 selection；实际观察见
  [selected Preview 截图](phase0/900x600-light-en-preview-selected.png)，
  语言契约见 `tests/full-ui-localization.test.ts` 的 Prompt Detail shell。
- **Edit / clean / dirty**：入口是 Edit tab；clean 时 Save disabled，输入
  Markdown 或 metadata 后呈现 dirty dot、可用 Save 和 editor focus；取消/失败
  时保留 buffer，保存成功后回到 clean；实际观察见
  [dirty Edit 截图](phase0/900x600-light-en-edit-dirty.png)，行为证据为
  `tests/full-ui-localization.test.ts` 的 `dirty state survives a locale switch`
  和 `tests/unsaved-navigation.test.ts` 的 `makeEditorDirty` flow。
- **History / Compare**：入口分别是 History tab 和 Compare… action；呈现是
  History empty/repository message 或临时 Compare overlay，不把 Compare 变成
  永久主 tab；关闭 Compare 后恢复原 Detail tab；实际观察见
  [History 截图](phase0/900x600-light-en-history.png) 和
  [Compare 截图](phase0/900x600-light-en-compare.png)，差异算法契约见
  `tests/compare_contract.mjs`。
- **Reload / Keep editing / save conflict / external file missing**：
  入口是 dirty editor 后点击其他 row、Refresh 或收到外部文件变化；呈现为
  app-owned ConfirmDialog、dirty dot 或 conflict/missing 分支；Cancel/Keep
  editing 关闭对话框并保持 buffer，Discard/Reload 才继续导航或替换内容；
  证据为 `tests/unsaved-navigation.test.ts` 的 Cancel/Discard/reload/menu
  流程和 `tests/refresh_selected.mjs` 的 dirty buffer/file_missing 分支
  （contract test only）。

### 异常、辅助信息和管理操作

- **missing project、frontmatter warning、Health**：入口是 machine state
  `PROJECT_FOLDER_NOT_FOUND`、frontmatter/health 派生状态；呈现为明确的
  missing banner、warning/error severity、路径或诊断 detail，而不是只改变
  透明度；恢复是 Locate Folder、Reload 或修正文件后重新扫描；证据为
  `tests/missing-project-recovery.test.ts`、`tests/health_contract.mjs` 和
  `tests/full-ui-localization.test.ts` 的 health localization
  （contract test only）。
- **Variables、Examples、Related、Variant**：入口是 Detail 的对应 section；
  呈现为可识别的变量、example rows、related links、variant family 和
  warning/error 状态；取消/失败应留在当前 section 并保留已填内容。变量复制
  失败时 dialog 和 focus 都必须保留；证据为
  `tests/variable-fill.test.ts`、`tests/examples_hardening.test.ts`、
  `tests/relation_contract.mjs`、`tests/variant_contract.mjs`。
- **Project Menu、Rename、Forget、New Prompt、Confirm、Compare**：
  入口是项目行 context menu、New、Refresh action 或 Compare action；呈现是
  modal/menu 的明确按钮语义、初始 focus 和稳定 z-index。Cancel/Escape 关闭
  最内层 overlay；失败不丢输入；实际观察见
  [New Prompt 截图](phase0/900x600-light-en-new-prompt.png) 和
  [Compare overlay 截图](phase0/900x600-light-en-compare.png)，路由证据为
  `tests/tauri-dialog-routing.test.ts`、`tests/name-dialog.test.ts`、
  `tests/modal-shortcuts.test.ts`。
- **Update Banner**：仅 packaged app 使用；入口是 updater 的
  `available`、`downloading`、`checking`、`uptodate` 或 `error` 状态。它由
  `+layout.svelte` 常驻挂载，是 bottom-right 的 fixed notification surface，
  `z-index: 190`，没有 backdrop、focus trap 或 Escape handler，也不接管全局
  Cmd/Ctrl+N/F/S。`available` 使用 `role="dialog"`，提供 Update & restart
  和显式 × dismiss；`downloading` 使用 `role="status"` 并显示 progress；
  `checking`、`uptodate`、`error` 都是 status presentation；`idle` 不渲染。
  Reduce Transparency 时保留实体背景 fallback。失败/取消恢复为当前主界面，
  不得把 Banner 改成 modal 或阻塞编辑；证据为
  `src/lib/components/UpdateBanner.svelte`、`src/routes/+layout.svelte` 和
  `PromptsView.hasOpenModal()`。

### 视觉状态和键盘状态对照

- **selected / focus**：selected row、selected Preview/History tab 及当前
  focused control 已在代表性截图和 accessibility snapshot 中确认。
- **hover / pressed**：这是瞬时状态，当前使用现有 `app.css` 的 `:hover` /
  `:active` 选择器和点击后 accessibility state 做观察记录；后续实现 PR 必须
  对 Rail、Shelf、row、primary action 各留一张人工 hover/pressed 检查结果，
  不得用“没有截图”代替验收。
- **disabled / busy**：New Prompt 的 AI naming disabled、Edit 的 Save disabled
  和例子移动按钮 disabled 已在 snapshot 中确认；AI naming busy 使用 deferred
  request，Cancel 仍可用，证据为 `tests/new-prompt-dialog.test.ts` 的
  `keeps Cancel available while naming is busy` 与
  `blocks naming while clearing credentials is pending`。
- **warning / error**：列表中 warning chip、missing project banner、AI naming
  failure 和 health severity 必须同时有文字/结构/颜色信号；证据见上方异常项。
- **dirty**：编辑器值变化后 dirty dot 与 Save enabled；locale 切换不清空
  buffer；截图和 `full-ui-localization.test.ts` / `unsaved-navigation.test.ts`
  共同锁定该状态。
- **Cmd/Ctrl+N、Cmd/Ctrl+F、Cmd/Ctrl+S、Escape、Enter**：无 keyboard-owning
  menu/dialog 时 N/F/S 作用于 New/Search/Save；有 menu/dialog 时快捷键让位，
  Escape 关闭最内层，Enter 提交 modal。Update Banner 不属于
  `hasOpenModal()`，因此出现 Banner 不会触发 modal keyboard isolation；证据为
  `tests/unsaved-navigation.test.ts`、`tests/modal-shortcuts.test.ts` 和
  `tests/name-dialog.test.ts`。

浏览器 fixture 适合验证正常浏览、筛选和编辑显示，但不包含真实
invalid-frontmatter、missing-folder、filesystem conflict 等全部异常状态。
这些状态的后续手工验收必须使用隔离的临时项目或打包 App，不能修改仓库内
用户 Prompt 文件。

## 后续阶段必须保持的行为

- Project path 是 Project 身份；relative Markdown path 是 Prompt 身份。
- Search、Project、Folder、Tag、Smart View、Sort、List/Grid、Batch 和 pane
  resize 语义不变；Navigation compatibility rule 以
  `navigation-state.ts`/`navigation_state.mjs` 为准：Search 独立组合，只有
  Needs Attention 可与 Folder/Tag 组合，Folder 与 Tag 互斥，Favorites/Draft/
  Archived/All 清除 Folder/Tag，非 Needs Attention 下 Folder/Tag 回到 All。
- 具体 Project 切换清空 Prompt selection、external-change state、Folder、Tag
  并重置 Smart View；All Projects 切换的 selection 由 selected-refresh decision
  决定，不得被统一实现为 selection preservation。
- Batch selection 不跨 library scope 生存；筛选后不可见项会被剔除。Batch
  writes 按文件独立执行，partial success 合法，失败路径必须准确报告，不得
  改成跨 scope selection 或伪装成 all-or-nothing transaction。
- Preview/Edit/History 保持在 Prompt Detail 内；Compare 仍是临时视图。
- dirty editor、冲突检测、Reload/Keep editing、missing project 恢复路径不变。
- Update Banner 保持 packaged-app-only、bottom-right fixed、`z-index: 190`、
  no backdrop、no focus trap、no Escape handler、non-modal keyboard semantics；
  Overlay plane 是视觉 z-layer，不代表其中每个成员都是 modal。
- Tauri 路径继续使用 app-owned Dialog，不重新引入浏览器原生
  `window.prompt`/`window.confirm`。
- locale 切换不清空 selection、filter、search、editor draft 或 dirty state。
- 不修改 Prompt、Project、Folder、Tag、Markdown、Git 内容，也不新增 sidecar。
- 内容层不使用逐行 blur；Reduce Transparency 时所有功能层仍然可读。

## 技术步骤风险矩阵

以下风险按“技术步骤 → 可能破坏的契约 → Phase 0 约束 → 必须提供的证据”
记录。没有对应证据时，风险项不能被标记为已关闭。

### R1：纯 CSS / token / material 变化（中风险）

- 可能破坏：Light/Dark 对比度、Reduce Transparency fallback、selected/
  focus/warning/error 的唯一可见信号、滚动性能。
- Phase 0 约束：内容层保持实体背景；玻璃只服务 Rail、Shelf、Toolbar、
  关键控件和 Overlay；不引入逐行 `backdrop-filter`。
- 证据：1440/1180/900/720 双主题截图、三张单项 prefers-* 截图、
  computed style、无 document overflow、`pnpm check`。

### R2：DOM 重排 / Shell 几何变化（高风险）

- 可能破坏：pane resize、sticky header、滚动容器、窄窗口 Detail action、
  traffic lights safe area 和焦点顺序。
- Phase 0 约束：Phase 1 不改 DOM；Phase 2 才能重排 Shell，并先收起 Shelf
  再压缩正文；当前 `900×600` Detail overflow 是 defect，不得固化成正确行为。
- 证据：目标区域图、1440/1180/900/720 逐项截图、边界/scrollWidth/
  clientWidth 记录、keyboard/accessibility snapshot。

### R3：状态接线 / callback / dirty 生命周期（高风险）

- 可能破坏：Project/Folder/Tag/Search/Batch、Preview/Edit/History、保存、
  conflict、external change、locale 切换和异步响应归属。
- Phase 0 约束：布局组件只消费已有 props/callback；不复制状态机，不改变
  Prompt/Project/Markdown 数据模型，不在 Phase 2/3 偷改保存或 filesystem 数据流。
- 证据：本文件的功能状态矩阵、`unsaved-navigation`、
  `refresh_selected`、`full-ui-localization`、`variable-fill`、
  `examples_hardening` 等现有回归测试。

### R4：Tauri / macOS 窗口与 Dialog（高风险）

- 可能破坏：Overlay drag region、traffic lights、窗口最小尺寸、app-owned
  NamePromptDialog/ConfirmDialog、menu → modal z-index 和 focus trap，以及
  Update Banner 被误改成 modal 后的键盘抢占。
- Phase 0 约束：不改 `tauri.conf.json`、Rust/IPC 或原生窗口策略；不重新引入
  `window.prompt`/`window.confirm` 作为 Tauri 路径；Update Banner 不添加
  backdrop、focus trap 或 Escape handler。
- 证据：`tests/tauri-dialog-routing.test.ts`、
  `tests/titlebar-contract.test.ts`、`tests/modal-shortcuts.test.ts`，以及
  Phase 7 的打包 App 手工 smoke。

### R5：发布 / 构建 / 签名验证（中风险）

- 可能破坏：bundle identifier、arm64 `.app`、updater artifact、签名设置或
  现有 `/Applications` 安装内容。
- Phase 0 约束：只记录浏览器基线；不构建、不安装、不覆盖现有 App，不修改
  release signing 配置。
- 证据：Phase 6 的 frontend/backend checks，Phase 7 的
  `pnpm tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`
  和未签名本地产物限制说明。

## Phase 1–7 依赖与进入门槛

这些 gate 是硬门槛：前一阶段的退出证据不完整时，不开始下一阶段；任何阶段
都不得跨阶段顺手改变数据流、Rust/filesystem 或用户文件。

### Phase 0 — 基线冻结（本 PR）

- 前置：无。
- 必须交付：exact baseline、工作区/环境、双主题和双 locale 的 viewport
  矩阵、单项 prefers-* 样本、功能状态矩阵、当前/目标 A 区域图、风险矩阵。
- 退出 gate：截图可追溯且人工检查；状态有入口/呈现/恢复/证据；已知 defect
  与正确行为边界清楚；`git diff --check` 通过。

### Phase 1 — Design Tokens 与材质契约

- 前置：Phase 0 全部交付并被 review 接受。
- 允许范围：只改 surface/text/border/radius/shadow/z-index 等 token、实体
  fallback、material contract 和 prefers-* CSS；不改 DOM、布局、callback、
  状态机或业务数据。
- 退出 gate：Light/Dark/三项辅助功能可读；无布局重排；`pnpm check`、
  `pnpm test:smoke`、`pnpm build` 通过。

### Phase 2 — Shell、Rail、Floating Shelf

- 前置：Phase 1 token/fallback 稳定。
- 允许范围：才可重排 `PromptsView` / `ProjectSidebar` 的展示结构，Shelf
  展开/收起只保存在 UI 层；复用现有 Project、Folder、Tag、Search 和 Dialog
  callback，不改数据流。
- 退出 gate：Rail/Shelf 区域图在 1440/1180/900/720 可解释，pane resize、
  keyboard order、menu → modal 层级和既有导航测试通过。

### Phase 3 — Browse：Prompt List 与 Detail Preview

- 前置：Phase 2 Shell 几何和导航稳定。
- 允许范围：只调整 List toolbar、List/Grid、selected/hover/warning/status
  及 Preview 阅读层；不改保存、搜索索引或 Markdown 序列化。
- 退出 gate：Search/Sort/Model/List/Grid/Batch、empty/no-match/missing 和
  长中文/emoji/长标签截图与测试通过；正文没有逐行玻璃。

### Phase 4 — Edit：正文主画布与 Metadata Inspector

- 前置：Phase 3 Preview 稳定。
- 允许范围：重排 Edit 视觉层和 Inspector sections；保留 dirty/save/
  conflict/reload 生命周期、字段和用户内容。
- 退出 gate：Save disabled/saving/success/conflict/error、locale 切换、切换
  Prompt/Project 的 buffer 归属，以及 Examples/Variables/Related/Variant
  测试通过。

### Phase 5 — Overlay、Menu、Dialog 与状态动画

- 前置：Phase 4 Edit/dirty/conflict 稳定。
- 允许范围：统一 Project Menu、Name Prompt、Confirm、Compare 的 modal/menu
  material/z-index/focus，以及 Update Banner 的独立 surface material/z-index；
  只添加可取消的短过渡，不改变 Tauri 路由。Update Banner 不得新增 backdrop、
  focus trap、Escape handler 或 global keyboard ownership。
- 退出 gate：Escape/Enter/backdrop/cancel/busy/disabled、menu 先关闭再开
  modal、app-owned dialog 和快捷键隔离测试通过；Update Banner 的 non-modal
  keyboard semantics 以及 Reduce Motion 不依赖动画。

### Phase 6 — i18n、Accessibility 与性能收口

- 前置：Phase 2–5 结构不再变动。
- 允许范围：双语言、Tab/aria/focus-visible、三项 prefers-*、滚动/搜索/
  dialog 性能与有限玻璃面清理；不做无关旧代码清理或数据重写。
- 退出 gate：`pnpm check`（0 errors / 0 warnings）、`pnpm test:smoke`、
  `pnpm build`、`git diff --check` 通过，浏览器无 console error、clipping
  或 document overflow。

### Phase 7 — Tauri 打包与发布前验收

- 前置：Phase 6 自动检查全部通过。
- 允许范围：只做无 updater artifact 的本地 `.app` 构建、traffic lights/
  drag region/窗口缩放和关键状态 smoke；不安装覆盖、不改签名配置。
- 退出 gate：浏览器与打包 App 的关键布局/交互一致，arm64 bundle 信息、
  未签名限制、before/after 截图和未解决问题均记录，之后才可关闭 Epic
  对应阶段。

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

本地 macOS 验证结果（2026-09-15，Darwin 27.0.0）：

- `pnpm check`：通过，0 errors / 0 warnings。
- `pnpm test:smoke`：通过，16 个 Vitest 文件、168 个测试，以及全部
  `.mjs` contract scripts 通过。
- `pnpm build`：通过；Vite 报告的 `INEFFECTIVE_DYNAMIC_IMPORT` 来自现有
  `src/lib/api.ts` 与 Tauri API 的混合导入，本次没有改动相关代码。
- `cd src-tauri && cargo test --lib`：通过，143 passed / 0 failed；保留
  现有 `src/prompts/store.rs:1974 unused_mut` warning。
- `git diff --check`：通过。

GitHub Actions 的 frontend/backend job 在 Linux/Ubuntu 环境运行，warning 集合
不应与本地 macOS 相同；backend 可能额外出现既有 platform/cfg 相关的
dead-code warning。应分别记录本地 warning 与 CI job conclusion，不能把
“本地只有一条 warning”解释为 CI stderr 的完整预期，也不能把 warning
误报为测试失败。本次 review 观察到 PR 的 frontend/backend job 均成功。

视觉证据仍需结合本文的运行时测量和后续阶段的浏览器/打包 App 手工 smoke；
自动化检查通过不能替代 viewport、主题、系统设置和 macOS 窗口验收。
