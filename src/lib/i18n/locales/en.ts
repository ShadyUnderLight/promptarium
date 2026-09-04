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
 */

export const en = {
  // App shell — language selector.
  'app.language': 'Language',
  'locale.system': 'System',
  'locale.en': 'English',
  'locale.zhCN': '简体中文',

  // Missing-project recovery UI. This is the P0 seam: the branch is decided
  // by `library.errorCode` (machine state), and only the display copy lives
  // in the catalog.
  'error.projectFolderNotFound': 'Project folder not found',
  'project.missing.hint':
    'Locate the folder again from the project sidebar, or forget this project.',
  'project.missing.locate': 'Locate folder',
  'project.missing.forget': 'Forget',
} as const;

/** The canonical key set — every catalog must satisfy `Record<MessageKey, string>`. */
export type MessageKey = keyof typeof en;
