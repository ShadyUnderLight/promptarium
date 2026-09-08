<script lang="ts">
  import { renderMarkdown } from '$lib/library/markdown';
  import { t } from '$lib/i18n/i18n.svelte';

  interface Props {
    body: string;
  }

  let { body }: Props = $props();
  const html = $derived(renderMarkdown(body));
</script>

<article class="markdown-preview">
  {#if body.trim()}
    {@html html}
  {:else}
    <p class="detail-placeholder">{t('detail.emptyBody')}</p>
  {/if}
</article>
