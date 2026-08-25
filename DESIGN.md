# Design and decisions

## Scope

`dsh-memory` is a DeepSeek Harness bundle: a Host pipeline plugin plus a Web settings page. It
turns historical root-session logs into durable long-term memory — a two-phase extraction and
consolidation pipeline adapted from the Codex memories system onto DSH primitives, plus a read
path that injects a dense summary into every session and exposes four retrieval tools.

The plugin owns its memory directory and its KV-backed bookkeeping. It never rewrites session
logs, never touches the agent preset or the prompt template, and runs entirely asynchronously
after session boundaries.

## Decision record

Confirmed with the user before implementation (2026-02):

| Decision | Choice | Rationale |
| --- | --- | --- |
| Memory root | `$DSH_HOME/memories` (configurable) | Codex-style global consolidation; workspace context is preserved per rollout instead |
| Phase 2 executor | Direct `llm.stream` call | Lightweight, retryable, no subagent quota cost; consolidation is one bounded prompt |
| Read path | Summary injected + tools on demand | `memory_summary.md` is token-budgeted navigation; details stay in MEMORY.md / rollout summaries |
| Trigger | Startup catch-up + turn-end debounce | Codex startup task plus DSH event-driven freshness; idle debounce doubles as the "idle long enough" guard |

Confirmed with the user before implementation (2026-08):

| Decision | Choice | Rationale |
| --- | --- | --- |
| Skill promotion | Phase 2 emits `skills/<name>/SKILL.md` via optional tool args | Codex skills parity; strictly validated names/paths; `remove_skills` for explicit retirement |
| Forgetting | Usage-tracked candidates retired into `rollout_summaries/.retired/` | Codex `max_unused_days` parity; recoverable archive instead of hard delete |
| Usage source | `memory_read` / `memory_search` calls (not injection, not list) | Mirrors Codex read-path telemetry: only explicit retrieval counts as "used" |
| Run logs | `logs/<stamp>-<stage>.json`, newest 50 kept | Settings page "what did the AI do" panel; bounded storage, redacted content |
| Running state | `get-state` exposes phase1/phase2 single-flight flags; buttons disabled while running | Reopening the settings page no longer "unlocks" an in-flight run |

## Architecture

```
session logs ──(sessionQuery/sessionPersistence)──► Phase 1 (per session)
                                                      ├─ filter → render → redact
                                                      ├─ llm extract → {raw_memory, rollout_summary, rollout_slug}
                                                      ├─ write rollout_summaries/<slug>.md
                                                      ├─ append raw_memories.md
                                                      └─ write run log (per session outcomes)
                                                                  │
                                                    (cooldown, pending flag)
                                                                  ▼
                                          Phase 2 (global, single-flight)
                                                      ├─ llm consolidate (INIT / INCREMENTAL)
                                                      ├─ write MEMORY.md + memory_summary.md (v1, redacted)
                                                      ├─ promote/remove skills/ (validated)
                                                      ├─ retire candidate summaries → .retired/
                                                      ├─ rotate raw_memories.md → archive
                                                      └─ write run log (full model output)
                                                                  │
                                                                  ▼
                                          read path: systemPrompt section (summary, cached)
                                                     memory_list / memory_read / memory_search / memory_add
                                                     (read/search record usage → forgetting input)
```

### Codex concepts → DSH primitives

| Codex | dsh-memory |
| --- | --- |
| state DB (`threads`, `stage1_outputs`, `jobs`) | storage hub KV (`json` backend): claims, cooldown, pending flag, overrides, usage, retiredAt |
| rollout JSONL files | session logs via `sessionQuery.readSession` / `sessionPersistence.load` |
| startup task, stage-1 job leases, retry backoff | boot catch-up + `agent/turn-stopping` debounce; per-session claims with backoff and restart recovery |
| global Phase 2 lock + 6h cooldown | in-process single-flight + configurable cooldown (default 6h) |
| `~/.codex/memories` + git baseline | `$DSH_HOME/memories`; atomic writes (temp + rename); no git dependency |
| developer-policy injection + `list`/`read`/`search`/`add_ad_hoc_note` | `systemPrompt.section` with a per-assembly provider + `memory_list`/`memory_read`/`memory_search`/`memory_add` |
| secret redaction, no-op gate, `v1` first-line protocol | kept: redaction on both input and output, empty-field no-op, exact `v1` first line |
| read-path usage telemetry (`usage.rs`) + `max_unused_days` | `memory_read`/`memory_search` usage records + `maxUnusedDays` candidates + `.retired/` archive |
| skills promotion in consolidation prompt | `PHASE2_TOOL` optional `skills`/`remove_skills` args, validated writes |

