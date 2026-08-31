<script lang="ts">
  import { renderMarkdown } from '$lib/library/markdown';

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
    <p class="detail-placeholder">This prompt has an empty body.</p>
  {/if}
</article>
