import type { Engine, EngineBackend, EngineName } from '@forge/shared';

/** What an entry file installs before Nest boots: the backend and its engines. The entry file is
 *  the only place that chooses them, so a request can never pick its backend. */
export interface Installed { backend: EngineBackend; engines: Partial<Record<EngineName, Engine>> }

let installed: Installed | undefined;

export function installEngines(next: Installed): void { installed = next; }

export function installedEngines(): Installed { return installed ?? { backend: 'cli', engines: {} }; }
