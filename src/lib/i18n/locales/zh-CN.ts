/**
 * Simplified Chinese catalog.
 *
 * `satisfies Record<MessageKey, string>` makes TypeScript fail the build if
 * this catalog ever drifts from the English key set — a missing or extra key
 * is a compile error, exactly the static parity guarantee Issue #35 asks for.
 *
 * Language self-names stay unchanged on purpose (English / 简体中文) so the
 * selector remains reachable after switching away from English.
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
} satisfies Record<MessageKey, string>;
