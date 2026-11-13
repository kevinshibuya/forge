import { useEffect, useRef, useState } from 'react';
import { usePatchPost } from '../api/hooks';
import { normalizeHashtags } from '../lib/hashtags';
import { LintedText } from './linted-text';
import { ErrorNote, Pill, chipInputCls } from './primitives';

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Wholesale editor for `post.hashtags`. Every commit normalizes the WHOLE array and PATCHes it,
 * because the endpoint replaces the column rather than merging — so the local array is always the
 * complete next state. Server state is the only source of truth here: there is no local copy of
 * the list to drift, just the in-progress text of whichever field is open.
 */
export function HashtagEditor({ postId, hashtags, readOnly = false }: {
  postId: number; hashtags: string[]; readOnly?: boolean;
}) {
  const patch = usePatchPost(postId);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [draft, setDraft] = useState('');
  const busy = patch.isPending;
  const addRef = useRef<HTMLInputElement | null>(null);
  const refocusAdd = useRef(false);

  /** Reports whether a write was actually launched: only then do the inputs disable, and only then
   *  does focus need reclaiming. */
  const commit = (next: string[]): boolean => {
    const normalized = normalizeHashtags(next);
    // A no-op edit (e.g. re-adding a case variant of an existing tag) must not spend a write.
    if (sameTags(normalized, hashtags)) return false;
    patch.mutate({ hashtags: normalized });
    return true;
  };

  // Enter disables the add input for the length of the PATCH, and the browser blurs whatever it
  // disables. Hand focus back so a run of hashtags can be typed without reaching for the mouse.
  useEffect(() => {
    if (busy || !refocusAdd.current) return;
    refocusAdd.current = false;
    addRef.current?.focus();
  }, [busy]);

  const startEdit = (index: number) => {
    if (busy || readOnly) return;
    setEditingIndex(index);
    setEditValue(hashtags[index] ?? '');
  };
  const commitEdit = (index: number) => {
    setEditingIndex(null);
    // An edit blanked to nothing removes the tag — normalization drops the empty.
    commit(hashtags.map((t, i) => (i === index ? editValue : t)));
  };
  const remove = (index: number) => commit(hashtags.filter((_, i) => i !== index));

  const commitDraft = (): boolean => {
    const value = draft;
    setDraft('');
    if (value.trim() === '') return false;
    return commit([...hashtags, value]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {hashtags.map((tag, index) =>
          editingIndex === index ? (
            <input
              key={`edit-${index}`}
              autoFocus
              className={`${chipInputCls} w-32`}
              value={editValue}
              disabled={busy}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => setEditingIndex(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(index); }
                if (e.key === 'Escape') { e.preventDefault(); setEditingIndex(null); }
              }}
            />
          ) : (
            <Pill key={`${tag}-${index}`} className={readOnly ? '' : 'pr-1.5'}>
              <button type="button" className="lowercase disabled:cursor-not-allowed" disabled={busy || readOnly}
                title={readOnly ? undefined : 'click to edit'} onClick={() => startEdit(index)}>
                <LintedText text={tag} />
              </button>
              {!readOnly && (
                <button type="button" aria-label={`remove ${tag}`} disabled={busy}
                  className="rounded-full px-1 text-soft transition-colors hover:text-ink disabled:cursor-not-allowed"
                  onClick={() => remove(index)}>
                  ×
                </button>
              )}
            </Pill>
          ),
        )}
        {!readOnly && (
        <input
          ref={addRef}
          className={`${chipInputCls} w-36`}
          value={draft}
          disabled={busy}
          placeholder={hashtags.length === 0 ? 'add a hashtag' : '+ hashtag'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { commitDraft(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); refocusAdd.current = commitDraft(); }
            // Clearing first makes the blur that follows a no-op, so Escape never adds.
            if (e.key === 'Escape') { e.preventDefault(); setDraft(''); }
          }}
        />
        )}
      </div>
      {patch.isError && (
        <div className="mt-2"><ErrorNote label="hashtags failed to save">{patch.error.message}</ErrorNote></div>
      )}
    </div>
  );
}
