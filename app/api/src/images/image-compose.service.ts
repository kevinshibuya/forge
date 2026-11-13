import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { HybridPlanSchema, HybridDirectionsSchema, unwrapResult, type Settings } from '@forge/shared';
import type { SplitPrompt } from '../engines/engine.interface';
import { RunRefused, RunnerService } from '../runner/runner.service';
import { SettingsService } from '../settings/settings.service';
import { ImagesService } from './images.service';
import { RENDERER, type Renderer } from './render.service';
import { candidateDir, newGroupId, readPngSize, writePng } from './asset-store';
import { assembleConstitution } from '../retrieval/constitution';
import { collectTells } from '../runner/tell-fields';
import { assemblePlanPrompt, assembleBackgroundPrompt, hybridTextBrief, assembleVariatorPrompt } from './hybrid-prompts';

export interface ImageLaunch { runId: number; finished: Promise<void> }

const DIM = { width: 1200, height: 1200 };

/**
 * Robustly pull a complete HTML document out of an LLM response. A large AI-generated HTML doc
 * cannot be reliably escaped into a JSON string (raw newlines, quotes, CSS `{}`/`"` all break
 * JSON.parse), so the image_html contract returns the document inside a fenced code block instead.
 *
 * Strategy: prefer a fenced ```html (or bare ```) block; within that block (or the raw output if
 * there is no fence), slice from the first `<!doctype html`/`<html` to the last `</html>`
 * (inclusive). Tolerates surrounding prose, CSS braces/quotes, and newlines. Throws when no
 * document is present so a bad run fails rather than persisting garbage.
 */
function sliceDoc(s: string): string | null {
  const start = s.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return null;
  const lower = s.toLowerCase();
  const end = lower.lastIndexOf('</html>');
  return (end > start ? s.slice(start, end + '</html>'.length) : s.slice(start)).trim();
}

export function extractHtml(output: string): string {
  const fenced = /```(?:html)?\s*([\s\S]*?)```/i.exec(output);
  const html = (fenced?.[1] ? sliceDoc(fenced[1]) : null) ?? sliceDoc(output);
  // Include a tail of the raw output: the failing text is otherwise unrecoverable post-run
  // (runs.output is only persisted on success), which made 2026-07-21's failures blind.
  // Control chars (esp. NUL) are stripped: Postgres text rejects 0x00, and a poisoned error
  // message would make runs.fail() itself throw, stranding the run non-terminal.
  if (!html) {
    const tail = output.trim().slice(-200).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    throw new Error(`image_html output contained no HTML document; output tail: ${tail}`);
  }
  return html;
}

export function assembleImageHtmlPrompt(input: {
  designLanguageDoc: string; brief: string; width: number; height: number; backgroundToken?: string;
}): SplitPrompt {
  const bg = input.backgroundToken
    ? `\n## background layer\nSet a full-bleed CSS background-image using EXACTLY this literal token as the url — \`background-image:url('${input.backgroundToken}')\` — with \`background-size:cover;background-position:center\`. Do NOT invent or inline any URL or base64 payload; the real background image is substituted in after you generate.\n\nThe background already contains the COMPLETE illustration. Your layer is typography ONLY: headline, subtext, optional kicker text (a small chip behind the kicker is fine), and a legibility scrim. Do NOT draw any other shapes, diagrams, icons, arrows, panels, or decorative SVG/CSS artwork — no visual elements beyond text, kicker chip, and scrim.\n`
    : '';
  return { system: [], user: [
    '# role',
    'You are a brand designer. Produce ONE self-contained HTML document that renders a social image.',
    `## canvas\nExactly ${input.width}x${input.height} px. \`html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden}\`.`,
    '## design language\n' + input.designLanguageDoc,
    '## brief\n' + input.brief,
    bg,
    '## output\nReturn the COMPLETE self-contained HTML document inside a single ```html fenced code block — a complete document starting with `<!doctype html>`, fonts via <link>. Output NOTHING else: no JSON, no commentary before or after the fence.',
  ].join('\n\n') };
}

/**
 * Substitute the generated background into hybrid HTML at render time. The multi-MB base64 data
 * URI is inserted HERE — never in any LLM prompt/output — by replacing every `__HYBRID_BG__`
 * placeholder the text step emitted. Throws if the placeholder is absent so the run fails rather
 * than rendering a background-less image.
 */
