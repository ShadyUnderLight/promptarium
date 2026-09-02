<script lang="ts">
  import { resolvePromptAssets, pickAssetReference } from '$lib/api';
  import type { PromptExample, ResolvedPromptAsset } from '$lib/prompts/types';
  import {
    exampleDisplayName,
    addExample,
    removeExample,
    moveExample,
    updateExampleField,
    addAsset,
    updateAsset,
    removeAsset,
    replaceInputWithFile,
    replaceOutputWithFile,
    clearFileRef,
  } from '$lib/examples/editor-helpers';

  interface Props {
    examples: PromptExample[];
    /** Project the edited prompt lives in — the only identity used by the
     *  resolver and the picker (never the active project). */
    projectPath: string;
    onChange: (examples: PromptExample[]) => void;
  }

  let { examples, projectPath, onChange }: Props = $props();

  // ── Asset state preview (Issue #26 §9) ──────────────────────────────────
  // Every reference (inputFile / outputFile / assets) is classified through the
  // backend resolver; a state chip sits next to each reference input so a
  // hand-typed path shows Ready / Missing / Invalid without a separate save.
  // References are identified by `{index, role, sub}` (position, no persistent
  // IDs) and re-resolved whenever the set or the Project changes.
  const refs = $derived(
    examples.flatMap((example, index) => {
      const list: Array<{ index: number; role: 'inputFile' | 'outputFile' | 'asset'; reference: string; sub?: number }> = [];
      if (example.inputFile) list.push({ index, role: 'inputFile', reference: example.inputFile });
      if (example.outputFile) list.push({ index, role: 'outputFile', reference: example.outputFile });
      (example.assets ?? []).forEach((reference, sub) =>
        list.push({ index, role: 'asset', reference, sub })
      );
      return list;
    })
  );

  let resolution = $state<Record<string, ResolvedPromptAsset>>({});

  const refsKey = $derived(
    refs.map((r) => `${r.index}:${r.role}:${r.sub ?? ''}:${r.reference}`).join('\n')
  );

  $effect(() => {
    const proj = projectPath;
    const key = refsKey;
    if (!proj || !refs.length) {
      resolution = {};
      return;
    }
    let cancelled = false;
    void resolvePromptAssets(
      proj,
      refs.map((r) => r.reference)
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, ResolvedPromptAsset> = {};
      results.forEach((result, i) => {
        map[`${refs[i].index}:${refs[i].role}:${refs[i].sub ?? ''}:${result.reference}`] = result;
      });
      resolution = map;
    });
    return () => {
      cancelled = true;
    };
  });

  function resolutionFor(
    index: number,
    role: 'inputFile' | 'outputFile' | 'asset',
    reference: string,
    sub?: number
  ): ResolvedPromptAsset | undefined {
    return resolution[`${index}:${role}:${sub ?? ''}:${reference}`];
  }

  function stateLabel(state: ResolvedPromptAsset['state']): string {
    return state === 'resolved' ? 'Ready' : state === 'missing' ? 'Missing' : 'Invalid';
  }

  // ── Picker flows (Issue #26 §8) ─────────────────────────────────────────
  // A picked file is converted by Rust into a canonical Project-relative
  // reference; only a successful conversion is written into editor state. When
  // a replacement would drop existing inline text, the user is asked first —
  // never silently deleted.
  let pickerError = $state('');

  async function chooseInputFile(index: number): Promise<void> {
    const reference = await pickFor(index);
    if (!reference) return;
    const example = examples[index];
    if (example.input) {
      const ok = window.confirm(
        'This example has inline input text. Replace it with the file reference?'
      );
      if (!ok) return;
    }
    onChange(replaceInputWithFile(examples, index, reference));
  }

  async function chooseOutputFile(index: number): Promise<void> {
    const reference = await pickFor(index);
    if (!reference) return;
    const example = examples[index];
    if (example.output) {
      const ok = window.confirm(
        'This example has inline output text. Replace it with the file reference?'
      );
      if (!ok) return;
    }
    onChange(replaceOutputWithFile(examples, index, reference));
  }

  async function chooseAsset(index: number): Promise<void> {
    const reference = await pickFor(index);
    if (!reference) return;
    onChange(addAsset(examples, index, reference));
  }

  /** Pick + convert a file. Returns the canonical reference, or `null` on
   *  cancel/rejection (an error is surfaced once, not per keystroke). */
  async function pickFor(index: number): Promise<string | null> {
    if (!projectPath) return null;
    pickerError = '';
    const result = await pickAssetReference(projectPath);
    if (result.reference) return result.reference;
    if (result.error && result.error !== 'Selection cancelled.') {
      pickerError = result.error;
    }
    return null;
  }
</script>

