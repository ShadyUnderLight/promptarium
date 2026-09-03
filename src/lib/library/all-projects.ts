import type { Project, PromptSummary } from '$lib/prompts/types';
import { decideSelectedRefresh, type SelectedRefreshDecision } from './refresh-selected';
import { promptKey } from './scope';

const ALL_PROJECTS_CONCURRENCY = 4;

export { ALL_PROJECTS_CONCURRENCY };

export interface ProjectScanResult {
  projectPath: string;
  summaries: PromptSummary[];
  revision: number;
}

export interface ProjectScanFailure {
  projectPath: string;
  error: string;
}

interface IndexedPrompt {
  summary: PromptSummary;
  bodyLower: string;
}

function searchFieldScore(token: string, value: string, weight: number): number | null {
  const lower = value.toLowerCase();
  if (!lower.includes(token)) return null;
  let score = weight;
  if (lower === token) score += weight;
  else if (lower.startsWith(token)) score += weight * 0.55;
  else if (lower.split(/[^\p{L}\p{N}]+/u).some((word) => word === token)) score += weight * 0.35;
  return score;
}

function scoreEntry(entry: IndexedPrompt, tokens: string[]): number | null {
  const fields = [
    [entry.summary.name, 100],
    [entry.summary.relativePath, 95],
    [entry.summary.metadata.tags.join(' '), 60],
    [entry.summary.metadata.description, 45],
    [entry.summary.metadata.models.join(' '), 35],
    [entry.bodyLower, 20],
  ] as const;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [value, weight] of fields) {
      best = Math.max(best, searchFieldScore(token, value, weight) ?? 0);
    }
    if (!best) return null;
    total += best;
  }
  return total / tokens.length;
}

export function searchProjectIndex(
  index: Map<string, IndexedPrompt> | undefined,
  query: string
): PromptSummary[] | null {
  if (!index) return null;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...index.values()].map((entry) => entry.summary);
  const matches: Array<{ summary: PromptSummary; score: number }> = [];
  for (const entry of index.values()) {
    const score = scoreEntry(entry, tokens);
    if (score !== null) matches.push({ summary: entry.summary, score });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.summary.name.localeCompare(b.summary.name))
    .map((match) => match.summary);
}

export function projectLabel(projects: Project[], projectPath: string): string {
  return projects.find((project) => project.path === projectPath)?.name ?? projectPath;
}

/** Merge per-project search hits into one globally ranked list. */
export function mergeSearchResults(
  projects: Project[],
  indexes: Map<string, Map<string, IndexedPrompt>>,
  query: string
): PromptSummary[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    const summaries: PromptSummary[] = [];
    for (const project of projects) {
      const index = indexes.get(project.path);
      if (!index) continue;
      for (const entry of index.values()) summaries.push(entry.summary);
    }
    return aggregateSummaries(summaries);
  }

  const matches: Array<{ summary: PromptSummary; score: number }> = [];
  for (const project of projects) {
    const index = indexes.get(project.path);
    if (!index) continue;
    for (const entry of index.values()) {
      const score = scoreEntry(entry, tokens);
      if (score !== null) matches.push({ summary: entry.summary, score });
    }
  }

  return matches
    .sort((a, b) => compareSearchHits(a, b, projects))
    .map((match) => match.summary);
}

export function compareSearchHits(
  a: { summary: PromptSummary; score: number },
  b: { summary: PromptSummary; score: number },
  projects: Project[]
): number {
  if (b.score !== a.score) return b.score - a.score;
  const projectCompare = projectLabel(projects, a.summary.projectPath).localeCompare(
    projectLabel(projects, b.summary.projectPath)
  );
  if (projectCompare !== 0) return projectCompare;
  const nameCompare = a.summary.name.localeCompare(b.summary.name);
  if (nameCompare !== 0) return nameCompare;
  return a.summary.projectPath.localeCompare(b.summary.projectPath);
}

export function aggregateSummaries(summaries: PromptSummary[]): PromptSummary[] {
  return [...summaries].sort((a, b) => {
    const projectCompare = a.projectPath.localeCompare(b.projectPath);
    if (projectCompare !== 0) return projectCompare;
    return a.name.localeCompare(b.name);
  });
}

export function aggregateScanResults(results: ProjectScanResult[]): PromptSummary[] {
  return aggregateSummaries(results.flatMap((result) => result.summaries));
}

export function staleProjectScanResults(
  results: ProjectScanResult[],
  getRevision: (projectPath: string) => number
): ProjectScanResult[] {
  return results.filter((result) => result.revision !== getRevision(result.projectPath));
}

