<script lang="ts">
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import { revealInFinder as apiRevealInFinder } from '$lib/api';
  import type { Project } from '$lib/prompts/types';
  import { forgetProject, renameProjectLabel, setProjectColor } from '$lib/library.svelte';
  import { errorDetail } from '$lib/library/errors';

  interface Props {
    project: Project;
    x: number;
    y: number;
    onClose: () => void;
    onNotice: (message: string) => void;
    canNavigate: () => boolean;
  }

  let { project, x, y, onClose, onNotice, canNavigate }: Props = $props();
  const colors = ['#4f7cff', '#0e9f6e', '#d97706', '#8b5cf6', '#db2777', '#0891b2'];
  let menuElement: HTMLElement | undefined = $state(undefined);

  onMount(() => menuElement?.focus());

  async function rename(): Promise<void> {
    const name = window.prompt('Project label', project.name);
    if (!name?.trim() || name.trim() === project.name) return;
    try {
      await renameProjectLabel(name.trim(), project.path);
      onNotice('Project label updated.');
      onClose();
    } catch (error) {
      onNotice(errorDetail(error));
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
    if (!window.confirm('Forget “' + project.name + '”? The folder and all Markdown files will stay on disk.')) return;
    if (!canNavigate()) return;
    try {
      await forgetProject(project.path);
      onNotice('Project forgotten. Its files are still on disk.');
      onClose();
    } catch (error) {
      onNotice(errorDetail(error));
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
  <button type="button" role="menuitem" onclick={rename}>Rename label…</button>
  <button type="button" role="menuitem" onclick={reveal}>Reveal in Finder</button>
  <div class="project-menu__label">Project color</div>
  <div class="project-menu__colors">
    {#each colors as color}
      <button type="button" class="color-swatch" style={'--swatch:' + color} class:color-swatch--selected={project.color === color} aria-label={'Use ' + color} onclick={() => chooseColor(color)}></button>
    {/each}
    <button type="button" class="color-clear" onclick={() => chooseColor(null)}>Clear</button>
  </div>
  <div class="project-menu__rule"></div>
  <button type="button" class="project-menu__danger" role="menuitem" onclick={forget}>Forget project…</button>
</section>