{#snippet stateChip(resolved: ResolvedPromptAsset | undefined)}
  {#if resolved}
    <span
      class:example-chip--ready={resolved.state === 'resolved'}
      class:example-chip--missing={resolved.state === 'missing'}
      class:example-chip--invalid={resolved.state === 'invalid'}
      class="example-chip"
    >{stateLabel(resolved.state)}</span>
  {/if}
{/snippet}

<div class="examples-editor">
  <div class="examples-editor__heading-row">
    <span class="variables-editor__heading">Examples</span>
    <span class="examples-editor__hint">File references are Project-relative; choose from inside the Project.</span>
  </div>
  {#if pickerError}
    <div class="examples-editor__error">{pickerError}</div>
  {/if}

  {#each examples as example, index (index)}
    <div class="example-edit-card">
      <div class="example-edit-card__header">
        <input
          class="example-edit-card__name"
          value={example.name ?? ''}
          placeholder={exampleDisplayName(example, index)}
          aria-label="Example name"
          oninput={(event) =>
            onChange(updateExampleField(examples, index, 'name', event.currentTarget.value || undefined))
          }
        />
        <span class="example-edit-card__fallback">{exampleDisplayName(example, index)}</span>
        <button
          type="button"
          class="example-edit-card__move"
          disabled={index === 0}
          aria-label="Move example up"
          onclick={() => onChange(moveExample(examples, index, -1))}
        >↑</button>
        <button
          type="button"
          class="example-edit-card__move"
          disabled={index === examples.length - 1}
          aria-label="Move example down"
          onclick={() => onChange(moveExample(examples, index, 1))}
        >↓</button>
        <button
          type="button"
          class="variable-doc-edit__remove"
          onclick={() => onChange(removeExample(examples, index))}
        >Remove</button>
      </div>

      <div class="example-edit-card__fields">
        {#if example.inputFile}
          <div class="example-file-edit">
            <span class="example-field__label">Input file</span>
            <div class="example-file-edit__row">
              <input
                value={example.inputFile}
                aria-label="Input file reference"
                onchange={(event) =>
                  onChange(updateExampleField(examples, index, 'inputFile', event.currentTarget.value || undefined))
                }
              />
              {@render stateChip(resolutionFor(index, 'inputFile', example.inputFile))}
              <button type="button" class="link-btn" onclick={() => chooseInputFile(index)}>Choose file…</button>
              <button type="button" class="link-btn" onclick={() => onChange(clearFileRef(examples, index, 'inputFile'))}>Use inline input</button>
            </div>
          </div>
        {:else}
          <label class="example-inline-edit">
            <span class="example-field__label">Input</span>
            <textarea
              value={example.input ?? ''}
              placeholder="Inline input…"
              oninput={(event) =>
                onChange(updateExampleField(examples, index, 'input', event.currentTarget.value || undefined))
              }
            ></textarea>
            <button type="button" class="link-btn" onclick={() => chooseInputFile(index)}>Choose file instead…</button>
          </label>
        {/if}

        {#if example.outputFile}
          <div class="example-file-edit">
            <span class="example-field__label">Output file</span>
            <div class="example-file-edit__row">
              <input
                value={example.outputFile}
                aria-label="Output file reference"
                onchange={(event) =>
                  onChange(updateExampleField(examples, index, 'outputFile', event.currentTarget.value || undefined))
                }
              />
              {@render stateChip(resolutionFor(index, 'outputFile', example.outputFile))}
              <button type="button" class="link-btn" onclick={() => chooseOutputFile(index)}>Choose file…</button>
              <button type="button" class="link-btn" onclick={() => onChange(clearFileRef(examples, index, 'outputFile'))}>Use inline output</button>
            </div>
          </div>
        {:else}
          <label class="example-inline-edit">
            <span class="example-field__label">Output</span>
            <textarea
              value={example.output ?? ''}
              placeholder="Inline output…"
              oninput={(event) =>
                onChange(updateExampleField(examples, index, 'output', event.currentTarget.value || undefined))
              }
            ></textarea>
            <button type="button" class="link-btn" onclick={() => chooseOutputFile(index)}>Choose file instead…</button>
          </label>
        {/if}

        <label class="example-inline-edit">
          <span class="example-field__label">Notes</span>
          <textarea
            value={example.notes ?? ''}
            placeholder="Optional notes…"
            oninput={(event) =>
              onChange(updateExampleField(examples, index, 'notes', event.currentTarget.value || undefined))
            }
          ></textarea>
        </label>

        <div class="example-assets-edit">
          <span class="example-field__label">Files</span>
          {#each example.assets ?? [] as reference, assetIndex (assetIndex)}
            <div class="example-file-edit__row">
              <input
                value={reference}
                aria-label="Asset file reference"
                onchange={(event) =>
                  onChange(updateAsset(examples, index, assetIndex, event.currentTarget.value))
                }
              />
              {@render stateChip(resolutionFor(index, 'asset', reference, assetIndex))}
              <button type="button" class="link-btn" onclick={() => onChange(removeAsset(examples, index, assetIndex))}>Remove</button>
            </div>
          {/each}
          <div class="example-assets-edit__actions">
            <button type="button" class="link-btn" onclick={() => chooseAsset(index)}>Choose file…</button>
            <button type="button" class="link-btn" onclick={() => onChange(addAsset(examples, index, ''))}>Add blank</button>
          </div>
        </div>
      </div>
    </div>
  {/each}

  <button type="button" class="link-btn" onclick={() => onChange(addExample(examples))}>Add example</button>
</div>
