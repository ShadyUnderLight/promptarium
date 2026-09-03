/**
 * Pure, deterministic editor helpers for the prompt `examples` array (Issue
 * #26 §6/§9). Every function takes an `examples` array and returns a *new*
 * array — the source array and its examples are never mutated, so the editor
 * dirty check and the typed projection stay consistent. The only entry points
 * that drop `examplesRaw` are the UI handlers that call these helpers, never
 * these functions themselves (they know nothing about `examplesRaw`).
 *
 * Array position is the only ordering; there is no persistent example ID.
 */
import type { PromptExample, PromptMetadata } from '../prompts/types';
import { cloneMetadata } from '../prompts/duplicate';

/** A display label for an example: its name when non-blank, otherwise a
 *  deterministic `Example N` fallback. The fallback is display-only — it is
 *  never written back to the file (Issue #26 §Preview contract). */
export function exampleDisplayName(example: PromptExample, index: number): string {
  const name = example.name?.trim();
  return name ? name : `Example ${index + 1}`;
}

/** One asset reference's position inside the examples editor: which example,
 *  which role (inputFile / outputFile / asset), and for `asset` the position
 *  within `assets[]`. There is no persistent example ID; array position is the
 *  only ordering (Issue #26 §6). */
export interface AssetRefIdentity {
  index: number;
  role: 'inputFile' | 'outputFile' | 'asset';
  sub?: number;
  reference: string;
}

/** Build the project-scoped key used by the asset resolution map (Issue #30
 *  P2). Binding the source Project path means two Projects that share the same
 *  `index:role:reference` can never collide across a Project switch — a stale
 *  entry from Project A can never be read back as Project B's resolution state.
 *  NUL cannot appear in a real filesystem path, so it is a safe delimiter
 *  inside the internal map key. */
export function assetResolutionKey(projectPath: string, ref: AssetRefIdentity): string {
  return `${projectPath}\u0000${ref.index}:${ref.role}:${ref.sub ?? ''}:${ref.reference}`;
}

/** Append one blank example. */
export function addExample(examples: PromptExample[]): PromptExample[] {
  return [...examples, {}];
}

/** Remove the example at `index`. Out-of-range is a safe no-op. */
export function removeExample(examples: PromptExample[], index: number): PromptExample[] {
  if (index < 0 || index >= examples.length) return examples;
  return [...examples.slice(0, index), ...examples.slice(index + 1)];
}

/** Move the example at `index` by `delta` (−1 up, +1 down), clamped to the
 *  array bounds. Returns the same array reference when the move is impossible. */
