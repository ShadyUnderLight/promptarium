<script lang="ts">
  import { parseVariables } from '$lib/compose/variables';

  interface Props {
    body: string;
  }

  let { body }: Props = $props();
  const variables = $derived(parseVariables(body));
</script>

<section class="variable-inspector">
  <div class="detail-section__heading">Variables <span>{variables.length}</span></div>
  {#if variables.length}
    <div class="variable-list">
      {#each variables as variable (variable.name)}
        <span class="variable-token">{variable.name}</span>
      {/each}
    </div>
  {:else}
    <p class="detail-muted">No variables detected in this prompt.</p>
  {/if}
</section>
