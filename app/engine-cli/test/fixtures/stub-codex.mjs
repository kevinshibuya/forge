// Mimics `codex exec`. Modes via env var STUB_MODE: ok | quota.
if (process.env.STUB_MODE === 'quota') {
  process.stderr.write("You've hit your usage limit. Upgrade or wait for the window to reset.");
  process.exit(1);
}
for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DATABASE_URL']) {
  // The forge codex engine must NEVER pass these: billing protection for the keys, and a
  // workspace-write agent has no business reaching the database.
  if (process.env[name]) {
    process.stderr.write(`LEAKED_ENV:${name}`);
    process.exit(3);
  }
}
process.stdout.write('Generated 4 images into ./assets\n');
process.exit(0);
