// Fix F fixture: writes ONE regular PNG (0.png) plus ONE symlink (1.png -> a real PNG OUTSIDE cwd)
// into the candidate dir. Proves raster ingest skips the symlink (only the regular file is ingested);
// without the lstat guard the symlink target is a valid PNG and would otherwise be ingested + served.
import { writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
writeFileSync('0.png', PNG);
const outside = join(tmpdir(), `forge-planted-${process.pid}-${Date.now()}.png`);
writeFileSync(outside, PNG);
symlinkSync(outside, '1.png');
process.stdout.write('wrote 0.png (regular) and 1.png (symlink)\n');
process.exit(0);
