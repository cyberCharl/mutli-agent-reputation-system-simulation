# Agent Notes Standard (v1)

This folder is for **agent-to-agent handoff notes only**.
Notes should optimize for quick continuation by another coding agent.

## File naming

`YYYY-MM-DD-<branch-or-topic>.md`

Example: `2026-02-12-p01-observability-implementation.md`

## Required sections (agent-focused)

1. `Session Metadata`
- Date/time
- Branch
- Base branch used for comparison
- Current repo state (`git status` summary)

2. `Objective and Scope`
- What was requested
- In-scope vs out-of-scope items handled

3. `Implementation Log`
- Ordered list of concrete changes
- File paths and key behavior deltas

4. `Decision Log`
- Important decisions made
- Defaults/weights/constants chosen
- Migration/tooling decisions

5. `Validation Log`
- Exact commands run
- Results
- Blockers and environmental constraints

6. `Handoff`
- Remaining risks
- Pending work
- Suggested next command(s)

## Writing rules

- Write for another agent, not for end users.
- Prefer operational detail over narrative.
- Include exact paths and command lines.
- Record blockers immediately when discovered.
- Keep entries append-only within a session file (no history rewriting).
