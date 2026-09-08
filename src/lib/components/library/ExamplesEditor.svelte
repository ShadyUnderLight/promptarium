<script lang="ts">
  import { resolvePromptAssets, pickAssetReference } from '$lib/api';
  import type { PromptExample, ResolvedPromptAsset } from '$lib/prompts/types';
  import {
    addExample,
    removeExample,
    moveExample,
    updateExampleField,
    addAsset,
    addBlankAsset,
    updateAsset,
    removeAsset,
    replaceInputWithFile,
    replaceOutputWithFile,
    clearFileRef,
    assetResolutionKey,
  } from '$lib/examples/editor-helpers';
  import { t } from '$lib/i18n/i18n.svelte';

  interface Props {
    examples: PromptExample[];
    /** Project the edited prompt lives in — the only identity used by the
     *  resolver and the picker (never the active project). */
    projectPath: string;
    /** Bumped by the library after a filesystem refresh. Only the derived
     *  asset-state preview re-resolves; the editor metadata is never touched
     *  (Issue #26 §14 live refresh). */
    refreshVersion?: number;
    onChange: (examples: PromptExample[]) => void;
  }

  let { examples, projectPath, refreshVersion = 0, onChange }: Props = $props();

  // ── Asset state preview (Issue #26 §9) ──────────────────────────────────
  // Every reference (inputFile / outputFile / assets) is classified through the
  // backend resolver; a state chip sits next to each reference input so a
  // hand-typed path shows Ready / Missing / Invalid without a separate save.
  // References are identified by `{index, role, sub}` (position, no persistent
  // IDs) and re-resolved whenever the set or the Project changes. Empty asset
  // entries are the editor's "Add blank" draft rows and are skipped here.
  const refs = $derived(
    examples.flatMap((example, index) => {
      const list: Array<{ index: number; role: 'inputFile' | 'outputFile' | 'asset'; reference: string; sub?: number }> = [];
      if (example.inputFile) list.push({ index, role: 'inputFile', reference: example.inputFile });
      if (example.outputFile) list.push({ index, role: 'outputFile', reference: example.outputFile });
      (example.assets ?? []).forEach((reference, sub) => {
        if (!reference.trim()) return;
        list.push({ index, role: 'asset', reference, sub });
      });
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
    // Reading refreshVersion keeps the asset-state chips in sync with a
    // filesystem refresh (e.g. a Missing file created in Finder flips to
    // Ready) without touching the editor metadata.
    refreshVersion;
    if (!proj || !refs.length) {
      resolution = {};
      return;
    }
    // A new resolve request never reuses the previous Project's visible state
    // (Issue #30 P2): clear the map up front so a stale Ready/Missing can never
    // leak across a Project switch, keep the stale-write guard, and handle
    // rejection by falling back to an empty map — never an old result.
    resolution = {};
    let cancelled = false;
    void resolvePromptAssets(
      proj,
      refs.map((r) => r.reference)
    ).then(
      (results) => {
        if (cancelled) return;
        const map: Record<string, ResolvedPromptAsset> = {};
        results.forEach((result, i) => {
          map[
            assetResolutionKey(proj, {
              index: refs[i].index,
              role: refs[i].role,
              sub: refs[i].sub,
              reference: result.reference,
            })
          ] = result;
        });
        resolution = map;
      },
      () => {
        if (cancelled) return;
        resolution = {};
      }
    );
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
    return resolution[assetResolutionKey(projectPath, { index, role, sub, reference })];
  }

  const stateKeys: Record<ResolvedPromptAsset['state'], 'examples.state.ready' | 'examples.state.missing' | 'examples.state.invalid'> = {
    resolved: 'examples.state.ready',
    missing: 'examples.state.missing',
    invalid: 'examples.state.invalid',
  };

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
      const ok = window.confirm(t('examples.confirm.replaceInput'));
      if (!ok) return;
    }
    onChange(replaceInputWithFile(examples, index, reference));
  }

  async function chooseOutputFile(index: number): Promise<void> {
    const reference = await pickFor(index);
    if (!reference) return;
    const example = examples[index];
    if (example.output) {
      const ok = window.confirm(t('examples.confirm.replaceOutput'));
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
    const result = await pickAssetReference(projectPath, t('examples.picker.title'));
    if (result.reference) return result.reference;
    if (result.failure === 'no-reference') pickerError = t('examples.picker.noReference');
    else if (result.failure === 'failed') {
      pickerError = t('examples.picker.failed', { detail: result.detail ?? '' });
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
    >{t(stateKeys[resolved.state])}</span>
  {/if}
{/snippet}

<div class="examples-editor">
  <div class="examples-editor__heading-row">
    <span class="variables-editor__heading">Examples</span>
    <span class="examples-editor__hint">{t('examples.editor.hint')}</span>
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
          placeholder={example.name || t('examples.fallbackName', { n: index + 1 })}
          aria-label={t('examples.editor.name.aria')}
          oninput={(event) =>
            onChange(updateExampleField(examples, index, 'name', event.currentTarget.value || undefined))
          }
        />
        <span class="example-edit-card__fallback">{example.name || t('examples.fallbackName', { n: index + 1 })}</span>
        <button
          type="button"
          class="example-edit-card__move"
          disabled={index === 0}
          aria-label={t('examples.editor.moveUp.aria')}
          onclick={() => onChange(moveExample(examples, index, -1))}
        >↑</button>
        <button
          type="button"
          class="example-edit-card__move"
          disabled={index === examples.length - 1}
          aria-label={t('examples.editor.moveDown.aria')}
          onclick={() => onChange(moveExample(examples, index, 1))}
        >↓</button>
        <button
          type="button"
          class="variable-doc-edit__remove"
          onclick={() => onChange(removeExample(examples, index))}
        >{t('meta.remove')}</button>
      </div>

      <div class="example-edit-card__fields">
        {#if example.inputFile}
          <div class="example-file-edit">
            <span class="example-field__label">{t('examples.inputFile')}</span>
            <div class="example-file-edit__row">
              <input
                value={example.inputFile}
                aria-label={t('examples.editor.inputRef.aria')}
                oninput={(event) =>
                  onChange(updateExampleField(examples, index, 'inputFile', event.currentTarget.value || undefined))
                }
              />
              {@render stateChip(resolutionFor(index, 'inputFile', example.inputFile))}
              <button type="button" class="link-btn" onclick={() => chooseInputFile(index)}>{t('examples.editor.chooseFile')}</button>
              <button type="button" class="link-btn" onclick={() => onChange(clearFileRef(examples, index, 'inputFile'))}>{t('examples.editor.useInlineInput')}</button>
            </div>
          </div>
        {:else}
          <label class="example-inline-edit">
            <span class="example-field__label">{t('examples.input')}</span>
            <textarea
              value={example.input ?? ''}
              placeholder={t('examples.editor.inlineInput.placeholder')}
              oninput={(event) =>
                onChange(updateExampleField(examples, index, 'input', event.currentTarget.value || undefined))
              }
            ></textarea>
            <button type="button" class="link-btn" onclick={() => chooseInputFile(index)}>{t('examples.editor.chooseFileInstead')}</button>
          </label>
        {/if}

        {#if example.outputFile}
          <div class="example-file-edit">
            <span class="example-field__label">{t('examples.outputFile')}</span>
            <div class="example-file-edit__row">
              <input
                value={example.outputFile}
                aria-label={t('examples.editor.outputRef.aria')}
                oninput={(event) =>
                  onChange(updateExampleField(examples, index, 'outputFile', event.currentTarget.value || undefined))
                }
              />
              {@render stateChip(resolutionFor(index, 'outputFile', example.outputFile))}
              <button type="button" class="link-btn" onclick={() => chooseOutputFile(index)}>{t('examples.editor.chooseFile')}</button>
              <button type="button" class="link-btn" onclick={() => onChange(clearFileRef(examples, index, 'outputFile'))}>{t('examples.editor.useInlineOutput')}</button>
            </div>
          </div>
        {:else}
          <label class="example-inline-edit">
            <span class="example-field__label">{t('examples.output')}</span>
            <textarea
              value={example.output ?? ''}
              placeholder={t('examples.editor.inlineOutput.placeholder')}
              oninput={(event) =>
                onChange(updateExampleField(examples, index, 'output', event.currentTarget.value || undefined))
              }
            ></textarea>
            <button type="button" class="link-btn" onclick={() => chooseOutputFile(index)}>{t('examples.editor.chooseFileInstead')}</button>
          </label>
        {/if}

        <label class="example-inline-edit">
          <span class="example-field__label">{t('examples.notes')}</span>
          <textarea
            value={example.notes ?? ''}
            placeholder={t('examples.editor.notes.placeholder')}
            oninput={(event) =>
              onChange(updateExampleField(examples, index, 'notes', event.currentTarget.value || undefined))
            }
          ></textarea>
        </label>

        <div class="example-assets-edit">
          <span class="example-field__label">{t('examples.files')}</span>
          {#each example.assets ?? [] as reference, assetIndex (assetIndex)}
            <div class="example-file-edit__row" class:example-file-edit__row--draft={!reference.trim()}>
              <input
                value={reference}
                placeholder={reference.trim() ? '' : t('examples.editor.asset.placeholder')}
                aria-label={t('examples.editor.assetRef.aria')}
                oninput={(event) =>
                  onChange(updateAsset(examples, index, assetIndex, event.currentTarget.value))
                }
              />
              {@render stateChip(resolutionFor(index, 'asset', reference, assetIndex))}
              <button type="button" class="link-btn" onclick={() => onChange(removeAsset(examples, index, assetIndex))}>{t('meta.remove')}</button>
            </div>
          {/each}
          <div class="example-assets-edit__actions">
            <button type="button" class="link-btn" onclick={() => chooseAsset(index)}>{t('examples.editor.chooseFile')}</button>
            <button type="button" class="link-btn" onclick={() => onChange(addBlankAsset(examples, index))}>{t('examples.editor.addBlank')}</button>
          </div>
        </div>
      </div>
    </div>
  {/each}

  <button type="button" class="link-btn" onclick={() => onChange(addExample(examples))}>{t('examples.editor.addExample')}</button>
</div>
