<script lang="ts">
  import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
  import { promptTitle } from '$lib/library.svelte';
  import { resolveRelations, type RelationLink } from '$lib/relations/relations';

  interface Props {
    document: PromptDocument;
    summaries: PromptSummary[];
    onNavigate: (projectPath: string, name: string) => void;
    /** In-editor `related` for the selected prompt; when provided it drives the
     *  outgoing list so the footer never disagrees with a dirty metadata editor.
     *  Backlinks always come from disk summaries. */
    relatedOverride?: string[];
  }

  let { document, summaries, onNavigate, relatedOverride }: Props = $props();
  const resolution = $derived(
    resolveRelations(
      summaries,
      { projectPath: document.projectPath, name: document.name },
      relatedOverride
    )
  );

  function linkLabel(link: RelationLink): string {
    return link.status === 'ok' && link.target ? promptTitle(link.target.name) : link.path;
  }

  function linkPath(link: RelationLink): string {
    return link.status === 'ok' && link.target ? link.target.name : link.path;
  }

  function linkStatusText(link: RelationLink): string {
    if (link.status === 'missing') return 'Missing';
    if (link.status === 'invalid') return 'Invalid';
    return 'Self';
  }
</script>

<section class="related-inspector" aria-label="Related prompts">
  <div class="detail-section__heading">Related <span>{resolution.related.length}</span></div>
  {#if resolution.related.length}
    <div class="related-list">
      {#each resolution.related as link (link.path)}
        {#if link.status === 'ok' && link.target}
          <button type="button" class="relation-row relation-row--ok" title={linkPath(link)} onclick={() => onNavigate(link.target!.projectPath, link.target!.name)}>
            <span class="relation-name">{linkLabel(link)}</span>
            <span class="relation-arrow" aria-hidden="true">→</span>
          </button>
        {:else}
          <div class="relation-row relation-row--{link.status}" title={linkPath(link)}>
            <span class="relation-name">{linkLabel(link)}</span>
            <span class="relation-status">{linkStatusText(link)}</span>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="detail-muted">No related prompts.</p>
  {/if}

  <div class="detail-section__heading related-inspector__heading">Referenced by <span>{resolution.referencedBy.length}</span></div>
  {#if resolution.referencedBy.length}
    <div class="related-list">
      {#each resolution.referencedBy as source (source.projectPath + '\u0000' + source.name)}
        <button type="button" class="relation-row relation-row--backlink" title={source.name} onclick={() => onNavigate(source.projectPath, source.name)}>
          <span class="relation-name">{promptTitle(source.name)}</span>
          <span class="relation-arrow" aria-hidden="true">←</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="detail-muted">No prompts reference this one.</p>
  {/if}
</section>
