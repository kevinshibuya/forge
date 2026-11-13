import { useEffect, useId, useState } from 'react';
import type { QueueItemDto } from '../../api/client';
import { fmtDateOnly, fmtWeekdayShort, todayIso } from '../../lib/format';
import { Button, ErrorNote, TierBadge, inputCls } from '../primitives';

/**
 * Two ways in, one popover:
 *  - `day`  — opened from a stream slot row: the DAY is fixed, the post is picked from the queue
 *             (set the optional time first, then click a post — picking one commits, per spec §3).
 *  - `post` — opened from a queue card or a scheduled row's time pill: the POST is fixed and the
 *             day is a field, so the same panel reschedules and schedules-from-queue.
 *
 * a11y shape is load-bearing and unchanged: `role="dialog"`, Escape from anywhere, click-away
 * sheet. The route smoke keys on `[role="dialog"]`.
 */
export type ScheduleTarget =
  | { kind: 'day'; date: string; presetPostId?: number }
  | { kind: 'post'; postId: number; label: string; date: string | null; time: string | null };

export interface ScheduleSubmit { postId: number; date: string; time: string | null }

export function SchedulePopover({ target, queue, pending, error, align = 'left', onSubmit, onUnschedule, onCancel }: {
  target: ScheduleTarget;
  queue: QueueItemDto[];
  pending: boolean;
  error: string | null;
  /** Which edge the panel hangs off — the right rail has no room to open leftwards. */
  align?: 'left' | 'right';
  onSubmit: (input: ScheduleSubmit) => void;
  onUnschedule: (postId: number) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(() => (target.kind === 'day' ? target.date : target.date ?? todayIso()));
  const [time, setTime] = useState(() => (target.kind === 'post' ? target.time ?? '' : ''));

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const submit = (postId: number) => { if (validDate && !pending) onSubmit({ postId, date, time: time || null }); };

  const titleId = useId();
  const labelId = useId();

  // Escape closes from anywhere, not just while focus is still inside the panel — the panel does not
  // trap focus, so a panel-scoped handler dies the moment focus leaves it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      {/* click-away: a transparent sheet under the panel, above everything else. Deliberately not a
          button — it covers the viewport, so as a control it would sit in the tab order announcing
          "close, button". Dismissal is pointer-only here; Escape is the keyboard route. */}
      <div aria-hidden="true" className="fixed inset-0 z-30 cursor-default" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={target.kind === 'post' ? `${titleId} ${labelId}` : titleId}
        className={`absolute top-full z-40 mt-1 w-[264px] rounded-card border border-hairline bg-paper p-3 ${
          align === 'right' ? 'right-0' : 'left-0'}`}
      >
        <div id={titleId} className="mb-2 border-b border-hairline-soft pb-2 text-[12px] lowercase text-ink">
          {target.kind === 'day'
            ? `schedule · ${fmtWeekdayShort(target.date)} ${fmtDateOnly(target.date)}`
            : target.date === null ? 'schedule this post' : 'reschedule'}
        </div>

        {target.kind === 'post' && (
          <>
            <p id={labelId} className="mb-2 line-clamp-2 text-[12px] leading-snug text-soft">{target.label}</p>
            <label className="mb-2 block">
              <div className="mb-1 text-[11px] lowercase text-soft">day</div>
              <input type="date" className={`${inputCls} py-1.5 text-[12px]`} value={date} autoFocus
                onChange={(e) => setDate(e.target.value)} />
            </label>
          </>
        )}

        <label className="block">
          <div className="mb-1 text-[11px] lowercase text-soft">time · optional</div>
          <input type="time" className={`${inputCls} py-1.5 text-[12px]`} value={time}
            {...(target.kind === 'day' ? { autoFocus: true } : {})}
            onChange={(e) => setTime(e.target.value)} />
        </label>

        {/* The day variant's picker: the queue itself, as a list. Clicking a post books it —
            the day is already fixed and the time is optional, so a save button would only add
            a step between the decision and the write. */}
        {target.kind === 'day' && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] lowercase text-soft">pick a post</div>
            {queue.length === 0 ? (
              <p className="text-[12px] lowercase text-soft">the queue is empty — promote an idea first</p>
            ) : (
              <ul className="-mx-1 max-h-[184px] overflow-y-auto">
                {queue.map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={pending} onClick={() => submit(p.id)}
                      className={`flex w-full items-start gap-2 rounded-card px-1 py-1.5 text-left transition-colors hover:bg-bone disabled:opacity-40 ${
                        p.id === target.presetPostId ? 'bg-bone' : ''}`}>
                      <TierBadge tier={p.tier} />
                      <span className="min-w-0 flex-1 line-clamp-2 text-[12px] leading-snug text-ink">{p.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <div className="mt-2"><ErrorNote label="error">{error}</ErrorNote></div>}

        <div className="mt-3 flex items-center gap-2">
          {target.kind === 'post' && (
            <Button className="!px-3 !py-1 !text-[12px]" disabled={!validDate || pending}
              onClick={() => submit(target.postId)}>
              {pending ? 'saving…' : 'save'}
            </Button>
          )}
          <Button variant="subtle" className="!px-3 !py-1 !text-[12px]" disabled={pending} onClick={onCancel}>
            cancel
          </Button>
          {target.kind === 'post' && target.date !== null && (
            <button type="button" disabled={pending} onClick={() => onUnschedule(target.postId)}
              className="ml-auto text-[11px] lowercase text-soft underline underline-offset-2 hover:text-ink disabled:opacity-40">
              unschedule
            </button>
          )}
        </div>
      </div>
    </>
  );
}
