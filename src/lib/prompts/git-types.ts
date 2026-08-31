/** TypeScript mirror of the read-only Git history seam. */

export interface GitRepositoryInfo {
  available: boolean;
  repositoryRoot?: string;
  reason?: 'git-unavailable' | 'not-a-repository';
}

export interface GitFileCommit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail?: string;
  authoredAt: number;
  subject: string;
  /** Repo-relative path of this prompt at the commit. */
  path: string;
  /** Present when this commit renamed the prompt file. */
  previousPath?: string;
}

export interface GitFileHistoryPage {
  commits: GitFileCommit[];
  nextCursor?: string;
  tracked: boolean;
}

export interface GitFileDiff {
  commit: string;
  parent?: string;
  patch: string;
}
