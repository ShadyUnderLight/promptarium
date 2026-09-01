/**
 * Relation derivation for Related Prompts & Backlinks (Issue #12).
 *
 * `related` in frontmatter is the explicit, user-owned relation. This module
 * turns a project's scan summaries into the two derived signals the UI shows:
 *
 *   related       — outgoing links, as written (deduped, deterministic order).
 *   referencedBy  — incoming links (backlinks): prompts in the same project
 *                   whose canonical relation resolves to the selected prompt.
 *
 * Resolution is strictly scoped by the source prompt's `projectPath`: a
 * relation value is a project-relative path inside the source project, so two
 * projects that both contain `shared/review` never cross-wire. Backlinks are
 * derived state and are never written back to any Markdown file; the prompt
 * file remains the single source of truth.
 *
 * This module is deliberately pure: no UI, no persistence, no filesystem
 * access. The Rust backend owns the authoritative parse-time validation (and
 * surfaces non-canonical entries as frontmatter warnings); this module only
 * classifies the same values for display, so an invalid value is never hidden
 * and never silently normalized.
 */
import type { PromptSummary } from '$lib/prompts/types';

export type RelationStatus = 'ok' | 'missing' | 'invalid' | 'self';

export interface RelationLink {
  /** The path exactly as written in frontmatter. */
  path: string;
  /** Resolution status. */
  status: RelationStatus;
  /** Present only when `status` is 'ok'; the resolved prompt identity. */
  target?: { projectPath: string; name: string };
}

export interface RelationResolution {
  /** Outgoing links, first-appearance order, deduplicated. */
  related: RelationLink[];
  /** Incoming links (backlinks), sorted by name for a stable UI. */
  referencedBy: PromptSummary[];
}

/**
 * Canonical relation values are project-relative prompt paths without a `.md`
 * suffix and without path escape; everything else is invalid and is surfaced
 * as an invalid link rather than silently normalized. Mirrors the Rust-side
 * `valid_relation_path` in store.rs so display classification never disagrees
 * with the frontmatter warning emitted at parse time.
 */
export function isCanonicalRelationPath(value: string): boolean {
  if (!value) return false;
  if (value.endsWith('.md')) return false;
  if (value.startsWith('/')) return false;
  if (value.includes('\\') || value.includes(':') || value.includes('\u0000')) return false;
  for (const segment of value.split('/')) {
    if (!segment || segment === '.' || segment === '..') return false;
  }
  return true;
}

/**
 * Resolve the Related / Referenced by sections for one selected prompt.
 * `summaries` may be the current project's summaries or an All Projects
 * aggregate; resolution filters to the target's own project either way, which
 * is what keeps same-named prompts in different projects from cross-wiring.
 */
export function resolveRelations(
  summaries: PromptSummary[],
  target: { projectPath: string; name: string }
): RelationResolution {
  const project = new Map<string, PromptSummary>();
  const sources: PromptSummary[] = [];
  for (const summary of summaries) {
    if (summary.projectPath !== target.projectPath) continue;
    project.set(summary.name, summary);
    if (summary.name !== target.name) sources.push(summary);
  }

  const targetSummary = project.get(target.name);
  const related: RelationLink[] = [];
  const seen = new Set<string>();
  for (const path of targetSummary?.metadata.related ?? []) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (path === target.name) {
      related.push({ path, status: 'self' });
      continue;
    }
    if (!isCanonicalRelationPath(path)) {
      related.push({ path, status: 'invalid' });
      continue;
    }
    const resolved = project.get(path);
    if (!resolved) {
      related.push({ path, status: 'missing' });
      continue;
    }
    related.push({
      path,
      status: 'ok',
      target: { projectPath: resolved.projectPath, name: resolved.name },
    });
  }

  // A source is a backlink only when its canonical relation value equals the
  // target name exactly. Non-canonical entries (e.g. a `.md` suffix) are shown
  // as invalid on the source's own Related section and never silently treated
  // as a reference here.
  const referencedBy = sources
    .filter((source) => source.metadata.related.includes(target.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { related, referencedBy };
}
