# AGENTS.md

Instructions for coding agents working in this repo (Kite Aurora algorithmic trading terminal).

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (one `CONTEXT.md` + `docs/adr/` at root). See `docs/agents/domain.md`.

## Skill usage rules (mattpocock/skills)

All 37 skills from `mattpocock/skills` are installed project-local in `.agents/skills/`. Refer to them on every development task:

- **Before building anything**: `/grill-with-docs` (or `/grill-me` for non-code) to align on the plan and sharpen `CONTEXT.md`/ADRs. Never skip grilling on non-trivial changes.
- **Large work**: `/wayfinder` for multi-session maps, then `/to-spec` + `/to-tickets` (writes to `.scratch/`) to break it into tracer-bullet tickets.
- **Implementing**: `/implement` a spec/ticket set, driving `/tdd` (red-green-refactor) at pre-agreed seams, closing with `/code-review` (Standards + Spec axes) before committing.
- **Bugs/perf**: `/diagnosing-bugs` loop (repro → minimise → hypothesise → instrument → fix → regression test).
- **Design health**: `/codebase-design` vocabulary for deep modules; run `/improve-codebase-architecture` every few days.
- **Research**: `/research` to background-agent primary-source investigation, saved as cited Markdown in the repo.
- **Conflicts**: `/resolving-merge-conflicts` hunk-by-hunk, never `--abort`.
- **Questions for humans**: `/to-questionnaire` for async decisions; `/wait-what` the moment a message doesn't land.
- **Router**: `/ask-matt` when unsure which skill/flow fits.

Model-invoked helpers (`tdd`, `code-review`, `diagnosing-bugs`, `research`, `domain-modeling`, `codebase-design`, `prototype`, `wizard`, `grilling`, `writing-for-agents`) apply automatically when the task fits — invoke them proactively, don't wait to be asked.

## Repo notes

- Monorepo: `services/*` (market-data, fundamentals, news, algorithm-engine, executor, api, shared) + `frontend`. See `TECHNICAL_DOCUMENTATION.md`.
- Typecheck: `npm run typecheck`. Dev: `scripts/run-all.ps1`.
- Full technical reference: `TECHNICAL_DOCUMENTATION.md`.
