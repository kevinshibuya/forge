import { useRef, useState, type DragEvent } from 'react';
import { INPUT_CAPS, REFUSAL, fmtBytes, inferInputKind, type InputPreview } from '@forge/shared';
import { ApiError } from '../api/client';
import { useAttachInput, usePostInputs, usePreviewInput, useRemoveInput, type InputSubmission } from '../api/hooks';
import { Button, ErrorNote, Panel, Pill, Spinner, chipInputCls } from './primitives';

/**
 * What the zone is doing, and therefore what it renders. `preview` and `refused` both come back
 * from a 200: the server answers the union whatever it decided, and only an attach turns a
 * refusal into a 422.
 */
export type DropState = 'idle' | 'dragover' | 'previewing' | 'preview' | 'refused' | 'attaching' | 'error';

/** What the operator is being asked to wait for, named after the work the server is doing. */
const waitingFor = (s: InputSubmission): string => {
  if ('file' in s) return 'reading';
  // A path is refused by the server at once; nothing walks it any more.
  return inferInputKind(s.text) === 'url' ? 'fetching' : 'reading';
};

/** What the operator actually sent, in bytes. A 413 never reaches a producer, so the sentence has
 *  to be built from this rather than from a manifest. */
const measured = (s: InputSubmission): number =>
  ('file' in s ? s.file.size : new TextEncoder().encode(s.text).length);

const overCap = (s: InputSubmission): string => REFUSAL.overBytes(measured(s));

