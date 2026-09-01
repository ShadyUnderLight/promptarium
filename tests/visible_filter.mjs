/**
 * Pure vectors for the library visible-prompt filter (Issue #13).
 *
 * `matchesLibraryFilters` is the AND-combination used by visiblePrompts():
 * the smart view (all / needs-attention / favorites / draft / archived) must
 * compose with whatever folder / tag / model filters are active. This locks the
 * Issue #13 requirement that Needs Attention combines with Search and with
 * Tag / Folder filters.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { matchesLibraryFilters } = await import(join(root, 'src/lib/library/visible-filter.ts'));

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

/** A minimal prompt summary; override only what a scenario needs. */
function prompt(overrides = {}) {
  return {
    projectPath: '/p',
    relativePath: 'a.md',
    name: 'a',
    folder: 'root',
    extension: '.md',
    metadata: {
      description: '',
      tags: [],
      status: 'active',
      favorite: false,
      models: [],
      related: [],
      extra: {},
    },
    modifiedAt: 0,
    sizeBytes: 0,
    hasFrontmatter: true,
    ...overrides,
  };
}

/** Default state: all view, no filters, project scope. */
function state(overrides = {}) {
  return {
    smartView: 'all',
    folderFilter: '',
    tagFilter: '',
    modelFilter: '',
    allProjects: false,
    ...overrides,
  };
}

console.log('smart view');

assert(
  matchesLibraryFilters(prompt(), state(), 0),
  'all view with no filters matches any prompt'
);
assert(
  !matchesLibraryFilters(prompt(), state({ smartView: 'needs-attention' }), 0),
  'needs-attention view skips prompts with no issues'
);
assert(
  matchesLibraryFilters(prompt(), state({ smartView: 'needs-attention' }), 2),
  'needs-attention view keeps prompts with issues'
);
assert(
  matchesLibraryFilters(prompt({ metadata: { favorite: true, status: 'active' } }), state({ smartView: 'favorites' }), 0),
  'favorites view keeps favorited prompts'
);
assert(
  matchesLibraryFilters(prompt({ metadata: { favorite: false, status: 'draft' } }), state({ smartView: 'draft' }), 0),
  'status view keeps matching status'
);

console.log('tag filter');

assert(
  matchesLibraryFilters(prompt({ metadata: { tags: ['x'] } }), state({ tagFilter: 'x' }), 0),
  'tag filter matches prompts carrying the tag'
);
assert(
  !matchesLibraryFilters(prompt({ metadata: { tags: [] } }), state({ tagFilter: 'x' }), 0),
  'tag filter skips prompts without the tag'
);

console.log('folder filter');

assert(
  matchesLibraryFilters(prompt({ folder: 'work' }), state({ folderFilter: 'work' }), 0),
  'folder filter matches prompts inside the folder'
);
assert(
  matchesLibraryFilters(prompt({ folder: 'work/deep' }), state({ folderFilter: 'work' }), 0),
  'folder filter matches prompts in nested subfolders'
);
assert(
  !matchesLibraryFilters(prompt({ folder: 'personal' }), state({ folderFilter: 'work' }), 0),
  'folder filter skips prompts outside the folder'
);
assert(
  matchesLibraryFilters(prompt({ folder: 'work' }), state({ folderFilter: 'work', allProjects: true }), 0),
  'all-projects scope bypasses the folder filter'
);

console.log('combinations (Issue #13)');

assert(
  matchesLibraryFilters(
    prompt({ folder: 'work', metadata: { tags: ['x'] } }),
    state({ smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'x' }),
    1
  ),
  'needs-attention + folder + tag combine with AND'
);
assert(
  !matchesLibraryFilters(
    prompt({ folder: 'work', metadata: { tags: ['x'] } }),
    state({ smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'x' }),
    0
  ),
  'combination requires at least one health issue'
);
assert(
  !matchesLibraryFilters(
    prompt({ folder: 'personal', metadata: { tags: ['x'] } }),
    state({ smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'x' }),
    1
  ),
  'combination requires the folder match'
);
assert(
  !matchesLibraryFilters(
    prompt({ folder: 'work', metadata: { tags: [] } }),
    state({ smartView: 'needs-attention', folderFilter: 'work', tagFilter: 'x' }),
    1
  ),
  'combination requires the tag match'
);

console.log('model filter');

assert(
  matchesLibraryFilters(prompt({ metadata: { models: ['gpt-4o'] } }), state({ modelFilter: 'gpt-4o' }), 0),
  'model filter matches prompts carrying the model'
);

console.log(failures === 0 ? 'visible filter: ok' : `visible filter: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