### Storage layout

```
<root>/
  memory_summary.md          always-injected navigation layer (first line exactly `v1`)
  MEMORY.md                  grep-friendly handbook: preferences, procedures, failure shields
  raw_memories.md            Phase 1 output awaiting consolidation
  raw_memories.archive.md    rotated history of consolidated raw blocks
  rollout_summaries/<slug>.md  per-session recaps with session id / cwd provenance
  rollout_summaries/.retired/  forgotten recaps (recoverable archive, never deleted)
  skills/<name>/SKILL.md     procedures promoted by consolidation (+ scripts/, templates/, examples/)
  logs/<stamp>-<stage>.json  run logs: every phase1 batch and phase2 call with full model output
  extensions/ad_hoc/notes/   user-requested ad hoc notes (memory_add)
```

### Bookkeeping

One KV record holds `{ processed: sessionId → claim, lastPhase1At, lastPhase2At, phase2Error,
pendingConsolidation, overrides, usage: path → {count, lastAt}, retiredAt: slug → timestamp }`.
Claims are `running | done | noop | failed(attempts)`, so a restart never re-extracts a session,
never re-runs consolidation inside the cooldown, and interrupted `running` claims recover as
failed after 30 minutes. Failed claims retry with exponential backoff and give up at
`retryLimit`. Writes are serialized through a promise chain; when the KV backend is unavailable
the store degrades to process-local state. `usage`/`retiredAt` are optional on load so archives
written by older versions keep loading.

### Scheduler

- Boot: one delayed pipeline run (4s), then once per root `agent/session-start` (throttled 60s).
- Every root `agent/turn-stopping`: debounced run (default 3 min) — the debounce is the
  "session idle long enough" gate that prevents summarizing active sessions.
- Phase 1 selects root sessions only (subagent sessions excluded), skips processed ones, ages
  out sessions older than `maxRolloutAgeDays`, extracts with bounded concurrency, then sets
  `pendingConsolidation`. Every batch writes a run log.
- Phase 2 runs after any successful extraction, pending flag, or unconsumed ad hoc notes,
  subject to the cooldown; failures record `phase2Error` and retry on the next scheduled window
  or manually. Every attempt (skipped/error/consolidated) writes a run log.
- Both runners expose `isRunning`; `get-state` reports it so the settings page keeps buttons
  disabled (and polls every 4 s) while the pipeline is genuinely in flight.

### Incremental extraction

Sessions grow after their first extraction, so claims carry a `lastSeq` watermark. A processed
session is re-checked no more often than `recheckIntervalMs` (default 30 min); when its log grew
by at least `minDeltaEvents` new rendered events, the delta is extracted into a new rollout part
(`<slug>-partN`) and appended to the raw queue. Legacy `noop` claims without a watermark get one
full re-extraction; legacy `done` claims only get their watermark baselined (their content is
already consolidated). The model input for a delta states explicitly that earlier content was
already processed.

### Structured tool-constrained output

Both phases constrain model output through the native function-calling channel
(`GenerateOptions.tools`): Phase 1 must call `memory_save` with `raw_memory`,
`rollout_summary`, `rollout_slug`; Phase 2 must call `memory_write` with `memory_md` and
`memory_summary_md` plus optional `skills` / `remove_skills` / `retire_summaries` arrays.
The plugin writes files itself; the model only fills structured arguments.
Free-text parsing remains as a fallback for models that ignore tool schemas. Phase 1 also
retries once with a halved transcript when output is truncated.

### Skill promotion

The consolidation prompt instructs the model to promote repeated, verifiable procedures into
`skills/<name>/SKILL.md` (YAML frontmatter + triggers/procedure/verification/pitfalls), with
optional supporting files under `scripts/`, `templates/`, `examples/`. Skill names are validated
against `[a-z0-9][a-z0-9-]{0,79}` and auxiliary paths against the allowed subdirectories before
any filesystem call; `remove_skills` deletes only validated skill directories. A failing skill
write is recorded (run log `skillErrors`) without failing the rest of the consolidation. The
existing `skills/` inventory is fed back into the model so updates merge instead of duplicating.
To make promoted skills load into sessions, the agent preset's `customSkillDirs` must reference
the memory `skills/` directory; the plugin never touches presets.

