import { ConflictException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RunRefused, RunnerService } from '../runner/runner.service';
import { RunsService } from '../runs/runs.service';
import { ImagesService, type AssetRow } from './images.service';
import { RENDERER, type Renderer } from './render.service';
import { substituteBackground, type ImageLaunch } from './image-compose.service';
import { bgPathFor, candidateDir, newGroupId, readPngSize, writePng } from './asset-store';
import { assembleBgRefinePrompt } from './hybrid-prompts';

const DIM = { width: 1200, height: 1200 };

/** A source candidate that can actually be refined: hybrid html WITH its placeholder, plus a readable bg.png. */
interface RefinableSource { source: AssetRow; htmlSource: string; sourceBg: string }

/** The canvas editor's payload: html with the background already inlined, plus the exact data URI to reverse. */
export interface EditableHtml { html: string; bgDataUri: string }

@Injectable()
export class ImageRefineService {
  private readonly log = new Logger(ImageRefineService.name);

  constructor(
    private readonly runner: RunnerService,
    private readonly images: ImagesService,
    private readonly runs: RunsService,
    @Inject(RENDERER) private readonly renderer: Renderer,
  ) {}

  /**
   * Patch ONE candidate's background: the source bg.png is attached to a single codex image_gen
   * call with the user's instruction, and the patched background lands as `bg.png` in the run's own
   * patch dir. That verified file is the run's ENTIRE product — no re-composite, no render, no
   * asset row. The canvas editor owns the composite now: it pulls the patched background with
   * `patchedBg(runId)` and swaps it under the live text layer, so a patch the user rejects costs
   * nothing and the source candidate is never touched.
   *
   * Attaching the source image is a DELIBERATE exception to the extract-only rule that governs
   * hybrid batch generation (a reference image anchors composition and kills batch diversity —
   * eye-tests 2026-07-19/22). That rule is scoped to generating N varied candidates; here anchoring
   * to one exact composition is the whole point, and exactly one background is produced.
   */
  async launchBgPatch(assetId: number, instruction: string): Promise<ImageLaunch> {
    const { source, sourceBg } = await this.requireRefinableSource(assetId);
    const postId = source.postId;
    // The patch dir is keyed by the run id, so it can only be built INSIDE the run callback. The
    // cleanup below needs that path too — hence the outer `let`, assigned once the callback runs.
    let bgPath: string | undefined;
    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((r) => { resolveRunId = r; });
    let refused: RunRefused | undefined;

    const finished = this.runner
      .executeManaged({
        kind: 'image_refine', prompt: instruction, postId, onStart: resolveRunId,
        run: async ({ call, runId, settings }) => {
          // codex edits the ATTACHED source bg and writes bg.png into this run's patch dir. The
          // image reaches the engine as a FILE PATH; no base64 data URI ever touches a prompt
          // (the standing no-base64-in-prompts invariant).
          const dir = candidateDir(postId, `patch-${runId}`);
          await mkdir(dir, { recursive: true });
          bgPath = join(dir, 'bg.png');
          const bgRes = await call('image_gen', {
            ...assembleBgRefinePrompt(instruction),
            cwd: dir,
            images: [sourceBg],
          });
          if (bgRes.failureKind) throw Object.assign(new Error(bgRes.errorDetail ?? 'background refine failed'), { failureKind: bgRes.failureKind });
          if (!(await readPngSize(bgPath))) {
            throw Object.assign(new Error('background refine produced no readable bg.png'), { failureKind: 'invalid_output' as const });
          }
          return bgRes.output;
        },
      })
      .then(async (r) => { if (!r.ok && bgPath) await unlink(bgPath).catch(() => undefined); })
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`bg patch of asset ${assetId} crashed: ${String(err)}`);
      });

    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('image_refine failed before a run was created — see api logs');
    return { runId, finished };
  }

  /**
   * The patched background produced by a `launchBgPatch` run, as a data URI the canvas can paint
   * immediately. A run still in flight is indistinguishable from one whose file was cleaned up, so
   * both read as 404 — the client polls the run's status for the difference.
   */
  async patchedBg(runId: number): Promise<{ bgDataUri: string }> {
    const run = await this.runs.get(runId);
    if (run.status === 'failed' || run.status === 'timeout') {
      throw new UnprocessableEntityException(
        `run ${runId} produced no background: ${run.error ?? run.failureKind ?? run.status}`,
      );
    }
    // No postId means no patch dir can exist — same 404 as an unreadable file.
    if (run.postId === null) throw new NotFoundException(`run ${runId} has no patched background`);
    const bgPath = join(candidateDir(run.postId, `patch-${runId}`), 'bg.png');
    let buf: Buffer;
    try { buf = await readFile(bgPath); }
    catch { throw new NotFoundException(`run ${runId} has no patched background yet`); }
    return { bgDataUri: `data:image/png;base64,${buf.toString('base64')}` };
  }

  /**
   * The candidate's text layer with its background inlined, ready to load into the canvas editor.
   *
   * `bgDataUri` is handed back SEPARATELY on purpose: the browser has to reverse the substitution
   * (data URI -> `__HYBRID_BG__`) before POSTing the edit back, and reversing it exactly requires
   * the exact string that went in. Sending a multi-MB data URI back through the API is the failure
   * `applyCanvasEdit` refuses.
   */
  async editableHtml(assetId: number): Promise<EditableHtml> {
    const { htmlSource, sourceBg } = await this.requireRefinableSource(assetId, 'edited on canvas');
    const bgDataUri = `data:image/png;base64,${(await readFile(sourceBg)).toString('base64')}`;
    return { html: substituteBackground(htmlSource, bgDataUri), bgDataUri };
  }

  /**
   * Land a canvas edit as its own candidate: the posted html (still in `__HYBRID_BG__` token form)
   * is re-composited over the SOURCE background and rendered synchronously — no engine, no run row,
   * nothing to poll. The source candidate is untouched; the child gets its own group dir and a COPY
   * of the source bg.png so it stays reference-eligible and can itself be refined or re-edited.
   *
   * With `bgRunId`, the background swapped under the text layer is that `launchBgPatch` run's
   * patched bg.png instead of the source's: the same save commits the accepted patch AND the
   * canvas edit as one candidate, which is why the child lands as `bg_refined` carrying the run
   * and the refine instruction as its provenance.
   */
  async applyCanvasEdit(assetId: number, htmlSource: string, bgRunId?: number): Promise<AssetRow> {
    // Cheapest check first, before any db/file work: a payload that still carries the inlined
    // background means the client skipped the reversal, and storing megabytes of base64 as an
    // asset's html source would poison every downstream re-composite.
    if (!htmlSource.includes('__HYBRID_BG__')) {
      throw new UnprocessableEntityException(
        'edited html must keep the __HYBRID_BG__ placeholder — reverse the background substitution before posting',
      );
    }
    const { source, sourceBg } = await this.requireRefinableSource(assetId, 'edited on canvas');
    const postId = source.postId;
    // Every bgRunId failure is a 422 raised BEFORE a single byte is written — a bad run id must
    // never leave a half-built candidate dir behind.
    const patch = bgRunId === undefined ? undefined : await this.requirePatchedBg(assetId, bgRunId, postId);
    const bg = patch?.bgPath ?? sourceBg;
    const groupId = newGroupId();
    const dir = candidateDir(postId, groupId);
    await mkdir(dir, { recursive: true });

    const dataUri = `data:image/png;base64,${(await readFile(bg)).toString('base64')}`;
    let buf: Buffer;
    try { buf = await this.renderer.render(substituteBackground(htmlSource, dataUri), DIM); }
    catch (err) { throw new InternalServerErrorException(`canvas edit render failed: ${String(err)}`); }

    const png = await writePng(dir, 0, buf);
    const bgPath = join(dir, 'bg.png');
    await copyFile(bg, bgPath);
    try {
      return await this.images.create({
        postId, lane: 'hybrid', htmlSource,
        // A bg_refined child's provenance is the instruction that produced its background — the
        // breakdown panel reads this field — not the source candidate's original brief.
        generationPrompt: (patch ? patch.prompt : source.generationPrompt) ?? undefined,
        pngPath: png, width: DIM.width, height: DIM.height, candidateGroupId: groupId,
        sourceAssetId: source.id,
        ...(patch ? { origin: 'bg_refined' as const, runId: bgRunId } : { origin: 'canvas_edited' as const }),
      });
    } catch (err) {
      // Insert failed after the files were written — no orphan candidate dir survives.
      await Promise.all([unlink(png).catch(() => undefined), unlink(bgPath).catch(() => undefined)]);
      throw err;
    }
  }

  /**
   * The patch run whose background a canvas save wants to commit, validated in
   * `requireRefinableSource`'s named-reason 422 style. `RunsService.get` throws a plain `Error` for
   * a missing row, which would surface as a 500 — a client-supplied id is a client error, so it is
   * translated here. The postId check is not cosmetic: a cross-post run id would silently
   * composite ANOTHER post's background into this candidate.
   */
  private async requirePatchedBg(assetId: number, bgRunId: number, postId: number): Promise<{ bgPath: string; prompt: string | null }> {
    const no = (why: string) =>
      new UnprocessableEntityException(`asset ${assetId} cannot be saved with run ${bgRunId}'s background: ${why}`);
    // A missing run is a 422 here, not a 404: the operator asked to save an asset, and the run it
    // names being absent is one of the several reasons that save cannot happen. Narrowed, so a
    // connection error stays a 500 instead of reading as "no such run".
    let run: Awaited<ReturnType<RunsService['get']>>;
    try { run = await this.runs.get(bgRunId); }
    catch (err) {
      if (err instanceof NotFoundException) throw no('no such run');
      throw err;
    }
    if (run.kind !== 'image_refine') throw no(`run kind is ${run.kind}, only image_refine runs produce a patched background`);
    if (run.postId !== postId) throw no(`it belongs to post ${run.postId ?? 'none'}, not post ${postId}`);
    const bgPath = join(candidateDir(postId, `patch-${bgRunId}`), 'bg.png');
    if (!(await readPngSize(bgPath))) throw no('its patched bg.png is missing or unreadable');
    return { bgPath, prompt: run.prompt };
  }

  /**
   * Everything the pipeline needs from the source, validated BEFORE a paid engine call: only a
   * hybrid candidate whose text layer still carries the `__HYBRID_BG__` placeholder and whose
   * textless bg.png is readable can be re-composited. Each failure names its own reason — a 422
   * the panel can show verbatim beats a run that burns an image generation and then fails.
   */
  private async requireRefinableSource(assetId: number, action = 'background-refined'): Promise<RefinableSource> {
    const source = await this.images.get(assetId); // 404 when the asset is gone
    const no = (why: string) =>
      new UnprocessableEntityException(`asset ${assetId} cannot be ${action}: ${why}`);
    if (source.lane !== 'hybrid') throw no(`lane is ${source.lane}, only hybrid candidates have a separate background`);
    const htmlSource = source.htmlSource;
    if (!htmlSource) throw no('no html source recorded');
    if (!htmlSource.includes('__HYBRID_BG__')) throw no('its html has no __HYBRID_BG__ placeholder to re-composite into');
    if (!source.pngPath) throw no('no rendered png');
    const sourceBg = bgPathFor(source.pngPath);
    if (!(await readPngSize(sourceBg))) throw no('its bg.png is missing or unreadable');
    return { source, htmlSource, sourceBg };
  }
}
