---
name: pocketbase-consistency
description: 'Keep PocketBase hooks and migrations minimal, consistent with newest PocketBase specs, and aligned with fast prototyping goals. Prioritize SvelteKit for business logic. Use when fixing hook/runtime errors, debugging migration failures, validating backend/frontend connectivity, or applying necessary schema changes.'
argument-hint: 'Describe the PocketBase change, target version, and any error log snippets'
user-invocable: true
---

# PocketBase Consistency

## What This Skill Produces
- A fast-prototyping mindset: minimal PocketBase hooks, with complex logic pushed to SvelteKit whenever possible.
- Hook changes that respect the existing `backend/src/hooks/*.pb.ts` structure without adding unnecessary complexity.
- Migration updates that apply cleanly and remain reversible.
- Error-driven fixes based on real logs and user comments, not guesswork.

## When To Use
- Aligning behavior to latest PocketBase docs or debugging hook errors in `backend/src/hooks/*.pb.ts`.
- Fixing migration failures in `backend/pb_migrations/*.js`.
- Refactoring backend behavior while keeping the PocketBase footprint as small as possible to prioritize speed of development.

## Fast Prototyping & Antigravity Philosophy
- **Minimize PocketBase Logic**: Treat PocketBase primarily as a fast data store. Prefer placing business rules, validation, and complex workflows into SvelteKit routes and server actions.
- **Keep Hooks Simple**: Only write PocketBase hooks when absolutely necessary (e.g., core domain constraints, phase-engine triggers, or strict security rules).
- **Avoid Premature Abstractions**: Keep the code small and MVP-friendly. If a request can be solved with less code in SvelteKit, choose that path over complex PB hooks.

## Inputs To Gather First
1. Confirm latest stable PocketBase from docs/releases (default behavior for this skill).
2. Exact error logs/snippets and user comments about expected behavior.
3. Scope of change: Should this actually be a PocketBase change, or can it be handled in SvelteKit?
4. Runtime reachability from workspace container: backend URL, frontend URL, and whether `dev:up` is running.

## Agent Debugging Capabilities (Workspace Container)
- Prefer service-DNS endpoints from inside the `workspace` container:
  - Backend: `http://pocketbase:8090` (or `$BACKEND_INTERNAL_URL`)
  - Frontend/SvelteKit dev server: `http://sveltekit-dev:5173` (or `$FRONTEND_INTERNAL_URL`)
- Use in-container HTTP tooling for fast debugging:
  - `curl -fsS "$BACKEND_INTERNAL_URL/api/health" | jq`
- Run migration safety checks from repo root:
  - `sh ./scripts/check-pocketbase-migrations.sh`
- If frontend endpoint checks fail, ask the user to start/restart services via the host task `dev:up` (Antigravity should not orchestrate compose from inside the workspace).

## Workflow
1. Confirm version + spec baseline.
2. Inspect existing local patterns before coding. Verify if the logic would be better placed in SvelteKit.
3. Draft minimal changes that preserve existing hook files and naming in `backend/src/hooks/`.
4. Implement necessary hook and/or migration updates.
5. Validate with project checks and error replay.
6. If errors remain, run a focused remediation loop from logs.

## FSM Transition Rule
- All state transition logic must remain side-effect free and be placed in the phase engine module.
- Use `backend/src/hooks/services/phase-engine.ts` as the only decision layer for phase changes.
- In hooks/routes, enforce `Fetch -> Evaluate -> Execute`:
  - Fetch all required records/counters first.
  - Evaluate transition decisions via phase engine functions only.
  - Execute only the minimal writes required by the decision output.

## Detailed Procedure

### 1) Confirm Spec Baseline & Versions
- **Server Executable Version:** `v0.39.8` (defined in `backend/Dockerfile`).
- **Client JS SDK Version:** `v0.27.0` (defined in `frontend/package.json` and `backend/package.json`).
- **Official Documentation:** Always refer to [PocketBase Documentation](https://pocketbase.io/docs/) and the [JS Hooks Overview](https://pocketbase.io/docs/js-overview/).
- **MCP Server Usage:** Always use the connected `pocketbase` MCP server tools (`get_collection_schema`, `query_collection`, `list_records`, `migrate_collection`, etc.) to inspect live schemas and collection structures before writing DB queries or migrations.
- **Hooks Syntax (v0.23+ / v0.39+):** Use top-level functions `onRecordCreateRequest(handler, "collection")`, `onRecordUpdateRequest(handler, "collection")`, `onRecordDeleteRequest(...)`, `routerAdd(method, path, handler)`. **Never use deprecated pre-v0.23 `$app.OnRecord...` syntax.**

### 2) Preserve Existing Project Structure
- Maintain the current high-level structure and organization of hooks in `backend/src/hooks/` (e.g., `problems.pb.ts`, `selection_phase.pb.ts`).
- Avoid merging or completely rewriting structure unless explicitly requested.
- Keep migration naming convention: `TIMESTAMP_description.js`.

### 3) Apply Hook Changes Safely (and Minimally)
- Ask yourself: "Is this hook necessary, or can SvelteKit do this?"
- Use request hooks when request context is needed (`onRecord*Request`).
- Ensure handlers call `e.next()` only when execution should continue.
- Keep syntax compatible with the PocketBase JS runtime (via TypeScript compilation) used in this repo.

### 4) Apply Migration Changes Safely
- Ensure each migration contains a single `migrate(up, down)` call.
- Keep up/down operations coherent; include down rollback by default.
- Prefer idempotent collection lookup/create patterns used in existing files.
- Avoid unsafe live-iteration removals when changing schema fields; use snapshot/reset patterns.

### 5) Validate In This Repo
- Run repo-relevant checks after edits:
  - `sh ./scripts/check-pocketbase-migrations.sh`
- Instruct the user to restart dev stack from tasks (`dev:restart`) to apply migrations cleanly.

### 6) Error-Driven Remediation Loop (Do Not Repeat Mistakes)
When an error is reported:
1. Capture exact log snippet and failing operation.
2. Verify against PocketBase docs before editing.
3. Apply one focused fix.
4. Re-run the closest validation command.
5. If still failing, use latest error output to adjust; do not re-apply the same failed strategy.
6. Append a short error-fix trail entry in task notes/PR notes.

## Quality Bar
- Fast, MVP-friendly implementations.
- PocketBase logic is strictly minimal; SvelteKit is the primary logic driver.
- Structure stays maintainable (split hooks preserved).
- Fixes are traceable to docs + log evidence.
- Migrations remain runnable and consistent.
