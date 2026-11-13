import { spawn } from 'node:child_process';
import type { Engine, EngineEvent, EngineRequest, EngineResult } from '@forge/shared';

/** Environment variables no cli child inherits. Both CLIs authenticate from their own credentials
 *  files and need none of them. The two keys are here for billing safety (a CLI that honoured one
 *  would move its runs onto the metered API; claude 2.1.282 ignores `ANTHROPIC_API_KEY` in -p mode),
 *  and a codex child is a workspace-write agent with shell tools, so it gets no database url. */
export const CLI_SCRUBBED_ENV: readonly string[] = ['OPENAI_API_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY'];

/** `process.env` plus `extra`, then scrubbed: `extra` is merged first, so a constructor argument
 *  cannot put a scrubbed key back. */
export function scrubbedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...extra };
  for (const key of CLI_SCRUBBED_ENV) delete env[key];
  return env;
}

/** Why WE ended the child, as opposed to the child ending on its own. */
export type EngineEnded = { kind: 'timeout'; detail: string };

export abstract class ProcessEngine implements Engine {
  abstract readonly name: Engine['name'];

  protected abstract command(req: EngineRequest): {
    bin: string; args: string[]; stdin?: string; env: Record<string, string>; cwd?: string;
  };
  /** `req` is threaded through so an engine can read the result the way the request asked for it
   *  (a schema-bearing claude run needs `structured_output`). Kept off the instance: one engine
   *  serves concurrent runs. */
  protected abstract interpret(stdout: string, stderr: string, exitCode: number, req: EngineRequest): EngineResult;

  /**
   * Result for a child this engine killed. `interpret` is deliberately NOT consulted here: the
   * kill reason has to win, or a truncated stream gets read as the run's real answer.
   */
  protected endedResult(stdout: string, ended: EngineEnded): EngineResult {
    return { output: stdout, failureKind: 'timeout', errorDetail: ended.detail };
  }

  run(req: EngineRequest, onEvent?: (e: EngineEvent) => void): Promise<EngineResult> {
    const { bin, args, stdin, env, cwd } = this.command(req);
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let ended: EngineEnded | undefined;
      let settled = false;
      const finish = (r: EngineResult) => { if (!settled) { settled = true; resolve(r); } };

      let killTimer: NodeJS.Timeout | undefined;

      const child = spawn(bin, args, { cwd: cwd ?? req.cwd, env: { ...env }, stdio: ['pipe', 'pipe', 'pipe'] });

      // Decode streams as UTF-8 so multi-byte sequences split across data events
      // are not corrupted into replacement characters in streamed AI output.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      const endChild = (reason: EngineEnded) => {
        if (ended) return;
        ended = reason;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000);
        killTimer.unref();
      };

      const timer = setTimeout(
        () => endChild({ kind: 'timeout', detail: `killed after ${req.timeoutMs}ms` }),
        req.timeoutMs,
      );

      child.on('error', (err) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        finish({ output: '', failureKind: 'spawn_error', errorDetail: String(err) });
      });

      child.stdout.on('data', (s: string) => {
        stdout += s;
        onEvent?.({ type: 'chunk', data: s });
      });
      child.stderr.on('data', (s: string) => {
        stderr += s;
        onEvent?.({ type: 'stderr', data: s });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        if (ended) {
          finish(this.endedResult(stdout, ended));
          return;
        }
        finish(this.interpret(stdout, stderr, code ?? -1, req));
      });

      // Guard stdin writes: when a spawn fails (e.g. ENOENT) or the child exits
      // immediately, writing to child.stdin emits an 'error' (EPIPE) on the stream.
      // Without this listener that surfaces as an unhandled exception and crashes
      // the process. The 'error'/'close' handlers above own the actual result.
      child.stdin.on('error', () => {});
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