export function moveExample(examples: PromptExample[], index: number, delta: number): PromptExample[] {
  const target = index + delta;
  if (index < 0 || index >= examples.length || target < 0 || target >= examples.length) {
    return examples;
  }
  const next = [...examples];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Set one field of one example to `value`, or delete the field when `value`
 *  is `undefined`. Never mutates the source example object. */
export function updateExampleField<K extends keyof PromptExample>(
  examples: PromptExample[],
  index: number,
  field: K,
  value: PromptExample[K] | undefined
): PromptExample[] {
  if (index < 0 || index >= examples.length) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  if (value === undefined) delete current[field];
  else current[field] = value;
  next[index] = current;
  return next;
}

/** Append one reference to an example's `assets` list. Blank references are
 *  ignored; the list keeps deterministic append order. */
export function addAsset(
  examples: PromptExample[],
  index: number,
  reference: string
): PromptExample[] {
  const trimmed = reference.trim();
  if (index < 0 || index >= examples.length || !trimmed) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  current.assets = [...(current.assets ?? []), trimmed];
  next[index] = current;
  return next;
}

/** Remove the asset at `assetIndex` from an example. Out-of-range is a no-op. */
export function removeAsset(
  examples: PromptExample[],
  index: number,
  assetIndex: number
): PromptExample[] {
  if (index < 0 || index >= examples.length) return examples;
  const assets = examples[index].assets;
  if (!assets || assetIndex < 0 || assetIndex >= assets.length) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  current.assets = [...assets.slice(0, assetIndex), ...assets.slice(assetIndex + 1)];
  next[index] = current;
  return next;
}

/** Replace the asset at `assetIndex` with `reference` (trimmed). A blank value
 *  is kept as an empty draft row rather than removed: it is still on screen and
 *  in the in-memory metadata (so it participates in dirty/save), and is only
 *  dropped when the entry is explicitly removed (`removeAsset`) or when the
 *  metadata is saved (`stripBlankAssetEntries`). Removing a row while the user
 *  is mid-typing would lose focus and the live value. */
export function updateAsset(
  examples: PromptExample[],
  index: number,
  assetIndex: number,
  reference: string
): PromptExample[] {
  if (index < 0 || index >= examples.length) return examples;
  const assets = examples[index].assets;
  if (!assets || assetIndex < 0 || assetIndex >= assets.length) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  const list = [...assets];
  list[assetIndex] = reference.trim();
  current.assets = list;
  next[index] = current;
  return next;
}

/** Append an empty asset entry — the editor's "Add blank" draft row (Issue #26
 *  §6). Unlike `addAsset` (the picker path, which trims and drops blanks), this
 *  deliberately keeps an empty string in memory: the row is editable, its typed
 *  value flows into dirty/save live, and it is stripped from what is persisted
 *  by `stripBlankAssetEntries` at save time, so `assets: ['']` never reaches
 *  the file. */
export function addBlankAsset(examples: PromptExample[], index: number): PromptExample[] {
  if (index < 0 || index >= examples.length) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  current.assets = [...(current.assets ?? []), ''];
  next[index] = current;
  return next;
}

/** Remove every empty asset entry before persisting. Returns the same array
 *  reference when nothing is blank so an unrelated save never churns the array.
 *  This is the single point that guarantees `assets: ['']` never reaches the
 *  file — the editor keeps blank rows in memory for editing, and strips them
 *  only when the metadata is saved (Issue #26 review P1). */
export function stripBlankAssetEntries(examples: PromptExample[]): PromptExample[] {
  let changed = false;
  const next = examples.map((example) => {
    const assets = example.assets;
    if (!assets || !assets.some((reference) => !reference.trim())) return example;
    const kept = assets.filter((reference) => reference.trim());
    changed = true;
    return { ...example, assets: kept };
  });
  return changed ? next : examples;
}

/** Build the metadata that should actually be persisted, plus whether that
 *  constitutes a real change (Issue #26 review P1).
 *
 *  `updateExamples` deliberately drops `examplesRaw` the moment any Examples
 *  edit happens, so even a net-zero "Add blank → nothing typed → Cmd+S" (or
 *  "Add blank → Remove") would otherwise be treated as a real metadata edit and
 *  re-serialize a hand-written examples block from its typed projection — losing
 *  the non-standard / partially-invalid structures #24 preserves. This strips
 *  the empty draft entries first, and when the examples list is semantically
 *  unchanged restores the original raw AST, so the raw is re-emitted and the
 *  frontmatter is only rewritten if some other field actually changed. The
 *  returned `dirty` is computed against the effective metadata (same
 *  JSON-string semantics the editor already uses), so a net-zero draft
 *  interaction yields `dirty: false` and the caller can skip the backend write
 *  entirely. */
export function effectiveMetadataForSave(
  metadata: PromptMetadata,
  originalMetadata: PromptMetadata
): { effective: PromptMetadata; dirty: boolean } {
  const effective = cloneMetadata(metadata);
  if (effective.examples) {
    effective.examples = stripBlankAssetEntries(effective.examples);
  }
  const examplesUnchanged =
    JSON.stringify(effective.examples ?? null) ===
    JSON.stringify(originalMetadata.examples ?? null);
  if (examplesUnchanged && originalMetadata.examplesRaw !== undefined) {
    effective.examplesRaw = originalMetadata.examplesRaw;
  }
  return {
    effective,
    dirty: JSON.stringify(effective) !== JSON.stringify(originalMetadata),
  };
}

/** Replace an example's inline `input` with a file reference (`inputFile`).
 *  This is the explicit "replace inline with file" action the UI performs only
 *  after the user confirms; the inline text is intentionally cleared. */
export function replaceInputWithFile(
  examples: PromptExample[],
  index: number,
  reference: string
): PromptExample[] {
  const trimmed = reference.trim();
  if (!trimmed) return examples;
  const withFile = updateExampleField(examples, index, 'inputFile', trimmed);
  return updateExampleField(withFile, index, 'input', undefined);
}

/** Replace an example's inline `output` with a file reference (`outputFile`). */
export function replaceOutputWithFile(
  examples: PromptExample[],
  index: number,
  reference: string
): PromptExample[] {
  const trimmed = reference.trim();
  if (!trimmed) return examples;
  const withFile = updateExampleField(examples, index, 'outputFile', trimmed);
  return updateExampleField(withFile, index, 'output', undefined);
}

/** Clear an example's `inputFile` reference so the inline `input` editor is
 *  shown again. The inline text is preserved exactly as it was. */
export function clearFileRef(
  examples: PromptExample[],
  index: number,
  role: 'inputFile' | 'outputFile'
): PromptExample[] {
  return updateExampleField(examples, index, role, undefined);
}

/** Whether an example has any content (name counts). Used by the editor to
 *  label an example that will be written as an empty item. */
export function hasExampleContent(example: PromptExample): boolean {
  return Boolean(
    example.name?.trim() ||
      example.input ||
      example.inputFile ||
      example.output ||
      example.outputFile ||
      example.notes ||
      (example.assets?.length ?? 0) > 0
  );
}
