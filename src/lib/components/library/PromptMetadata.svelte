<script lang="ts">
  import type { PromptMetadata as Metadata, PromptStatus } from '$lib/prompts/types';

  interface Props {
    metadata: Metadata;
    editing: boolean;
    onChange: (metadata: Metadata) => void;
  }

  let { metadata, editing, onChange }: Props = $props();

  function clone(): Metadata {
    return { ...metadata, tags: [...metadata.tags], models: [...metadata.models], extra: { ...metadata.extra } };
  }

  function setField<K extends keyof Metadata>(field: K, value: Metadata[K]): void {
    const next = clone();
    next[field] = value;
    onChange(next);
  }

  function listValue(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
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
