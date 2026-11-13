import { loadEnv } from './env';
import { installEngines } from './engines/installed';
import { apiEngines } from './engines/api';
import { bootstrap } from './bootstrap';

/** The `api` backend: the production entry. It never imports `@forge/engine-cli`
 *  (invariant 9, proved by test/no-cli-in-prod.spec.ts). The provider keys come from `app/api/.env`,
 *  so `loadEnv()` runs before `apiEngines()` reads them. */
loadEnv();
installEngines({ backend: 'api', engines: apiEngines() });
bootstrap();