export function InputsPanel({ postId, readOnly }: { postId: number; readOnly: boolean }) {
  const inputs = usePostInputs(postId);
  const preview = usePreviewInput(postId);
  const attach = useAttachInput(postId);
  const remove = useRemoveInput(postId);

  const [state, setState] = useState<DropState>('idle');
  const [refused, setRefused] = useState('');
  const [failure, setFailure] = useState('');
  const [card, setCard] = useState<Extract<InputPreview, { ok: true }> | null>(null);
  const [pending, setPending] = useState<InputSubmission | null>(null);
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const rows = inputs.data ?? [];
  const total = rows.reduce((n, r) => n + r.bytes, 0);

  const reset = () => {
    setState('idle');
    setCard(null);
    setPending(null);
    setRefused('');
    setFailure('');
  };

  /**
   * A 422 carries the producer's own sentence, so it renders as a refusal rather than a failure.
   * A 413 never reached a producer, so the sentence is built here from what was sent. Anything
   * else is a fault and says so.
   */
  const fromError = (err: Error, s: InputSubmission) => {
    const status = err instanceof ApiError ? err.status : 0;
    // Only call it over the cap when it actually is. A 413 on a submission that measures UNDER the
    // cap means the transport refused it, and telling the operator "4,000,000 bytes, the cap is
    // 5 MB" would be a refusal that contradicts its own numbers.
    if (status === 413 && measured(s) > INPUT_CAPS.bytes) { setRefused(overCap(s)); setState('refused'); return; }
    if (status === 422 || status === 409) { setRefused(err.message); setState('refused'); return; }
    setFailure(err.message);
    setState('error');
  };

  const start = (s: InputSubmission) => {
    setPending(s);
    setRefused('');
    setFailure('');
    setState('previewing');
    preview.mutate(s, {
      onSuccess: (result) => {
        if (result.ok) { setCard(result); setState('preview'); return; }
        setRefused(result.refused);
        setState('refused');
      },
      onError: (err: Error) => fromError(err, s),
    });
  };

  const confirm = () => {
    if (!pending) return;
    setState('attaching');
    attach.mutate(pending, {
      onSuccess: reset,
      // The producer runs again at attach, so a page that changed in between can refuse here.
      onError: (err: Error) => fromError(err, pending),
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // The add button is disabled while a preview is in flight; the zone has to refuse a drop for
    // the same reason, or two previews race and the later one wins whatever the operator saw.
    if (state === 'previewing' || state === 'attaching') return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 1) { setRefused(REFUSAL.oneAtATime); setState('refused'); return; }
    const file = files[0];
    if (file) start({ file });
  };

  return (
    <Panel className="mb-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">inputs</div>
        {rows.length > 0 && (
          <div className="text-[11px] text-soft">
            {rows.length} {rows.length === 1 ? 'input' : 'inputs'} · {fmtBytes(total)}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline gap-2">
              <Pill>{row.kind}</Pill>
              <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{row.ref}</span>
              <span className="shrink-0 text-[11px] text-soft">{fmtBytes(row.bytes)}</span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`remove ${row.ref}`}
                  disabled={remove.isPending}
                  className="shrink-0 rounded-full px-1 text-soft transition-colors hover:text-ink disabled:cursor-not-allowed"
                  onClick={() => remove.mutate(row.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : state === 'preview' || state === 'attaching' ? (
        <div className="mt-3 rounded border border-hairline p-3">
          <div className="flex items-baseline gap-2">
            <Pill>{card?.kind}</Pill>
            <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{card?.ref}</span>
          </div>
          <div className="mt-1.5 text-[12px] text-soft">
            {card?.manifest.files.length} {card?.manifest.files.length === 1 ? 'file' : 'files'}
            {' · '}{fmtBytes(card?.manifest.bytes ?? 0)}
            {card && card.manifest.skipped > 0 && ` · skipped ${card.manifest.skipped}`}
          </div>
          {card && card.manifest.refused.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {card.manifest.refused.map((entry) => (
                <li key={entry} className="break-all font-mono text-[11px] text-salmon">{entry}</li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex gap-2">
            <Button onClick={confirm} disabled={state === 'attaching'}>attach</Button>
            <Button variant="ghost" onClick={reset} disabled={state === 'attaching'}>cancel</Button>
          </div>
        </div>
      ) : state === 'refused' ? (
        <div className="mt-3 rounded border border-hairline p-3">
          <div className="text-[12px] text-salmon">{refused}</div>
          <div className="mt-2.5"><Button variant="ghost" onClick={reset}>dismiss</Button></div>
        </div>
      ) : (
        <>
          <div
            data-testid="inputs-drop-zone"
            className={`mt-3 rounded border border-dashed p-4 text-center text-[12px] transition-colors ${
              state === 'dragover' ? 'border-ink text-ink' : 'border-hairline text-soft'
            }`}
            onDragOver={(e) => { e.preventDefault(); setState('dragover'); }}
            // A dragleave fires when the pointer crosses a CHILD, so the guard is what keeps the
            // highlight from flickering on the way in.
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setState('idle'); }}
            onDrop={onDrop}
          >
            {state === 'previewing' ? (
              <span className="inline-flex items-center gap-2"><Spinner /> {pending && waitingFor(pending)}</span>
            ) : (
              <>
                drop a file here, or{' '}
                <button type="button" className="underline underline-offset-2 hover:text-ink"
                  onClick={() => fileRef.current?.click()}>
                  pick a file
                </button>
                <input ref={fileRef} type="file" className="hidden" aria-label="pick a file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) start({ file });
                  }}
                />
              </>
            )}
          </div>

          <div className="mt-2 flex gap-2">
            <textarea
              aria-label="a link, or paste some text"
              className={`${chipInputCls} min-h-9 flex-1 resize-y font-sans`}
              placeholder="a link, or paste some text"
              value={draft}
              disabled={state === 'previewing'}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              disabled={draft.trim() === '' || state === 'previewing'}
              onClick={() => { start({ text: draft }); setDraft(''); }}
            >
              add
            </Button>
          </div>
        </>
      )}

      {state === 'error' && (
        <div className="mt-2"><ErrorNote label="the input could not be read">{failure}</ErrorNote></div>
      )}
      {remove.isError && (
        <div className="mt-2"><ErrorNote label="the input could not be removed">{remove.error.message}</ErrorNote></div>
      )}
    </Panel>
  );
}
