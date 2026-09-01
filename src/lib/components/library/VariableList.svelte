<script lang="ts">
  import type { VariableDoc } from '$lib/prompts/types';
  import { deriveVariableContract } from '$lib/variables/contract';

  interface Props {
    body: string;
    annotations?: Record<string, VariableDoc>;
  }

  let { body, annotations }: Props = $props();
  const contract = $derived(deriveVariableContract(body, annotations));
  // The count always comes from the body parser: documented + undocumented
  // exhaust the parsed variables. Stale annotations are metadata-only.
  const bodyVariableCount = $derived(contract.documented.length + contract.undocumented.length);
</script>

<section class="variable-inspector">
  <div class="detail-section__heading">Variables <span>{bodyVariableCount}</span></div>
  {#if bodyVariableCount || contract.stale.length}
    <div class="variable-contract">
      {#each contract.documented as variable (variable.name)}
        <div class="variable-doc-row">
          <span class="variable-token">{variable.name}</span>
          {#if variable.description}<span class="variable-doc-text">{variable.description}</span>{/if}
          {#if variable.example}<span class="variable-doc-example">Example: {variable.example}</span>{/if}
        </div>
      {/each}
      {#each contract.undocumented as variable (variable.name)}
        <div class="variable-doc-row variable-doc-row--undocumented">
          <span class="variable-token">{variable.name}</span>
          <span class="variable-doc-status">Needs description</span>
        </div>
      {/each}
      {#each contract.stale as variable (variable.name)}
        <div class="variable-doc-row variable-doc-row--stale">
          <span class="variable-token">{variable.name}</span>
          <span class="variable-doc-status">Not used in body</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="detail-muted">No variables detected in this prompt.</p>
  {/if}
</section>
