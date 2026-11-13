// Reads stdin fully, then echoes an envelope to stdout. Simulates a happy engine.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  process.stdout.write(`OUT:${input.trim()}`);
  process.exit(0);
});
