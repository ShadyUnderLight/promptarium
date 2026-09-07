/**
 * English catalog — the canonical key contract.
 *
 * Every other locale must satisfy the exact same key set
 * (see locales/zh-CN.ts). Keys are stable semantic paths
 * (`sidebar.projects`), never English copy, so adding a language never
 * requires a key rename.
 *
 * Language self-names (`locale.en`, `locale.zhCN`) are intentionally the
 * same in every catalog so a user can always find the switch back.
 *
 * Plural bases (`*.one` / `*.other`) are selected by `tPlural()` via
 * `Intl.PluralRules`; locales without the distinction (zh-CN is always
 * `other`) repeat the same text for both entries to keep key parity
 * type-checked. Machine enums (`PromptSort`, `PromptViewMode`, theme,
 * status) never appear here — only display copy does.
 */

export const en = {
  // App shell — language selector (#35).
  'app.language': 'Language',
  'locale.system': 'System',
  'locale.en': 'English',
  'locale.zhCN': '简体中文',

  // Missing-project recovery UI (#35 P0 seam — branch decided by
  // `library.errorCode`, only the display copy lives here).
  'error.projectFolderNotFound': 'Project folder not found',
  'project.missing.hint': 'Locate the folder again from the project sidebar, or forget this project.',
  'project.missing.locate': 'Locate folder',
  'project.missing.forget': 'Forget',

  // App shell — header & footer. Brand `Promptarium` stays untranslated.
  'shell.theme.dark': 'Dark',
  'shell.theme.light': 'Light',
  'shell.checkForUpdates': 'Check for updates',
  'shell.updateTo': 'Update to v{version}',
  'shell.footer.tagline': 'Prompt Library{version} — local-first Markdown prompts, organized by project',

  // Library topbar (workspace chrome).
  'topbar.title': 'Prompt Library',
  'topbar.search.placeholder': 'Search all prompts…',
  'topbar.search.aria': 'Search all prompts',
  'topbar.refresh': 'Refresh library',
  'topbar.scope.fallbackProject': 'Project',
  'topbar.scope.localWorkspace': 'Local Markdown workspace',

  // Project sidebar.
  'sidebar.nav.aria': 'Prompt Library navigation',
  'sidebar.projects': 'Projects',
  'sidebar.addProject': 'Add project',
  'sidebar.addProject.placeholder': 'Paste a folder path…',
  'sidebar.browse': 'Browse',
  'sidebar.add': 'Add',
  'sidebar.locate': 'Locate',
  'sidebar.allProjects': 'All Projects',
  'sidebar.allProjects.title': 'Search prompts across every registered project',
  'sidebar.empty': 'Add a folder to start your library.',
  'sidebar.smartViews': 'Smart Views',
  'sidebar.allPrompts': 'All prompts',
  'sidebar.needsAttention': 'Needs Attention',
  'sidebar.favorites': 'Favorites',
  'sidebar.draft': 'Draft',
  'sidebar.archived': 'Archived',
  'sidebar.folders': 'Folders',
  'sidebar.newFolder': 'New folder',
  'sidebar.folder.title': 'Right-click to rename or delete an empty folder',
  'sidebar.folders.empty': 'Folders appear from your project tree.',
  'sidebar.tags': 'Tags',
  'sidebar.tags.empty': 'Tags come from prompt frontmatter.',
  'sidebar.newPrompt': 'New prompt',
  'sidebar.failedRefresh.one': '{count} project could not refresh',
  'sidebar.failedRefresh.other': '{count} projects could not refresh',

  // Folder / project dialogs (window.prompt / window.confirm / Tauri dialog
  // titles). Paths, folder names and project names passed as params stay raw.
  'dialog.folderPath.browserDev': 'Folder path (browser-dev only):',
  'dialog.chooseProjectFolder': 'Choose a prompt project folder',
  'dialog.folderPathInsideProject': 'Folder path inside this project',
  'dialog.folderAction': 'Folder action: rename or delete',
  'dialog.newFolderPath': 'New folder path',
  'dialog.deleteEmptyFolder': 'Delete empty folder “{folder}”?',
  'dialog.forgetMissingProject': 'Forget this missing project? No files will be deleted.',
  'dialog.projectLabel': 'Project label',
  'dialog.forgetProject': 'Forget “{name}”? The folder and all Markdown files will stay on disk.',
  'dialog.batchDeleteFiles': 'Delete these Markdown files?\n\n{list}\n\nThis cannot be undone.',

  // Project context menu.
  'menu.renameLabel': 'Rename label…',
  'menu.revealInFinder': 'Reveal in Finder',
  'menu.projectColor': 'Project color',
  'menu.useColor': 'Use {color}',
  'menu.clearColor': 'Clear',
  'menu.forgetProject': 'Forget project…',

  // Prompt library states.
  'library.section.aria': 'Prompt library',
  'library.list.aria': 'Prompts',
  'library.refreshing': 'Refreshing…',
  'library.chooseProject': 'Choose a prompt project',
  'library.emptyNoProjects': 'Add a folder from the sidebar. Every Markdown file inside becomes a prompt.',
  'library.addFirstPrompt': 'Add your first prompt',
  'library.noMatching': 'No matching prompts',
  'library.noPromptsYet': 'No prompts yet',
  'library.tryAnotherSearch': 'Try another search or clear a filter.',
  'library.createFirstPrompt': 'Create a Markdown prompt to start building this library.',

  // Prompt list items.
  'library.select.aria': 'Select {name}',
  'library.noDescription': 'No description yet',
  'library.projectRoot': 'Project root',
  'library.variables.one': '{count} variable',
  'library.variables.other': '{count} variables',

  // Prompt toolbar — batch controls, sort/view chrome. Sort and view values
  // stay stable enums in code; only these labels localize.
  'toolbar.selectedCount': '{count} selected',
  'toolbar.selectAll': 'Select all',
  'toolbar.favorite': 'Favorite',
  'toolbar.unfavorite': 'Unfavorite',
  'toolbar.archive': 'Archive',
  'toolbar.active': 'Active',
  'toolbar.tagPlaceholder': 'tag',
  'toolbar.addTag': 'Add tag',
  'toolbar.removeTag': 'Remove tag',
  'toolbar.delete': 'Delete',
  'toolbar.cancel': 'Cancel',
  'toolbar.count.one': '{count} prompt',
  'toolbar.count.other': '{count} prompts',
  'toolbar.countOf': 'of {total}',
  'toolbar.sort.aria': 'Sort prompts',
  'toolbar.sort.modifiedDesc': 'Modified newest',
  'toolbar.sort.modifiedAsc': 'Modified oldest',
  'toolbar.sort.nameAsc': 'Name A–Z',
  'toolbar.sort.nameDesc': 'Name Z–A',
  'toolbar.sort.favoriteFirst': 'Favorites first',
  'toolbar.filterModel.aria': 'Filter by model',
  'toolbar.allModels': 'All models',
  'toolbar.viewMode.aria': 'View mode',
  'toolbar.listView': 'List view',
  'toolbar.gridView': 'Grid view',

  // New-prompt dialog (core creation entry point).
  'newPrompt.close': 'Close',
  'newPrompt.project': 'Project',
  'newPrompt.filename': 'Filename',
  'newPrompt.filenameHint': 'relative path, without .md',
  'newPrompt.body': 'Prompt Markdown',
  'newPrompt.body.placeholder': 'Write the prompt body…',
  'newPrompt.description': 'Description',
  'newPrompt.description.placeholder': 'What is this prompt for?',
  'newPrompt.status': 'Status',
  'newPrompt.status.active': 'Active',
  'newPrompt.status.draft': 'Draft',
  'newPrompt.status.archived': 'Archived',
  'newPrompt.tags': 'Tags',
  'newPrompt.commaSeparated': 'comma separated',
  'newPrompt.models': 'Models',
  'newPrompt.created': 'Created',
  'newPrompt.favorite': 'Favorite',
  'newPrompt.cancel': 'Cancel',
  'newPrompt.create': 'Create prompt',
  'newPrompt.creating': 'Creating…',
  'newPrompt.error.filename': 'Enter a filename for the prompt.',
  'newPrompt.error.project': 'Choose a project for this prompt.',

  // Core-path notices (toasts).
  'notice.projectLocated': 'Project folder located.',
  'notice.projectAdded': 'Project added.',
  'notice.addProjectFirst': 'Add a prompt project first.',
  'notice.projectForgottenKept': 'Project forgotten. Its files are still on disk.',
  'notice.projectForgottenMissing': 'Project forgotten. Its files were not changed.',
  'notice.projectLabelUpdated': 'Project label updated.',
  'notice.promptCreated': 'Prompt created.',
  'notice.enterTagFirst': 'Enter a tag first.',
  'notice.batchUpdated.one': '{count} prompt updated.',
  'notice.batchUpdated.other': '{count} prompts updated.',
  'notice.batchFailures': '{count} updated; failed: {failures}',
  'notice.fsWatchUnavailable': 'Automatic refresh unavailable: {detail}. Focus or manual Refresh still works.',

  // Pane resizers.
  'panes.resizeSidebar.aria': 'Resize project sidebar',
  'panes.resizeLibrary.aria': 'Resize prompt library',
} as const;

/** The canonical key set — every catalog must satisfy `Record<MessageKey, string>`. */
export type MessageKey = keyof typeof en;