### Forgetting

Read-path usage is recorded per file when `memory_read` returns content or `memory_search`
surfaces hits (listing and injection are not usage, mirroring Codex read telemetry). Phase 2
annotates rollout summaries older than `maxUnusedDays` (default 30, 0 disables) since their last
activity as 「候选遗忘」and asks the model to compress/remove their MEMORY.md/summary entries and
list the retired slugs in `retire_summaries`. The plugin moves those files into
`rollout_summaries/.retired/` (recoverable; retired slugs stop appearing in the phase-2 index).
Forgetting is conservative by prompt construction: only explicitly annotated candidates may be
retired.

### Ad hoc notes

`memory_add` writes user-requested notes into `extensions/ad_hoc/notes/`; Phase 2 feeds every
unconsumed note into consolidation as the highest-priority evidence source (user self-reports
outrank inferred facts, and conflicting evidence is preserved with attribution on both sides).
Consumed notes are moved to `extensions/ad_hoc/archive/` after a successful consolidation.

## Security invariants

- Session content is rendered as data, never instructions: the extraction prompt states it, and
  the renderer strips everything except user/assistant text and tool call/result summaries.
- Secret redaction applies to the rendered transcript *and* to model output before either is
  written to disk: API keys, JWT, Bearer tokens, PATs, Slack tokens, PEM private keys, and
  `password/secret/token/api_key`-style assignments.
- Memory tools resolve paths inside the memory root only; traversal and absolute paths are
  rejected before any filesystem call.
- The consolidation prompt demands the exact `v1` first line and the plugin enforces it
  mechanically (`ensureSummaryV1`).
- Consolidation output is bounded by `phase2MaxTokens`; injected summaries by `maxSummaryChars`;
  transcripts by `maxTranscriptChars`; raw input by `maxRawChars`. Every model input has a cap.

## Failure modes and recovery

| Failure | Behavior |
| --- | --- |
| No model route | Pipeline skips with `skippedNoRoute`; no state damage; retried on next trigger |
| Extraction call fails | Claim marked failed with backoff; `retryLimit` attempts, then parked |
| Consolidation output malformed | Raw memories preserved, `phase2Error` recorded, pending flag kept |
| Consolidation output truncated | `finish_reason=length` inside the tool-call JSON: raised `phase2MaxTokens` (default 32768, cap 131072) + lenient block/JSON fallbacks + redacted model response in the run log; auto-retries pause after 3 consecutive failures (manual runs bypass) |
| Skill write invalid | That skill is skipped with the error in the run log; MEMORY.md/summary still land |
| Retire target missing | Skipped silently (ENOENT), no state change |
| Process restart mid-extraction | Orphaned `running` claims recover as failed and retry |
| KV backend missing | Claims stay process-local; pipeline still runs without cross-restart durability |
| Session log unreadable | That session's claim fails; other candidates unaffected |

## Coverage boundary

The plugin reads session logs through the public query surface and writes only inside its own
memory root. It does not modify session history, the agent preset, prompt templates, or other
plugins' storage. Extraction runs only for root (non-subagent) sessions; subagent work is
already summarized inside its parent's log. Model routing falls back to the deployment default
model (`agentDefaultModel`) when no dedicated route is configured. The client page is a
configuration and observation surface only; it does not gate any security boundary.

## Prior art

The two-phase pipeline, three-layer artifact layout, no-op gate, secret redaction, claims with
retry backoff, cooldown, skill promotion, read-path usage telemetry with a `max_unused_days`
forgetting threshold, and the `v1` summary protocol are adapted from the OpenAI Codex memories
system (audited via `codex-rs/memories`, `codex-rs/ext/memories`, `codex-rs/state`). Prompts and
code are written from scratch for DSH; no Codex implementation text is copied. The package
build chain follows the `@nanmicoder/dsh-auto-mode` layout, and the settings page pattern
follows the `@dsh-local/vision-bridge` plugin.
