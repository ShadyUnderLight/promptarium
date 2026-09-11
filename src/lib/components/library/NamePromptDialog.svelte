<script lang="ts">
  /**
   * In-app replacement for `window.prompt` on the naming steps of Prompt Detail
   * (rename / move / duplicate / duplicate as variant). macOS Tauri ships a
   * WKWebView whose UI delegate implements no JavaScript prompt panel, so
   * `window.prompt` resolves to `null` **without ever showing a dialog** — the
   * native call cannot be used at all, not merely styled differently.
   *
   * Reuses the small-modal shell (`.modal` + `.library-confirm`) and the
   * existing `filename` copy, so this component adds no CSS and no new strings.
   */
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import { t } from '$lib/i18n/i18n.svelte';

  interface Props {
    title: string;
    initialValue: string;
    /** Called with the raw input value; the caller decides what a no-op is. */
    onConfirm: (value: string) => void;
    onCancel: () => void;
  }

  let { title, initialValue, onConfirm, onCancel }: Props = $props();
  let input: HTMLInputElement | undefined = $state(undefined);

  onMount(() => {
    // Pre-select the suggestion so typing replaces it.
    input?.focus();
    input?.select();
  });

  function submit(): void {
    const raw = input?.value;
    if (raw?.trim()) {
      onConfirm(raw);
      return;
    }
    // An empty answer behaves like the native prompt it replaces: it closed and
    // the caller's `if (next)` treated '' as a no-op. Closing here keeps that
    // contract — a blank submit must not leave an inert dialog on screen that
    // looks like the button is broken.
    onCancel();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  function handleInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onCancel()}>
  <dialog open class="modal library-confirm" aria-labelledby="name-prompt-title" onkeydown={handleKeydown} tabindex="-1" {@attach focusTrap}>
    <div class="dialog-heading"><h2 id="name-prompt-title">{title}</h2></div>
    <label class="field">
      <span>{t('newPrompt.filename')} <small>{t('newPrompt.filenameHint')}</small></span>
      <input bind:this={input} value={initialValue} spellcheck="false" onkeydown={handleInputKeydown} />
    </label>
    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" onclick={onCancel}>{t('confirm.cancel')}</button>
      <button type="button" class="btn btn--primary" onclick={submit}>{t('confirm.confirm')}</button>
    </div>
  </dialog>
</div>
