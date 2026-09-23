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
  '.detail-actions-menu',
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
  '.detail-actions-menu',
  '.update-banner',
]) {
  assert(
    noneSelectors.includes(fallbackSelector),
    `${fallbackSelector} has a reduced-transparency blur fallback`
  );
}

console.log('surface consumers');
assert(
  appCss.includes('grid-template-columns: var(--rail-width) var(--sidebar-effective-width) 6px'),
  'workspace keeps separate Rail and Shelf columns'
);
assert(
  appCss.includes('.library-workspace--shelf-collapsed'),
  'workspace has a UI-only collapsed Shelf layout'
);
assert(
  /\.library-rail\s*\{[^}]*align-self:\s*start/s.test(appCss) &&
    /\.library-rail\s*\{[^}]*height:\s*fit-content/s.test(appCss),
  'Rail sizes to its controls instead of stretching through the workspace'
);
assert(
  !appCss.includes('.library-rail__spacer'),
  'Rail does not reserve a full-height spacer between navigation groups'
);
assert(
  /\.library-rail\s*\{[^}]*max-height:\s*calc\(100%\s*-\s*var\(--surface-margin\)\s*-\s*var\(--surface-margin\)/s.test(appCss),
  'Rail stays within the workspace height'
);
assert(
  /\.library-rail\s*\{[^}]*overflow-y:\s*auto/s.test(appCss),
  'Rail scrolls vertically when its controls exceed the workspace height'
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
  /\.library-warning\s*\{[^}]*color:\s*var\(--text\)/s.test(appCss),
  'warning summary uses the normal text color'
);
assert(
  /\.library-warning \.btn--ghost[\s\S]*?color:\s*var\(--text\)/s.test(appCss),
  'warning summary CTA uses the normal text color'
);
assert(
  /\.library-workspace\s*\{[^}]*var\(--sidebar-effective-width\)[^}]*var\(--library-effective-width\)/s.test(
    appCss
  ),
  'workspace uses viewport-aware effective pane widths'
);
assert(
  /@media \(max-width:\s*1440px\)[\s\S]*?\.detail-toolbar[\s\S]*?flex-wrap:\s*wrap/s.test(appCss),
  'sub-wide viewports allow Detail toolbar actions to wrap'
);
assert(
  appCss.includes('container: prompt-detail / inline-size'),
  'Detail exposes its actual content width as a layout container'
);
assert(
  /@container prompt-detail \(min-width:\s*40rem\)[\s\S]*?\.editor-layout[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(12rem,\s*17rem\)/s.test(
    appCss
  ),
  'wide Detail containers use the persistent two-column editor'
);
assert(
  /\.editor-canvas\s*\{[^}]*overflow:\s*auto/s.test(appCss) &&
    /\.prompt-editor\s*\{[^}]*min-height:\s*0/s.test(appCss),
  'Edit panes let the canvas and editor shrink and scroll at every height'
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

console.log('increase contrast status colours (Issue #67)');
const contrastBlock = appCss.match(/@media \(prefers-contrast: more\)\s*\{[\s\S]*?\n\}/);
assert(contrastBlock !== null, 'the Increase Contrast block is declared');
const contrastRules = contrastBlock?.[0] ?? '';

for (const [token, replacement] of [
  ['--warning', '--warning-contrast'],
  ['--success', '--success-contrast'],
  ['--error', '--error-contrast'],
  ['--error-fill', '--error-fill-contrast'],
]) {
  assert(
    new RegExp(`${token}:\\s*var\\(${replacement}\\)`).test(contrastRules),
    `Increase Contrast lifts ${token} through ${replacement}`
  );
}

/** The value `token` resolves to inside the first block opened by `selector`. */
function tokenInBlock(selector, token) {
  const start = appCss.indexOf(selector);
  if (start === -1) return undefined;
  const open = appCss.indexOf('{', start);
  const body = appCss.slice(open, appCss.indexOf('\n}', open));
  return body.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
}

// "More contrast" needs an explicit, verified step: the existing -strong variants
// are not contrast levels (light --warning-strong clears 3.19:1 on white), so the
// alias has to point at the dedicated --*-contrast token instead of absorbing the
// old one.
for (const token of ['--warning-contrast', '--success-contrast', '--error-contrast']) {
  const light = tokenInBlock(':root {', token);
  const dark = tokenInBlock("[data-theme='dark'] {", token);
  assert(light !== undefined, `${token} is declared for light`);
  assert(dark !== undefined, `${token} is declared for dark`);
  assert(light !== dark, `${token} is theme-aware`);
}
assert(
  !/--warning:\s*var\(--warning-strong\)/.test(contrastRules),
  'Increase Contrast lifts --warning through a dedicated contrast token, not the -strong variant'
);

/* ---------------------------------------------------------------------------
 * Increase Contrast has to reach the pixels, not just the token table.
 *
 * Several consumers tint their own background with the very token they use as
 * text (.health-badge--warning is `var(--warning)` 14% over the page,
 * .frontmatter-warning layers the -strong tint, the error strips use 8%), so
 * deepening a token deepens what its text sits on and the two move towards each
 * other. Measuring the token against --bg-subtle in isolation reported a pass
 * where the badge composited to 3.98:1 — which is exactly the gap this section
 * exists to close.
 *
 * Rules are collected from the stylesheet rather than hand-listed, so a new
 * `.foo { color: var(--warning); background: color-mix(... var(--warning) 30%) }`
 * widens the net by itself.
 * ------------------------------------------------------------------------- */
const stylesheet = appCss.replace(/\/\*[\s\S]*?\*\//g, '');

const CONTRAST_REDIRECT = {
  '--warning': '--warning-contrast',
  '--success': '--success-contrast',
  '--error': '--error-contrast',
  '--error-fill': '--error-fill-contrast',
};

function themeBlock(theme) {
  const id = theme === 'dark' ? "[data-theme='dark'] {" : ':root {';
  const start = stylesheet.indexOf(id);
  assert(start !== -1, `${id} is declared`);
  return stylesheet.slice(stylesheet.indexOf('{', start), stylesheet.indexOf('\n}', start));
}

/** The literal a token resolves to, following the Increase Contrast redirect. */
function resolveToken(theme, token, mode = 'contrast') {
  const name = mode === 'contrast' ? CONTRAST_REDIRECT[token] ?? token : token;
  const find = (scope) =>
    themeBlock(scope).match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
  const value = find(theme) ?? find('light');
  assert(value !== undefined, `${name} is declared for ${theme} or light`);
  const literal = /^#([0-9a-f]{6})$/i.exec(value);
  assert(
    literal !== null,
    `${name} resolves to a literal hex colour so it can be measured (got "${value}")`
  );
  return literal[1];
}

function channels(color) {
  return [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16));
}

function relativeLuminance(color) {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, color N%, transparent)` composited over `base`. */
function composite(color, alpha, base) {
  return channels(color)
    .map((value, i) => Math.round(alpha * value + (1 - alpha) * channels(base)[i]))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function ruleBody(selector) {
  const start = stylesheet.indexOf(`${selector} {`);
  assert(start !== -1, `${selector} is declared`);
  const open = stylesheet.indexOf('{', start);
  return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
}

const STATUS_TEXT_RULES = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => {
    const fg = /(?:^|[;\s])color:\s*var\((--warning|--success|--error)\)/.exec(body)?.[1];
    if (!fg) return null;
    const tint =
      /background:\s*color-mix\(in srgb,\s*var\((--[a-z-]+)\)\s*([\d.]+)%,\s*transparent\)/.exec(
        body
      );
    const solid = /background:\s*var\((--[a-z-]+)\)/.exec(body);
    return {
      selector: selector.trim(),
      fg,
      tint: tint ? { token: tint[1], alpha: Number(tint[2]) / 100 } : null,
      solid: solid ? solid[1] : null,
    };
  })
  .filter(Boolean);

assert(
  STATUS_TEXT_RULES.length >= 10,
  `status tokens are painted as text by several rules (found ${STATUS_TEXT_RULES.length})`
);

// Both page surfaces, because a rule can land on either; the worse one governs.
const SURFACES = ['--bg-card', '--bg-subtle'];

for (const rule of STATUS_TEXT_RULES) {
  const placement = rule.solid ?? (rule.tint ? `${rule.tint.token} ${rule.tint.alpha * 100}%` : 'page');
  for (const theme of ['light', 'dark']) {
    const fg = resolveToken(theme, rule.fg);
    const worst = Math.min(
      ...SURFACES.map((surface) => {
        let base = resolveToken(theme, surface);
        if (rule.solid) base = resolveToken(theme, rule.solid);
        else if (rule.tint) {
          base = composite(resolveToken(theme, rule.tint.token), rule.tint.alpha, base);
        }
        return contrast(fg, base);
      })
    );
    assert(
      worst >= 4.5,
      `Increase Contrast keeps ${rule.selector} readable in ${theme} ` +
        `(${rule.fg} on ${placement} = ${worst.toFixed(2)}:1, needs 4.5)`
    );
  }
}

/* ---------------------------------------------------------------------------
 * That scan keys on the foreground, so it is blind to the mirror image: text
 * from a token Increase Contrast does *not* redirect, background from one it
 * does. Both halves still move — the tint deepens underneath a text colour that
 * stays put — so the two converge, and a consumer can come out with less
 * contrast than it started with from a preference that asked for more.
 *
 * Not hypothetical: light .diff-line--add (text --success-strong on a 12%
 * --success tint) fell from 3.99:1 to 3.87:1 once --success was redirected, and
 * `color: var(--success-strong)` never matched the pattern above. So the
 * complement is collected here rather than hand-listed.
 *
 * Literal text colours are out of scope, but not unmeasured: .btn--danger and
 * .warning-badge both paint #fff on the solid --error-fill, and the
 * white-on-fill checks below name each of them individually rather than
 * assuming they keep sharing one pair. A rule that declares no colour of its
 * own inherits from the compound base class it is authored with —
 * .library-warning--missing is always written as `library-warning
 * library-warning--missing`, so the base's `color: var(--text)` is the
 * declaration that lands.
 * ------------------------------------------------------------------------- */
const COLOR_DECLARATION = /(?:^|[;\s])color:\s*([^;]+);?/g;
const REDIRECTED = new Set(Object.keys(CONTRAST_REDIRECT));

const OWN_TEXT_TOKEN = new Map(
  [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => [
      selector.trim(),
      [...body.matchAll(COLOR_DECLARATION)]
        .pop()?.[1]
        .trim()
        .match(/^var\((--[a-z-]+)\)$/)?.[1],
    ])
    .filter(([, token]) => token !== undefined)
);

/** The text token of the compound base class this selector is authored with. */
function inheritedTextToken(selector) {
  const base = [...OWN_TEXT_TOKEN.keys()]
    .filter((candidate) => candidate !== selector && selector.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return base === undefined ? undefined : OWN_TEXT_TOKEN.get(base);
}

const MIXED_TEXT_RULES = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => {
    const name = selector.trim();
    const tint =
      /background:\s*color-mix\(in srgb,\s*var\((--[a-z-]+)\)\s*([\d.]+)%,\s*transparent\)/.exec(
        body
      );
    const solid = /background:\s*var\((--[a-z-]+)\)/.exec(body);
    const background = tint?.[1] ?? solid?.[1];
    if (background === undefined || !REDIRECTED.has(background)) return null;
    const own = [...body.matchAll(COLOR_DECLARATION)].pop()?.[1].trim();
    // A literal is not a token pair that a redirect can move apart.
    if (own !== undefined && !own.startsWith('var(')) return null;
    const fg = own?.match(/^var\((--[a-z-]+)\)$/)?.[1] ?? inheritedTextToken(name);
    // Rules whose *text* is redirected are already measured above.
    if (fg === undefined || REDIRECTED.has(fg)) return null;
    return {
      selector: name,
      fg,
      tint: tint ? { token: tint[1], alpha: Number(tint[2]) / 100 } : null,
      solid: solid ? solid[1] : null,
    };
  })
  .filter(Boolean);

// Named, so the collector cannot quietly stop seeing the consumers this section
// exists for: an empty or reshaped scan would otherwise pass by measuring
// nothing at all.
for (const selector of [
  '.btn--danger:disabled',
  '.library-warning--missing',
  '.diff-line--add',
  '.diff-line--remove',
]) {
  assert(
    MIXED_TEXT_RULES.some((rule) => rule.selector === selector),
    `${selector} is measured as a mixed-token consumer`
  );
}

/* Increase Contrast may re-point a consumer's text at the redirected token —
 * that is how .diff-line--add is repaired — and the block wins the cascade, so
 * its declaration, not the flat rule, is what has to be measured.
 *
 * Reads the comment-stripped text: `contrastRules` is sliced out of the raw
 * stylesheet, and a comment sitting above a rule would otherwise land in the
 * same `[^{}]+` group as the selector and stop it matching. */
const CONTRAST_TEXT_OVERRIDE = new Map();
for (const [, selector, body] of contrastRules
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const declared = [...body.matchAll(COLOR_DECLARATION)].pop()?.[1].trim();
  const token = declared?.match(/^var\((--[a-z-]+)\)$/)?.[1];
  if (token !== undefined) CONTRAST_TEXT_OVERRIDE.set(selector.trim(), token);
}

for (const rule of MIXED_TEXT_RULES) {
  const fg = CONTRAST_TEXT_OVERRIDE.get(rule.selector) ?? rule.fg;
  const placement = rule.solid ?? (rule.tint ? `${rule.tint.token} ${rule.tint.alpha * 100}%` : 'page');
  for (const theme of ['light', 'dark']) {
    const worst = Math.min(
      ...SURFACES.map((surface) => {
        let base = resolveToken(theme, surface);
        if (rule.solid) base = resolveToken(theme, rule.solid);
        else if (rule.tint) {
          base = composite(resolveToken(theme, rule.tint.token), rule.tint.alpha, base);
        }
        return contrast(resolveToken(theme, fg), base);
      })
    );
    assert(
      worst >= 4.5,
      `Increase Contrast keeps ${rule.selector} readable in ${theme} ` +
        `(${fg} on ${placement} = ${worst.toFixed(2)}:1, needs 4.5)`
    );
  }
}

// The fill is not "white text only": .btn--danger:disabled tints the same fill
// and keeps an --error-strong label on top of it. Both compositions are
// measured, so one value serving both themes is a result of the arithmetic
// rather than a structural rule a future dark step would have to break.
//
// Every consumer of white-on-fill is named, not just the first one. The pair is
// shared today, so a selector that quietly moved to another surface would leave
// this section green while the comment above it stopped being true.
const WHITE_ON_FILL = ['.btn--danger', '.warning-badge'];
for (const selector of WHITE_ON_FILL) {
  const body = ruleBody(selector);
  assert(
    /(?:^|[;\s])color:\s*#fff/.test(body),
    `${selector} paints a white label on the fill`
  );
  assert(
    /background:\s*var\(--error-fill\)/.test(body),
    `${selector} sits on the measured --error-fill surface`
  );
}
for (const theme of ['light', 'dark']) {
  const fill = resolveToken(theme, '--error-fill');
  const ratio = contrast('ffffff', fill);
  assert(
    ratio >= 4.5,
    `Increase Contrast keeps the white-on-fill labels readable in ${theme} ` +
      `(${WHITE_ON_FILL.join(' + ')} on --error-fill = ${ratio.toFixed(2)}:1)`
  );
  const disabledBody = ruleBody('.btn--danger:disabled');
  // The leading boundary matters: without it `border-color: var(--border)` reads
  // as the label declaration and the assertion measures the wrong pair.
  const label = /(?:^|[;\s])color:\s*var\((--[a-z-]+)\)/.exec(disabledBody)?.[1];
  assert(label !== undefined, 'the disabled danger button declares its label token');
  const worst = Math.min(
    ...SURFACES.map((surface) =>
      contrast(
        resolveToken(theme, label),
        composite(fill, 0.12, resolveToken(theme, surface))
      )
    )
  );
  assert(
    worst >= 4.5,
    `Increase Contrast keeps the disabled danger button readable in ${theme} ` +
      `(${label} on the --error-fill tint = ${worst.toFixed(2)}:1)`
  );
}

console.log(failures === 0 ? 'material contract: ok' : `material contract: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
