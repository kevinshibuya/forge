import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { sameSources, type Source } from '@forge/shared';
import { useUpdateBody } from '../api/hooks';
import { LintedText } from './linted-text';
import { ErrorNote, Pill, chipInputCls } from './primitives';

/** A ref that parses as http or https is the web; everything else is a path on this machine. */
// Exported for its spec; its only consumer is the editor below. Splitting it out to please fast
// refresh would make a module of six lines with one reader, which is the worse boundary.
// oxlint-disable-next-line react/only-export-components
export function inferKind(ref: string): Source['kind'] {
  try {
    const { protocol } = new URL(ref);
    return protocol === 'http:' || protocol === 'https:' ? 'web' : 'file';
  } catch {
    return 'file';
  }
}

/** Which field of which row is open. Only one can be, so one piece of state covers both. */
type Editing = { index: number; field: 'ref' | 'note' } | null;

/**
 * Wholesale editor for `post.sources`, in `HashtagEditor`'s language. Every commit sends the
 * COMPLETE next list, because the body endpoint replaces the column rather than merging. Server
 * state is the only truth: the sole local state is the in-progress text of whichever field is open.
 */
export function SourcesEditor({ postId, sources, readOnly = false }: {
  postId: number; sources: Source[]; readOnly?: boolean;
}) {
  const save = useUpdateBody(postId);
  const [editing, setEditing] = useState<Editing>(null);
  const [editValue, setEditValue] = useState('');
  const [draftRef, setDraftRef] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const busy = save.isPending;
  const refInput = useRef<HTMLInputElement | null>(null);
  const refocusAdd = useRef(false);

  /** Reports whether a write was launched: only then do the inputs disable and focus need
   *  reclaiming. Every ref and note is trimmed here, so nothing stored carries stray space. */
  const commit = (next: Source[]): boolean => {
    const trimmed = next
      .map((s) => ({ ...s, ref: s.ref.trim(), note: s.note.trim() }))
      .filter((s) => s.ref !== '');
    if (sameSources(trimmed, sources)) return false;
    save.mutate({ sources: trimmed });
    return true;
  };

  const startEdit = (index: number, field: 'ref' | 'note') => {
    if (busy) return;
    setEditing({ index, field });
    setEditValue((field === 'ref' ? sources[index]?.ref : sources[index]?.note) ?? '');
  };
  const commitEdit = (index: number, field: 'ref' | 'note') => {
    setEditing(null);
    commit(sources.map((s, i) => {
      if (i !== index) return s;
      // Editing a ref re-infers the kind: a url edited into a path stops being web.
      return field === 'ref'
        ? { ...s, ref: editValue, kind: inferKind(editValue.trim()) }
        : { ...s, note: editValue };
    }));
  };
  const remove = (index: number) => commit(sources.filter((_, i) => i !== index));

  const commitDraft = (): boolean => {
    const ref = draftRef;
    const note = draftNote;
    setDraftRef('');
    setDraftNote('');
    if (ref.trim() === '') return false;
    return commit([...sources, { kind: inferKind(ref.trim()), ref, note }]);
  };
  // Enter disables the add inputs for the length of the write, and the browser blurs what it
  // disables. Hand focus back so a run of sources can be typed without reaching for the mouse.
  const onDraftKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      refocusAdd.current = commitDraft();
      if (!refocusAdd.current) refInput.current?.focus();
    }
    // Clearing first makes the blur that follows a no-op, so Escape never adds.
    if (e.key === 'Escape') { e.preventDefault(); setDraftRef(''); setDraftNote(''); }
  };

  // A launched write disabled the inputs and the browser blurred them; reclaim focus once it
  // lands, so a run of sources can be typed without reaching for the mouse.
  useEffect(() => {
    if (busy || !refocusAdd.current) return;
    refocusAdd.current = false;
    refInput.current?.focus();
  }, [busy]);

  const editBox = (index: number, field: 'ref' | 'note', width: string) => (
    <input
      autoFocus
      className={`${chipInputCls} ${width}`}
      value={editValue}
      disabled={busy}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={() => setEditing(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(index, field); }
        if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
      }}
    />
  );

  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">sources</div>
      <div className="flex flex-col gap-1.5">
        {sources.map((source, index) => (
          <Pill key={`${source.ref}-${index}`} className={readOnly ? '' : 'pr-1.5'}>
            <span className="lowercase text-soft">{source.kind}</span>
            <span className="mx-1.5 text-line">·</span>
            {editing?.index === index && editing.field === 'ref' ? editBox(index, 'ref', 'w-64') : (
              readOnly
                ? <span className="font-mono text-[11px] break-all">{source.ref}</span>
                : (
                  <button type="button" aria-label={`edit source ${source.ref}`} title="click to edit"
                    className="font-mono text-[11px] break-all disabled:cursor-not-allowed"
                    disabled={busy} onClick={() => startEdit(index, 'ref')}>
                    {source.ref}
                  </button>
                )
            )}
            <span className="mx-1.5 text-line">·</span>
            {editing?.index === index && editing.field === 'note' ? editBox(index, 'note', 'w-48') : (
              readOnly
                ? <LintedText text={source.note} />
                : (
                  <button type="button" aria-label={`edit note for ${source.ref}`} title="click to edit"
                    className="disabled:cursor-not-allowed" disabled={busy}
                    onClick={() => startEdit(index, 'note')}>
                    <LintedText text={source.note} />
                  </button>
                )
            )}
            {!readOnly && (
              <button type="button" aria-label={`remove ${source.ref}`} disabled={busy}
                className="rounded-full px-1 text-soft transition-colors hover:text-ink disabled:cursor-not-allowed"
                onClick={() => remove(index)}>
                ×
              </button>
            )}
          </Pill>
        ))}
        {/* Rendered even when the list is empty, so the add row is always reachable. The blur
            handler sits on the row, not the inputs: moving from ref to note is not a commit,
            and committing there would store the source before its note was typed. */}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-1.5"
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commitDraft(); }}>
            <input
              ref={refInput}
              className={`${chipInputCls} w-64 font-mono normal-case`}
              value={draftRef}
              disabled={busy}
              placeholder="ref"
              onChange={(e) => setDraftRef(e.target.value)}
              onKeyDown={onDraftKey}
            />
            <input
              className={`${chipInputCls} w-48 normal-case`}
              value={draftNote}
              disabled={busy}
              placeholder="note"
              onChange={(e) => setDraftNote(e.target.value)}
              onKeyDown={onDraftKey}
            />
          </div>
        )}
      </div>
      {save.isError && (
        <div className="mt-2"><ErrorNote label="sources failed to save">{save.error.message}</ErrorNote></div>
      )}
    </div>
  );
}
