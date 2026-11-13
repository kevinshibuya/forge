import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  ENGINES_BY_BACKEND, type EngineBackend, type EngineName, type ModelPrices, type ModelRowPatch, type TaskKey,
} from '@forge/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { modelRegistry } from '../db/schema';

/** One registry row with its prices as numbers. drizzle answers numeric columns as strings;
 *  this is the edge where they become numbers. */
export interface ModelRow {
  id: number;
  task: TaskKey;
  backend: EngineBackend;
  engine: EngineName;
  model: string;
  effort: string | null;
  maxOutputTokens: number;
  prices: ModelPrices;
  updatedAt: Date;
}

function toModelRow(r: typeof modelRegistry.$inferSelect): ModelRow {
  return {
    id: r.id,
    task: r.task as TaskKey,
    backend: r.backend as EngineBackend,
    engine: r.engine as EngineName,
    model: r.model,
    effort: r.effort,
    maxOutputTokens: r.maxOutputTokens,
    prices: {
      inputPerMtok: Number(r.inputPerMtok),
      cacheWritePerMtok: Number(r.cacheWritePerMtok),
      cacheReadPerMtok: Number(r.cacheReadPerMtok),
      outputPerMtok: Number(r.outputPerMtok),
      imagePerUnit: Number(r.imagePerUnit),
    },
    updatedAt: r.updatedAt,
  };
}

/** The model registry (ADR 0019). Read on every call, never cached: a row edit takes effect on
 *  the next run. `task` and `backend` are a row's identity; `engine` moves only within its backend. */
@Injectable()
export class ModelRegistryService {
  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  async list(): Promise<ModelRow[]> {
    const rows = await this.db.select().from(modelRegistry).orderBy(asc(modelRegistry.backend), asc(modelRegistry.task));
    return rows.map(toModelRow);
  }

  async resolve(task: TaskKey, backend: EngineBackend): Promise<ModelRow | null> {
    const [row] = await this.db.select().from(modelRegistry)
      .where(and(eq(modelRegistry.task, task), eq(modelRegistry.backend, backend)));
    return row ? toModelRow(row) : null;
  }

  async patch(id: number, patch: ModelRowPatch): Promise<ModelRow> {
    const [row] = await this.db.select().from(modelRegistry).where(eq(modelRegistry.id, id));
    if (!row) throw new NotFoundException(`registry row ${id} not found`);
    const backend = row.backend as EngineBackend;
    if (patch.engine !== undefined && !ENGINES_BY_BACKEND[backend].includes(patch.engine)) {
      throw new UnprocessableEntityException(
        `engine ${patch.engine} does not run on the ${backend} backend; it takes ${ENGINES_BY_BACKEND[backend].join(' or ')}`,
      );
    }
    const { inputPerMtok, cacheWritePerMtok, cacheReadPerMtok, outputPerMtok, imagePerUnit, ...rest } = patch;
    const price = (n: number | undefined) => (n === undefined ? undefined : String(n));
    const [updated] = await this.db.update(modelRegistry).set({
      ...rest,
      inputPerMtok: price(inputPerMtok),
      cacheWritePerMtok: price(cacheWritePerMtok),
      cacheReadPerMtok: price(cacheReadPerMtok),
      outputPerMtok: price(outputPerMtok),
      imagePerUnit: price(imagePerUnit),
      updatedAt: new Date(),
    }).where(eq(modelRegistry.id, id)).returning();
    return toModelRow(updated!);
  }
}
