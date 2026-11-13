/**
 * The status dot every run surface shares — the runs log, the workspace history rows, the detail.
 *
 * Encoding follows the phase-3 status rule (success = mint, failure = salmon, warnings = soft).
 * `failed` was ink, which read as "terminal and fine" — identical to a published post's dot — so a
 * failed run was the only failure on the page carrying no failure hue. Within the two-accent
 * palette `running` and `failed` are both salmon, separated by fill/animation rather than hue,
 * exactly as `drafting` (pulsing salmon) and `draft_ready` (solid salmon) are in `STATUS_DOTS`.
 * `timeout` stays soft: it is the warning, not the failure.
 */
export const RUN_DOT: Record<string, string> = {
  running: 'bg-salmon animate-pulse', succeeded: 'bg-mint', failed: 'bg-salmon', timeout: 'bg-soft',
};
