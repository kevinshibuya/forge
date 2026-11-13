import { cliEngines } from '@forge/engine-cli';
import { installEngines } from './engines/installed';
import { bootstrap } from './bootstrap';

/** The `cli` backend: Kevin's dev entry, on his subscriptions. `npm run start:dev` boots it. */
installEngines({ backend: 'cli', engines: cliEngines() });
bootstrap();
