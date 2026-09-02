import type { PromptMetadata } from './types';
import { withVariantOf } from './types';

/** Deep-copy the supported metadata fields for a new prompt file. The generic
 *  spread copies `notes` (Issue #15) along with every other supported field;
 *  Duplicate / Duplicate as Variant both route through this, so a future
 *  explicit-field-list refactor cannot silently drop a field. `examples`
 *  (Issue #24) is deep-copied so the new prompt never shares a mutable
 *  array/object with the source; the raw `examplesRaw` value is cloned too so a
 *  malformed source example is duplicated verbatim. An `undefined` source
 *  yields a fresh default metadata object (used by the dev fixture). */
export function cloneMetadata(metadata: PromptMetadata | undefined): PromptMetadata {
  const value = metadata ?? {
    description: '',
    tags: [],
    status: 'active' as const,
    favorite: false,
    models: [],
    related: [],
    extra: {},
  };
  const variables = value.variables
    ? Object.fromEntries(Object.entries(value.variables).map(([name, doc]) => [name, { ...doc }]))
    : undefined;
  const examples = value.examples
    ? value.examples.map((example) => ({
        ...example,
        assets: example.assets ? [...example.assets] : undefined,
        extra: example.extra ? { ...example.extra } : undefined,
      }))
    : undefined;
  return {
    ...value,
    tags: [...value.tags],
    models: [...value.models],
    related: [...value.related],
    extra: { ...value.extra },
    ...(variables ? { variables } : {}),
    ...(examples ? { examples } : {}),
    ...(value.examplesRaw !== undefined
      ? { examplesRaw: JSON.parse(JSON.stringify(value.examplesRaw)) }
      : {}),
  };
}

/** Metadata for "Duplicate": a full copy of the source metadata, including
 *  `notes` (Issue #15). */
export function duplicateMetadata(metadata: PromptMetadata): PromptMetadata {
  return cloneMetadata(metadata);
}

/** Metadata for "Duplicate as Variant": a full copy of the source metadata
 *  plus `variantOf` pointing at the source prompt, with `notes` preserved like
 *  every other supported field (Issue #15). */
export function variantMetadata(metadata: PromptMetadata, sourceName: string): PromptMetadata {
  return withVariantOf(cloneMetadata(metadata), sourceName);
}
