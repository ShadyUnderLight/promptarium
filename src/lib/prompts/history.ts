import type { GitFileHistoryPage, GitRepositoryInfo } from './git-types';

export type HistoryEmptyReason = 'git-unavailable' | 'not-a-repository' | 'untracked' | 'no-commits';

export function isStaleHistoryResponse(
  serial: number,
  currentSerial: number,
  project: string,
  name: string,
  activeProject: string | null,
  activeName: string | null
): boolean {
  return serial !== currentSerial || project !== activeProject || name !== activeName;
}

export function isStaleHistoryDiffResponse(
  requestSerial: number,
  currentSerial: number,
  project: string,
  name: string,
  commit: string,
  activeProject: string | null,
  activeName: string | null,
  selectedCommit: string | null
): boolean {
  return (
    isStaleHistoryResponse(requestSerial, currentSerial, project, name, activeProject, activeName) ||
    selectedCommit !== commit
  );
}

export function historyEmptyReason(
  repo: GitRepositoryInfo | null,
  page: GitFileHistoryPage | null
): HistoryEmptyReason | null {
  if (!repo?.available) return repo?.reason ?? 'not-a-repository';
  if (!page?.tracked) return 'untracked';
  if (!page.commits.length) return 'no-commits';
  return null;
}

export function appendHistoryPage(
  current: GitFileHistoryPage,
  next: GitFileHistoryPage
): GitFileHistoryPage {
  return {
    tracked: current.tracked,
    commits: [...current.commits, ...next.commits],
    nextCursor: next.nextCursor,
  };
}
