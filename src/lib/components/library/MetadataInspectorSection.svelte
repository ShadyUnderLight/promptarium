<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    children: Snippet;
  }

  let { title, children }: Props = $props();
  let open = $state(true);
</script>

<section class="metadata-inspector-section" data-collapsed={!open}>
  <button
    type="button"
    class="metadata-inspector-section__toggle"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="metadata-inspector-section__title">{title}</span>
    <span class="metadata-inspector-section__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
  </button>
  {#if open}
    <div class="metadata-inspector-section__body">
      {@render children()}
    </div>
  {/if}
</section>
