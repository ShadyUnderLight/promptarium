<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { focusTrap } from '$lib/attachments/focusTrap';
  import type { Project, PromptDocument, PromptMetadata, PromptStatus } from '$lib/prompts/types';
  import { defaultPromptMetadata } from '$lib/prompts/types';
  import { t } from '$lib/i18n/i18n.svelte';
  import type {
    AiNamingFailure,
    CredentialFailure,
    DeepSeekCredentialStatus,
  } from '$lib/api';
  import {
    clearDeepSeekApiKey,
    deepseekCredentialStatus,
    generatePromptFilenameSuggestions,
    isTauri,
    setDeepSeekApiKey,
  } from '$lib/api';
  import type { MessageKey } from '$lib/i18n/locales/en';
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    projects: Project[];
    defaultProjectPath: string;
    defaultFolder?: string;
    onCreate: (projectPath: string, name: string, body: string, metadata: PromptMetadata) => Promise<PromptDocument>;
    onClose: () => void;
  }

  let { projects, defaultProjectPath, defaultFolder = '', onCreate, onClose }: Props = $props();
  let nameInput: HTMLInputElement | undefined = $state(undefined);
  let projectPath = $state('');
  let name = $state('');
  let body = $state('');
  let description = $state('');
  let tagsText = $state('');
  let status = $state<PromptStatus>('active');
  let favorite = $state(false);
  let modelsText = $state('');
  let created = $state('');
  let error = $state('');
  let busy = $state(false);
  let namingBusy = $state(false);
  let namingError = $state('');
  let suggestions = $state<string[]>([]);
  let credentialStatus = $state<DeepSeekCredentialStatus | null>(null);
  let credentialPanelOpen = $state(false);
  let apiKeyInput = $state('');
  let credentialBusy = $state(false);
  let credentialError = $state('');
  let namingRequestSerial = 0;
  let activeNamingRequest = 0;
  let credentialRevision = 0;
  let disposed = false;
  const showProjectPicker = $derived(projects.length > 1);
  const namingDisabled = $derived(
    !body.trim() ||
      namingBusy ||
      credentialBusy ||
      credentialStatus?.supported === false ||
      Boolean(credentialStatus?.failure),
  );

  const namingFailureMessages: Record<AiNamingFailure, MessageKey> = {
    'not-configured': 'newPrompt.aiNaming.error.notConfigured',
    unsupported: 'newPrompt.aiNaming.error.unsupported',
    'empty-prompt': 'newPrompt.aiNaming.emptyPrompt',
    'credential-store': 'newPrompt.aiNaming.error.keychain',
    'auth-failed': 'newPrompt.aiNaming.error.authFailed',
    'rate-limited': 'newPrompt.aiNaming.error.rateLimited',
    'insufficient-balance': 'newPrompt.aiNaming.error.insufficientBalance',
    network: 'newPrompt.aiNaming.error.network',
    timeout: 'newPrompt.aiNaming.error.timeout',
    'bad-response': 'newPrompt.aiNaming.error.badResponse',
    'service-error': 'newPrompt.aiNaming.error.serviceError',
  };

  const credentialFailureMessages: Record<CredentialFailure, MessageKey> = {
    unsupported: 'newPrompt.aiNaming.error.unsupported',
    'empty-key': 'newPrompt.aiNaming.error.emptyKey',
    store: 'newPrompt.aiNaming.error.credential',
  };

  const credentialStatusFailureMessages: Record<CredentialFailure, MessageKey> = {
    unsupported: 'newPrompt.aiNaming.error.unsupported',
    'empty-key': 'newPrompt.aiNaming.error.emptyKey',
    store: 'newPrompt.aiNaming.error.keychain',
  };

  onMount(() => {
    projectPath = defaultProjectPath;
    name = defaultFolder ? defaultFolder + '/' : '';
    nameInput?.focus();
    void loadCredentialStatus();
  });

  onDestroy(() => {
    disposed = true;
    namingRequestSerial += 1;
  });

  function listValue(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }

  async function loadCredentialStatus(): Promise<void> {
    const revision = credentialRevision;
    try {
      const status = await deepseekCredentialStatus();
      if (!disposed && revision === credentialRevision) {
        credentialStatus = status;
      }
    } catch {
      if (!disposed && revision === credentialRevision) {
        credentialStatus = { configured: false, supported: isTauri() };
      }
    }
  }

  function invalidateNaming(): void {
    namingRequestSerial += 1;
    activeNamingRequest = 0;
    namingBusy = false;
    suggestions = [];
    namingError = '';
  }

  function handleBodyInput(event: Event): void {
    body = (event.currentTarget as HTMLTextAreaElement).value;
    invalidateNaming();
  }

  function namingFailureMessage(failure: AiNamingFailure): string {
    return t(namingFailureMessages[failure]);
  }

  function credentialFailureMessage(failure: CredentialFailure): string {
    return t(credentialFailureMessages[failure]);
  }

  function credentialStatusFailureMessage(failure: CredentialFailure): string {
    return t(credentialStatusFailureMessages[failure]);
  }

  function beginCredentialMutation(): void {
    credentialRevision += 1;
    invalidateNaming();
  }

  function finishCredentialMutation(): void {
    credentialRevision += 1;
    namingRequestSerial += 1;
    activeNamingRequest = 0;
    namingBusy = false;
  }

  async function generateNames(): Promise<void> {
    const requestBody = body;
    if (credentialBusy || namingBusy) return;
    if (!requestBody.trim()) {
      namingError = t('newPrompt.aiNaming.emptyPrompt');
      return;
    }
    if (!credentialStatus) {
      credentialPanelOpen = true;
      credentialError = '';
      return;
    }
    if (!credentialStatus.supported) {
      namingError = t('newPrompt.aiNaming.error.unsupported');
      return;
    }
    if (credentialStatus.failure) {
      namingError = credentialStatusFailureMessage(credentialStatus.failure);
      return;
    }
    if (!credentialStatus.configured) {
      credentialPanelOpen = true;
      credentialError = '';
      return;
    }

    const requestId = ++namingRequestSerial;
    activeNamingRequest = requestId;
    namingBusy = true;
    namingError = '';
    try {
      const result = await generatePromptFilenameSuggestions(requestBody);
      if (disposed || requestId !== namingRequestSerial || body !== requestBody) return;
      if (result.failure) {
        namingError = namingFailureMessage(result.failure);
        if (result.failure === 'not-configured') {
          credentialStatus = { configured: false, supported: true };
          credentialPanelOpen = true;
        } else if (result.failure === 'unsupported') {
          credentialStatus = { configured: false, supported: false };
        } else if (result.failure === 'credential-store') {
          credentialStatus = {
            configured: credentialStatus?.configured ?? false,
            supported: true,
            failure: 'store',
          };
        }
        return;
      }
      if (result.names.length < 3) {
        namingError = t('newPrompt.aiNaming.error.badResponse');
        return;
      }
      suggestions = result.names.slice(0, 3);
    } catch {
      if (!disposed && requestId === namingRequestSerial && body === requestBody) {
        namingError = t('newPrompt.aiNaming.error.network');
      }
    } finally {
      if (!disposed && activeNamingRequest === requestId) {
        activeNamingRequest = 0;
        namingBusy = false;
      }
    }
  }

  function applySuggestion(suggestion: string): void {
    const slash = name.lastIndexOf('/');
    name = slash >= 0 ? name.slice(0, slash + 1) + suggestion : suggestion;
  }

  function openCredentialPanel(): void {
    credentialPanelOpen = true;
    credentialError = '';
  }

  function closeCredentialPanel(): void {
    if (credentialBusy) return;
    credentialPanelOpen = false;
    credentialError = '';
    apiKeyInput = '';
  }

  async function saveCredential(): Promise<void> {
    if (credentialBusy) return;
    if (!apiKeyInput.trim()) {
      credentialError = t('newPrompt.aiNaming.error.emptyKey');
      return;
    }
    credentialBusy = true;
    credentialError = '';
    beginCredentialMutation();
    try {
      const result = await setDeepSeekApiKey(apiKeyInput);
      if (result.failure || !result.status.configured) {
        credentialError = result.failure
          ? credentialFailureMessage(result.failure)
          : t('newPrompt.aiNaming.error.credential');
        return;
      }
      credentialStatus = result.status;
      apiKeyInput = '';
      credentialPanelOpen = false;
      namingError = '';
      suggestions = [];
    } catch {
      credentialError = t('newPrompt.aiNaming.error.credential');
    } finally {
      finishCredentialMutation();
      credentialBusy = false;
    }
  }

  async function clearCredential(): Promise<void> {
    if (credentialBusy) return;
    credentialBusy = true;
    credentialError = '';
    beginCredentialMutation();
    try {
      const result = await clearDeepSeekApiKey();
      if (result.failure) {
        credentialError =
          result.failure === 'store'
            ? t('newPrompt.aiNaming.error.clearCredential')
            : credentialFailureMessage(result.failure);
        return;
      }
      credentialStatus = result.status;
      apiKeyInput = '';
      namingError = '';
      suggestions = [];
    } catch {
      credentialError = t('newPrompt.aiNaming.error.clearCredential');
    } finally {
      finishCredentialMutation();
      credentialBusy = false;
    }
  }

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      error = t('newPrompt.error.filename');
      return;
    }
    if (!projectPath) {
      error = t('newPrompt.error.project');
      return;
    }
    busy = true;
    error = '';
    const metadata = defaultPromptMetadata();
    metadata.description = description.trim();
    metadata.tags = listValue(tagsText);
    metadata.status = status;
    metadata.favorite = favorite;
    metadata.models = listValue(modelsText);
    if (created.trim()) metadata.created = created.trim();
    try {
      await onCreate(projectPath, trimmed, body, metadata);
      onClose();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
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
  <dialog open class="modal new-prompt-dialog" aria-labelledby="new-prompt-title" onkeydown={handleKeydown} tabindex="-1" {@attach focusTrap}>
    <div class="dialog-heading">
      <div>
        <span class="eyebrow">{t('topbar.title')}</span>
        <h2 id="new-prompt-title">{t('sidebar.newPrompt')}</h2>
      </div>
      <button type="button" class="icon-button" aria-label={t('newPrompt.close')} title={t('newPrompt.close')} onclick={onClose}><Icon name="close" /></button>
    </div>

    {#if error}<p class="form-error">{error}</p>{/if}

    {#if showProjectPicker}
      <label class="field">
        <span>{t('newPrompt.project')}</span>
        <select bind:value={projectPath}>
          {#each projects as project (project.path)}
            <option value={project.path}>{project.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <label class="field">
      <span>{t('newPrompt.filename')} <small>{t('newPrompt.filenameHint')}</small></span>
      <input bind:this={nameInput} bind:value={name} placeholder="coding/review-pr" spellcheck="false" />
    </label>

    <section class="new-prompt-ai" aria-label={t('newPrompt.aiNaming')}>
      <div class="new-prompt-ai__header">
        <div class="new-prompt-ai__heading">
          <strong>{t('newPrompt.aiNaming')}</strong>
          <span class="new-prompt-ai__privacy">{t('newPrompt.aiNaming.privacy')}</span>
        </div>
        <div class="new-prompt-ai__credential">
          {#if credentialStatus?.failure}
            <span class="new-prompt-ai__unsupported">
              {credentialStatusFailureMessage(credentialStatus.failure)}
            </span>
            {#if credentialStatus.failure === 'store'}
              <button type="button" class="btn btn--ghost btn--sm" onclick={openCredentialPanel}>
                {t('newPrompt.aiNaming.settings')}
              </button>
            {/if}
          {:else if credentialStatus?.configured}
            <span class="new-prompt-ai__configured">{t('newPrompt.aiNaming.configured')}</span>
            <button type="button" class="btn btn--ghost btn--sm" onclick={openCredentialPanel}>
              {t('newPrompt.aiNaming.settings')}
            </button>
          {:else if credentialStatus?.supported === false}
            <span class="new-prompt-ai__unsupported">{t('newPrompt.aiNaming.error.unsupported')}</span>
          {:else}
            <button type="button" class="btn btn--ghost btn--sm" onclick={openCredentialPanel}>
              {t('newPrompt.aiNaming.configure')}
            </button>
          {/if}
        </div>
      </div>

      {#if credentialPanelOpen}
        <div class="new-prompt-ai__config">
          <label class="field">
            <span>{t('newPrompt.aiNaming.apiKey')}</span>
            <input
              type="password"
              autocomplete="off"
              bind:value={apiKeyInput}
              placeholder={t('newPrompt.aiNaming.apiKey.placeholder')}
              disabled={credentialBusy}
            />
          </label>
          {#if credentialError}<p class="form-error">{credentialError}</p>{/if}
          <div class="new-prompt-ai__config-actions">
            <button type="button" class="btn btn--ghost btn--sm" onclick={closeCredentialPanel} disabled={credentialBusy}>
              {t('newPrompt.aiNaming.cancel')}
            </button>
            <button type="button" class="btn btn--primary btn--sm" onclick={saveCredential} disabled={credentialBusy}>
              {t('newPrompt.aiNaming.saveKey')}
            </button>
            {#if credentialStatus?.configured}
              <button type="button" class="btn btn--ghost btn--sm" onclick={clearCredential} disabled={credentialBusy}>
                {t('newPrompt.aiNaming.clearKey')}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="new-prompt-ai__actions">
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          aria-label={t('newPrompt.aiNaming')}
          title={t('newPrompt.aiNaming.privacy')}
          onclick={generateNames}
          disabled={namingDisabled}
        >
          {#if namingBusy}
            {t('newPrompt.aiNaming.generating')}
          {:else}
            <span aria-hidden="true">✨</span>
            {t('newPrompt.aiNaming')}
          {/if}
        </button>
        {#if !body.trim()}<span class="new-prompt-ai__hint">{t('newPrompt.aiNaming.emptyPrompt')}</span>{/if}
      </div>

      {#if namingError}<p class="form-error" aria-live="polite">{namingError}</p>{/if}

      {#if suggestions.length}
        <div class="new-prompt-ai__suggestions" aria-live="polite">
          <strong>{t('newPrompt.aiNaming.suggestions')}</strong>
          <div class="new-prompt-ai__candidate-list">
            {#each suggestions as suggestion (suggestion)}
              <button type="button" class="new-prompt-ai__candidate" onclick={() => applySuggestion(suggestion)}>
                {suggestion}
              </button>
            {/each}
          </div>
          <button type="button" class="btn btn--ghost btn--sm" onclick={generateNames} disabled={namingDisabled}>
            {t('newPrompt.aiNaming.regenerate')}
          </button>
        </div>
      {/if}
    </section>

    <label class="field">
      <span>{t('newPrompt.body')}</span>
      <textarea class="new-prompt-body" value={body} oninput={handleBodyInput} placeholder={t('newPrompt.body.placeholder')}></textarea>
    </label>

    <div class="metadata-grid metadata-grid--dialog">
      <label class="field field--wide">
        <span>{t('newPrompt.description')}</span>
        <input bind:value={description} placeholder={t('newPrompt.description.placeholder')} />
      </label>
      <label class="field">
        <span>{t('newPrompt.status')}</span>
        <select bind:value={status}>
          <option value="active">{t('newPrompt.status.active')}</option>
          <option value="draft">{t('newPrompt.status.draft')}</option>
          <option value="archived">{t('newPrompt.status.archived')}</option>
        </select>
      </label>
      <label class="field">
        <span>{t('newPrompt.tags')} <small>{t('newPrompt.commaSeparated')}</small></span>
        <input bind:value={tagsText} placeholder="coding, review" />
      </label>
      <label class="field">
        <span>{t('newPrompt.models')} <small>{t('newPrompt.commaSeparated')}</small></span>
        <input bind:value={modelsText} placeholder="ChatGPT, Claude" />
      </label>
      <label class="field">
        <span>{t('newPrompt.created')}</span>
        <input type="date" bind:value={created} />
      </label>
      <label class="check-field">
        <input type="checkbox" bind:checked={favorite} />
        <span>{t('newPrompt.favorite')}</span>
      </label>
    </div>

    <div class="modal__actions">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={busy}>{t('newPrompt.cancel')}</button>
      <button type="button" class="btn btn--primary" onclick={submit} disabled={busy}>{busy ? t('newPrompt.creating') : t('newPrompt.create')}</button>
    </div>
  </dialog>
</div>
