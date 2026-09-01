/**
 * Library scope and refresh-flag regression tests.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  allProjectsRefreshFlagsAtStart,
  finalizeAllProjectsRefreshFlags,
  projectScopeRefreshFlags,
  resolveLibraryScopeAfterRosterRefresh,
} = await import(join(root, 'src/lib/library/scope-refresh.ts'));

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures++;
    console.error('  FAIL: ' + message);
  }
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, message + '\n    expected ' + e + '\n    got      ' + a);
}

const projects = [
  { name: 'Work', path: '/work' },
  { name: 'Personal', path: '/personal' },
];

console.log('resolveLibraryScopeAfterRosterRefresh preserves All Projects');
eq(
  resolveLibraryScopeAfterRosterRefresh(
    { kind: 'all-projects' },
    projects,
    '/work'
  ),
  { kind: 'all-projects' },
  'forget project while browsing all projects stays in all projects'
);

console.log('resolveLibraryScopeAfterRosterRefresh preserves project scope');
eq(
  resolveLibraryScopeAfterRosterRefresh(
    { kind: 'project', projectPath: '/work' },
    projects,
    '/work'
  ),
  { kind: 'project', projectPath: '/work' },
  'roster refresh keeps current project scope'
);

console.log('allProjectsRefreshFlagsAtStart');
eq(
  allProjectsRefreshFlagsAtStart(0),
  { loading: true, refreshing: false },
  'first global load uses blocking spinner'
);
eq(
  allProjectsRefreshFlagsAtStart(12),
  { loading: false, refreshing: true },
  'subsequent global refresh keeps snapshot visible'
);

console.log('finalizeAllProjectsRefreshFlags');
eq(
  finalizeAllProjectsRefreshFlags(3, 3, { kind: 'all-projects' }),
  { loading: false, refreshing: false },
  'current global refresh clears flags'
);
eq(
  finalizeAllProjectsRefreshFlags(3, 4, { kind: 'all-projects' }),
  null,
  'stale global refresh does not own flag cleanup'
);
eq(
  finalizeAllProjectsRefreshFlags(3, 3, { kind: 'project', projectPath: '/work' }),
  null,
  'project scope switch abandons global refresh cleanup'
);

console.log('projectScopeRefreshFlags');
eq(
  projectScopeRefreshFlags(),
  { loading: false, refreshing: false },
  'entering project scope clears inherited refreshing'
);

if (failures) {
  console.error('\n' + failures + ' test(s) failed.');
  process.exit(1);
}

console.log('\nAll library scope refresh tests passed.');
