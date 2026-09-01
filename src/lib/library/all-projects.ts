import type { Project, PromptSummary } from '$lib/prompts/types';
import { promptKey } from './scope';

const ALL_PROJECTS_CONCURRENCY = 4;

export { ALL_PROJECTS_CONCURRENCY };

export interface ProjectScanResult {
  projectPath: string;
  summaries: PromptSummary[];
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
