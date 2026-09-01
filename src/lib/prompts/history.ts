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

export function historyEmptyMessage(reason: HistoryEmptyReason): string {
  switch (reason) {
    case 'git-unavailable':
      return '本机 Git 不可用，无法在此查看 Prompt 版本历史。';
    case 'not-a-repository':
      return '此 Project 不在 Git 仓库中。将 Project 放入 Git 仓库后即可在这里查看 Prompt 版本历史。';
    case 'untracked':
      return '当前 Prompt 尚无 Git 历史。';
    case 'no-commits':
      return '当前 Prompt 尚无 Git 历史。';
  }
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

/** First-page history always refetches when opening History; cache is only for pagination within a session. */
export async function loadHistoryFirstPage(
  fetchFirstPage: () => Promise<GitFileHistoryPage>
): Promise<GitFileHistoryPage> {
  return fetchFirstPage();
}
