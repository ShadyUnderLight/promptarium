<script lang="ts">
  import type { VariableDoc } from '$lib/prompts/types';
  import { deriveVariableContract } from '$lib/variables/contract';
  import { t } from '$lib/i18n/i18n.svelte';

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
  <div class="detail-section__heading">{t('meta.variables')} <span>{bodyVariableCount}</span></div>
  {#if bodyVariableCount || contract.stale.length}
    <div class="variable-contract">
      {#each contract.documented as variable (variable.name)}
        <div class="variable-doc-row">
          <span class="variable-token">{variable.name}</span>
          {#if variable.description}<span class="variable-doc-text">{variable.description}</span>{/if}
          {#if variable.example}<span class="variable-doc-example">{t('vars.examplePrefix', { example: variable.example })}</span>{/if}
        </div>
      {/each}
      {#each contract.undocumented as variable (variable.name)}
        <div class="variable-doc-row variable-doc-row--undocumented">
          <span class="variable-token">{variable.name}</span>
          <span class="variable-doc-status">{t('vars.needsDescription')}</span>
        </div>
      {/each}
      {#each contract.stale as variable (variable.name)}
        <div class="variable-doc-row variable-doc-row--stale">
          <span class="variable-token">{variable.name}</span>
          <span class="variable-doc-status">{t('vars.stale')}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="detail-muted">{t('vars.none')}</p>
  {/if}
</section>
