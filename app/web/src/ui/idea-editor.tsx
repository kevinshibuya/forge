import { useState } from 'react';
import { usePatchIdea } from '../api/hooks';
import type { IdeaDto } from '../api/client';
import { ErrorNote, Panel, inputCls } from './primitives';

/** The body textarea's idiom at paragraph scale: same border and typography, shorter box. */
const ideaBoxCls = `${inputCls} min-h-24 font-sans leading-relaxed text-[14px] disabled:opacity-50`;

/**
 * Click-to-edit over `idea.rawText`, following `HashtagEditor`'s model: server state is the only
 * truth, and the sole local state is the in-progress text of an open editor. The save is a PATCH
 * on the idea, so the posts list title and this panel both follow the invalidation.
 */
export function IdeaEditor({ idea, readOnly = false }: { idea: IdeaDto; readOnly?: boolean }) {
  const patch = usePatchIdea();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [empty, setEmpty] = useState(false);
  const busy = patch.isPending;

  const open = () => {
    if (busy || readOnly) return;
    setDraft(idea.rawText);
    setEmpty(false);
    setEditing(true);
  };

  /** `usePatchIdea` returns its refetch promise, so `isPending` holds until the fresh text is in
   *  cache. Staying open until then keeps the at-rest paragraph from flashing the stale value. */
  const save = () => {
    const next = draft.trim();
    if (next === '') { setEmpty(true); return; }
    setEmpty(false);
    if (next === idea.rawText) { setEditing(false); return; }
    patch.mutate({ id: idea.id, rawText: next }, { onSuccess: () => setEditing(false) });
  };

  return (
    <Panel className="mb-4">
      <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">the idea</div>
      {readOnly ? (
        // On a measured post the idea is a record, so it renders as the paragraph it is with no
        // affordance suggesting otherwise.
        <div className="mt-1 text-[14px] text-soft">{idea.rawText}</div>
      ) : editing ? (
        <textarea
          autoFocus
          aria-label="the idea"
          className={`mt-1 ${ideaBoxCls}`}
          value={draft}
          disabled={busy}
          onChange={(e) => { setDraft(e.target.value); setEmpty(false); }}
          // The browser blurs what it disables, so a blur mid-PATCH would save a second time.
          onBlur={() => { if (!busy) save(); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
            // Reverting first makes the blur that follows compare equal, so Escape never saves.
            if (e.key === 'Escape') { e.preventDefault(); setDraft(idea.rawText); setEmpty(false); setEditing(false); }
          }}
        />
      ) : (
        <button type="button" aria-label="edit the idea" title="click to edit"
          className="mt-1 block w-full text-left text-[14px] text-soft transition-colors hover:text-ink disabled:cursor-not-allowed"
          disabled={busy} onClick={open}>
          {idea.rawText}
        </button>
      )}
      {/* Field scale: a validation message under the box, not a panel-level failure. */}
      {empty && <div className="mt-2"><ErrorNote inline label="the idea cannot be empty" /></div>}
      {patch.isError && (
        <div className="mt-2"><ErrorNote label="idea failed to save">{patch.error.message}</ErrorNote></div>
      )}
    </Panel>
  );
}
