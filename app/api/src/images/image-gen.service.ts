import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { lstat, mkdir } from 'node:fs/promises';
import { RunRefused, RunnerService } from '../runner/runner.service';
import { SettingsService } from '../settings/settings.service';
import { ImagesService } from './images.service';
import type { ImageLaunch } from './image-compose.service';
import { candidateDir, listPngs, newGroupId, readPngSize } from './asset-store';

const DIM = { width: 1200, height: 1200 };

@Injectable()
export class ImageGenService {
  private readonly log = new Logger(ImageGenService.name);

  constructor(
    private readonly runner: RunnerService,
    private readonly settings: SettingsService,
    private readonly images: ImagesService,
  ) {}

  async launchRaster(postId: number, brief: string, batch?: number): Promise<ImageLaunch> {
    const settings = await this.settings.get();
    const n = Math.min(Math.max(batch ?? settings.imageCandidateBatch, 1), 10);
    const groupId = newGroupId();
    const dir = candidateDir(postId, groupId);
    await mkdir(dir, { recursive: true });

    const prompt = [
      `Generate ${n} distinct candidate images, each exactly ${DIM.width}x${DIM.height} px, as PNG files`,
      'written into the current working directory. Name them 0.png, 1.png, and so on.',
      'Do not write any other files. Brief:',
      brief,
    ].join('\n');

    let resolveRunId!: (id: number) => void;
    const runIdReady = new Promise<number>((r) => { resolveRunId = r; });
    let refused: RunRefused | undefined;

    const finished = this.runner
      .execute({
        kind: 'image_gen', postId, system: [], user: prompt, cwd: dir,
        onStart: resolveRunId,
        finalize: async () => {
          // Validate each file is a real PNG and record its TRUE dimensions. A run that wrote no
          // readable PNGs FAILS the run (spec: "no readable output files = failed run") by throwing.
          const valid: { path: string; w: number; h: number }[] = [];
          for (const p of await listPngs(dir)) {
            // Only ingest REGULAR files: a symlink (isFile() === false) planted by the generator could
            // otherwise be ingested and later served, escaping the assets root. lstat does not follow it.
            let st;
            try { st = await lstat(p); } catch { continue; }
            if (!st.isFile()) continue;
            const size = await readPngSize(p);
            if (size) valid.push({ path: p, w: size.w, h: size.h });
          }
          if (valid.length === 0) throw new Error('image_gen produced no readable PNGs');
          // Insert the whole grid atomically — a partially-written candidate set never lands.
          await this.images.createMany(valid.map((v) => ({
            postId, lane: 'raster', generationPrompt: brief,
            pngPath: v.path, width: v.w, height: v.h, candidateGroupId: groupId,
          })));
          // The billable image count is what actually landed, not what was asked for. The runner
          // prices it and writes it with the call's usage.
          return { images: valid.length };
        },
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        if (err instanceof RunRefused) { refused = err; return; }
        this.log.error(`raster ingest for post ${postId} crashed: ${String(err)}`);
      });

    const runId = await Promise.race([runIdReady, finished.then(() => -1)]);
    if (runId === -1) throw refused ?? new ConflictException('image_gen failed before a run was created — see api logs');
    return { runId, finished };
  }
}
