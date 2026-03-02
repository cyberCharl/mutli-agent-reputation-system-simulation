# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex, etc.) when working with code in this repository.

## Overview

Multi-Agent Reputation System Simulation — a TypeScript research framework studying reputation dynamics in LLM-to-LLM negotiations using the MSPN hypergame.

**Core research question:** Does reputation visibility change agent behavior in mixed-motive multi-agent settings?

## Development Practices

### Frequent Commits

- Commit after each logical unit of work (not once at the end)
- Write descriptive commit messages explaining what changed and why
- Run tests before committing: `npm test`
- Keep commits atomic — one concern per commit

### Code Style

- TypeScript strict mode enabled
- Use existing patterns from the codebase
- Prefer functional style where appropriate
- All new code must be testable

## Agent Progress Notes Standard

After finishing and verifying a piece of work, create a markdown file in `agent-notes/` for agent-only handoff notes.

- Follow the format documented in `agent-notes/README.md`.
- Create one note file per session/milestone: `YYYY-MM-DD-<branch-or-topic>.md`.
- Notes are for agents only: include implementation log, decision log, validation commands/results, blockers, and next steps.

## Project Structure

```
src/
├── game.ts           # MSPN game logic, belief updates
├── agent.ts          # LLM agent wrapper, mock fallback
├── reputation.ts     # Karma system and consequences
├── simulator.ts      # A/B test runner, parallel execution
├── compare.ts        # Model-vs-model comparison
├── stats.ts          # Statistical significance (t-test, bootstrap CI)
├── visualize.ts      # HTML dashboard generation
├── karma/storage.ts  # Persistent karma (atomic JSON writes)
├── types.ts          # Type definitions
├── prompts.ts        # LLM prompt templates
├── schemas.ts        # Zod schemas for structured output
└── openrouter.ts     # OpenRouter API client

agent-notes/          # Agent-to-agent handoff notes
data/                 # Persistent karma storage
results/              # Simulation run outputs
tests/                # Jest test suites
```

## Commands

```bash
npm run dev           # Run simulation (100 episodes, mock agents)
npm run test          # Run all tests
npm run compare       # Compare models head-to-head
npm run visualize     # Generate HTML dashboard from results
```

## Roadmap

See `PLAN-ENHANCEMENTS.md` for the prioritized implementation roadmap covering observability, multi-agent support, evaluation hardening, and statistical rigor.
