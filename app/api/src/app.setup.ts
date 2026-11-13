import type { NestExpressApplication } from '@nestjs/platform-express';
import { INPUT_JSON_LIMIT } from '@forge/shared';

/**
 * Everything the http layer needs before it listens, in one place so a supertest app is
 * configured exactly like the real one. A controller method called directly runs none of this,
 * which is why every api-edge rule is tested through a real application.
 *
 * The json limit is raised for the whole api, not only the inputs routes: express defaults to
 * 100 kB and a pasted text at the input cap is 5 MB. Every other route inherits the wider limit,
 * which ADR 0017 records as a consequence.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.useBodyParser('json', { limit: INPUT_JSON_LIMIT });
}
