/**
 * The canvas editor's in-iframe half: the postMessage protocol both sides speak, and the script
 * that implements selection / drag / inline text edit / style ops / serialization inside the
 * sandboxed iframe.
 *
 * `runtime()` below is serialized with `Function.prototype.toString()` and inlined into the
 * iframe's `srcDoc`, so it MUST be entirely self-contained: no imports, no references to anything
 * in this module's scope. Type-only references are fine (they erase); a value reference would
 * compile and then throw `ReferenceError` inside the iframe. Every constant it needs is declared
 * in its own body, and the two protocol tags are repeated as literals there — the exported
 * constants below are the parent's copy and the two MUST stay in sync.
 */

/** Tag on every iframe -> parent message. Repeated as a literal inside `runtime()`. */
export const EDITOR_EVENT = 'forge-editor-event';
/** Tag on every parent -> iframe message. Repeated as a literal inside `runtime()`. */
export const EDITOR_COMMAND = 'forge-editor-command';

export type TextAlign = 'left' | 'center' | 'right';
/** What kind of thing the selection is — decided by `data-forge-kind`, which survives serialize. */
export type ElementKind = 'text' | 'box';
export type LayerDir = 'front' | 'forward' | 'backward' | 'back';

/** The selection's current computed look — everything the toolbar renders from. */
export interface SelectionStyle {
  tag: string;
  kind: ElementKind;
  fontSizePx: number;
  /** `#rrggbb`, because `<input type="color">` accepts nothing else. */
  color: string;
  fontWeight: number;
  textAlign: TextAlign;
  widthPx: number;
  heightPx: number;
  /** `#rrggbb` background-colour; `#000000` when there is no resolvable one. */
  fill: string;
  radiusPx: number;
  /** 0–100, so the toolbar never has to think in fractions. */
  opacityPct: number;
}

/** A partial write to the selection's INLINE styles; every field is an absolute value. */
export interface StylePatch {
  fontSizePx?: number;
  color?: string;
  fontWeight?: number;
  textAlign?: TextAlign;
  fill?: string;
  radiusPx?: number;
  opacityPct?: number;
}

export type EditorEvent =
  /** Fired only once pin-all has completed: before it, nothing in the document is selectable. */
  | { forge: typeof EDITOR_EVENT; type: 'ready' }
  | { forge: typeof EDITOR_EVENT; type: 'selection'; style: SelectionStyle | null }
  /**
   * The runtime reports the background it actually has applied — the parent never guesses.
   * `bgRunId` is the run behind it, or `null` while it is still the source candidate's (including
   * after every refine has been undone).
   */
  | { forge: typeof EDITOR_EVENT; type: 'html'; html: string; bgDataUri: string; bgRunId: number | null }
  /** Escape pressed inside the iframe while not editing text — the parent owns "close". */
  | { forge: typeof EDITOR_EVENT; type: 'escape' }
  /** Fired after every push/undo/redo, so the toolbar's buttons track the stacks. */
  | { forge: typeof EDITOR_EVENT; type: 'history'; undoDepth: number; redoDepth: number };

export type EditorCommand =
  /**
   * The parent hands the runtime its background identity. Sent from the `<iframe>`'s `onLoad`
   * handler — guaranteed to run after the parent's message-listener effect, whereas replying to
   * `ready` races effect registration and a lost init silently breaks the save reversal.
   */
  | { forge: typeof EDITOR_COMMAND; type: 'init'; bgDataUri: string }
  | { forge: typeof EDITOR_COMMAND; type: 'style'; patch: StylePatch }
  | { forge: typeof EDITOR_COMMAND; type: 'deselect' }
  | { forge: typeof EDITOR_COMMAND; type: 'serialize' }
  /** Focus may sit either side of the iframe boundary, so both sides drive the same one stack. */
  | { forge: typeof EDITOR_COMMAND; type: 'undo' }
  | { forge: typeof EDITOR_COMMAND; type: 'redo' }
  /** Inserts at the canvas centre, selects it, and (for text) drops straight into edit mode. */
  | { forge: typeof EDITOR_COMMAND; type: 'add'; kind: ElementKind }
  | { forge: typeof EDITOR_COMMAND; type: 'layer'; dir: LayerDir }
  /**
   * A landed background patch: `toUri` replaces whatever URI the document carries RIGHT NOW —
   * which after an undo may be the source's again, so the parent never says what to swap *from*.
   */
  | { forge: typeof EDITOR_COMMAND; type: 'background'; toUri: string; runId: number };

