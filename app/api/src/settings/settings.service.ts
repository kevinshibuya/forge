import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_SETTINGS, Settings, SettingsSchema } from '@forge/shared';
import { eq } from 'drizzle-orm';
import { DB, ForgeDb } from '../db/client';
import { settings } from '../db/schema';

/**
 * If a stored settings blob predates `scheduling`, derive it from `cadence.timezone`.
 * Returns the patch to apply, or null when the row already has `scheduling`
 * (or has no legacy timezone to lift, in which case defaults apply).
 */
function liftCadenceTimezone(
  stored: Record<string, unknown>,
): { scheduling: Settings['scheduling'] } | null {
  if ('scheduling' in stored) return null;
  const cadence = stored.cadence;
  if (typeof cadence !== 'object' || cadence === null) return null;
  const timezone = (cadence as Record<string, unknown>).timezone;
  if (typeof timezone !== 'string') return null;
  return { scheduling: { timezone, weeklyGoal: null } };
}

@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: ForgeDb) {}

  async get(): Promise<Settings> {
    const rows = await this.db.select().from(settings).where(eq(settings.id, 1));
    if (rows.length === 0) {
      await this.db.insert(settings)
        .values({ id: 1, data: DEFAULT_SETTINGS })
        .onConflictDoNothing();
      return structuredClone(DEFAULT_SETTINGS);
    }
    const stored = rows[0]!.data as Record<string, unknown>;
    const lifted = liftCadenceTimezone(stored);
    const parsed = SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...stored, ...lifted });
    if (lifted) {
      // One-shot normalization: persist so subsequent reads take the fast path.
      await this.db.update(settings)
        .set({ data: parsed, updatedAt: new Date() })
        .where(eq(settings.id, 1));
    }
    return parsed;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = SettingsSchema.parse({ ...current, ...patch });
    await this.db.update(settings)
      .set({ data: next, updatedAt: new Date() })
      .where(eq(settings.id, 1));
    return next;
  }
}
