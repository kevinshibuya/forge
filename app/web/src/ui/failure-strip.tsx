import { Link } from 'react-router';
import type { RunDto } from '../api/client';
import { Button, Pill } from './primitives';
import { failureMessage } from './run-failure';

/**
 * One row that says what the last run did where the operator can answer it: the failure label,
 * its lines (a decline's reason and question, a broken contract's raw head), a link to the run
 * on the runs log, and a relaunch control when the surface can relaunch. No dismiss: the strip
 * goes away when a newer run of the same kind succeeds.
 */
export function FailureStrip({ run, onRelaunch, relaunchLabel = 'relaunch' }: {
  run: Pick<RunDto, 'id' | 'failureKind' | 'error' | 'output' | 'declined'>;
  onRelaunch?: () => void;
  relaunchLabel?: string;
}) {
  const f = failureMessage(run);
  const declined = run.failureKind === 'declined';
  const border = f.tone === 'ink' ? 'border-ink' : 'border-salmon';
  const pill = f.tone === 'ink' ? 'border-ink text-ink' : 'border-salmon text-salmon';
  return (
    <div className={`flex items-start gap-3 rounded-card border ${border} bg-paper px-3 py-2 text-[12px] text-soft`}>
      <Pill className={pill}>{f.label}</Pill>
      <div className="min-w-0 flex-1">
        {f.lines.map((line, i) => (
          // The second line of a decline is the question, the one line the operator can act on.
          <p key={i} className={`${i > 0 ? 'mt-1' : ''} ${declined && i === 1 ? 'text-ink' : ''}`}>{line}</p>
        ))}
        <Link className="mt-1 inline-block text-ink hover:text-salmon" to={`/runs?run=${run.id}`}>open run →</Link>
      </div>
      {onRelaunch && <Button variant="subtle" onClick={onRelaunch}>{relaunchLabel}</Button>}
    </div>
  );
}
