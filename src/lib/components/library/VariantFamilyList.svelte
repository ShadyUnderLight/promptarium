<script lang="ts">
  import type { PromptDocument, PromptSummary } from '$lib/prompts/types';
  import { promptTitle } from '$lib/library.svelte';
  import { resolveVariantFamily, type VariantLink } from '$lib/variants/variants';
  import { t } from '$lib/i18n/i18n.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { MessageKey } from '$lib/i18n/locales/en';

  interface Props {
    document: PromptDocument;
    summaries: PromptSummary[];
    onNavigate: (projectPath: string, name: string) => void;
  }

  let { document, summaries, onNavigate }: Props = $props();

  const family = $derived(
    resolveVariantFamily(summaries, { projectPath: document.projectPath, name: document.name })
  );

  function linkLabel(link: VariantLink): string {
    return link.status === 'ok' && link.target ? promptTitle(link.target.name) : link.path;
  }

  function linkPath(link: VariantLink): string {
    return link.status === 'ok' && link.target ? link.target.name : link.path;
  }

  const statusKeys: Record<Exclude<VariantLink['status'], 'ok'>, MessageKey> = {
    missing: 'rel.status.missing',
    invalid: 'rel.status.invalid',
    self: 'rel.status.self',
  };

  function statusLabel(link: VariantLink): string {
    return link.status === 'ok' ? '' : t(statusKeys[link.status]);
  }
</script>

<section class="related-inspector" aria-label={t('variant.aria')}>
  <div class="detail-section__heading">{t('variant.heading')}</div>

  {#if family.parent}
    <div class="detail-section__heading related-inspector__heading">{t('variant.parent')}</div>
    <div class="related-list">
      {#if family.parent.status === 'ok' && family.parent.target}
        <button
          type="button"
          class="relation-row relation-row--ok"
          title={linkPath(family.parent)}
          onclick={() => onNavigate(family.parent!.target!.projectPath, family.parent!.target!.name)}
        >
          <span class="relation-name">{linkLabel(family.parent)}</span>
          <span class="relation-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>
        </button>
      {:else}
        <div class="relation-row relation-row--{family.parent.status}" title={linkPath(family.parent)}>
          <span class="relation-name">{linkLabel(family.parent)}</span>
          <span class="relation-status">{statusLabel(family.parent)}</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if family.children.length}
    <div class="detail-section__heading related-inspector__heading">{t('variant.children')} <span>{family.children.length}</span></div>
    <div class="related-list">
      {#each family.children as child (child.name)}
        <button
          type="button"
          class="relation-row relation-row--ok"
          title={child.name}
          onclick={() => onNavigate(child.projectPath, child.name)}
        >
          <span class="relation-name">{promptTitle(child.name)}</span>
          <span class="relation-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>
        </button>
      {/each}
    </div>
  {/if}

  {#if family.siblings.length}
    <div class="detail-section__heading related-inspector__heading">{t('variant.siblings')} <span>{family.siblings.length}</span></div>
    <div class="related-list">
      {#each family.siblings as sibling (sibling.name)}
        <button
          type="button"
          class="relation-row relation-row--ok"
          title={sibling.name}
          onclick={() => onNavigate(sibling.projectPath, sibling.name)}
        >
          <span class="relation-name">{promptTitle(sibling.name)}</span>
          <span class="relation-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>
        </button>
      {/each}
    </div>
  {/if}

  {#if !family.parent && !family.children.length && !family.siblings.length}
    <p class="detail-muted">{t('variant.none')}</p>
  {/if}
</section>
