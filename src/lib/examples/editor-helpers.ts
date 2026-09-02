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
import type { PromptExample } from '../prompts/types';

/** A display label for an example: its name when non-blank, otherwise a
 *  deterministic `Example N` fallback. The fallback is display-only — it is
 *  never written back to the file (Issue #26 §Preview contract). */
export function exampleDisplayName(example: PromptExample, index: number): string {
  const name = example.name?.trim();
  return name ? name : `Example ${index + 1}`;
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

/** Replace the asset at `assetIndex` with `reference`. A blank replacement
 *  removes the asset (clearing the field deletes the entry). */
export function updateAsset(
  examples: PromptExample[],
  index: number,
  assetIndex: number,
  reference: string
): PromptExample[] {
  const trimmed = reference.trim();
  if (index < 0 || index >= examples.length) return examples;
  const assets = examples[index].assets;
  if (!assets || assetIndex < 0 || assetIndex >= assets.length) return examples;
  const next = [...examples];
  const current = { ...next[index] };
  if (trimmed) {
    const list = [...assets];
    list[assetIndex] = trimmed;
    current.assets = list;
  } else {
    current.assets = assets.filter((_, i) => i !== assetIndex);
  }
  next[index] = current;
  return next;
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