export function substituteBackground(html: string, dataUri: string): string {
  if (!html.includes('__HYBRID_BG__')) throw new Error('hybrid HTML missing __HYBRID_BG__ placeholder');
  return html.split('__HYBRID_BG__').join(dataUri);
}

@Injectable()
export class ImageComposeService {
  private readonly log = new Logger(ImageComposeService.name);

  constructor(
    private readonly runner: RunnerService,
    private readonly settings: SettingsService,
    private readonly images: ImagesService,
    @Inject(RENDERER) private readonly renderer: Renderer,
  ) {}

  async launchHtml(postId: number, brief: string): Promise<ImageLaunch> {
    const settings = await this.settings.get();
    const prompt = assembleImageHtmlPrompt({ designLanguageDoc: settings.designLanguageDoc, brief, ...DIM });
    return this.launch(postId, 'html', prompt, brief);
  }

  /**
   * Plan-first orchestrated hybrid: one managed run drives plan (claude JSON) -> background
   * (codex writes bg.png) -> text (claude HTML referencing the `__HYBRID_BG__` placeholder) ->
   * composite (substitute the bg data URI at render time ONLY, never in a prompt) -> ingest one
   * `lane:hybrid` candidate. Any step failing fails the one run and lands no partial candidate.
   */
  async launchHybrid(postId: number, brief: string): Promise<ImageLaunch> {
    const settings = await this.settings.get();
    const groupId = newGroupId();
    const dir = candidateDir(postId, groupId);
    await mkdir(dir, { recursive: true });
    const bgPath = join(dir, 'bg.png');
    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((r) => { resolveRunId = r; });
    let refused: RunRefused | undefined;

    const finished = this.runner
      .executeManaged({
        kind: 'image_hybrid', prompt: brief, postId, onStart: resolveRunId,
        run: async ({ call, runId, addTells }) => {
          // 0. reference (fail-loud when set but broken)
          let refBg: string | null;
          try { refBg = await this.images.referenceBgFor(postId); }
          catch (err) { throw Object.assign(err as Error, { failureKind: 'invalid_output' as const }); }

          // 1. plan
          // A reference is read by path: `images` lets the plan step Read it (the prompt names it).
          const planRes = await call('image_plan', {
            ...assemblePlanPrompt(
              assembleConstitution({ kind: 'image_plan', settings, rules: [] }),
              brief, settings.designLanguageDoc, refBg ?? undefined,
            ),
            ...(refBg ? { images: [refBg] } : {}),
            schema: HybridPlanSchema,
          });
          if (planRes.failureKind) throw Object.assign(new Error(planRes.errorDetail ?? 'plan failed'), { failureKind: planRes.failureKind });
          // The plan step is under the output contract: the structured result is required, a
          // decline fails the whole run as declined, and the zod parse only catches what the JSON
          // Schema could not carry.
          if (planRes.structured === undefined) {
            throw Object.assign(new Error('invalid plan: engine returned no structured result'), { failureKind: 'invalid_output' as const });
          }
          const unwrapped = unwrapResult(planRes.structured);
          if (unwrapped.kind === 'malformed') {
            throw Object.assign(new Error(`invalid plan: ${unwrapped.reason}`), { failureKind: 'invalid_output' as const });
          }
          if (unwrapped.kind === 'declined') {
            throw Object.assign(new Error(unwrapped.decline.reason), { failureKind: 'declined' as const, declined: unwrapped.decline });
          }
          let plan;
          try { plan = HybridPlanSchema.parse(unwrapped.value); }
          catch (err) { throw Object.assign(new Error(`invalid plan: ${String(err)}`), { failureKind: 'invalid_output' as const }); }
          // The plan runs through `call`, not `execute`, so it lints here and rides on the parent run.
          addTells(collectTells(plan, ['headline', 'subtext']).map((t) => ({ ...t, field: `plan.${t.field}` })));

          // 2. background — codex writes bg.png into dir
          // Reference is extract-only: the plan step Reads it into refLearnings, but the image is
          // NEVER attached here — an attached reference anchors composition and kills batch
          // diversity (eye-tests 2026-07-19/22), no matter how the prompt frames it.
          // Now that the reference is extract-only, refLearnings is its ONLY channel: if the plan
          // step's Read failed or it just omitted the optional field, the reference had no effect
          // on this candidate at all and nothing else would ever say so.
          if (refBg !== null && !plan.refLearnings) {
            this.log.warn(`hybrid post ${postId}: reference set but the plan returned no refLearnings — this candidate is unreferenced`);
          }
          const bgRes = await call('image_gen', {
            ...assembleBackgroundPrompt(plan, refBg !== null),
            cwd: dir,
          });
          if (bgRes.failureKind) throw Object.assign(new Error(bgRes.errorDetail ?? 'background failed'), { failureKind: bgRes.failureKind });
          const bgSize = await readPngSize(bgPath);
          if (!bgSize) throw Object.assign(new Error('background produced no readable bg.png'), { failureKind: 'invalid_output' as const });

          // 3. text
          const textPrompt = assembleImageHtmlPrompt({ designLanguageDoc: settings.designLanguageDoc, brief: hybridTextBrief(plan), ...DIM, backgroundToken: '__HYBRID_BG__' });
          this.log.log(`hybrid post ${postId}: text step prompt length=${textPrompt.user.length}`); // observability for the no-base64 invariant
          const textRes = await call('image_html', textPrompt);
          if (textRes.failureKind) throw Object.assign(new Error(textRes.errorDetail ?? 'text failed'), { failureKind: textRes.failureKind });
          const htmlWithToken = extractHtml(textRes.output);

          // 4. composite — base64 only here, never in a prompt
          const dataUri = `data:image/png;base64,${(await readFile(bgPath)).toString('base64')}`;
          let html: string;
          try { html = substituteBackground(htmlWithToken, dataUri); }
          catch (err) { throw Object.assign(err as Error, { failureKind: 'invalid_output' as const }); }
          const buf = await this.renderer.render(html, DIM);
          const png = await writePng(dir, 0, buf);
          try {
            // runId is the archaeology-ending FK (spec §1b): it is what lets the breakdown panel
            // show the exact plan/gen/html steps that produced THIS candidate.
            await this.images.create({ postId, lane: 'hybrid', htmlSource: htmlWithToken, generationPrompt: brief, pngPath: png, width: DIM.width, height: DIM.height, candidateGroupId: groupId, runId, origin: 'generated' });
          } catch (err) { await unlink(png).catch(() => undefined); throw err; }
          return textRes.output;
        },
      })
      .then(async (r) => { if (!r.ok) await unlink(bgPath).catch(() => undefined); })
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`hybrid for post ${postId} crashed: ${String(err)}`);
      });

    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('image_hybrid failed before a run was created — see api logs');
    return { runId, finished };
  }

  /**
   * Fan out N independent hybrid pipelines in parallel — one click yields N varied candidates.
   * Diversity is deliberate: one variator run (n>=2) spreads the brief into N distinct visual
   * directions; pipeline i runs on brief+direction_i (launchHybrid itself UNCHANGED, so the
   * augmented brief lands in the run row and the candidate's generationPrompt). Partial success
   * is expected: a failed pipeline leaves the others' candidates intact. Returns the started
   * run ids; `finished` resolves once every started pipeline settles (used by tests).
   */
  async launchHybridBatch(
    postId: number, brief: string, batch?: number,
  ): Promise<{ runIds: number[]; finished: Promise<void> }> {
    const settings = await this.settings.get();
    const n = Math.min(Math.max(batch ?? settings.imageCandidateBatch, 1), 10);
    const briefs = await this.diversifiedBriefs(postId, brief, n, settings);
    const settled = await Promise.allSettled(briefs.map((b) => this.launchHybrid(postId, b)));
    const started = settled
      .filter((r): r is PromiseFulfilledResult<ImageLaunch> => r.status === 'fulfilled')
      .map((r) => r.value);
    if (started.length === 0) {
      throw new ConflictException('all hybrid pipelines failed to start — see api logs');
    }
    const finished = Promise.allSettled(started.map((l) => l.finished)).then(() => undefined);
    return { runIds: started.map((l) => l.runId), finished };
  }

  /**
   * N per-candidate briefs via one audited image_variate run. FAIL-OPEN by contract: a failed or
   * unparseable variator (its run row records the failure) degrades to the plain brief for every
   * missing slot — the batch always launches. n<2 skips the call entirely.
   */
  private async diversifiedBriefs(postId: number, brief: string, n: number, settings: Settings): Promise<string[]> {
    if (n < 2) return [brief];
    // runner.execute does real work BEFORE its own try block (settings.get, runs.start, events.open),
    // so it CAN reject — e.g. runs.start hitting a DB whose run_kind enum predates migration 0005.
    // Without this catch that rejection propagates out and takes the whole batch down (500, zero
    // pipelines), which is precisely what "fail-open" promises never happens.
    const constitution = assembleConstitution({ kind: 'image_variate', settings, rules: [] });
    const res = await this.runner.execute({
      kind: 'image_variate', postId,
      ...assembleVariatorPrompt(constitution, brief, n),
      schema: HybridDirectionsSchema, tellFields: ['directions[]'],
    }).catch((err: unknown) => {
      this.log.warn(`variator run could not start for post ${postId} (${String(err)}) — batch falls back to the plain brief`);
      return null;
    });
    const directions = res?.ok ? res.data.directions : [];
    // Silent partial degradation is the expensive failure here: the run row goes green, the
    // candidates come back looking samey, and there is no way to tell the variator apart from the
    // plan/bg steps as the culprit — the exact diagnosis loop that cost two eye-test fix waves.
    if (directions.length < n || new Set(directions).size < directions.length) {
      this.log.warn(`variator returned ${directions.length}/${n} directions (${new Set(directions).size} distinct) for post ${postId} — the remaining candidates fall back to the plain brief`);
    }
    // The override clause matters: briefs often spell out a concrete visual treatment, and without
    // it the plan step obeys the brief's devices/layout verbatim — collapsing batch diversity
    // (eye-test 2026-07-22: every candidate kept the brief's bubbles→gate→pills skeleton).
    return Array.from({ length: n }, (_, i) =>
      directions[i]
        ? `${brief}\n\n## visual direction (this candidate)\n${directions[i]}\nThis direction SUPERSEDES any specific visual devices, elements, or layout described in the brief above: keep the brief's message and meaning, but render them entirely through this direction's visuals.`
        : brief);
  }

  /** Shared by html + hybrid (Task 8): run image_html, then render + persist INSIDE the run lifecycle
   *  via `finalize`, so a render failure fails the run (html preserved) and the SSE stream closes only
   *  once the candidate row exists (the panel refetch on stream-close then sees it). */
  protected async launch(
    postId: number, lane: 'html' | 'hybrid', prompt: SplitPrompt, generationPrompt: string,
  ): Promise<ImageLaunch> {
    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((r) => { resolveRunId = r; });
    // `finalize` runs inside the same run, well after onStart, so the id captured here is always
    // set by the time the candidate row is written — that FK is the asset's lineage.
    let startedRunId: number | undefined;
    let refused: RunRefused | undefined;

    const finished = this.runner
      .execute({
        kind: 'image_html', postId, ...prompt,
        onStart: (id) => { startedRunId = id; resolveRunId(id); },
        // Schemaless: a large AI-generated HTML doc can't be reliably escaped into a JSON string,
        // so the run returns the raw output and we extract the fenced document here. A malformed
        // (no-document) output makes extractHtml throw, which fails the run — the desired behavior.
        finalize: async (rawOutput) => {
          const html = extractHtml(rawOutput);
          const groupId = newGroupId();
          const buf = await this.renderer.render(html, DIM);
          const png = await writePng(candidateDir(postId, groupId), 0, buf);
          try {
            await this.images.create({
              postId, lane, htmlSource: html, generationPrompt: lane === 'hybrid' ? generationPrompt : undefined,
              pngPath: png, width: DIM.width, height: DIM.height, candidateGroupId: groupId,
              ...(startedRunId !== undefined ? { runId: startedRunId } : {}), origin: 'generated',
            });
          } catch (err) {
            // The insert failed after the PNG was written — remove the just-written file so a failed
            // run leaves no orphan on disk, then rethrow to fail the run.
            await unlink(png).catch(() => undefined);
            throw err;
          }
        },
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`image_html for post ${postId} crashed: ${String(err)}`);
      });

    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('image_html failed before a run was created — see api logs');
    return { runId, finished };
  }
}
