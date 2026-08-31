<script lang="ts">
  import { focusTrap } from '$lib/attachments/focusTrap';

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
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel,
  }: Props = $props();
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
      <button type="button" class="btn btn--ghost" onclick={onCancel} disabled={busy}>{cancelLabel}</button>
      <button type="button" class:btn--danger={destructive} class="btn btn--primary" onclick={confirm} disabled={busy}>
        {busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  </dialog>
</div>
