# Research runs read a staged snapshot, never the home directory

Amended by ADR 0017 (2026-09-06): the roots allowlist here governs the harness snapshot only.

A research run gets the `Read` tool so a post can cite the operator's real harness (agent definitions, skills, hooks). `~/.claude` also holds `.credentials.json`, an OAuth token, `history.jsonl` and every session transcript under `projects/`, and the CLI's `Read` is not fenced by the run's cwd. We copy an allowlisted snapshot (`settings.researchSources`, filtered by a hard deny list no setting can change, symlinks never followed) into `<tmp>/forge-research/<key>/harness/`, make `<key>/` the run's cwd (one level up, so the snapshot's `CLAUDE.md` is not auto-loaded as project instructions), record the manifest on the run, and delete the directory when the run settles. Two fences hold the model to it: a `--settings` permission deny on `Read` under the home directory and system roots, which the CLI enforces (verified on 2.1.259), and a persisted tool-call audit with a server-computed `outsideRoot` flag for anything that still tried.

Source: `docs/superpowers/specs/2026-09-02-style-docs-and-research-runs-design.md` (§5 Staged root).

## Update, 2026-09-03: the tool fence, corrected twice

Implementing this turned up a wrong assumption, and the first correction was itself wrong.

**First:** `--allowedTools` does not restrict the tool set, it only auto-approves the tools it
names. A real research run (run 102) shelled out through `Bash` while `--allowedTools` said
`Read,WebSearch,WebFetch`. Every path rule we pass is a `Read(...)` rule, so none of them constrain
`Bash`, and `Grep` reads file contents anywhere on disk.

**Second, and this is the part the first fix got wrong:** the response was to deny tools by name,
justified in this ADR by the claim that a blocklist "is what the CLI offers". That claim was false.
Both review legs disproved it independently, one by extracting the tool registry from the installed
binary and one by asking a fenced child to list its tools. Under the blocklist the child still had
`Monitor` (which runs shell commands on a loop), `REPL` and `JavaScript` (which execute code),
`Agent` (the live name for delegation; the blocklist named only the dead alias `Task`), `Skill` (the
live name; the blocklist named the dead `SlashCommand`), `LS`, `MultiEdit`, `Snip`, `WebBrowser`,
and the operator's entire Google Drive MCP including `create_file` and `share_file`. The blocklist
closed one door in a room full of them.

The CLI does offer an allowlist, and 2.1.259 has offered it all along:

- `--tools Read,WebSearch,WebFetch` restricts the built-in registry. Probed: the child reports
  exactly those three, and both `Read` and `WebSearch` still execute.
- `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` drops MCP servers, which `--tools` does
  not cover. Without it the child inherited the operator's user-scope servers.
- `--setting-sources ''` stops the child loading `~/.claude/settings.json`, including the
  operator's PreToolUse and PostToolUse hooks, and stops it auto-loading `~/.claude/CLAUDE.md` as
  user memory. That last one had quietly defeated the point of staging the snapshot one directory
  below the cwd: the operator's real harness CLAUDE.md was in context regardless.
- `--no-session-persistence` stops the CLI writing a full session transcript under
  `~/.claude/projects`, one directory per research run, holding the contents of every staged file
  read and every page fetched. Deleting the snapshot means little while that survives; two such
  directories existed before this was found.

The file side had the same error in mirror image. `researchSources` was free-form with a deny list
of nine patterns, in a harness root that also holds `.git` (whose history carries every committed
version of `settings.json`), `shell-snapshots`, `paste-cache`, `session-env`, `debug`, `logs`,
`codex-runs`, `backups` and `archive`. None were denied, and the Settings UI told the operator they
were. `RESEARCH_ROOTS` is now the first fence: a snapshot is drawn only from `CLAUDE.md`, `agents`,
`skills`, `hooks` and `bin`, a source glob can only narrow that, and a directory added to the
harness tomorrow is out by default. The deny list stays as the belt.

`RESEARCH_DENIED_TOOLS` is kept as a second belt, but it is no longer the mechanism. The lesson is
the one this ADR already stated for files and then failed to apply to tools: **the fence is an
allowlist; a blocklist is what you keep behind it.**

What remains unfenced, named here so nobody has to rediscover it: `WebFetch` can send. Everything
above governs what a run may READ; nothing stops a fetched page from instructing the model to fetch
an attacker URL with the snapshot's contents in the query string. Localhost and the metadata
address are denied, which closes the path back into the operator's own unauthenticated api, but
general egress is inherent to "may search the web". A host allowlist, or dropping `WebFetch` and
keeping `WebSearch`, is the fix if that ever matters more than the capability.

## Considered options

- **Point `Read` at `~/.claude` and deny the secret files.** Rejected as the primary mechanism: a deny list has to anticipate every future secret, and there would be no record of what the model could see. A deny on the whole home directory is kept as the second fence precisely because it needs no such anticipation.
- **No local reads; paste what the post needs into the idea.** The status quo. Rejected because the whole point is grounding a post in files that change, without the operator curating them by hand each time.

## Consequences

- The manifest is the answer to "what did the model see", per run, forever.
- Narrowing the readable locations is a settings edit. Adding a root, or allowing a denied path, is a code change (see the Update above).
- Snapshots cost a copy per run. The default allowlist is a few hundred kilobytes; if it grows, the fix is a tighter allowlist, not a symlink.

## Amended for v2 (2026-09-24)

The staged snapshot, the allowlist of roots and the three fences were built around one thing: the CLI's `Read` running on the operator's own machine, next to the operator's own secrets. The hosted `api` backend has no `Read`, no home directory and no CLI, so this mechanism is not ported; it is deleted with the `cli` backend's Research support (ADR 0019 confines `cli` to runs without Inputs or Research). What survives in spirit is in ADR 0023: a Research run is a managed Run whose first step plans queries under the Output contract, forge searches and fetches only the returned URLs itself through the SSRF guard, the caps ("narrow but never widen") become 5 searches, 10 fetches and 200,000 characters per run, and the manifest's job, "what did the model see", is done by the Run's context row (ADR 0026). The exfiltration channel this ADR named, a URL the model writes into `WebFetch`, is closed by the model having no fetch tool at all.
