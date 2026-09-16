/**
 * Phase 1 浮岛书架基础的 CSS 材质契约。
 *
 * 这是源码契约而不是 computed-style 测试：jsdom 不实现 backdrop-filter
 * 和系统偏好媒体查询；浏览器 computed-style 检查仍属于手工 UI 验证。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appCss = readFileSync(join(root, 'src/app.css'), 'utf8');
const updateBanner = readFileSync(
  join(root, 'src/lib/components/UpdateBanner.svelte'),
  'utf8'
);

function readSvelteSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readSvelteSources(path);
    return entry.isFile() && entry.name.endsWith('.svelte')
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}

const materialCss = [appCss, ...readSvelteSources(join(root, 'src'))].join('\n');

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

function selectorsWithValue(source, value) {
  const property = '(?:-webkit-)?backdrop-filter';
  const pattern = new RegExp(
    `([^{}]+)\\{[^{}]*${property}\\s*:\\s*${value}`,
    'g'
  );
  return [...source.matchAll(pattern)].map((match) => match[1].trim());
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
  /^\s*-webkit-backdrop-filter\s*:\s*blur\(var\(--glass-blur\)\)/m.test(materialCss),
  'WebKit blur is declared'
);
assert(
  /^\s*backdrop-filter\s*:\s*blur\(var\(--glass-blur\)\)/m.test(materialCss),
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
const blurredSelectors = selectorsWithValue(
  materialCss,
  'blur\\(var\\(--glass-blur\\)\\)'
).join('\n');
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
  '.library-rail',
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
const noneSelectors = selectorsWithValue(materialCss, 'none').join('\n');
for (const fallbackSelector of [
  '.prompt-toolbar',
  '.library-rail',
  '.project-sidebar',
  '.modal',
  '.project-menu',
  '.update-banner',
]) {
  assert(
    noneSelectors.includes(fallbackSelector),
    `${fallbackSelector} has a reduced-transparency blur fallback`
  );
}

console.log('surface consumers');
assert(
  appCss.includes('grid-template-columns: var(--rail-width) var(--sidebar-width) 6px'),
  'workspace keeps separate Rail and Shelf columns'
);
assert(
  appCss.includes('.library-workspace--shelf-collapsed'),
  'workspace has a UI-only collapsed Shelf layout'
);
assert(
  /\.project-sidebar--collapsed\s*\{[^}]*visibility:\s*hidden/s.test(appCss),
  'collapsed Shelf retains its grid slot'
);
assert(
  /\.pane-resizer:disabled\s*\{[^}]*pointer-events:\s*none/s.test(appCss),
  'collapsed Shelf resizer is inert'
);
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
assert(
  /@supports[\s\S]*?\.prompt-toolbar select\s*\{[^}]*background:\s*var\(--surface-regular-glass\)/s.test(
    appCss
  ),
  'Toolbar filters use the regular glass surface when supported'
);
assert(
  /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.prompt-toolbar select\s*\{[^}]*background:\s*var\(--surface-regular\)/s.test(
    appCss
  ),
  'Toolbar filters restore the regular surface for reduced transparency'
);

console.log(failures === 0 ? 'material contract: ok' : `material contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
