<script lang="ts">
  /** One editor-only pending asset row (Issue #26 §6): the input shown when the
   *  user clicks "Add blank" in an example's Files section. The row commits
   *  only on blur or Enter; a blank commit discards the row without ever
   *  writing an empty string into the typed metadata. All draft state is UI
   *  session state — it is never serialized. */
  interface Props {
    /** Called with the typed value on commit (blur / Enter). The caller trims
     *  and decides whether to append a real asset entry. */
    onCommit: (value: string) => void;
  }

  let { onCommit }: Props = $props();
  let value = $state('');

  function commit(): void {
    onCommit(value);
  }
</script>

<div class="example-file-edit__row example-file-edit__row--draft">
  <input
    value={value}
    oninput={(event) => (value = event.currentTarget.value)}
    onchange={commit}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    }}
    placeholder="Type a project-relative path…"
    aria-label="New asset reference"
  />
  <span class="example-chip example-chip--draft">new</span>
</div>
