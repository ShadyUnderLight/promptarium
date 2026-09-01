/**
 * Pure vectors for the sidebar navigation state transitions (Issue #13).
 *
 * Only Needs Attention composes with folder/tag filters. Favorites/Draft/
 * Archived and the Folder/Tag navigation must keep their original
 * mutually-exclusive semantics (a compatibility requirement of Issue #13).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { applyNavigationAction } = await import(join(root, 'src/lib/library/navigation-state.ts'));

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

/** Default navigation state: all view, no filters. */
function nav(overrides = {}) {
  return { smartView: 'all', folderFilter: '', tagFilter: '', ...overrides };
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, message + '\n    expected ' + e + '\n    got      ' + a);
}

console.log('smart views keep original semantics (Issue #13 compatibility)');

eq(
  applyNavigationAction(nav({ folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'favorites' }),
  { smartView: 'favorites', folderFilter: '', tagFilter: '' },
  'selecting Favorites clears folder and tag filters'
);
eq(
  applyNavigationAction(nav({ folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'draft' }),
  { smartView: 'draft', folderFilter: '', tagFilter: '' },
  'selecting Draft clears folder and tag filters'
);
eq(
  applyNavigationAction(nav({ folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'archived' }),
  { smartView: 'archived', folderFilter: '', tagFilter: '' },
  'selecting Archived clears folder and tag filters'
);
eq(
  applyNavigationAction(nav({ folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'all' }),
  { smartView: 'all', folderFilter: '', tagFilter: '' },
  'selecting All prompts clears folder and tag filters'
);

console.log('needs-attention composes with folder/tag');

eq(
  applyNavigationAction(nav({ folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'needs-attention' }),
  { smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'coding' },
  'selecting Needs Attention keeps active folder and tag filters'
);
eq(
  applyNavigationAction(nav({ smartView: 'needs-attention', tagFilter: 'coding' }), { kind: 'select-folder', folder: 'work' }),
  { smartView: 'needs-attention', folderFilter: 'work', tagFilter: '' },
  'folder click inside Needs Attention keeps the smart view and clears only the tag'
);
eq(
  applyNavigationAction(nav({ smartView: 'needs-attention', folderFilter: 'work' }), { kind: 'select-tag', tag: 'coding' }),
  { smartView: 'needs-attention', folderFilter: '', tagFilter: 'coding' },
  'tag click inside Needs Attention keeps the smart view and clears only the folder'
);
eq(
  applyNavigationAction(
    applyNavigationAction(nav({ smartView: 'needs-attention' }), { kind: 'select-tag', tag: 'coding' }),
    { kind: 'select-folder', folder: 'work' }
  ),
  { smartView: 'needs-attention', folderFilter: 'work', tagFilter: '' },
  'Needs Attention never accumulates folder AND tag together'
);

console.log('folder/tag stay mutually exclusive outside needs-attention');

eq(
  applyNavigationAction(nav({ smartView: 'favorites', tagFilter: 'coding' }), { kind: 'select-folder', folder: 'work' }),
  { smartView: 'all', folderFilter: 'work', tagFilter: '' },
  'folder click falls back to All and clears the tag'
);
eq(
  applyNavigationAction(nav({ smartView: 'draft', folderFilter: 'work' }), { kind: 'select-tag', tag: 'coding' }),
  { smartView: 'all', folderFilter: '', tagFilter: 'coding' },
  'tag click falls back to All and clears the folder'
);
eq(
  applyNavigationAction(nav({ folderFilter: 'work' }), { kind: 'select-tag', tag: 'coding' }),
  { smartView: 'all', folderFilter: '', tagFilter: 'coding' },
  'tag click clears an active folder filter'
);

console.log('all view is the reset');

eq(
  applyNavigationAction(nav({ smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'coding' }), { kind: 'select-view', view: 'all' }),
  { smartView: 'all', folderFilter: '', tagFilter: '' },
  'All prompts resets the needs-attention + filter combination'
);

console.log(failures === 0 ? 'navigation state: ok' : `navigation state: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
