// Mimics `claude -p --output-format stream-json`: newline-delimited JSON, final result line.
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: 'thinking' } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: `{"echo":${JSON.stringify(input.trim())}}` }) + '\n');
  process.exit(0);
});
