<script lang="ts">
  import { resolvePromptAssets, revealAssetInFinder } from '$lib/api';
  import type { PromptExample, ResolvedPromptAsset } from '$lib/prompts/types';
  import { exampleDisplayName } from '$lib/examples/editor-helpers';

  interface Props {
    examples: PromptExample[];
    /** Project the selected prompt lives in — the only identity used to resolve
     *  and reveal assets (never the active project). */
    projectPath: string;
    /** Bumped by the library after a filesystem refresh so a missing asset that
     *  appears on disk flips to Ready without reopening the prompt. */
    refreshVersion: number;
  }

  let { examples, projectPath, refreshVersion }: Props = $props();

  /** Flat, deterministic list of file references to classify, one entry per
   *  role (inputFile / outputFile / asset) so each is shown under its role. */
  const entries = $derived(
    examples.flatMap((example, index) => {
      const refs: Array<{ index: number; role: 'inputFile' | 'outputFile' | 'asset'; reference: string }> = [];
      if (example.inputFile) refs.push({ index, role: 'inputFile', reference: example.inputFile });
      if (example.outputFile) refs.push({ index, role: 'outputFile', reference: example.outputFile });
      for (const reference of example.assets ?? []) refs.push({ index, role: 'asset', reference });
      return refs;
    })
  );

  /** Resolution state keyed by `${index}:${role}:${reference}`. Missing/invalid
   *  references stay visible with their raw path; only Ready references Reveal. */
  let resolution = $state<Record<string, ResolvedPromptAsset>>({});

  const referencesKey = $derived(entries.map((e) => `${e.index}:${e.role}:${e.reference}`).join('\n'));

  $effect(() => {
    const proj = projectPath;
    const key = referencesKey;
    // Reading refreshVersion keeps the resolver re-running after an fs refresh.
    refreshVersion;
    if (!proj || !entries.length) {
      resolution = {};
      return;
    }
    let cancelled = false;
    void resolvePromptAssets(
      proj,
      entries.map((e) => e.reference)
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, ResolvedPromptAsset> = {};
      results.forEach((result, i) => {
        map[`${entries[i].index}:${entries[i].role}:${result.reference}`] = result;
      });
      resolution = map;
    });
    return () => {
      cancelled = true;
    };
  });

  /** Expansion is UI session state only — never persisted. One example is
   *  expanded by default; with several, the first is expanded and the rest are
   *  collapsed. The default resets when the example set changes. */
  let expanded = $state<boolean[]>([]);
  $effect(() => {
    const count = examples.length;
    if (expanded.length === count) return;
    expanded = examples.map((_, index) => (count === 1 ? true : index === 0));
  });

  function toggle(index: number): void {
    const next = [...expanded];
    next[index] = !next[index];
    expanded = next;
  }

  function resolutionFor(
    index: number,
    role: 'inputFile' | 'outputFile' | 'asset',
    reference: string
  ): ResolvedPromptAsset | undefined {
    return resolution[`${index}:${role}:${reference}`];
  }

  async function reveal(project: string, reference: string): Promise<void> {
    try {
      await revealAssetInFinder(project, reference);
    } catch {
      // Reveal fails closed on the backend; a failure here is not an editor error.
    }
  }

  function stateLabel(state: ResolvedPromptAsset['state']): string {
    return state === 'resolved' ? 'Ready' : state === 'missing' ? 'Missing' : 'Invalid';
  }

  function kindLabel(kind: ResolvedPromptAsset['kind'] | undefined): string {
    if (!kind) return 'File';
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
</script>

{#snippet fileRow(resolved: ResolvedPromptAsset | undefined, project: string, onReveal: (project: string, reference: string) => Promise<void>)}
  {#if resolved}
    <div class="example-file-row">
      <span class="example-file-row__ref">{resolved.reference}</span>
      <span class="example-file-row__kind">{kindLabel(resolved.kind)}</span>
      <span class:example-file-row__state--ready={resolved.state === 'resolved'} class:example-file-row__state--missing={resolved.state === 'missing'} class:example-file-row__state--invalid={resolved.state === 'invalid'} class="example-file-row__state">
        {stateLabel(resolved.state)}
      </span>
      {#if resolved.state === 'resolved'}
        <button type="button" class="example-file-row__reveal" onclick={() => onReveal(project, resolved.reference)}>Reveal</button>
      {/if}
    </div>
  {/if}
{/snippet}

{#if examples.length}
  <div class="examples-section">
    <div class="examples-section__heading">Examples ({examples.length})</div>
    <div class="examples-list">
      {#each examples as example, index (index)}
        <div class="example-card">
          <button
            type="button"
            class="example-card__toggle"
            aria-expanded={expanded[index] === true}
            onclick={() => toggle(index)}
          >
            <span class="example-card__chevron">{expanded[index] ? '▾' : '▸'}</span>
            <span class="example-card__name">{exampleDisplayName(example, index)}</span>
          </button>
          {#if expanded[index]}
            <div class="example-card__body">
              {#if example.input}
                <div class="example-field">
                  <span class="example-field__label">Input</span>
                  <pre class="example-text">{example.input}</pre>
                </div>
              {/if}
              {#if example.inputFile}
                <div class="example-field">
                  <span class="example-field__label">Input file</span>
                  {@render fileRow(resolutionFor(index, 'inputFile', example.inputFile), projectPath, reveal)}
                </div>
              {/if}
              {#if example.output}
                <div class="example-field">
                  <span class="example-field__label">Output</span>
                  <pre class="example-text">{example.output}</pre>
                </div>
              {/if}
              {#if example.outputFile}
                <div class="example-field">
                  <span class="example-field__label">Output file</span>
                  {@render fileRow(resolutionFor(index, 'outputFile', example.outputFile), projectPath, reveal)}
                </div>
              {/if}
              {#if example.notes}
                <div class="example-field">
                  <span class="example-field__label">Notes</span>
                  <div class="example-notes">{example.notes}</div>
                </div>
              {/if}
              {#if example.assets?.length}
                <div class="example-field">
                  <span class="example-field__label">Files</span>
                  <div class="example-files">
                    {#each example.assets as reference, assetIndex (assetIndex)}
                      {@render fileRow(resolutionFor(index, 'asset', reference), projectPath, reveal)}
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
