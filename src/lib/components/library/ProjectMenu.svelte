<script lang="ts">
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import { isTauri, revealInFinder as apiRevealInFinder } from '$lib/api';
  import type { Project } from '$lib/prompts/types';
  import { forgetProject, renameProjectLabel, setProjectColor } from '$lib/library.svelte';
  import { errorDetail } from '$lib/library/errors';
  import { t } from '$lib/i18n/i18n.svelte';

  type NameRequestOptions = {
    label?: string;
    hint?: string;
    placeholder?: string;
  };

  type ConfirmRequestOptions = {
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  };

  interface Props {
    project: Project;
    x: number;
    y: number;
    onClose: () => void;
    onNotice: (message: string) => void;
    canNavigate: () => Promise<boolean>;
    /** In-app dialogs are supplied by PromptsView in the packaged window. */
    requestName?: (title: string, initialValue: string, options?: NameRequestOptions) => Promise<string | null>;
    requestConfirm?: (title: string, message: string, options?: ConfirmRequestOptions) => Promise<boolean>;
  }

  let {
    project,
    x,
    y,
    onClose,
    onNotice,
    canNavigate,
    requestName,
    requestConfirm,
  }: Props = $props();
  const colors = ['#4f7cff', '#0e9f6e', '#d97706', '#8b5cf6', '#db2777', '#0891b2'];
  let menuElement: HTMLElement | undefined = $state(undefined);

  onMount(() => menuElement?.focus());

  async function askName(title: string, initialValue: string, options?: NameRequestOptions): Promise<string | null> {
    // Browser dev keeps the quick native fallback. WKWebView in the packaged
    // app has no prompt panel, so an absent app callback cancels safely.
    if (!isTauri()) return window.prompt(title, initialValue);
    return requestName ? requestName(title, initialValue, options) : null;
  }

  async function askConfirm(title: string, message: string, options?: ConfirmRequestOptions): Promise<boolean> {
    if (!isTauri()) return window.confirm(message);
    return requestConfirm ? requestConfirm(title, message, options) : false;
  }

  async function rename(): Promise<void> {
    const currentProject = project;
    const notify = onNotice;
    onClose();
    const name = await askName(
      t('dialog.projectLabel'),
      currentProject.name,
      { label: t('dialog.projectLabel'), hint: '' }
    );
    if (!name?.trim() || name.trim() === currentProject.name) return;
    try {
      await renameProjectLabel(name.trim(), currentProject.path);
      notify(t('notice.projectLabelUpdated'));
    } catch (error) {
      notify(errorDetail(error));
    }
  }

  async function chooseColor(color: string | null): Promise<void> {
    try {
      await setProjectColor(project.path, color);
      onClose();
    } catch (error) {
      onNotice(errorDetail(error));
    }
  }

  async function forget(): Promise<void> {
    // Close the menu before either app-owned dialog can ask. This backdrop is
    // a context layer (z-index 150/151) painting over the `.modal-backdrop`
    // (100) every ConfirmDialog/NamePromptDialog renders in, so a menu left
    // standing would bury the dialog and swallow its clicks. Capture values
    // before unmounting because the close nulls this component's props.
    const currentProject = project;
    const path = currentProject.path;
    const name = currentProject.name;
    const notify = onNotice;
    onClose();
    if (
      !(await askConfirm(
        t('dialog.forgetProject.title'),
        t('dialog.forgetProject', { name }),
        { confirmLabel: t('confirm.forgetProject'), destructive: true }
      ))
    ) return;
    if (!(await canNavigate())) return;
    try {
      await forgetProject(path);
      notify(t('notice.projectForgottenKept'));
    } catch (error) {
      notify(errorDetail(error));
    }
  }

  async function reveal(): Promise<void> {
    try {
      await apiRevealInFinder(project.path);
    } catch (error) {
      onNotice(errorDetail(error));
    }
    onClose();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div class="context-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}></div>
<section bind:this={menuElement} class="project-menu" style={'left:' + x + 'px; top:' + y + 'px'} role="menu" tabindex="-1" onkeydown={handleKeydown} {@attach focusTrap}>
  <div class="project-menu__heading">{project.name}</div>
  <button type="button" role="menuitem" onclick={rename}>{t('menu.renameLabel')}</button>
  <button type="button" role="menuitem" onclick={reveal}>{t('menu.revealInFinder')}</button>
  <div class="project-menu__label">{t('menu.projectColor')}</div>
  <div class="project-menu__colors">
    {#each colors as color}
      <button type="button" class="color-swatch" style={'--swatch:' + color} class:color-swatch--selected={project.color === color} aria-label={t('menu.useColor', { color })} onclick={() => chooseColor(color)}></button>
    {/each}
    <button type="button" class="color-clear" onclick={() => chooseColor(null)}>{t('menu.clearColor')}</button>
  </div>
  <div class="project-menu__rule"></div>
  <button type="button" class="project-menu__danger" role="menuitem" onclick={forget}>{t('menu.forgetProject')}</button>
</section>
