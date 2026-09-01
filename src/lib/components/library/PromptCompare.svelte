<script lang="ts">
  import { readPrompt } from '$lib/api';
  import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
  import { diffMetadata, diffTexts } from '$lib/prompts/compare';
  import DiffViewer from './DiffViewer.svelte';

  interface Props {
    /** Left side: the currently selected prompt (loaded document, disk truth —
     *  Compare never reloads the current buffer, so a dirty editor is never
     *  overwritten by opening it). */
    document: PromptDocument;
    summaries: PromptSummary[];
    onClose: () => void;
  }

  let { document, summaries, onClose }: Props = $props();

  const others = $derived(
    summaries
      .filter((summary) => summary.projectPath === document.projectPath && summary.name !== document.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  );

  let targetName = $state('');
  let target = $state<PromptDocument | null>(null);
  let loading = $state(false);
  let error = $state('');

  $effect(() => {
    if (!targetName) {
      target = null;
      return;
    }
    let cancelled = false;
    loading = true;
    error = '';
    void readPrompt(document.projectPath, targetName)
      .then((doc) => {
        if (cancelled) return;
        target = doc;
      })
      .catch((err) => {
        if (cancelled) return;
        error = err instanceof Error ? err.message : String(err);
        target = null;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const bodyPatch = $derived(target ? diffTexts(document.body, target.body) : '');
  const metadataDiff = $derived(target ? diffMetadata(document.metadata, target.metadata) : []);

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <dialog open class="modal compare-modal" aria-label="Compare prompts" onkeydown={handleKeydown} tabindex="-1">
    <div class="compare-modal__head">
      <h3>Compare with…</h3>
      <div class="compare-modal__controls">
        <select class="compare-picker" aria-label="Prompt to compare with" value={targetName} onchange={(event) => (targetName = event.currentTarget.value)}>
          <option value="" disabled>Choose a prompt…</option>
          {#each others as other (other.name)}
            <option value={other.name}>{other.name}</option>
          {/each}
        </select>
        <button type="button" class="btn btn--ghost btn--sm" onclick={onClose}>Close</button>
      </div>
    </div>

    {#if !others.length}
      <p class="compare-empty">No other prompt in this project to compare with.</p>
    {:else if loading}
      <p class="compare-empty">Loading the prompt to compare…</p>
    {:else if error}
      <p class="compare-empty">{error}</p>
    {:else if target}
      <section class="compare-section">
        <div class="compare-section__heading">Body</div>
        {#if bodyPatch}
          <DiffViewer patch={bodyPatch} />
        {:else}
          <p class="compare-empty">No body differences.</p>
        {/if}
      </section>
      <section class="compare-section">
        <div class="compare-section__heading">Metadata</div>
        {#if metadataDiff.length}
          {#each metadataDiff as diff (diff.field)}
            <div class="compare-meta-row">
              <span class="compare-meta-row__field">{diff.field}</span>
              <span class="compare-meta-row__left">{diff.left}</span>
              <span class="compare-meta-row__arrow" aria-hidden="true">→</span>
              <span class="compare-meta-row__right">{diff.right}</span>
            </div>
          {/each}
        {:else}
          <p class="compare-empty">No metadata differences.</p>
        {/if}
      </section>
    {/if}
  </dialog>
</div>