function runtime(): void {
  // --- self-contained by contract: nothing below may reference this module's scope ------------
  const PREFIX = '__forge_ed';
  const SEL_CLASS = '__forge_ed_sel';
  const EVENT_TAG = 'forge-editor-event';
  const COMMAND_TAG = 'forge-editor-command';
  const HANDLE = 14;
  /** A click has to move this far before it counts as a drag rather than a selection. */
  const DRAG_SLOP = 3;
  /** Operation-log depth. Beyond this the oldest entry is dropped, so a long session stays bounded. */
  const LOG_CAP = 100;
  /** Pin targets covering at least this share of the canvas are background carriers, not content. */
  const FULL_BLEED = 0.95;
  /** Replaced elements pin regardless of their computed display, and are never walked into. */
  const REPLACED = ['img', 'svg', 'video', 'canvas'];
  /** Block-level computed displays. Anything inline-level stays in text flow and is never pinned. */
  const BLOCKISH = ['block', 'flex', 'grid', 'list-item', 'table'];

  const css = document.createElement('style');
  css.id = PREFIX + '_css';
  css.textContent = [
    // Text selection is the browser's drag gesture fighting ours; contenteditable opts back in.
    'body{-webkit-user-select:none;user-select:none}',
    '[contenteditable="true"]{-webkit-user-select:text!important;user-select:text!important}',
    '.' + SEL_CLASS + '{outline:3px solid #3A96E8!important;outline-offset:2px!important;cursor:move!important}',
    '.' + SEL_CLASS + '[contenteditable="true"]{outline-color:#22c55e!important;cursor:text!important}',
    '#' + PREFIX + '_handles{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none}',
    '#' + PREFIX + '_handles>b{position:absolute;width:' + HANDLE + 'px;height:' + HANDLE + 'px;' +
      'margin:' + (-HANDLE / 2) + 'px 0 0 ' + (-HANDLE / 2) + 'px;background:#fff;border:2px solid #3A96E8;' +
      'border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.4);pointer-events:auto}',
    '#' + PREFIX + '_handles>b[data-dir="e"]{cursor:ew-resize}',
    '#' + PREFIX + '_handles>b[data-dir="s"]{cursor:ns-resize}',
    '#' + PREFIX + '_handles>b[data-dir="se"]{cursor:nwse-resize}',
  ].join('\n');
  document.head.appendChild(css);

  const handles = document.createElement('div');
  handles.id = PREFIX + '_handles';
  handles.style.display = 'none';
  for (const dir of ['e', 's', 'se']) {
    const knob = document.createElement('b');
    knob.setAttribute('data-dir', dir);
    handles.appendChild(knob);
  }
  document.body.appendChild(handles);

  let selected: HTMLElement | null = null;
  let editing: HTMLElement | null = null;
  /** The edited element's innerHTML when the edit STARTED — the `before` half of its log entry. */
  let editingBefore = '';
  /** Live gesture. `left`/`top` are the element's pinned offsets when the pointer went down. */
  let drag: {
    el: HTMLElement; startX: number; startY: number; left: number; top: number; moved: boolean;
    /** Inline `left`/`top` at pointerdown: one log entry per completed gesture, diffed at pointerup. */
    before: Record<string, string>;
  } | null = null;
  let resize: {
    el: HTMLElement; dir: string; startX: number; startY: number; w: number; h: number;
    before: Record<string, string>;
  } | null = null;
  /** False until pin-all has run; every gesture is inert before that, so a stray click selects nothing. */
  let pinned = false;
  /** Monotonic element id. Pin-all seeds it; anything inserted later keeps counting from here. */
  let nextEid = 1;
  /** The background data URI currently applied in the document — the parent supplies it on `init`. */
  let bgDataUri = '';
  /** The run behind the applied background; `null` while it is still the source candidate's. */
  let bgRunId: number | null = null;
  /**
   * Every background the session has held, keyed by run id (`null` = the source's). `background`
   * log entries carry these KEYS, never the ~1.7MB URI strings: ten refines would otherwise retain
   * ~34MB in the log, where the map holds N+1 URIs for N refines.
   */
  const bgUris = new Map<number | null, string>();

  function send(event: Record<string, unknown>): void {
    event['forge'] = EVENT_TAG;
    // '*' is safe here: postMessage on `parent` reaches exactly one window, the editor's own page.
    parent.postMessage(event, '*');
  }

  function toHex(color: string): string {
    const m = /^rgba?\(([^)]+)\)$/.exec(color);
    if (!m) return '#000000';
    const parts = (m[1] ?? '').split(',').map((p) => Number.parseFloat(p));
    const byte = (n: number | undefined) =>
      Math.max(0, Math.min(255, Math.round(n ?? 0))).toString(16).padStart(2, '0');
    return '#' + byte(parts[0]) + byte(parts[1]) + byte(parts[2]);
  }

  /**
   * A box is whatever says it is one. The tag is PERSISTED through serialize (unlike every other
   * `data-forge-*` attribute), because a reopened editor has no other way to tell a decorative
   * rectangle the user added from a text block that happens to be empty right now.
   */
  function kindOf(el: Element): 'text' | 'box' {
    return el.getAttribute('data-forge-kind') === 'box' ? 'box' : 'text';
  }

  function measure(el: HTMLElement): Record<string, unknown> {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const align = cs.textAlign === 'center' || cs.textAlign === 'right' ? cs.textAlign : 'left';
    const opacity = Number.parseFloat(cs.opacity);
    return {
      tag: el.tagName.toLowerCase(),
      kind: kindOf(el),
      fontSizePx: Math.round(Number.parseFloat(cs.fontSize) || 16),
      color: toHex(cs.color),
      fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
      textAlign: align,
      widthPx: Math.round(r.width),
      heightPx: Math.round(r.height),
      // `transparent` computes to rgba(0,0,0,0), which `toHex` reads as #000000 — the same fallback
      // it gives an unparseable colour, and the same value a fresh box starts at.
      fill: toHex(cs.backgroundColor),
      radiusPx: Math.round(num(cs.borderTopLeftRadius)),
      opacityPct: Math.round((Number.isFinite(opacity) ? opacity : 1) * 100),
    };
  }

  /**
   * The pinned element a pointer event acts on: the nearest ancestor carrying an eid, so clicking
   * an `<em>` inside a headline grabs the headline (the only thing that can actually move).
   *
   * Background carriers are rejected by their `data-forge-bg` tag, decided once at pin time — not
   * by a live area check, which would strand a user-added box the moment it was resized near
   * full-bleed, and would go stale after a background swap.
   */
  function selectable(node: EventTarget | null): HTMLElement | null {
    if (!pinned) return null;
    if (!(node instanceof HTMLElement)) return null;
    if (node.closest('#' + PREFIX + '_handles') !== null) return null;
    const el = node.closest('[data-forge-eid]');
    if (!(el instanceof HTMLElement)) return null;
    if (el.hasAttribute('data-forge-bg')) return null;
    return el;
  }

  function paintHandles(): void {
    if (selected === null || editing !== null) { handles.style.display = 'none'; return; }
    const r = selected.getBoundingClientRect();
    handles.style.display = 'block';
    const at = (dir: string, x: number, y: number) => {
      const knob = handles.querySelector('b[data-dir="' + dir + '"]');
      if (!(knob instanceof HTMLElement)) return;
      // Clamped into the canvas: an element flush against the 1200px edge would otherwise put half
      // its handle outside the iframe's viewport, where no pointer can reach it.
      knob.style.left = Math.min(window.innerWidth - HANDLE / 2, Math.max(HANDLE / 2, x)) + 'px';
      knob.style.top = Math.min(window.innerHeight - HANDLE / 2, Math.max(HANDLE / 2, y)) + 'px';
    };
    at('e', r.right, r.top + r.height / 2);
    at('s', r.left + r.width / 2, r.bottom);
    at('se', r.right, r.bottom);
  }

  function stopEditing(): void {
    if (editing === null) return;
    const el = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    el.blur();
    // One log entry per COMMITTED edit, from snapshots taken at edit start and here — never from the
    // browser's own stack. Accepted quirk (spec §2d): that stack is document-scoped and is not
    // cleared on commit, so a native Cmd+Z inside a LATER edit may reach back into this element's
    // text. The editor's own undo stays correct regardless, because it replays these two strings.
    const after = el.innerHTML;
    const eid = eidOf(el);
    if (eid !== '' && after !== editingBefore) pushEntry({ kind: 'text', eid, before: editingBefore, after });
    editingBefore = '';
    paintHandles();
    if (selected !== null) send({ type: 'selection', style: measure(selected) });
  }

  function startEditing(el: HTMLElement): void {
    stopEditing();
    editing = el;
    editingBefore = el.innerHTML;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    // Double-click's own word selection is suppressed by the editor's user-select:none, so select
    // the whole element instead — "double-click, type to replace" is the expected gesture.
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    if (sel !== null) { sel.removeAllRanges(); sel.addRange(range); }
    paintHandles();
  }

  function select(el: HTMLElement | null): void {
    if (selected === el) { paintHandles(); return; }
    stopEditing();
    if (selected !== null) {
      selected.classList.remove(SEL_CLASS);
      if (selected.getAttribute('class') === '') selected.removeAttribute('class');
    }
    selected = el;
    if (selected !== null) selected.classList.add(SEL_CLASS);
    paintHandles();
    send({ type: 'selection', style: selected === null ? null : measure(selected) });
  }

  function num(value: string): number {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Three decimals is an order of magnitude finer than the 1/64px the layout engine snaps to, so a
   * measured rect written back this way round-trips exactly. Rounding to whole pixels would be
   * tidier in the saved source but its error compounds down every level of nesting, and a width
   * rounded even a fraction short can re-wrap a headline.
   */
  function px(n: number): string {
    return Math.round(n * 1000) / 1000 + 'px';
  }

  // --- operation log ---------------------------------------------------------------------------
  //
  // Undo is an operation log, never a document snapshot: the editable html carries the background
  // inlined at ~1.7MB, so snapshotting per operation would cost hundreds of megabytes a session.
  //
  // Entries address elements by EID and are re-resolved at application time. Holding a node
  // reference would break the moment a removed element came back — re-inserting parsed html yields
  // a different object for the same logical element, and the eid rides along inside the stored html.

  /** One inline-style property's absolute values. `''` means "no inline value" (the property is removed). */
  interface StyleDiff { before: string; after: string }

  type LogEntry =
    /** move, resize, font size, colour, weight, alignment — and later z-index, fill, radius, opacity. */
    | { kind: 'style'; eid: string; props: Record<string, StyleDiff> }
    /** A committed inline text edit, as innerHTML either side of it. */
    | { kind: 'text'; eid: string; before: string; after: string }
    /** Add: absent in `before`, present in `after`. `parentEid` `null` means `document.body`. */
    | { kind: 'insert'; eid: string; parentEid: string | null; index: number; html: string }
    /** Delete: the mirror of `insert`. */
    | { kind: 'remove'; eid: string; parentEid: string | null; index: number; html: string }
    /** A refine landing, or an undone one. Keys into `bgUris`; `null` is the source background. */
    | { kind: 'background'; beforeRunId: number | null; afterRunId: number | null };

  type Direction = 'before' | 'after';

  const undoStack: LogEntry[] = [];
  const redoStack: LogEntry[] = [];

  function sendHistory(): void {
    send({ type: 'history', undoDepth: undoStack.length, redoDepth: redoStack.length });
  }

  /** The one way an entry reaches the log: any new operation also invalidates the redo stack. */
  function pushEntry(entry: LogEntry): void {
    undoStack.push(entry);
    if (undoStack.length > LOG_CAP) undoStack.shift();
    redoStack.length = 0;
    sendHistory();
  }

  function eidOf(el: Element): string {
    return el.getAttribute('data-forge-eid') ?? '';
  }

  function byEid(eid: string): Element | null {
    return eid === '' ? null : document.querySelector('[data-forge-eid="' + eid + '"]');
  }

  /** The inline values of `names` right now, to diff a gesture against once it completes. */
  function snapshot(el: HTMLElement, names: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of names) out[name] = el.style.getPropertyValue(name);
    return out;
  }

  function setProp(el: HTMLElement, name: string, value: string): void {
    if (value === '') el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }

  /** Diff `el`'s inline styles against a snapshot; logs ONE entry, or none if nothing actually moved. */
  function pushStyleDiff(el: HTMLElement, before: Record<string, string>): void {
    const eid = eidOf(el);
    if (eid === '') return;
    const props: Record<string, StyleDiff> = {};
    let changed = false;
    for (const name of Object.keys(before)) {
      const was = before[name] ?? '';
      const now = el.style.getPropertyValue(name);
      if (was === now) continue;
      props[name] = { before: was, after: now };
      changed = true;
    }
    if (changed) pushEntry({ kind: 'style', eid, props });
  }

  function applyStyleEntry(entry: { eid: string; props: Record<string, StyleDiff> }, dir: Direction): Element | null {
    const el = byEid(entry.eid);
    if (!(el instanceof HTMLElement)) return null;
    for (const name of Object.keys(entry.props)) {
      const diff = entry.props[name];
      if (diff !== undefined) setProp(el, name, dir === 'before' ? diff.before : diff.after);
    }
    return el;
  }

  function applyTextEntry(entry: { eid: string; before: string; after: string }, dir: Direction): Element | null {
    const el = byEid(entry.eid);
    if (el === null) return null;
    el.innerHTML = dir === 'before' ? entry.before : entry.after;
    return el;
  }

  /** Rebuild a logged element at its recorded index — both directions reconstruct it from outerHTML. */
  function insertLogged(entry: { eid: string; parentEid: string | null; index: number; html: string }): Element | null {
    const existing = byEid(entry.eid);
    if (existing !== null) return existing;
    const host = entry.parentEid === null ? document.body : byEid(entry.parentEid);
    if (host === null) return null;
    const tpl = document.createElement('template');
    tpl.innerHTML = entry.html;
    const node = tpl.content.firstElementChild;
    if (node === null) return null;
    host.insertBefore(node, host.children[entry.index] ?? null);
    return node;
  }

  function removeLogged(eid: string): void {
    const el = byEid(eid);
    if (el === null) return;
    if (selected === el) select(null);
    el.remove();
  }

  /**
   * Repoint every reference to the applied background URI at another one. The composited candidate
   * carries it in a `<style>` rule; inline `style` attributes and `<img src>` are covered too so a
   * differently-shaped document cannot silently keep the old bytes.
   */
  function swapBg(from: string, to: string): void {
    if (from === '' || from === to) return;
    for (const node of Array.from(document.querySelectorAll('style'))) {
      if (node.id.indexOf(PREFIX) === 0) continue;
      const text = node.textContent;
      if (text !== null && text.indexOf(from) !== -1) node.textContent = text.split(from).join(to);
    }
    for (const node of Array.from(document.querySelectorAll('[style]'))) {
      const attr = node.getAttribute('style');
      if (attr !== null && attr.indexOf(from) !== -1) node.setAttribute('style', attr.split(from).join(to));
    }
    for (const img of Array.from(document.images)) {
      if (img.getAttribute('src') === from) img.setAttribute('src', to);
    }
  }

  /** Put the document on the background belonging to `runId` (`null` = the source candidate's). */
  function applyBackground(runId: number | null): boolean {
    const next = bgUris.get(runId);
    if (next === undefined) return false;
    swapBg(bgDataUri, next);
    bgDataUri = next;
    bgRunId = runId;
    return true;
  }

  /**
   * A refine landing: register the patched URI under its run, put the document on it, and log the
   * move as ONE entry. The `before` half is whatever run the document is on at this moment, so a
   * refine after an undo unwinds back to exactly where it started.
   */
  function landBackground(toUri: string, runId: number): void {
    // Nothing to swap FROM before `init` has named the source URI, and re-landing the run the
    // document is already on would only log a no-op entry.
    if (toUri === '' || bgDataUri === '' || runId === bgRunId) return;
    const from = bgRunId;
    bgUris.set(runId, toUri);
    if (!applyBackground(runId)) return;
    pushEntry({ kind: 'background', beforeRunId: from, afterRunId: runId });
  }

  function applyEntry(entry: LogEntry, dir: Direction): void {
    let touched: Element | null = null;
    switch (entry.kind) {
      case 'style':
        touched = applyStyleEntry(entry, dir);
        break;
      case 'text':
        touched = applyTextEntry(entry, dir);
        break;
      case 'insert':
      case 'remove': {
        const present = entry.kind === 'insert' ? dir === 'after' : dir === 'before';
        if (present) touched = insertLogged(entry);
        else removeLogged(entry.eid);
        break;
      }
      case 'background':
        applyBackground(dir === 'before' ? entry.beforeRunId : entry.afterRunId);
        break;
    }
    // Re-select what the entry touched, so the effect of an undo is always visible; then re-measure,
    // because undoing a colour or a resize has to walk the toolbar back with it.
    if (touched instanceof HTMLElement && selected !== touched) select(touched);
    paintHandles();
    if (selected !== null) send({ type: 'selection', style: measure(selected) });
  }

  function undo(): void {
    // A text edit still open commits first, as its own entry — so this pop undoes exactly that edit.
    stopEditing();
    const entry = undoStack.pop();
    if (entry !== undefined) {
      applyEntry(entry, 'before');
      redoStack.push(entry);
    }
    sendHistory();
  }

  function redo(): void {
    stopEditing();
    const entry = redoStack.pop();
    if (entry !== undefined) {
      applyEntry(entry, 'after');
      undoStack.push(entry);
    }
    sendHistory();
  }

  // --- add / delete / layer ---------------------------------------------------------------------

  /** The padding-edge origin an absolute child of `el` is positioned against — pin-all's reference. */
  function originOf(el: Element): { x: number; y: number } {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { x: r.left + num(cs.borderLeftWidth), y: r.top + num(cs.borderTopWidth) };
  }

  /**
   * Where a new element is inserted: INSIDE the background carrier, alongside the design's own
   * elements, not in `body` beside the carrier.
   *
   * This is what makes layering work. A candidate's content lives inside its full-bleed canvas div,
   * so an element added to `body` is a sibling of that div and of nothing else — z-index only orders
   * within one parent, so it could never be sent below any original element, only below the whole
   * design (where it would vanish). Adding it to the carrier makes it a peer of the scrim, the text
   * block and the rest, which is what "send backward" is expected to step through.
   *
   * The deepest carrier wins, and the last of equal depth — with stacked full-bleed layers, the
   * innermost, topmost one is the surface the user is actually looking at.
   */
  function addHost(): HTMLElement {
    let best: HTMLElement | null = null;
    let bestDepth = -1;
    for (const node of Array.from(document.querySelectorAll('[data-forge-bg]'))) {
      if (!(node instanceof HTMLElement)) continue;
      let depth = 0;
      for (let p = node.parentElement; p !== null; p = p.parentElement) depth += 1;
      if (depth >= bestDepth) { bestDepth = depth; best = node; }
    }
    return best ?? document.body;
  }

  /**
   * The colour and typeface of the document's biggest piece of text, so an added block is legible
   * against the same background everything else sits on AND set in the same face. "Biggest" is by
   * computed font size, over elements that render text of their OWN (a wrapper's descendant text is
   * the descendant's).
   *
   * The spec names `body`'s computed style as the font-family source; that is the FALLBACK here,
   * because these candidates set their typeface on the canvas div rather than on `body`, so reading
   * `body` alone drops new text into the browser default (Times) beside a web-font headline.
   */
  function dominantText(): { color: string; fontFamily: string } {
    let bestColor: string | null = null;
    let bestFamily: string | null = null;
    let bestSize = -1;
    for (const node of Array.from(document.querySelectorAll('[data-forge-eid]'))) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.hasAttribute('data-forge-bg')) continue;
      let owns = false;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3 && (child.textContent ?? '').trim() !== '') { owns = true; break; }
      }
      if (!owns) continue;
      const cs = getComputedStyle(node);
      const size = num(cs.fontSize);
      if (size > bestSize) { bestSize = size; bestColor = cs.color; bestFamily = cs.fontFamily; }
    }
    return {
      color: bestColor === null ? '#ffffff' : toHex(bestColor),
      fontFamily: bestFamily ?? getComputedStyle(document.body).fontFamily,
    };
  }

  /** Index among `parent`'s ELEMENT children — the coordinate `insert`/`remove` entries replay. */
  function indexIn(parent: Element, el: Element): number {
    return Array.from(parent.children).indexOf(el);
  }

  function addElement(kind: 'text' | 'box'): void {
    if (!pinned) return;
    const el = document.createElement('div');
    const width = kind === 'box' ? 400 : 600;
    const height = kind === 'box' ? 240 : 120;
    const host = addHost();
    const origin = originOf(host);
    const s = el.style;
    // The same shape pin-all leaves every other element in, so the new one is indistinguishable from
    // a pinned one: absolute, no margins, no `right`/`bottom` to over-constrain it.
    s.position = 'absolute';
    s.margin = '0';
    s.padding = '0';
    s.right = 'auto';
    s.bottom = 'auto';
    // Border-box means the written width/height ARE the rect, so the resize handles and a later
    // re-pin agree with each other without a padding subtraction.
    s.boxSizing = 'border-box';
    s.left = px(window.innerWidth / 2 - width / 2 - origin.x);
    s.top = px(window.innerHeight / 2 - height / 2 - origin.y);
    s.width = px(width);
    s.height = px(height);
    if (kind === 'box') {
      el.setAttribute('data-forge-kind', 'box');
      s.backgroundColor = '#000000';
      s.borderRadius = '0px';
      s.opacity = '0.4';
    } else {
      const dominant = dominantText();
      s.fontFamily = dominant.fontFamily;
      s.fontSize = '48px';
      s.fontWeight = '700';
      s.color = dominant.color;
      el.textContent = 'new text';
    }
    el.setAttribute('data-forge-eid', String(nextEid++));
    // Last child of the host, so a new element starts on top of its new peers. In `body` that means
    // before the handles overlay, which has to stay the final child.
    if (host === document.body) host.insertBefore(el, handles);
    else host.appendChild(el);
    // Captured before selection/contenteditable touch it: the log must replay a clean element.
    pushEntry({
      kind: 'insert', eid: eidOf(el), parentEid: host === document.body ? null : eidOf(host),
      index: indexIn(host, el), html: el.outerHTML,
    });
    select(el);
    // "Add text, type" is one gesture: the placeholder is pre-selected so the first keystroke replaces it.
    if (kind === 'text') startEditing(el);
  }

  function deleteSelection(): void {
    if (!pinned || selected === null) return;
    const el = selected;
    const parent = el.parentElement;
    if (parent === null) return;
    // A pinned element's parent is usually body or another pin target, but a skipped inline wrapper
    // can own one. Give it an eid rather than lose the anchor — the attribute is bookkeeping only
    // and is stripped at serialize like every other.
    if (parent !== document.body && eidOf(parent) === '') parent.setAttribute('data-forge-eid', String(nextEid++));
    const parentEid = parent === document.body ? null : eidOf(parent);
    const index = indexIn(parent, el);
    const eid = eidOf(el);
    if (eid === '') return;
    // Deselect FIRST: the recorded outerHTML must not carry the selection outline's class, or every
    // undo would restore a stale one.
    select(null);
    pushEntry({ kind: 'remove', eid, parentEid, index, html: el.outerHTML });
    el.remove();
    paintHandles();
  }

  /**
   * Give every pin target under `parent` an explicit, EVEN z-index matching the order it already
   * paints in — sorted by effective z (`auto` counts as 0) with document order as the tiebreak.
   *
   * This is a representation change, not an edit: paint order is identical either side of it, so it
   * is deliberately not logged. What it buys is that a layer op afterwards only has to write ONE
   * value (the odd slot between two neighbours) instead of renumbering, which keeps every layer op a
   * single undo entry — a `style` entry addresses one element.
   */
  function normalizeZ(parent: Element): HTMLElement[] {
    const kids: { el: HTMLElement; z: number; i: number }[] = [];
    let i = 0;
    for (const child of Array.from(parent.children)) {
      i += 1;
      if (!(child instanceof HTMLElement)) continue;
      if (!child.hasAttribute('data-forge-eid')) continue;
      const raw = getComputedStyle(child).zIndex;
      kids.push({ el: child, z: raw === 'auto' ? 0 : Number.parseInt(raw, 10) || 0, i });
    }
    kids.sort((a, b) => (a.z - b.z) || (a.i - b.i));
    // Numbering starts at 2, not 0, so "send to back" has the odd slot 1 to land in without ever
    // going negative — see the clamp in `layer()` for why negative is not an option.
    let rank = 1;
    for (const kid of kids) { kid.el.style.setProperty('z-index', String(rank * 2)); rank += 1; }
    return kids.map((kid) => kid.el);
  }

  /**
   * Re-stack the selection among its siblings.
   *
   * Background carriers are the FLOOR, not participants: they are siblings of the content (both are
   * usually body children), so ordering against them literally would let "send to back" drop a box
   * to `z-index:-1` underneath the full-bleed background, where it vanishes completely. They are
   * excluded from the running order and clamp everything else above them instead.
   *
   * Accepted limit (spec §3d): z-index only orders within a shared stacking context, so an element
   * nested in a container can never be raised above a sibling of that container. Reparenting to
   * escape that is out of scope.
   */
  function layer(dir: string): void {
    if (!pinned || selected === null) return;
    const parent = selected.parentElement;
    if (parent === null) return;
    const zOf = (el: HTMLElement | undefined): number =>
      el === undefined ? 0 : num(el.style.getPropertyValue('z-index'));
    const normalized = normalizeZ(parent);
    // The highest background carrier among the siblings — nothing may be ordered below it.
    let floor = -Infinity;
    for (const el of normalized) if (el.hasAttribute('data-forge-bg')) floor = Math.max(floor, zOf(el));
    const order = normalized.filter((el) => !el.hasAttribute('data-forge-bg'));
    const at = order.indexOf(selected);
    if (at === -1) return;
    let next: number;
    if (dir === 'front') next = zOf(order[order.length - 1]) + 1;
    else if (dir === 'back') next = zOf(order[0]) - 1;
    else if (dir === 'forward') {
      if (at === order.length - 1) return;
      next = zOf(order[at + 1]) + 1;
    } else if (dir === 'backward') {
      if (at === 0) return;
      next = zOf(order[at - 1]) - 1;
    } else return;
    if (floor !== -Infinity && next <= floor) next = floor + 1;
    // Never negative. A positioned element with a negative z-index is painted in its nearest
    // ANCESTOR stacking context, and a pinned container has `z-index:auto` — so it is not one. The
    // element would jump the container entirely and land behind the canvas's background image,
    // invisible. `normalizeZ` starts at 2 to keep slot 1 free for exactly this case.
    if (next < 1) next = 1;
    // Snapshot AFTER normalising: undo has to restore the normalised value, not the absent one, or
    // it would drop the element to an effective 0 while its siblings still carry explicit z.
    const before = snapshot(selected, ['z-index']);
    selected.style.setProperty('z-index', String(next));
    pushStyleDiff(selected, before);
    paintHandles();
    send({ type: 'selection', style: measure(selected) });
  }

  /** One pinning decision, measured in pass 1 and applied untouched in pass 2. */
  interface PinPlan {
    el: HTMLElement | SVGElement;
    left: number;
    top: number;
    width: number;
    height: number;
    background: boolean;
  }

  /**
   * Convert the whole document to absolute positioning, once, before any gesture.
   *
   * Pass 1 measures with zero mutation (the first write invalidates every later rect); pass 2
   * applies in document order, so a parent always gets its explicit height before its children
   * leave flow and therefore cannot collapse. Every pin is a visual no-op, and afterwards moving
   * anything is a pure `left`/`top` write that cannot reflow a sibling.
   *
   * `left`/`top` are measured against the padding edge of the nearest ancestor that is ITSELF a pin
   * target — the post-pin containing block. The literal DOM parent is the wrong reference: a
   * skipped inline wrapper stays `position:static` and never becomes one.
   *
   * Margins are zeroed rather than subtracted out. Computed margins are *used* values, so a block
   * centred with `margin:0 auto` reports a concrete left margin that resolves to 0 once the element
   * is out of flow — subtracting it would throw the box sideways by exactly that much.
   */
  function pinAll(): void {
    const plan: PinPlan[] = [];
    const canvasArea = window.innerWidth * window.innerHeight;

    const measurePass = (parent: Element, originX: number, originY: number): void => {
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) continue;
        if (child.id.indexOf(PREFIX) === 0) continue;
        const cs = getComputedStyle(child);
        const rect = child.getBoundingClientRect();
        // Replaced elements are opaque: their children are not CSS boxes and must never be pinned.
        const replaced = REPLACED.indexOf(child.tagName.toLowerCase()) !== -1;
        const sized = rect.width > 0 && rect.height > 0;
        if (!sized || !(replaced || BLOCKISH.indexOf(cs.display) !== -1)) {
          // Skipped, but walked THROUGH: a block nested in a <span> still pins, and against this
          // same origin, because the skipped wrapper never becomes its containing block.
          if (!replaced) measurePass(child, originX, originY);
          continue;
        }
        const borderLeft = num(cs.borderLeftWidth);
        const borderTop = num(cs.borderTopWidth);
        // The rect is a border box; `width`/`height` mean the content box unless the element says
        // otherwise, so strip the padding and borders back off when it doesn't.
        let width = rect.width;
        let height = rect.height;
        if (cs.boxSizing !== 'border-box') {
          width = Math.max(0, width - borderLeft - num(cs.borderRightWidth)
            - num(cs.paddingLeft) - num(cs.paddingRight));
          height = Math.max(0, height - borderTop - num(cs.borderBottomWidth)
            - num(cs.paddingTop) - num(cs.paddingBottom));
        }
        plan.push({
          el: child,
          left: rect.left - originX,
          top: rect.top - originY,
          width,
          height,
          // EVERY full-bleed layer is a background carrier, not just the first or the largest: a
          // document that stacks two of them must protect both, or the user drags what looks like
          // the entire design off the canvas.
          background: canvasArea > 0 && (rect.width * rect.height) / canvasArea >= FULL_BLEED,
        });
        if (!replaced) measurePass(child, rect.left + borderLeft, rect.top + borderTop);
      }
    };

    const bodyCs = getComputedStyle(document.body);
    const bodyRect = document.body.getBoundingClientRect();
    measurePass(document.body, bodyRect.left + num(bodyCs.borderLeftWidth), bodyRect.top + num(bodyCs.borderTopWidth));

    // Top-level children need a containing block before they go absolute.
    document.body.style.position = 'relative';
    for (const item of plan) {
      item.el.setAttribute('data-forge-eid', String(nextEid++));
      if (item.background) item.el.setAttribute('data-forge-bg', '');
      const s = item.el.style;
      s.position = 'absolute';
      s.margin = '0';
      // `right`/`bottom` are forced to `auto`: an element that already derived its width from
      // `left`+`right` would be over-constrained by adding an explicit `left`, and resize instead
      // of hold still.
      s.right = 'auto';
      s.bottom = 'auto';
      s.left = px(item.left);
      s.top = px(item.top);
      s.width = px(item.width);
      s.height = px(item.height);
    }
  }

  /**
   * Move content that sits BESIDE the background carrier onto it, preserving its exact position.
   *
   * z-index only orders within one parent, so an element that is a sibling of the canvas can never
   * be sent below anything nested inside the canvas — "send to back" just parks it directly above
   * the whole design, forever. Elements added by an earlier version of this editor were inserted
   * into `body` and saved that way, so reopening such a candidate reproduces that dead end. Adopting
   * them onto the carrier is what makes layering reach the design's own elements.
   *
   * Only LATER siblings move: they already paint above the carrier, so re-homing them under it
   * leaves the picture identical (their z-indices stay, and the carrier's own children default to
   * an effective 0). Runs inside the pin pass, before `ready` and before any log entry exists, so
   * it is a representation change like pinning itself — never an edit the user has to undo.
   */
  function adoptStrays(): void {
    const host = addHost();
    const parent = host.parentElement;
    if (host === document.body || parent === null) return;
    const strays: HTMLElement[] = [];
    let seenHost = false;
    for (const child of Array.from(parent.children)) {
      if (child === host) { seenHost = true; continue; }
      if (!seenHost || !(child instanceof HTMLElement)) continue;
      if (!child.hasAttribute('data-forge-eid') || child.hasAttribute('data-forge-bg')) continue;
      strays.push(child);
    }
    if (strays.length === 0) return;
    const origin = originOf(host);
    for (const el of strays) {
      // Measure BEFORE the move: the containing block changes with the parent, so `left`/`top` have
      // to be re-expressed against the carrier's padding edge to keep the element exactly put.
      const r = el.getBoundingClientRect();
      host.appendChild(el);
      el.style.left = px(r.left - origin.x);
      el.style.top = px(r.top - origin.y);
    }
  }

  document.addEventListener('pointerdown', (e) => {
    if (!pinned) return;
    const target = e.target;
    // A resize handle owns the gesture outright.
    if (target instanceof HTMLElement && target.parentElement === handles && selected !== null) {
      const r = selected.getBoundingClientRect();
      resize = {
        el: selected, dir: target.getAttribute('data-dir') ?? 'se',
        startX: e.clientX, startY: e.clientY, w: r.width, h: r.height,
        before: snapshot(selected, ['width', 'height']),
      };
      e.preventDefault();
      return;
    }
    // Inside the element being text-edited: let the browser place the caret, never drag.
    if (editing !== null && target instanceof Node && editing.contains(target)) return;
    const el = selectable(target);
    select(el);
    if (el === null) return;
    // Everything is already absolute, so the current offsets are simply where the drag starts from.
    const cs = getComputedStyle(el);
    drag = {
      el, startX: e.clientX, startY: e.clientY, left: num(cs.left), top: num(cs.top), moved: false,
      before: snapshot(el, ['left', 'top']),
    };
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (resize !== null) {
      // The pointer's clientX/clientY are already in the iframe's own 1200px space — the browser
      // inverts the parent's CSS `transform: scale()` during hit-testing, so no manual factor.
      const dx = e.clientX - resize.startX;
      const dy = e.clientY - resize.startY;
      if (resize.dir !== 's') resize.el.style.width = Math.max(8, Math.round(resize.w + dx)) + 'px';
      if (resize.dir !== 'e') resize.el.style.height = Math.max(8, Math.round(resize.h + dy)) + 'px';
      paintHandles();
      if (selected !== null) send({ type: 'selection', style: measure(selected) });
      return;
    }
    if (drag === null) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      drag.moved = true;
    }
    drag.el.style.left = px(drag.left + dx);
    drag.el.style.top = px(drag.top + dy);
    paintHandles();
  });

  const endGesture = () => {
    const changed = resize !== null || (drag !== null && drag.moved);
    // Pointerup, not pointermove: a drag or a resize is ONE entry however many frames it took.
    if (resize !== null) pushStyleDiff(resize.el, resize.before);
    if (drag !== null && drag.moved) pushStyleDiff(drag.el, drag.before);
    drag = null;
    resize = null;
    if (changed && selected !== null) { paintHandles(); send({ type: 'selection', style: measure(selected) }); }
  };
  document.addEventListener('pointerup', endGesture);
  document.addEventListener('pointercancel', endGesture);

  document.addEventListener('dblclick', (e) => {
    if (!pinned) return;
    const el = selectable(e.target);
    if (el === null) return;
    select(el);
    startEditing(el);
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      // Inside an active text edit the key belongs to the browser: backing a word out has to behave
      // the way it does in any other text field. The committed edit is one entry on our own stack.
      if (editing !== null) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Inside a text edit these keys ARE text input; nowhere else do they mean anything but delete.
      if (editing !== null || selected === null) return;
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key !== 'Escape') return;
    // Escape commits the text edit (contract: blur/Escape both commit); only OUTSIDE an edit does
    // it mean "close the editor", which is the parent's decision to make.
    if (editing !== null) { e.preventDefault(); e.stopPropagation(); stopEditing(); return; }
    send({ type: 'escape' });
  });

  /** `<!doctype html>` + a cleaned clone: editor artifacts never reach the saved html source. */
  function serialize(): string {
    stopEditing();
    const clone = document.documentElement.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return '';
    for (const node of Array.from(clone.querySelectorAll('[id^="' + PREFIX + '"]'))) node.remove();
    for (const node of Array.from(clone.querySelectorAll('.' + SEL_CLASS))) {
      node.classList.remove(SEL_CLASS);
      if (node.getAttribute('class') === '') node.removeAttribute('class');
    }
    for (const node of Array.from(clone.querySelectorAll('[contenteditable]'))) node.removeAttribute('contenteditable');
    // The pinned geometry itself is PERSISTED — a reopened editor must inherit the same layout —
    // but the editor's own bookkeeping never reaches the saved source. The one exception is
    // `data-forge-kind`: it is not bookkeeping but a property of the element, and a reopened editor
    // has no other way to know a box is a box.
    for (const node of Array.from(clone.querySelectorAll('[data-forge-eid]'))) node.removeAttribute('data-forge-eid');
    for (const node of Array.from(clone.querySelectorAll('[data-forge-bg]'))) node.removeAttribute('data-forge-bg');
    return '<!doctype html>\n' + clone.outerHTML;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const msg: unknown = e.data;
    if (typeof msg !== 'object' || msg === null) return;
    const cmd = msg as {
      forge?: unknown; type?: unknown; patch?: Record<string, unknown>;
      bgDataUri?: unknown; kind?: unknown; dir?: unknown; toUri?: unknown; runId?: unknown;
    };
    if (cmd.forge !== COMMAND_TAG) return;
    if (cmd.type === 'init') {
      if (typeof cmd.bgDataUri === 'string') {
        bgDataUri = cmd.bgDataUri;
        // The source background is the map's `null` key; every `background` entry keys into here.
        bgUris.set(null, bgDataUri);
        bgRunId = null;
      }
      return;
    }
    if (cmd.type === 'serialize') {
      // The runtime is the single source of truth for which background the document carries; the
      // parent reverses the substitution with what it is told here, never with what it loaded.
      send({ type: 'html', html: serialize(), bgDataUri: bgDataUri, bgRunId: bgRunId });
      return;
    }
    if (cmd.type === 'deselect') { select(null); return; }
    if (cmd.type === 'undo') { undo(); return; }
    if (cmd.type === 'redo') { redo(); return; }
    if (cmd.type === 'add') {
      if (cmd.kind === 'text' || cmd.kind === 'box') addElement(cmd.kind);
      return;
    }
    if (cmd.type === 'layer') {
      if (typeof cmd.dir === 'string') layer(cmd.dir);
      return;
    }
    if (cmd.type === 'background') {
      if (typeof cmd.toUri === 'string' && typeof cmd.runId === 'number') landBackground(cmd.toUri, cmd.runId);
      return;
    }
    if (cmd.type !== 'style' || selected === null) return;
    const patch = cmd.patch ?? {};
    const el = selected;
    // One entry per discrete toolbar action: snapshot, write, diff.
    const before = snapshot(el, [
      'font-size', 'color', 'font-weight', 'text-align', 'background-color', 'border-radius', 'opacity',
    ]);
    if (typeof patch['fontSizePx'] === 'number') el.style.setProperty('font-size', patch['fontSizePx'] + 'px');
    if (typeof patch['color'] === 'string') el.style.setProperty('color', patch['color']);
    if (typeof patch['fontWeight'] === 'number') el.style.setProperty('font-weight', String(patch['fontWeight']));
    if (typeof patch['textAlign'] === 'string') el.style.setProperty('text-align', patch['textAlign']);
    if (typeof patch['fill'] === 'string') el.style.setProperty('background-color', patch['fill']);
    if (typeof patch['radiusPx'] === 'number') el.style.setProperty('border-radius', patch['radiusPx'] + 'px');
    if (typeof patch['opacityPct'] === 'number') el.style.setProperty('opacity', String(patch['opacityPct'] / 100));
    pushStyleDiff(el, before);
    paintHandles();
    send({ type: 'selection', style: measure(el) });
  });

  /**
   * Pinning must not run until the document has its REAL metrics. The candidate html loads its web
   * fonts with `display=swap`, so a script at the end of `<body>` sees text laid out in the fallback
   * face; pinning there would freeze every box at metrics that go wrong the instant the real font
   * arrives. (The server renderer awaits `document.fonts.ready` before screenshotting for exactly
   * this reason.) Images then have to be decoded, and a double `requestAnimationFrame` lets the
   * resulting layout settle.
   */
  async function settle(): Promise<void> {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  async function boot(): Promise<void> {
    // Imperfect metrics still beat an editor that never opens, so a rejection here is not fatal.
    try { await settle(); } catch { /* fall through and pin on whatever we have */ }
    pinAll();
    // Only meaningful once everything is absolute: re-homing an element is a pure `left`/`top`
    // rewrite then, and cannot disturb a layout that no longer has any flow left to disturb.
    adoptStrays();
    pinned = true;
    // Only now: `ready` is the parent's signal that the document is pinned and gestures are live.
    send({ type: 'ready' });
  }

  void boot();
}

/** The `<style>`/`<script>` the runtime installs all carry this id prefix, and strip themselves by it. */
const RUNTIME_SCRIPT_ID = '__forge_ed_runtime';

/**
 * Splice the runtime into a complete HTML document. Injected LAST (just before `</body>`) so the
 * document's own styles are already parsed when the editor's `!important` overrides land.
 */
export function injectRuntime(html: string): string {
  const tag = `<script id="${RUNTIME_SCRIPT_ID}">(${runtime.toString()})();</script>`;
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at === -1 ? html + tag : html.slice(0, at) + tag + html.slice(at);
}
