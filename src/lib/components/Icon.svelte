<script lang="ts">
  /**
   * Icon — the one local inline-SVG icon set (Issue #43). Offline by design:
   * no icon font, no CDN, no runtime dependency.
   *
   * Visual only. Every consumer keeps its own aria-label / title / visible
   * text; the svg itself is aria-hidden and never substitutes semantics.
   * Stroke shapes inherit currentColor, so icons follow both themes and
   * state colours (danger, favorite, …) for free. The `.icon` rule in
   * app.css sizes them at 1em, keeping each context's existing font-size
   * in charge.
   */
  type IconName =
    | 'search'
    | 'refresh'
    | 'plus'
    | 'minus'
    | 'close'
    | 'star'
    | 'star-outline'
    | 'warning'
    | 'chevron-down'
    | 'chevron-right'
    | 'list'
    | 'grid'
    | 'arrow-right'
    | 'arrow-left'
    | 'arrow-up'
    | 'arrow-down'
    | 'sparkle'
    | 'command'
    | 'folder'
    | 'tag'
    | 'history'
    | 'panel-left';

  interface Props {
    name: IconName;
  }

  let { name }: Props = $props();

  // Static string table, never user input. Filled shapes carry their own
  // fill/stroke attributes to override the svg-level stroke defaults.
  const shapes: Record<IconName, string> = {
    search: '<circle cx="11" cy="11" r="7.5"/><path d="M20.5 20.5 16.7 16.7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    star: '<path fill="currentColor" stroke="none" d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>',
    'star-outline': '<path d="m12 3.7 2.5 5.3 5.8.5-4.4 3.85 1.3 5.7L12 16.15 6.8 19.05l1.3-5.7L3.7 9.5l5.8-.5z"/>',
    warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
    'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    'arrow-up': '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m18 13-6 6-6-6"/>',
    folder: '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-12A2.5 2.5 0 0 1 4 16.5z"/>',
    tag: '<path d="M3.5 5.5v5.2a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l4.7-4.7a2 2 0 0 0 0-2.8L11.6 4.6a2 2 0 0 0-1.4-.6H5.5a2 2 0 0 0-2 2Z"/><circle cx="7.5" cy="8" r="1"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 5v4h4"/><path d="M12 7.5v5l3 1.8"/>',
    'panel-left': '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9 4v16"/>',
    sparkle: '<path fill="currentColor" stroke="none" d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>'
  };
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {@html shapes[name]}
</svg>
