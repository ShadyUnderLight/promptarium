/**
 * Variant family derivation for Prompt Compare & Variants (Issue #14).
 *
 * `variantOf` in frontmatter names a parent prompt inside the same project. It
 * expresses family membership only: no inheritance, composition, metadata
 * merging or runtime resolution — a variant is always a complete, independent
 * Markdown prompt.
 *
 * This module mirrors relations.ts: it is deliberately pure (no UI, no
 * persistence, no filesystem access). Resolution is scoped by the source
 * prompt's `projectPath`, uses the same canonical relative-path rules as
 * `related` (see isCanonicalRelationPath), and surfaces invalid / broken /
 * self values instead of hiding or normalizing them. Backlinks / children are
 * derived state and are never written back to any Markdown file.
 */
import type { PromptSummary } from '$lib/prompts/types';
import { getVariantOf, getVariantOfRaw, hasInvalidVariantOfType } from '$lib/prompts/types';
import { isCanonicalRelationPath } from '$lib/relations/relations';

export type VariantStatus = 'ok' | 'missing' | 'invalid' | 'self';

export interface VariantLink {
  /** The path exactly as written in frontmatter. */
  path: string;
  /** Resolution status. */
  status: VariantStatus;
  /** Present only when `status` is 'ok'; the resolved parent identity. */
  target?: { projectPath: string; name: string };
}

export interface VariantFamily {
  /** The selected prompt's explicit parent, classified. Null when none. */
  parent: VariantLink | null;
  /** Prompts in the same project whose variantOf resolves to the selected
   *  prompt (its direct children), sorted by name. */
  children: PromptSummary[];
  /** Other prompts in the same project sharing the same parent as the selected
   *  prompt (its siblings), sorted by name. Empty when the prompt has no
   *  resolvable parent. */
  siblings: PromptSummary[];
}

/**
 * Classify one prompt's variantOf value against its own project's prompt set.
 * The selected prompt is located by (projectPath, name); its `variantOf` is
 * classified self → invalid → missing → ok, matching how `related` entries are
 * classified so Health and the family UI never disagree.
 */
export function classifyVariantParent(
  summaries: PromptSummary[],
  target: { projectPath: string; name: string }
): VariantLink | null {
  const own = summaries.find(
    (summary) => summary.projectPath === target.projectPath && summary.name === target.name
  );
  if (!own) return null;
  const raw = getVariantOf(own.metadata);
  if (!raw) {
    // Present but wrong YAML type (number / array / …) is an invalid parent,
    // not an absent one — surface it so Health and the family UI can flag it.
    if (hasInvalidVariantOfType(own.metadata)) {
      const rawValue = getVariantOfRaw(own.metadata);
      return { path: `${typeof rawValue}: ${JSON.stringify(rawValue)}`, status: 'invalid' };
    }
    return null;
  }
  if (raw === target.name) return { path: raw, status: 'self' };
  if (!isCanonicalRelationPath(raw)) return { path: raw, status: 'invalid' };
  const project = new Set(
    summaries.filter((summary) => summary.projectPath === target.projectPath).map((summary) => summary.name)
  );
  if (!project.has(raw)) return { path: raw, status: 'missing' };
  return {
    path: raw,
    status: 'ok',
    target: { projectPath: target.projectPath, name: raw },
  };
}

/**
 * Resolve the variant family of one selected prompt. A source is a child when
 * its canonical, non-self variantOf equals the target name exactly; a sibling
 * shares the target's parent. Non-canonical or self entries are never treated
 * as family members — they are surfaced on their own prompt's Parent row and by
 * Health instead.
 */
