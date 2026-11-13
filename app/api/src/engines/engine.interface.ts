/** The Engine v2 seam lives in `@forge/shared` (ADR 0019); the api re-exports it and owns the DI tokens. */
import type { SystemBlock } from '@forge/shared';

export type {
  Engine, EngineBackend, EngineEvent, EngineName, EngineRequest, EngineResult, EngineUsage, SystemBlock,
} from '@forge/shared';

/** A built prompt: the cached system blocks and the user turn. `renderPrompt` joins them for the
 *  audit and the cli stdin. */
export type SplitPrompt = { system: SystemBlock[]; user: string };

/** The installed engines, keyed by engine name. */
export const ENGINES = Symbol('ENGINES');
/** The process's backend, `api` or `cli`, chosen by the entry file. */
export const ENGINE_BACKEND = Symbol('ENGINE_BACKEND');
