<script lang="ts">
  import { tick } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import type { VariableDoc } from '$lib/prompts/types';
  import { parseVariables, renderFilledPrompt } from '$lib/variables/variables';
  import { t } from '$lib/i18n/i18n.svelte';
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    body: string;
    annotations?: Record<string, VariableDoc>;
    onCopy: (text: string) => Promise<boolean>;
    onClose: () => void;
  }

  let { body, annotations, onCopy, onClose }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state(undefined);
  let fills = $state<Record<string, string>>({});
  let busy = $state(false);
  const variables = $derived(parseVariables(body));

  function docFor(name: string): VariableDoc | undefined {
    return annotations && Object.hasOwn(annotations, name) ? annotations[name] : undefined;
  }

  function valueFor(name: string): string {
    return Object.hasOwn(fills, name) ? fills[name] : '';
  }

  function setFill(name: string, value: string): void {
    fills = Object.fromEntries([...Object.entries(fills).filter(([key]) => key !== name), [name, value]]);
  }

  async function copy(): Promise<void> {
    if (busy) return;
    const focusBeforeCopy =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    busy = true;
    let copied = false;
    try {
      copied = await onCopy(renderFilledPrompt(body, fills));
    } finally {
      busy = false;
    }
    if (copied) {
      onClose();
      return;
    }
    await tick();
    if (focusBeforeCopy && dialog?.contains(focusBeforeCopy)) {
      focusBeforeCopy.focus();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <dialog
    open
    bind:this={dialog}
    class="modal variable-fill-dialog"
    aria-labelledby="variable-fill-title"
    onkeydown={handleKeydown}
    tabindex="-1"
    {@attach focusTrap}
  >
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">{t('variableFill.eyebrow')}</span>
        <h2 id="variable-fill-title">{t('variableFill.title')}</h2>
      </div>
      <button type="button" class="icon-button" aria-label={t('variableFill.close')} title={t('variableFill.close')} onclick={onClose} disabled={busy}>
        <Icon name="close" />
      </button>
    </div>

    <p class="variable-fill-dialog__hint">{t('variableFill.hint')}</p>

    <form onsubmit={(event) => { event.preventDefault(); void copy(); }}>
      <div class="variable-fill-dialog__fields">
        {#each variables as variable (variable.name)}
          {@const doc = docFor(variable.name)}
          <label class="variable-fill-field">
            <span class="variable-fill-field__name">
              <span class="variable-token">{`{${variable.name}}`}</span>
              <span class="variable-fill-field__label">{t('variableFill.field', { name: variable.name })}</span>
            </span>
            {#if doc?.description}
              <span class="variable-fill-field__description">{doc.description}</span>
            {/if}
            <textarea
              rows="2"
              value={valueFor(variable.name)}
              placeholder={doc?.example ?? t('variableFill.emptyPlaceholder')}
              aria-label={t('variableFill.field', { name: variable.name })}
              oninput={(event) => setFill(variable.name, event.currentTarget.value)}
              disabled={busy}
            ></textarea>
            {#if doc?.example}
              <span class="variable-fill-field__example">{t('variableFill.example', { example: doc.example })}</span>
            {/if}
          </label>
        {/each}
      </div>

      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" onclick={onClose} disabled={busy}>{t('variableFill.cancel')}</button>
        <button type="submit" class="btn btn--primary" disabled={busy}>
          {busy ? t('variableFill.copying') : t('variableFill.copy')}
        </button>
      </div>
    </form>
  </dialog>
</div>