export function replaceProjectScanResults(
  results: ProjectScanResult[],
  replacements: ProjectScanResult[]
): ProjectScanResult[] {
  const byPath = new Map(replacements.map((result) => [result.projectPath, result]));
  return results.map((result) => byPath.get(result.projectPath) ?? result);
}

export interface AllProjectsGlobalCommitInput {
  finalized: ProjectScanResult[];
  projects: Project[];
  searchQuery: string;
  searchIndexes: Map<string, Map<string, IndexedPrompt>>;
  selectedProjectPath: string | null;
  selectedName: string | null;
  editorDirty: boolean;
  reloadSelected: boolean;
}

export interface AllProjectsGlobalCommitPlan {
  summaries: PromptSummary[];
  healthyProjects: Project[];
  healthyProjectPaths: string[];
  prompts: PromptSummary[];
  queryAtCommit: string;
  decision: SelectedRefreshDecision;
  selectedReload: { projectPath: string; name: string } | null;
}

/** Plan every synchronous global snapshot consumer from one finalized project scan set. */
export function planAllProjectsGlobalCommit(input: AllProjectsGlobalCommitInput): AllProjectsGlobalCommitPlan {
  const healthyProjects = input.projects.filter((project) =>
    input.finalized.some((result) => result.projectPath === project.path)
  );
  const summaries = aggregateScanResults(input.finalized);
  const queryAtCommit = input.searchQuery;
  const prompts = queryAtCommit.trim()
    ? mergeSearchResults(healthyProjects, input.searchIndexes, queryAtCommit)
    : summaries;
  const decision = decideSelectedRefresh({
    selectedProjectPath: input.selectedProjectPath,
    selectedName: input.selectedName,
    summaries,
    editorDirty: input.editorDirty,
    reloadSelected: input.reloadSelected,
  });
  const selectedReload =
    decision.reloadSelected &&
    !decision.clearSelection &&
    input.selectedName &&
    input.selectedProjectPath &&
    summariesContainIdentity(summaries, input.selectedProjectPath, input.selectedName)
      ? { projectPath: input.selectedProjectPath, name: input.selectedName }
      : null;
  return {
    summaries,
    healthyProjects,
    healthyProjectPaths: healthyProjects.map((project) => project.path),
    prompts,
    queryAtCommit,
    decision,
    selectedReload,
  };
}

/** Re-refresh mutated projects until every snapshot revision matches, then commit synchronously. */
export async function finalizeAllProjectsScanResults<T>(options: {
  results: ProjectScanResult[];
  getRevision: (projectPath: string) => number;
  refreshProjects: (projectPaths: string[]) => Promise<ProjectScanResult[]>;
  shouldAbort: () => boolean;
  commit: (results: ProjectScanResult[]) => T;
}): Promise<T | null> {
  let results = options.results;
  while (true) {
    if (options.shouldAbort()) return null;
    const stale = staleProjectScanResults(results, options.getRevision);
    if (stale.length === 0) {
      return options.commit(results);
    }
    const stalePaths = [...new Set(stale.map((result) => result.projectPath))];
    const refreshed = await options.refreshProjects(stalePaths);
    if (options.shouldAbort()) return null;
    results = replaceProjectScanResults(results, refreshed);
  }
}

/** Scan + index refresh for one project; summaries and revision share one stable revision interval. */
export async function refreshAllProjectsProjectScan(
  projectPath: string,
  scanProject: (projectPath: string) => Promise<PromptSummary[]>,
  refreshSearchIndex: (projectPath: string, summaries: PromptSummary[]) => Promise<unknown>,
  getRevision: (projectPath: string) => number,
  shouldAbort?: () => boolean
): Promise<ProjectScanResult | null> {
  while (true) {
    if (shouldAbort?.()) return null;
    const revisionAtStart = getRevision(projectPath);
    const summaries = await scanProject(projectPath);
    if (shouldAbort?.()) return null;
    await refreshSearchIndex(projectPath, summaries);
    if (shouldAbort?.()) return null;
    if (revisionAtStart !== getRevision(projectPath)) {
      continue;
    }
    return { projectPath, summaries, revision: revisionAtStart };
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export function summariesContainIdentity(
  summaries: PromptSummary[],
  projectPath: string,
  name: string
): boolean {
  return summaries.some((summary) => summary.projectPath === projectPath && summary.name === name);
}

export function identityKey(identity: { projectPath: string; name: string }): string {
  return promptKey(identity.projectPath, identity.name);
}
