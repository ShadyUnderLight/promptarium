<script lang="ts">
  import { focusTrap } from '$lib/attachments/focusTrap';
  import { t } from '$lib/i18n/i18n.svelte';

  interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  }

  let {
    title,
    message,
    confirmLabel,
    cancelLabel,
    destructive = false,
    onConfirm,
    onCancel,
  }: Props = $props();
  // The button order in the markup is load-bearing. `focusTrap` moves focus to
  // the first focusable child, which is the Cancel button, so a bare Enter takes
  // the safe path — keep editing, cancel, or keep the project — and never lands
  // on Delete / Forget / Discard. Keep Cancel first; this is not a bug to fix.
  let busy = $state(false);

  async function confirm(): Promise<void> {
    busy = true;
    try {
      await onConfirm();
    } finally {
      busy = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onCancel()}>
  <dialog open class="modal library-confirm" aria-labelledby="confirm-title" onkeydown={handleKeydown} tabindex="-1" {@attach focusTrap}>
    <h2 id="confirm-title">{title}</h2>
    <p>{message}</p>
    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" onclick={onCancel} disabled={busy}>{cancelLabel ?? t('confirm.cancel')}</button>
      <button type="button" class:btn--danger={destructive} class="btn btn--primary" onclick={confirm} disabled={busy}>
        {busy ? t('confirm.working') : confirmLabel ?? t('confirm.confirm')}
      </button>
    </div>
  </dialog>
</div>
