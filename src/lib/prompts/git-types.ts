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
