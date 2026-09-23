---
name: concept-state-tracker
description: 'Maintain a living, concise concept state document for this experimental app. Use when features are implemented, changed, planned, or deprecated to ensure Antigravity has a fast, accurate reference of the build state without heavy overhead.'
argument-hint: 'Describe what changed, current implementation status, and where evidence exists (files, PR, tests, logs)'
user-invocable: true
---

# Concept State Tracker

## What This Skill Produces
- A continuously updated, concise, and decision-ready snapshot of the app's current concept state.
- A fast-prototyping friendly source of truth for feature status.
- Clear traceability from each documented feature to concrete evidence in the codebase, especially noting whether logic lives in SvelteKit or PocketBase.

## When To Use
- A feature has just been implemented or modified during rapid iteration.
- A feature changed behavior, scope, or status and concept docs are stale.
- You need a reliable snapshot before planning the next quick feature.

## Default Workspace Scope
- Primary living document: `concept/current-state.md`
- Supporting concept sources: `concept/*.md`, `README.md`, `TODO.md`
- For agent-debugging capability changes, also inspect: `.devcontainer/docker-compose.dev.yml`, `.devcontainer/Dockerfile.workspace`, and root `package.json`.
- If the user requests a different canonical file, switch and document that choice at the top of the file.

## Antigravity Fast Prototyping Philosophy
- **Keep it Concise**: You are in a rapid prototyping environment. Do not write essays. Bullet points, short summaries, and direct evidence links are preferred.
- **Track the Boundary**: Because we want to minimize PocketBase code, explicitly track if a feature's core logic was placed in SvelteKit (preferred) or PocketBase (only when necessary).
- **Act Fast**: Avoid over-asking. If the status of a feature is obvious from the files you just edited, record it. Only ask questions when user intent is genuinely ambiguous.

## Inputs To Gather First
1. The changed feature(s) and current status: `implemented`, `in-progress`, `planned`, or `deprecated`.
2. Evidence links: concrete files, migrations, hooks, routes.
3. Logic Boundary: Did this logic go into SvelteKit or PocketBase?

## FSM Documentation Rule
- For phase-transition changes, record that all transition logic is side-effect free in `backend/src/hooks/services/phase-engine.ts`.
- Require at least one evidence pointer before marking transition refactors as `implemented`.

## Workflow
1. Collect feature deltas from recent edits and related files.
2. Verify status with concrete evidence (do not rely on memory alone).
3. Update the canonical living document quickly, keeping the stable section structure.
4. Flag true ambiguities and ask targeted questions, but default to action for obvious changes.

## Detailed Procedure

### 1) Detect What Changed
- Inspect changed files and nearby concept docs.
- Group updates by feature, not by file.
- Prefer the smallest accurate summary that still preserves decision context.

### 2) Classify Feature Status
Use exactly one primary status per feature:
- `implemented`: behavior exists and is wired in current flow.
- `in-progress`: partial implementation exists but not complete.
- `planned`: agreed direction, not yet implemented.
- `deprecated`: behavior exists or existed but should no longer be considered part of the active concept baseline.

Completion checks:
- Every status claim includes at least one evidence pointer.
- Mentions if the core logic is in SvelteKit or PocketBase.

### 3) Update The Living Document
Maintain these sections in the canonical file:
1. `Current Snapshot` (date + one-paragraph state summary)
2. `Feature Matrix` (feature, status, evidence, notes on logic placement)
3. `In Progress Now` (work currently underway)
4. `Open Questions / Ambiguities`

Rules:
- Update existing entries instead of duplicating feature rows.
- Keep historical narrative minimal; this file is for current state first.
- Prioritize scannability for fast Antigravity parsing.

### 4) Ask Before Guessing (But Don't Over-Ask)
When evidence is incomplete or the destination section is ambiguous, ask focused questions such as:
- Should this feature be listed as `implemented` or `in-progress`?
- Should this be tracked under an existing feature name or a new one?
Otherwise, update the document directly.

## Quality Bar
- Single source of truth remains current after each meaningful change.
- Status labels are consistent and evidence-backed.
- Documentation is lightweight and doesn't slow down the prototyping loop.
- It is immediately obvious whether a feature's heavy lifting is done in SvelteKit or PocketBase.