export function resolveVariantFamily(
  summaries: PromptSummary[],
  target: { projectPath: string; name: string }
): VariantFamily {
  const project = new Map<string, PromptSummary>();
  const sources: PromptSummary[] = [];
  for (const summary of summaries) {
    if (summary.projectPath !== target.projectPath) continue;
    project.set(summary.name, summary);
    if (summary.name !== target.name) sources.push(summary);
  }

  const parent = classifyVariantParent(summaries, target);

  const children = sources
    .filter((source) => {
      const raw = getVariantOf(source.metadata);
      return raw !== undefined && raw !== source.name && isCanonicalRelationPath(raw) && raw === target.name;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const siblings =
    parent && parent.status === 'ok' && parent.target
      ? sources
          .filter((source) => {
            const raw = getVariantOf(source.metadata);
            return (
              raw !== undefined &&
              raw !== source.name &&
              isCanonicalRelationPath(raw) &&
              raw === parent.target!.name
            );
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return { parent, children, siblings };
}

/**
 * Deterministically find every prompt name that participates in a variantOf
 * cycle of length >= 2 (A -> B -> A). A self reference (raw === own name) is
 * not counted here: it is surfaced as a self variant instead, so it is never
 * double-reported. Only canonical, non-self, resolvable edges are followed; an
 * invalid or missing edge terminates the walk. Returns a stable, sorted array.
 */
export function findVariantCycleMembers(summaries: PromptSummary[], projectPath: string): string[] {
  const project = new Set(
    summaries.filter((summary) => summary.projectPath === projectPath).map((summary) => summary.name)
  );
  const projectMap = new Map<string, PromptSummary>();
  for (const summary of summaries) {
    if (summary.projectPath === projectPath) projectMap.set(summary.name, summary);
  }

  // name -> canonical parent name; only ok, non-self edges are followed.
  const parentOf = new Map<string, string>();
  for (const summary of projectMap.values()) {
    const raw = getVariantOf(summary.metadata);
    if (!raw || raw === summary.name || !isCanonicalRelationPath(raw)) continue;
    if (project.has(raw)) parentOf.set(summary.name, raw);
  }

  const inCycle = new Set<string>();
  for (const start of parentOf.keys()) {
    if (inCycle.has(start)) continue;
    const seen = new Map<string, number>(); // name -> step index in this walk
    let current: string | undefined = start;
    let step = 0;
    while (current !== undefined && parentOf.has(current)) {
      if (seen.has(current)) {
        // A revisit means every node from the first occurrence is on a cycle.
        const from = seen.get(current)!;
        for (const node of [...seen.keys()].slice(from)) inCycle.add(node);
        break;
      }
      seen.set(current, step);
      current = parentOf.get(current);
      step++;
    }
  }
  return [...inCycle].sort((a, b) => a.localeCompare(b));
}

/**
 * True when setting `source.variantOf = candidateParent` would create a cycle:
 * the candidate is the source itself, or the candidate is a (direct or
 * transitive) descendant of the source — i.e. walking the candidate's own
 * parent chain reaches the source. Blocking descendants is required: with
 * C.variantOf = B and B.variantOf = A, letting A pick B or C would build
 * A -> B -> A / A -> C -> B -> A. A pre-existing cycle that does not contain
 * the source is not this call's problem: pointing at it adds no cycle through
 * the source, so it returns false. The UI uses this to filter the parent
 * picker and guard the set action; a hand-written file that already forms a
 * cycle is still surfaced by Health, never silently "fixed" here.
 */
export function wouldCreateVariantCycle(
  summaries: PromptSummary[],
  source: { projectPath: string; name: string },
  candidateParent: string
): boolean {
  if (candidateParent === source.name) return true;
  const project = new Map<string, PromptSummary>();
  for (const summary of summaries) {
    if (summary.projectPath === source.projectPath) project.set(summary.name, summary);
  }
  const seen = new Set<string>();
  let current: string | undefined = candidateParent;
  while (current !== undefined && project.has(current)) {
    if (current === source.name) return true;
    if (seen.has(current)) return false; // pre-existing cycle elsewhere
    seen.add(current);
    const raw = getVariantOf(project.get(current)!.metadata);
    current = raw && raw !== current && isCanonicalRelationPath(raw) ? raw : undefined;
  }
  return false;
}
