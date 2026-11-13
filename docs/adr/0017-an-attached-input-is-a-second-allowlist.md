# An attached Input is a second allowlist, behind the same belt

ADR 0015 fenced research runs to an allowlisted snapshot of `~/.claude`, and the rule that carried the whole mechanism was "a setting can narrow this, never widen it". Inputs need the operator to point a run at any folder on the machine, which that rule forbids outright. So the roots allowlist of ADR 0015 now governs the harness snapshot only, and an operator's explicit `path` is a second allowlist of one: not a widening of the first, but a separate grant made by hand, per post, behind the same belt and the same fences.

Source: `docs/superpowers/specs/2026-09-04-output-contract-and-post-ownership-design.md` (§5 Inputs).

## What the second allowlist costs to enter

A chosen path is judged three times: as the operator typed it, again after `realpath`, and finally by inode. Refused as a choice: a relative path, the home directory itself, `/`, `~/.claude` and its subtree, the exact roots `/Users`, `/home`, `/root` and `/Volumes`, `/etc` and `/private/etc` with theirs, and anything hidden. Anything deeper is allowed, which is the point.

Two of those three exist because the review found the first one alone was not enough.

**The belt has to run at the choice, not only under it.** The walk skips a dotfile and a dot-directory, and nothing skipped the one the walker was handed, so `~/.claude.json`, which holds the account and every MCP server's environment, attached as a single file. So did `~/.codex` with its `auth.json` and `~/.config/gh` with its host tokens. A file named directly also skipped `RESEARCH_DENY` entirely, so a `settings.json` refused through its parent was accepted on its own. The choice now faces both rules.

**Name matching cannot see an alias.** On macOS a firmlink is not a symlink, and `realpath.native` leaves it alone, so `/System/Volumes/Data/Users/k/.claude` and `~/.claude` are the same inode under two names that no string comparison reconciles. `/System/Volumes/Data` prefixed onto any refused root walked straight past every check, including the path to the harness OAuth token. The last judgement is therefore by `dev:ino`: the exact roots against the chosen path, the subtree roots against every ancestor. `Read(//System/Volumes/**)` joins the deny settings for the same reason.

The tree behind an accepted choice is walked behind the belt ADR 0015 already built: the `RESEARCH_DENY` list, symlinks refused rather than followed, dotfiles and `.git` and `node_modules` skipped, a text-like extension allowlist, and per-input caps of 200 files and 5 MB with a per-run total of 500 files and 20 MB. Over a cap is a refusal that names the numbers, never a truncated manifest, so what the model was given is never a surprise subset of what the operator chose.

The fences of ADR 0015 hold unchanged, and they are the `--settings` permission deny, which is what actually refuses a tool or a path, and the persisted tool-call audit with its server-computed `outsideRoot` flag. A run fenced by Inputs alone is given `Read` and nothing else. The web and the harness snapshot arrive only with the research toggle, which keeps its old meaning.

## Considered

Letting `settings.researchSources` accept absolute paths outside the harness. Rejected: one setting with two meanings, and the harness allowlist would have to widen for a reason that has nothing to do with the harness.

Letting the model fetch and read at run time instead of staging. Rejected in §5: it needs `WebFetch` on every run kind, and the manifest would no longer say what was actually read.

Pasting small inputs into the prompt and staging only large ones. Rejected in §5: two mechanisms, and the second one never gets an audit.

## Consequences

A run now carries two manifests and one audit: `staged_manifest` for the harness snapshot and `staged_inputs` for what the operator attached, both under one staged root whose `harness/` and `inputs/` subtrees the audit treats as inside.

`RESEARCH_DENY` is harness-shaped, so a project tree with a top-level `logs/`, `cache/` or `settings.json` sees those listed as refused rows on the first attach. That is by design and visible, not silent.

Every copy opens its source with `O_NOFOLLOW` and copies from the descriptor, so the final component cannot be swapped for a symlink between the check and the read. An ancestor directory swapped in the same window, on the operator's own machine, is accepted.

A `file` or `url` input keeps a frozen copy under `uploads/inputs/<post>/<input>/`, deleted with the input. `post_inputs` references `posts` without a cascade, so whichever slice adds a post-delete route has to remove the input rows and that folder itself; today no such route exists.

The body-parser limit rises to 12 MB for the whole api, not only the inputs routes, because a pasted text at the 5 MB cap has to reach the producer and be refused by sentence rather than by a 413 that says nothing useful. It is sized above twice the cap on purpose: JSON escaping costs two bytes for a quote, a backslash or a newline, so a legitimate paste can double on the wire, and at 6 MB the transport refused texts that were under the cap. The api listens on 127.0.0.1 only, so the widened limit is bounded by the operator's own machine.

Staging moved inside `RunnerService.execute`, between the run row and the spawn. A refusal now fails a run the operator can see on the failure strip, where before it was an HTTP error that no run recorded.

There is no fourth fence. `scripts/probe-inputs.mjs` asked the CLI to read a file outside the staged root under `--allowedTools 'Read(//<cwd>/**)'` and it returned the contents, with an empty `permission_denials`. That is the same behaviour ADR 0015 recorded for tool names: `--allowedTools` auto-approves, it never restricts. The bare tool names ship, and what holds a run to its root stays the `--settings` deny and the audit.

## Amended for v2 (2026-09-24)

The second allowlist was a grant over the operator's own disk, and a hosted Tenant has no disk to grant. The `path` kind dies with the Staged root (ADR 0023). `file` and `url` stay, and the mechanism this ADR rejected in §5, "pasting small inputs into the prompt", becomes the only mechanism, for the reason the rejection gave in reverse: on the `api` backend there is no `Read`, so a second mechanism cannot exist, and the audit that staging gave is now the Run's structured context row, which records the Inputs' text as the model saw it. An Input is parsed to text at attach (TS extractors, a hosted OCR fallback for scans) and carried inline; the caps shrink from 500 files and 20 MB per run to what a prompt can carry, 8 files and 120,000 characters per run, and an Input that would break the cap is refused at attach with the numbers, as before. Passage retrieval over long documents is the recorded successor. The 12 MB body limit this ADR widened goes back down to 1 MB: uploads travel to object storage through presigned URLs and never through the api body. On the `cli` backend a run with Inputs is not offered at all (ADR 0019), so the staging code moves to the dev-only package with the fences that belong to it.
