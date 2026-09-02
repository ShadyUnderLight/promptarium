<script lang="ts">
  import type { PromptMetadata as Metadata, PromptStatus, PromptSummary, VariableDoc, PromptExample } from '$lib/prompts/types';
  import { getVariantOf, getVariantOfRaw, withVariantOf } from '$lib/prompts/types';
  import { parseVariables } from '$lib/variables/variables';
  import { setVariableDoc } from '$lib/variables/contract';
  import { addRelatedEntry, removeRelatedEntry } from '$lib/relations/relations';
  import { wouldCreateVariantCycle } from '$lib/variants/variants';
  import ExamplesEditor from './ExamplesEditor.svelte';

  interface Props {
    metadata: Metadata;
    body: string;
    editing: boolean;
    /** Names of every prompt in the current project (for the Related picker). */
    promptNames?: string[];
    /** Name of the prompt being edited (never offered as a related target). */
    currentName?: string;
    /** Summaries of the current project (for the variant parent cycle guard). */
    summaries?: PromptSummary[];
    /** Project the edited prompt lives in (for the variant parent cycle guard). */
    projectPath?: string;
    /** Bumped after a filesystem refresh; forwarded to the Examples editor so
     *  its asset-state chips re-resolve without touching editor metadata. */
    refreshVersion?: number;
    onChange: (metadata: Metadata) => void;
  }

  let { metadata, body, editing, promptNames = [], currentName = '', summaries = [], projectPath = '', refreshVersion = 0, onChange }: Props = $props();

  // Variable names come live from the body parser. The editor never creates or
  // renames variables in frontmatter; a body edit immediately surfaces a new
  // row, but nothing is written until an explicit Save.
  const variableNames = $derived(parseVariables(body).map((variable) => variable.name));
  const staleNames = $derived(
    Object.keys(metadata.variables ?? {}).filter((name) => !variableNames.includes(name))
  );

  function clone(): Metadata {
    const variables = metadata.variables
      ? Object.fromEntries(
          Object.entries(metadata.variables).map(([name, doc]) => [name, { ...doc }])
        )
      : undefined;
    const examples = metadata.examples
      ? metadata.examples.map((example) => structuredClone(example))
      : undefined;
    return {
      ...metadata,
      tags: [...metadata.tags],
      models: [...metadata.models],
      related: [...metadata.related],
      extra: { ...metadata.extra },
      ...(variables ? { variables } : {}),
      ...(examples ? { examples } : {}),
    };
  }

  /** Explicit Examples edits make the typed projection authoritative: clearing
   *  `examplesRaw` lets the serializer re-emit from the fresh typed structure
   *  instead of the stale hand-written AST (Issue #26 §6 / #24 preservation). */
  function updateExamples(examples: PromptExample[]): void {
    const next = clone();
    next.examples = examples;
    delete next.examplesRaw;
    onChange(next);
  }

  function setField<K extends keyof Metadata>(field: K, value: Metadata[K]): void {
    const next = clone();
    next[field] = value;
    onChange(next);
  }

  function listValue(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }

  function docFor(name: string): VariableDoc | undefined {
    const variables = metadata.variables;
    // Own-property check: {constructor} / {toString} / {__proto__} are legal
    // variable names and must not match Object.prototype members.
    return variables && Object.hasOwn(variables, name) ? variables[name] : undefined;
  }

  function setDocField(name: string, field: 'description' | 'example', value: string): void {
    const next = clone();
    const current = docFor(name) ?? {};
    const doc: VariableDoc = { ...current, [field]: value || undefined };
    const variables = setVariableDoc(next.variables, name, doc);
    if (variables) next.variables = variables;
    else delete next.variables;
    onChange(next);
  }

  function removeStaleDoc(name: string): void {
    const next = clone();
    const variables = setVariableDoc(next.variables, name, undefined);
    if (variables) next.variables = variables;
    else delete next.variables;
    onChange(next);
  }

  // Related prompts: the picker only offers prompts in the current project,
  // never the prompt being edited, and never entries already linked.
  const addableRelated = $derived(
    promptNames.filter((name) => name !== currentName && !metadata.related.includes(name))
  );
  let relatedPick = $state('');

  function addRelated(): void {
    if (!relatedPick) return;
    setField('related', addRelatedEntry(metadata.related, relatedPick));
    relatedPick = '';
  }

  // The raw list is rendered verbatim — including duplicates that came from a
  // hand-edited file — so removal is by index (value-based removal would wipe
  // every duplicate at once). See removeRelatedEntry().
  function removeRelated(index: number): void {
    setField('related', removeRelatedEntry(metadata.related, index));
  }

  // Variant parent (Issue #14): a single optional `variantOf` value. The picker
  // offers only prompts in the current project, never the prompt being edited,
  // never its current parent, and never a candidate that would create a cycle
  // (a candidate that is the prompt itself or one of its descendants). The
  // set action re-guards so a stale/forged selection cannot slip through.
  const currentVariantRaw = $derived(getVariantOfRaw(metadata));
  const currentVariant = $derived(getVariantOf(metadata));
  const variantDisplay = $derived(
    currentVariant ??
      (currentVariantRaw !== undefined ? `${typeof currentVariantRaw}: ${JSON.stringify(currentVariantRaw)}` : '')
  );
  const addableVariant = $derived(
    promptNames.filter(
      (name) =>
        name !== currentName &&
        name !== currentVariant &&
        !wouldCreateVariantCycle(summaries, { projectPath, name: currentName }, name)
    )
  );
  let variantPick = $state('');

  function setVariant(): void {
    if (!variantPick) return;
    if (wouldCreateVariantCycle(summaries, { projectPath, name: currentName }, variantPick)) {
      variantPick = '';
      return;
    }
    onChange(withVariantOf(metadata, variantPick));
    variantPick = '';
  }

  function clearVariant(): void {
    onChange(withVariantOf(metadata, undefined));
  }
