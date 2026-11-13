import { useEffect, useMemo, useState } from 'react';
import { usePatchRegistryRow, usePatchSettings, useRegistry, useSettings } from '../api/hooks';
import type { ModelRowDto, SettingsDto } from '../api/client';
import { ENGINES_BY_BACKEND, TEXT_RUN_KINDS, type ModelRowPatch, type StyleDoc, type TextRunKind } from '@forge/shared';
import { Button, EmptyState, ErrorNote, Field, PageHeader, Panel, inputCls } from '../ui/primitives';
import { Reveal, Skeleton } from '../ui/skeleton';

/** A price or a token count is valid only as a finite, non-negative number, the bound the api's
 *  zod schema enforces. Held as strings while typed: parsing on every keystroke would fight the
 *  user mid-type ("0.", a cleared field). */
function parseRate(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const PRICE_FIELDS = [
  ['inputPerMtok', 'input'],
  ['cacheWritePerMtok', 'cache write'],
  ['cacheReadPerMtok', 'cache read'],
  ['outputPerMtok', 'output'],
  ['imagePerUnit', 'image'],
] as const;
type PriceKey = typeof PRICE_FIELDS[number][0];

interface RowDraft {
  engine: string; model: string; effort: string; maxOutputTokens: string;
  prices: Record<PriceKey, string>;
}

function toRowDraft(row: ModelRowDto): RowDraft {
  return {
    engine: row.engine, model: row.model, effort: row.effort ?? '', maxOutputTokens: String(row.maxOutputTokens),
    prices: {
      inputPerMtok: String(row.prices.inputPerMtok), cacheWritePerMtok: String(row.prices.cacheWritePerMtok),
      cacheReadPerMtok: String(row.prices.cacheReadPerMtok), outputPerMtok: String(row.prices.outputPerMtok),
      imagePerUnit: String(row.prices.imagePerUnit),
    },
  };
}

/** The whole editable row as the PATCH body, or the first reason it cannot be one. */
function toPatch(d: RowDraft): { patch: ModelRowPatch } | { error: string } {
  const model = d.model.trim();
  if (model === '') return { error: 'the model id is required' };
  const max = Number(d.maxOutputTokens.trim());
  if (!/^\d+$/.test(d.maxOutputTokens.trim()) || max < 256 || max > 128_000) {
    return { error: 'max output must be a whole number from 256 to 128000' };
  }
  const prices = {} as Record<PriceKey, number>;
  for (const [key] of PRICE_FIELDS) {
    const n = parseRate(d.prices[key]);
    if (n === null) return { error: 'prices must be numbers ≥ 0' };
    prices[key] = n;
  }
  const effort = d.effort.trim();
  return {
    patch: {
      engine: d.engine as NonNullable<ModelRowPatch['engine']>, model, effort: effort === '' ? null : effort,
      maxOutputTokens: max, ...prices,
    },
  };
}

/** Column widths shared by the header and every row, so the labels sit over their inputs. */
const COL = { task: 'w-28 shrink-0', engine: 'w-32 shrink-0', effort: 'w-24 shrink-0', max: 'w-24 shrink-0', price: 'w-20 shrink-0' };

function RegistryRow({ row }: { row: ModelRowDto }) {
  const patch = usePatchRegistryRow();
  const [draft, setDraft] = useState(() => toRowDraft(row));
  const [saved, setSaved] = useState(false);
  // Re-seed only when the SERVER row moves (a save here, or another tab's): re-seeding on every
  // refetch would wipe an edit in progress.
  const [seen, setSeen] = useState(row.updatedAt);
  if (seen !== row.updatedAt) { setSeen(row.updatedAt); setDraft(toRowDraft(row)); }

  const result = toPatch(draft);
  const edited = JSON.stringify(draft) !== JSON.stringify(toRowDraft(row));
  const name = `${row.task} on ${row.backend}`;
  const update = (next: Partial<RowDraft>) => { setSaved(false); setDraft({ ...draft, ...next }); };

  return (
    <div className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className={`${COL.task} font-mono text-[13px] text-ink`}>{row.task}</div>
        <div className={COL.engine}>
          <select
            className={inputCls} value={draft.engine} aria-label={`engine for ${name}`}
            onChange={(e) => update({ engine: e.target.value })}
          >
            {ENGINES_BY_BACKEND[row.backend].map((engine) => <option key={engine} value={engine}>{engine}</option>)}
          </select>
        </div>
        <div className="min-w-0 flex-1">
          <input
            className={`${inputCls} font-mono text-[13px]`} value={draft.model} aria-label={`model for ${name}`}
            onChange={(e) => update({ model: e.target.value })}
          />
        </div>
        <div className={COL.effort}>
          <input
            className={inputCls} value={draft.effort} placeholder="none" aria-label={`effort for ${name}`}
            onChange={(e) => update({ effort: e.target.value })}
          />
        </div>
        <div className={COL.max}>
          <input
            className={`${inputCls} text-right tabular-nums`} inputMode="numeric" value={draft.maxOutputTokens}
            aria-label={`max output for ${name}`}
            onChange={(e) => update({ maxOutputTokens: e.target.value })}
          />
        </div>
      </div>

      {/* Each price carries its own caption: a second header line above the first row would
          interleave with the first line's labels and read as one jumbled row. */}
      <div className="mt-2 flex items-end gap-3">
        <div className={COL.task} />
        {PRICE_FIELDS.map(([key, label]) => (
          <div key={key} className={COL.price}>
            <div className="mb-0.5 text-right text-[10px] tracking-[0.1em] lowercase text-soft">{label}</div>
            <input
              className={`${inputCls} text-right tabular-nums`} inputMode="decimal" value={draft.prices[key]}
              aria-label={`${label} price for ${name}`}
              onChange={(e) => update({ prices: { ...draft.prices, [key]: e.target.value } })}
            />
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-[13px] lowercase text-mint">saved ✓</span>}
          <Button
            variant="subtle" disabled={!edited || patch.isPending}
            onClick={() => { setSaved(false); setDraft(toRowDraft(row)); }}
          >
            reset
          </Button>
          <Button
            aria-label={`save ${name}`} disabled={!edited || 'error' in result || patch.isPending}
            onClick={() => {
              if ('patch' in result) patch.mutate({ id: row.id, patch: result.patch }, { onSuccess: () => setSaved(true) });
            }}
          >
            {patch.isPending ? 'saving…' : 'save'}
          </Button>
        </div>
      </div>

      {/* The row names the failure: in a list of thirteen, "prices must be numbers" alone does
          not say which row. */}
      {'error' in result && <ErrorNote label={`${row.task} · ${row.backend}`} inline>{result.error}</ErrorNote>}
      {patch.isError && <ErrorNote label={`${row.task} · ${row.backend}`} inline>{patch.error.message}</ErrorNote>}
    </div>
  );
}

/** What each backend is, in the operator's terms. */
const BACKEND_NOTE: Record<ModelRowDto['backend'], string> = {
  cli: 'the claude and codex clis, on your subscriptions. npm run start:dev.',
  api: 'the provider sdks, billed per token.',
};

function ModelsPanel({ rows }: { rows: ModelRowDto[] }) {
  // cli first: it is the backend Kevin runs day to day.
  const groups = (['cli', 'api'] as const).map((backend) => ({ backend, rows: rows.filter((r) => r.backend === backend) }));
  return (
    <Panel>
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">models</div>
        <div className="text-[12px] lowercase text-soft">
          one row per task and backend; prices are usd per million tokens, images per image; the cost on
          a run is priced from the row at call time
        </div>
      </div>

      {groups.map(({ backend, rows: group }) => (
        <section key={backend} className="mt-4 first-of-type:mt-0">
          <div className="flex items-baseline gap-3 border-b border-hairline pb-2">
            <div className="font-mono text-[13px] text-ink">{backend}</div>
            <div className="text-[12px] lowercase text-soft">{BACKEND_NOTE[backend]}</div>
          </div>
          <div className="flex items-center gap-3 pb-1 pt-2 text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">
            <div className={COL.task}>task</div>
            <div className={COL.engine}>engine</div>
            <div className="min-w-0 flex-1">model</div>
            <div className={COL.effort}>effort</div>
            <div className={`${COL.max} text-right`}>max output</div>
          </div>
          {group.length === 0
            ? <EmptyState>no rows for this backend.</EmptyState>
            : group.map((row) => <RegistryRow key={row.id} row={row} />)}
        </section>
      ))}
    </Panel>
  );
}

/**
 * The weekly goal, held as a string for the same reason the rates are: an empty field is a
 * legitimate in-progress state, and "" is also the value that MEANS null once saved.
 * Valid = empty (null) or an integer 1–7 — exactly the api's `z.number().int().min(1).max(7).nullable()`.
 */
function parseGoal(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const n = Number(trimmed);
  return n >= 1 && n <= 7 ? { ok: true, value: n } : { ok: false };
}

/**
 * Weekly goal only. Timezone is deliberately NOT editable in phase 1 — the web formatters are
 * hardcoded to São Paulo, so a control that took a timezone and changed nothing would lie. The
 * PATCH still carries the stored timezone verbatim: `PATCH /settings` merges at the TOP level, so
 * sending a partial `scheduling` object would drop the field.
 */
function SchedulingPanel({ scheduling }: { scheduling: SettingsDto['scheduling'] }) {
  const patch = usePatchSettings();
  const initial = scheduling.weeklyGoal === null ? '' : String(scheduling.weeklyGoal);
  const [goal, setGoal] = useState(initial);
  const [saved, setSaved] = useState(false);

  // Re-seed only when the SERVER value actually moves (a save, or another tab's write). Seeding on
  // every `scheduling` identity would wipe an in-progress edit each time the query refetched, and
  // an effect can't be used the way the style docs panel's is: "" is both a valid draft and a valid
  // saved value, so there is no empty state to key the seeding off.
  const [seen, setSeen] = useState(scheduling.weeklyGoal);
  if (seen !== scheduling.weeklyGoal) { setSeen(scheduling.weeklyGoal); setGoal(initial); }

  const parsed = parseGoal(goal);
  const dirty = parsed.ok && parsed.value !== scheduling.weeklyGoal;

  return (
    <Panel className="mt-4">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">scheduling</div>
        <div className="text-[12px] lowercase text-soft">what a good week looks like</div>
      </div>

      <div className="max-w-[240px]">
        <Field label="weekly goal · posts published">
          <input
            className={`${inputCls} tabular-nums`} inputMode="numeric" value={goal}
            aria-label="weekly goal" aria-invalid={!parsed.ok} placeholder="none"
            onChange={(e) => { setSaved(false); setGoal(e.target.value); }}
          />
        </Field>
        {!parsed.ok && (
          <ErrorNote label="weekly goal" inline>must be a whole number 1–7, or empty for no goal</ErrorNote>
        )}
      </div>

      <p className="mt-3 max-w-[560px] text-[12px] leading-relaxed lowercase text-soft">
        drives the goal and streak tiles on the dashboard and planner. leave it empty and neither
        appears — a target you never set shouldn't read as a target you missed.
        {' '}times are shown in <span className="font-mono">{scheduling.timezone}</span>.
      </p>

      <div className="mt-5 flex items-center gap-3 border-t border-hairline pt-4">
        <Button
          disabled={!dirty || patch.isPending}
          onClick={() => {
            if (!parsed.ok) return;
            patch.mutate(
              { scheduling: { timezone: scheduling.timezone, weeklyGoal: parsed.value } },
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          {patch.isPending ? 'saving…' : 'save scheduling'}
        </Button>
        <Button variant="subtle" disabled={goal === initial || patch.isPending}
          onClick={() => { setSaved(false); setGoal(initial); }}>
          reset
        </Button>
        {saved && <span className="text-[13px] lowercase text-mint">saved ✓</span>}
      </div>

      {patch.isError && <div className="mt-3"><ErrorNote label="error">{patch.error.message}</ErrorNote></div>}
    </Panel>
  );
}

/** A doc id is a slug: lowercase, digits and hyphens, so it can key a settings row and a
 *  `## style: <name>` section without quoting. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function StyleDocsSection({ styleDocs }: { styleDocs: StyleDoc[] }) {
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<StyleDoc[] | null>(null);
  const [saved, setSaved] = useState(false);

  // Seeded once: re-seeding on every `styleDocs` identity would wipe an
  // in-progress edit each time the query refetched.
  useEffect(() => {
    if (draft === null) setDraft(styleDocs);
  }, [draft, styleDocs]);

  /** StyleDocSchema requires a name of at least one character, so an empty one would come back
   *  as a raw zod 400. Blocked here with the same treatment the duplicate id gets. */
  const blankName = useMemo(() => draft?.some((doc) => doc.name.trim() === '') ?? false, [draft]);

  const duplicateId = useMemo(() => {
    if (!draft) return null;
    const seen = new Set<string>();
    for (const doc of draft) {
      if (seen.has(doc.id)) return doc.id;
      seen.add(doc.id);
    }
    return null;
  }, [draft]);

  const edited = useMemo(
    () => (draft ? JSON.stringify(draft) !== JSON.stringify(styleDocs) : false),
    [draft, styleDocs],
  );

  if (!draft) return null;

  const update = (index: number, patchDoc: Partial<StyleDoc>) => {
    setSaved(false);
    setDraft(draft.map((doc, i) => (i === index ? { ...doc, ...patchDoc } : doc)));
  };

  /** A ticked box means the kind is NOT excluded, so unticking is what writes to excludedKinds. */
  const toggleKind = (index: number, kind: TextRunKind, applies: boolean) => {
    const doc = draft[index]!;
    update(index, {
      excludedKinds: applies
        ? doc.excludedKinds.filter((k) => k !== kind)
        : [...doc.excludedKinds, kind],
    });
  };

  return (
    <Panel className="mt-4">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[11px] font-semibold tracking-[0.15em] lowercase text-soft">style docs</div>
        <div className="text-[12px] lowercase text-soft">prose every text prompt carries</div>
      </div>

      {draft.length === 0 && (
        <p className="text-[12px] lowercase text-soft">no style docs. every prompt carries the persona only.</p>
      )}

      <div className="flex flex-col gap-4">
        {/* Keyed by position, not id: renaming re-slugifies the id, and keying on it would
            remount the row on every keystroke and drop focus mid-word. */}
        {draft.map((doc, index) => (
          <div key={index} className="rounded-card border border-hairline p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Field label="name">
                <input
                  className={inputCls} value={doc.name} aria-label={`name of ${doc.id}`}
                  onChange={(e) => update(index, { name: e.target.value, id: slugify(e.target.value) || doc.id })}
                />
              </Field>
              <label className="flex items-center gap-1.5 text-[12px] lowercase text-soft">
                <input
                  type="checkbox" checked={doc.enabled} aria-label={`${doc.id} enabled`}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                />
                enabled
              </label>
              <Button
                variant="subtle" className="ml-auto"
                onClick={() => { setSaved(false); setDraft(draft.filter((_, i) => i !== index)); }}
              >
                remove
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {TEXT_RUN_KINDS.map((kind) => {
                const applies = !doc.excludedKinds.includes(kind);
                return (
                  <label key={kind} className="flex items-center gap-1.5 text-[12px] lowercase text-soft">
                    <input
                      type="checkbox" checked={applies}
                      aria-label={`${doc.id} applies to ${kind}`}
                      onChange={(e) => toggleKind(index, kind, e.target.checked)}
                    />
                    {kind.replace('_', ' ')}
                  </label>
                );
              })}
            </div>

            {/* No TellOverlay here on purpose: a style doc names its own tells by construction,
                so the body would always be solid red. */}
            <div className="mt-3">
              <Field label="body">
                <textarea
                  className={`${inputCls} min-h-[200px] font-mono text-[12px] leading-relaxed`}
                  value={doc.body} aria-label={`body of ${doc.id}`}
                  onChange={(e) => update(index, { body: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Button
          variant="subtle"
          onClick={() => {
            setSaved(false);
            setDraft([...draft, {
              id: `doc-${draft.length + 1}`, name: 'new doc', body: '', enabled: true, excludedKinds: [],
            }]);
          }}
        >
          + add doc
        </Button>
      </div>

      {blankName && (
        <div className="mt-3">
          <ErrorNote label="name" inline>every doc needs a name. the constitution renders it as the section heading.</ErrorNote>
        </div>
      )}

      {duplicateId && (
        <div className="mt-3">
          <ErrorNote label="duplicate id" inline>{`two docs share the id "${duplicateId}". rename one before saving.`}</ErrorNote>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 border-t border-hairline pt-4">
        <Button
          disabled={!edited || blankName || duplicateId !== null || patch.isPending}
          onClick={() => patch.mutate({ styleDocs: draft }, { onSuccess: () => setSaved(true) })}
        >
          {patch.isPending ? 'saving…' : 'save style docs'}
        </Button>
        <Button variant="subtle" disabled={!edited || patch.isPending}
          onClick={() => { setSaved(false); setDraft(styleDocs); }}>
          reset
        </Button>
        {saved && <span className="text-[13px] lowercase text-mint">saved ✓</span>}
      </div>

      {patch.isError && <div className="mt-3"><ErrorNote label="error">{patch.error.message}</ErrorNote></div>}
    </Panel>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const registry = useRegistry();

  return (
    <div className="max-w-[760px]">
      <PageHeader label="the settings" sub="the knobs the engine reads: which model runs each task, what it costs, and what a good week looks like." />

      {settings.isError && <ErrorNote label="could not load settings">{settings.error.message}</ErrorNote>}
      {registry.isError && <ErrorNote label="could not load the model registry">{registry.error.message}</ErrorNote>}

      <Reveal
        pending={!settings.isError && !registry.isError && (settings.isPending || registry.isPending)}
        skeleton={<SettingsSkeleton />}
      >
        {registry.data && <ModelsPanel rows={registry.data} />}
        {settings.data && <SchedulingPanel scheduling={settings.data.scheduling} />}
        {settings.data && <StyleDocsSection styleDocs={settings.data.styleDocs} />}
      </Reveal>
    </div>
  );
}

/** Form-shaped: the models panel's rows, then the scheduling panel's two fields. */
function SettingsSkeleton() {
  return (
    <div data-probe="skeleton-settings">
      <Panel>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-24 shrink-0" />
            <Skeleton className="h-9 w-24 shrink-0" />
            <Skeleton className="size-7 shrink-0 rounded-full" />
          </div>
        ))}
      </Panel>
      <Panel className="mt-4">
        {[0, 1].map((i) => (
          <div key={i} className="mb-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-8 w-24 rounded-pill" />
      </Panel>
    </div>
  );
}
