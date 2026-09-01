<script lang="ts">
  import type { PromptMetadata as Metadata, PromptStatus, VariableDoc } from '$lib/prompts/types';
  import { parseVariables } from '$lib/variables/variables';

  interface Props {
    metadata: Metadata;
    body: string;
    editing: boolean;
    onChange: (metadata: Metadata) => void;
  }

  let { metadata, body, editing, onChange }: Props = $props();

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
    return {
      ...metadata,
      tags: [...metadata.tags],
      models: [...metadata.models],
      extra: { ...metadata.extra },
      ...(variables ? { variables } : {}),
    };
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
    return metadata.variables?.[name];
  }

  function setDocField(name: string, field: 'description' | 'example', value: string): void {
    const next = clone();
    const variables = next.variables ?? {};
    const current = variables[name] ?? {};
    const doc: VariableDoc = { ...current, [field]: value || undefined };
    if (doc.description || doc.example || Object.keys(doc.extra ?? {}).length) {
      variables[name] = doc;
    } else {
      delete variables[name];
    }
    if (Object.keys(variables).length) {
      next.variables = variables;
    } else {
      delete next.variables;
    }
    onChange(next);
  }

  function removeStaleDoc(name: string): void {
    const next = clone();
    const variables = next.variables;
    if (!variables) return;
    delete variables[name];
    if (Object.keys(variables).length) {
      next.variables = variables;
    } else {
      delete next.variables;
    }
    onChange(next);
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
  </div>
{:else}
  <dl class="metadata-inspector">
    <div><dt>Description</dt><dd>{metadata.description || 'No description'}</dd></div>
    <div><dt>Status</dt><dd><span class={'status-chip status-chip--' + metadata.status}>{metadata.status}</span></dd></div>
    <div><dt>Tags</dt><dd>{#if metadata.tags.length}{#each metadata.tags as tag (tag)}<span class="tag-chip">#{tag}</span>{/each}{:else}<span class="detail-muted">None</span>{/if}</dd></div>
    <div><dt>Models</dt><dd>{metadata.models.join(', ') || 'Any model'}</dd></div>
    <div><dt>Created</dt><dd>{metadata.created ?? 'Unknown'}</dd></div>
  </dl>
{/if}
