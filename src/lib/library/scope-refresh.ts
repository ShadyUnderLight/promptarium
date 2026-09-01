import type { Project } from '$lib/prompts/types';
import type { LibraryScope } from './scope';

export interface RefreshUiFlags {
  loading: boolean;
  refreshing: boolean;
}

export function allProjectsRefreshFlagsAtStart(promptCount: number): RefreshUiFlags {
  const initialLoad = promptCount === 0;
  return { loading: initialLoad, refreshing: !initialLoad };
}

/** Clear All Projects refresh UI flags only when this refresh is still current. */
export function finalizeAllProjectsRefreshFlags(
  startedSerial: number,
  currentSerial: number,
  scope: LibraryScope
): RefreshUiFlags | null {
  if (startedSerial === currentSerial && scope.kind === 'all-projects') {
    return { loading: false, refreshing: false };
  }
  return null;
}

/** Entering a single-project scope must not inherit All Projects refresh UI. */
export function projectScopeRefreshFlags(): RefreshUiFlags {
  return { loading: false, refreshing: false };
}

/** Roster refresh updates projects/active without implicitly changing browse scope. */
export function resolveLibraryScopeAfterRosterRefresh(
  previousScope: LibraryScope,
  projects: Project[],
  activePath: string | null
): LibraryScope {
  if (previousScope.kind === 'all-projects') {
    return { kind: 'all-projects' };
  }
  if (projects.some((project) => project.path === previousScope.projectPath)) {
    return previousScope;
  }
  if (activePath) {
    return { kind: 'project', projectPath: activePath };
  }
  return { kind: 'all-projects' };
}
