<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    title: string;
    children: Snippet;
  }

  let { id, title, children }: Props = $props();
  let open = $state(true);
</script>

<section class="metadata-inspector-section" data-collapsed={!open} aria-labelledby={`${id}-title`}>
  <button
    type="button"
    class="metadata-inspector-section__toggle"
    aria-expanded={open}
    aria-controls={`${id}-body`}
    onclick={() => (open = !open)}
  >
    <span id={`${id}-title`} class="metadata-inspector-section__title">{title}</span>
    <span class="metadata-inspector-section__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
  </button>
  <div
    id={`${id}-body`}
    class="metadata-inspector-section__body"
    role="region"
    aria-labelledby={`${id}-title`}
    hidden={!open}
  >
    {@render children()}
  </div>
</section>
