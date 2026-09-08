/**
 * Simplified Chinese catalog.
 *
 * `satisfies Record<MessageKey, string>` makes TypeScript fail the build if
 * this catalog ever drifts from the English key set — a missing or extra key
 * is a compile error, exactly the static parity guarantee Issue #35 asks for.
 *
 * Language self-names stay unchanged on purpose (English / 简体中文) so the
 * selector remains reachable after switching away from English.
 *
 * zh-CN has no plural distinction (Intl.PluralRules always returns `other`),
 * so `*.one` / `*.other` entries carry the same text — that repetition keeps
 * the key parity statically type-checked.
 */

import type { MessageKey } from './en';

export const zhCN = {
  // App shell — language selector.
  'app.language': '语言',
  'locale.system': '跟随系统',
  'locale.en': 'English',
  'locale.zhCN': '简体中文',

  // Missing-project recovery UI (display copy only; branch is driven by code).
  'error.projectFolderNotFound': '项目文件夹未找到',
  'project.missing.hint': '请从项目侧边栏重新定位该文件夹，或移除该项目。',
  'project.missing.locate': '重新定位文件夹',
  'project.missing.forget': '移除',

  // App shell — header & footer. Brand `Promptarium` stays untranslated.
  'shell.theme.dark': '深色',
  'shell.theme.light': '浅色',
  'shell.checkForUpdates': '检查更新',
  'shell.updateTo': '更新到 v{version}',
  'shell.footer.tagline': '提示词库{version} — 本地优先的 Markdown 提示词库，按项目组织',

  // Library topbar (workspace chrome).
  'topbar.title': '提示词库',
  'topbar.search.placeholder': '搜索全部提示词…',
  'topbar.search.aria': '搜索全部提示词',
  'topbar.refresh': '刷新提示词库',
  'topbar.scope.fallbackProject': '项目',
  'topbar.scope.localWorkspace': '本地 Markdown 工作区',

  // Project sidebar.
  'sidebar.nav.aria': '提示词库导航',
  'sidebar.projects': '项目',
  'sidebar.addProject': '添加项目',
  'sidebar.addProject.placeholder': '粘贴文件夹路径…',
  'sidebar.browse': '浏览',
  'sidebar.add': '添加',
  'sidebar.locate': '重新定位',
  'sidebar.allProjects': '全部项目',
  'sidebar.allProjects.title': '在所有已注册项目中搜索提示词',
  'sidebar.empty': '添加一个文件夹来开始你的提示词库。',
  'sidebar.smartViews': '智能视图',
  'sidebar.allPrompts': '全部提示词',
  'sidebar.needsAttention': '需要处理',
  'sidebar.favorites': '收藏',
  'sidebar.draft': '草稿',
  'sidebar.archived': '已归档',
  'sidebar.folders': '文件夹',
  'sidebar.newFolder': '新建文件夹',
  'sidebar.folder.title': '右键可重命名或删除空文件夹',
  'sidebar.folders.empty': '文件夹来自你的项目目录结构。',
  'sidebar.tags': '标签',
  'sidebar.tags.empty': '标签来自提示词的 frontmatter。',
  'sidebar.newPrompt': '新建提示词',
  'sidebar.failedRefresh.one': '{count} 个项目刷新失败',
  'sidebar.failedRefresh.other': '{count} 个项目刷新失败',

  // Folder / project dialogs. 路径、文件夹名、项目名等参数保持原样，不翻译。
  'dialog.folderPath.browserDev': '文件夹路径（仅浏览器开发模式）：',
  'dialog.chooseProjectFolder': '选择一个提示词项目文件夹',
  'dialog.folderPathInsideProject': '项目内文件夹路径',
  'dialog.folderAction': '文件夹操作：输入 rename 或 delete',
  'dialog.newFolderPath': '新文件夹路径',
  'dialog.deleteEmptyFolder': '删除空文件夹“{folder}”？',
  'dialog.forgetMissingProject': '移除此丢失的项目？不会删除任何文件。',
  'dialog.projectLabel': '项目名称',
  'dialog.forgetProject': '移除“{name}”？文件夹和所有 Markdown 文件都会保留在磁盘上。',
  'dialog.batchDeleteFiles': '删除这些 Markdown 文件？\n\n{list}\n\n此操作无法撤销。',

  // Project context menu.
  'menu.renameLabel': '重命名…',
  'menu.revealInFinder': '在访达中显示',
  'menu.projectColor': '项目颜色',
  'menu.useColor': '使用 {color}',
  'menu.clearColor': '清除',
  'menu.forgetProject': '移除项目…',

  // Prompt library states.
  'library.section.aria': '提示词库',
  'library.list.aria': '提示词',
  'library.refreshing': '正在刷新…',
  'library.chooseProject': '选择一个提示词项目',
  'library.emptyNoProjects': '从侧边栏添加一个文件夹，其中的每个 Markdown 文件都会成为一个提示词。',
  'library.addFirstPrompt': '添加第一个提示词',
  'library.noMatching': '没有匹配的提示词',
  'library.noPromptsYet': '暂无提示词',
  'library.tryAnotherSearch': '尝试其他搜索条件或清除筛选。',
  'library.createFirstPrompt': '新建一个 Markdown 提示词来开始构建你的提示词库。',

  // Prompt list items.
  'library.select.aria': '选择 {name}',
  'library.noDescription': '暂无描述',
  'library.projectRoot': '项目根目录',
  'library.variables.one': '{count} 个变量',
  'library.variables.other': '{count} 个变量',

  // Prompt toolbar — 批量操作、排序/视图。内部枚举值不翻译，仅展示文案。
  'toolbar.selectedCount': '已选择 {count} 项',
  'toolbar.selectAll': '全选',
  'toolbar.favorite': '收藏',
  'toolbar.unfavorite': '取消收藏',
  'toolbar.archive': '归档',
  'toolbar.active': '使用中',
  'toolbar.tagPlaceholder': '标签',
  'toolbar.addTag': '添加标签',
  'toolbar.removeTag': '移除标签',
  'toolbar.delete': '删除',
  'toolbar.cancel': '取消',
  'toolbar.count.one': '个提示词',
  'toolbar.count.other': '个提示词',
  'toolbar.countOf': '/ 共 {total} 个',
  'toolbar.sort.aria': '提示词排序',
  'toolbar.sort.modifiedDesc': '最近修改',
  'toolbar.sort.modifiedAsc': '最早修改',
  'toolbar.sort.nameAsc': '名称 A–Z',
  'toolbar.sort.nameDesc': '名称 Z–A',
  'toolbar.sort.favoriteFirst': '收藏优先',
  'toolbar.filterModel.aria': '按模型筛选',
  'toolbar.allModels': '全部模型',
  'toolbar.viewMode.aria': '视图模式',
  'toolbar.listView': '列表视图',
  'toolbar.gridView': '网格视图',

  // New-prompt dialog（核心创建入口）。
  'newPrompt.close': '关闭',
  'newPrompt.project': '项目',
  'newPrompt.filename': '文件名',
  'newPrompt.filenameHint': '相对路径，不含 .md',
  'newPrompt.body': '提示词 Markdown',
  'newPrompt.body.placeholder': '输入提示词正文…',
  'newPrompt.description': '描述',
  'newPrompt.description.placeholder': '这个提示词用来做什么？',
  'newPrompt.status': '状态',
  'newPrompt.status.active': '使用中',
  'newPrompt.status.draft': '草稿',
  'newPrompt.status.archived': '已归档',
  'newPrompt.tags': '标签',
  'newPrompt.commaSeparated': '逗号分隔',
  'newPrompt.models': '模型',
  'newPrompt.created': '创建日期',
  'newPrompt.favorite': '收藏',
  'newPrompt.cancel': '取消',
  'newPrompt.create': '创建提示词',
  'newPrompt.creating': '创建中…',
  'newPrompt.error.filename': '请输入提示词文件名。',
  'newPrompt.error.project': '请为这个提示词选择一个项目。',

  // Core-path notices (toasts).
  'notice.projectLocated': '已重新定位项目文件夹。',
  'notice.projectAdded': '项目已添加。',
  'notice.addProjectFirst': '请先添加一个提示词项目。',
  'notice.projectForgottenKept': '项目已移除，文件仍保留在磁盘上。',
  'notice.projectForgottenMissing': '项目已移除，文件未做任何改动。',
  'notice.projectLabelUpdated': '项目名称已更新。',
  'notice.promptCreated': '提示词已创建。',
  'notice.enterTagFirst': '请先输入标签。',
  'notice.batchUpdated.one': '{count} 个提示词已更新。',
  'notice.batchUpdated.other': '{count} 个提示词已更新。',
  'notice.batchFailures': '{count} 个已更新，失败：{failures}',
  'notice.fsWatchUnavailable': '自动刷新不可用：{detail}。聚焦或手动刷新仍然可用。',

  // Pane resizers.
  'panes.resizeSidebar.aria': '调整项目侧边栏宽度',
  'panes.resizeLibrary.aria': '调整提示词库宽度',
} satisfies Record<MessageKey, string>;
