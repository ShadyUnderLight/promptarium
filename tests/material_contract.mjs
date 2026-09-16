/**
 * Phase 1 浮岛书架基础的 CSS 材质契约。
 *
 * 这是源码契约而不是 computed-style 测试：jsdom 不实现 backdrop-filter
 * 和系统偏好媒体查询；浏览器 computed-style 检查仍属于手工 UI 验证。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appCss = readFileSync(join(root, 'src/app.css'), 'utf8');
const updateBanner = readFileSync(
  join(root, 'src/lib/components/UpdateBanner.svelte'),
  'utf8'
);
const materialCss = `${appCss}\n${updateBanner}`;

const requiredTokens = [
  '--surface-content',
  '--surface-regular',
  '--surface-prominent',
  '--surface-overlay',
  '--surface-regular-glass',
  '--surface-prominent-glass',
  '--surface-overlay-glass',
  '--glass-blur',
  '--glass-highlight',
  '--shadow-sidebar',
  '--shadow-overlay',
  '--rail-width',
  '--shelf-width',
  '--content-gap',
  '--surface-margin',
  '--z-shell',
  '--z-list',
  '--z-detail',
  '--z-shelf',
  '--z-toolbar',
  '--z-overlay',
  '--z-context-backdrop',
  '--z-context-menu',
  '--z-update',
  '--z-toast',
];

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

function selectorsWithBackdropFilter(source) {
  return [...source.matchAll(/([^{}]+)\{[^{}]*(?:-webkit-)?backdrop-filter\s*:/g)].map(
    (match) => match[1].trim()
  );
}

console.log('material tokens');
for (const token of requiredTokens) {
  assert(appCss.includes(`${token}:`), `missing ${token}`);
}

console.log('material fallbacks and system preferences');
assert(
  appCss.includes('@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'),
  'app.css keeps the progressive-enhancement supports guard'
);
assert(
  materialCss.includes('-webkit-backdrop-filter: blur(var(--glass-blur))'),
  'WebKit blur is declared'
);
assert(
  materialCss.includes('backdrop-filter: blur(var(--glass-blur))'),
  'unprefixed blur is declared'
);
assert(
  materialCss.includes('@media (prefers-reduced-transparency: reduce)'),
  'reduced-transparency fallback is declared'
);
assert(
  appCss.includes('@media (prefers-contrast: more)'),
  'increased-contrast overrides are declared'
);
assert(
  appCss.includes('@media (prefers-reduced-motion: reduce)'),
  'reduced-motion overrides are declared'
);
assert(
  updateBanner.includes('background: var(--surface-overlay);'),
  'Update Banner has an opaque overlay fallback'
);

console.log('blur boundaries');
const blurredSelectors = selectorsWithBackdropFilter(materialCss).join('\n');
for (const forbiddenSelector of [
  '.prompt-list-item',
  '.markdown-preview',
  '.prompt-editor',
  '.prompt-history',
  '.history-diff-panel',
  '.diff-viewer',
]) {
  assert(
    !blurredSelectors.includes(forbiddenSelector),
    `${forbiddenSelector} must not use backdrop-filter`
  );
}
for (const allowedSelector of [
  '.prompt-toolbar',
  '.project-sidebar',
  '.modal',
  '.project-menu',
  '.update-banner',
]) {
  assert(
    blurredSelectors.includes(allowedSelector),
    `${allowedSelector} is an approved blur consumer`
  );
}

console.log('surface consumers');
assert(
  /\.prompt-library\s*\{[^}]*background:\s*var\(--surface-content\)/s.test(appCss),
  'Prompt Library uses the content surface'
);
assert(
  /\.prompt-detail\s*\{[^}]*background:\s*var\(--surface-content\)/s.test(appCss),
  'Prompt Detail uses the content surface'
);
assert(
  /\.prompt-editor\s*\{[^}]*background:\s*var\(--surface-content\)/s.test(appCss),
  'Prompt Editor uses the content surface'
);
assert(
  /\.project-menu\s*\{[^}]*background:\s*var\(--surface-overlay\)/s.test(appCss),
  'Project Menu uses the overlay surface'
);

console.log(failures === 0 ? 'material contract: ok' : `material contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
