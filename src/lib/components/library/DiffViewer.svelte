<script lang="ts">
  import { parseDiffLines } from '$lib/prompts/diff-lines';

  interface Props {
    patch: string;
  }

  let { patch }: Props = $props();

  const lines = $derived(parseDiffLines(patch));
</script>

<pre class="diff-viewer" aria-label="File diff">
  {#each lines as line}
    <span class="diff-line diff-line--{line.kind}">{line.text || ' '}</span>
  {/each}
</pre>