</script>

{#if editing}
  <div class="metadata-editor">
    <label class="field field--wide">
      <span>Description</span>
      <textarea value={metadata.description} oninput={(event) => setField('description', event.currentTarget.value)} placeholder="What is this prompt for?"></textarea>
    </label>
    <div class="metadata-grid">
      <label class="field">
        <span>Status</span>
        <select value={metadata.status} onchange={(event) => setField('status', event.currentTarget.value as PromptStatus)}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <label class="check-field">
        <input type="checkbox" checked={metadata.favorite} onchange={(event) => setField('favorite', event.currentTarget.checked)} />
        <span>Favorite</span>
      </label>
      <label class="field field--wide">
        <span>Tags <small>comma separated</small></span>
        <input value={metadata.tags.join(', ')} oninput={(event) => setField('tags', listValue(event.currentTarget.value))} placeholder="coding, review" />
      </label>
      <label class="field field--wide">
        <span>Model hints <small>comma separated</small></span>
        <input value={metadata.models.join(', ')} oninput={(event) => setField('models', listValue(event.currentTarget.value))} placeholder="ChatGPT, Claude" />
      </label>
      <label class="field">
        <span>Created</span>
        <input type="date" value={metadata.created ?? ''} oninput={(event) => setField('created', event.currentTarget.value || undefined)} />
      </label>
    </div>
    <label class="field field--wide">
      <span>Usage Notes <small>not part of Copy Prompt</small></span>
      <textarea class="notes-editor" value={metadata.notes ?? ''} oninput={(event) => setField('notes', event.currentTarget.value || undefined)} placeholder="Scenarios, model stability, gotchas, how to fill variables…"></textarea>
    </label>
    <div class="variables-editor">
      <span class="variables-editor__heading">Variables</span>
      {#each variableNames as name (name)}
        <div class="variable-doc-edit">
          <div class="variable-doc-edit__name">
            <span class="variable-token">{name}</span>
            {#if !docFor(name)}<span class="variable-doc-edit__status">Undocumented</span>{/if}
          </div>
          <div class="variable-doc-edit__fields">
            <input
              value={docFor(name)?.description ?? ''}
              oninput={(event) => setDocField(name, 'description', event.currentTarget.value)}
              placeholder="Description"
            />
            <input
              value={docFor(name)?.example ?? ''}
              oninput={(event) => setDocField(name, 'example', event.currentTarget.value)}
              placeholder="Example"
            />
          </div>
        </div>
      {/each}
      {#if staleNames.length}
        <span class="variables-editor__heading">Stale documentation</span>
        {#each staleNames as name (name)}
          <div class="variable-doc-edit">
            <div class="variable-doc-edit__name">
              <span class="variable-token">{name}</span>
              <button type="button" class="variable-doc-edit__remove" onclick={() => removeStaleDoc(name)}>Remove documentation</button>
            </div>
            <div class="variable-doc-edit__fields">
              <input
                value={docFor(name)?.description ?? ''}
                oninput={(event) => setDocField(name, 'description', event.currentTarget.value)}
                placeholder="Description"
              />
              <input
                value={docFor(name)?.example ?? ''}
                oninput={(event) => setDocField(name, 'example', event.currentTarget.value)}
                placeholder="Example"
              />
            </div>
          </div>
        {/each}
      {/if}
      {#if !variableNames.length && !staleNames.length}
        <p class="detail-muted">No variables detected in the prompt body.</p>
      {/if}
    </div>
    <div class="related-editor">
      <span class="variables-editor__heading">Related prompts</span>
      {#if metadata.related.length}
        <div class="related-edit-list">
          {#each metadata.related as path, index (index)}
            <div class="variable-doc-edit">
              <div class="variable-doc-edit__name">
                <span class="variable-token">{path}</span>
                <button type="button" class="variable-doc-edit__remove" onclick={() => removeRelated(index)}>Remove</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if addableRelated.length}
        <div class="related-picker">
          <select bind:value={relatedPick} onchange={addRelated} aria-label="Add a related prompt">
            <option value="" disabled>Add a related prompt…</option>
            {#each addableRelated as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </div>
      {:else}
        <p class="detail-muted">No other prompt in this project is available to link.</p>
      {/if}
    </div>
    <div class="related-editor">
      <span class="variables-editor__heading">Variant of</span>
      {#if currentVariantRaw !== undefined}
        <div class="related-edit-list">
          <div class="variable-doc-edit">
            <div class="variable-doc-edit__name">
              <span class="variable-token">{variantDisplay}</span>
              <button type="button" class="variable-doc-edit__remove" onclick={clearVariant}>Remove</button>
            </div>
          </div>
        </div>
      {/if}
      {#if addableVariant.length}
        <div class="related-picker">
          <select bind:value={variantPick} onchange={setVariant} aria-label="Set variant parent">
            <option value="" disabled>{currentVariant ? 'Change variant parent…' : 'Set variant parent…'}</option>
            {#each addableVariant as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </div>
      {:else if currentVariantRaw === undefined}
        <p class="detail-muted">No other prompt in this project is available as a variant parent.</p>
      {/if}
    </div>
    <ExamplesEditor examples={metadata.examples ?? []} projectPath={projectPath} refreshVersion={refreshVersion} onChange={updateExamples} />
  </div>
{:else}
  <dl class="metadata-inspector">
    <div><dt>Description</dt><dd>{metadata.description || 'No description'}</dd></div>
    <div><dt>Status</dt><dd><span class={'status-chip status-chip--' + metadata.status}>{metadata.status}</span></dd></div>
    <div><dt>Tags</dt><dd>{#if metadata.tags.length}{#each metadata.tags as tag (tag)}<span class="tag-chip">#{tag}</span>{/each}{:else}<span class="detail-muted">None</span>{/if}</dd></div>
    <div><dt>Models</dt><dd>{metadata.models.join(', ') || 'Any model'}</dd></div>
    <div><dt>Created</dt><dd>{metadata.created ?? 'Unknown'}</dd></div>
  </dl>
  {#if metadata.notes}
    <div class="usage-notes">
      <div class="usage-notes__heading">Usage Notes</div>
      <div class="usage-notes__body">{metadata.notes}</div>
    </div>
  {/if}
{/if}
