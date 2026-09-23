# Backend — Remix Platform

This directory contains the runtime configuration, migrations, and business logic (hooks) for the [PocketBase](https://pocketbase.io/) (v0.39.8) backend driving the Remix Platform.

## Architecture

We keep PocketBase minimal and fast-prototyping friendly, implementing our custom business logic via TypeScript hooks.

- **`src/hooks/`**: TypeScript source for custom PocketBase behaviors (e.g., phases, voting rules, labels). 
  - Each domain has a top-level `*.pb.ts` entrypoint.
  - Logic is modularized into `services/` and `utils/`.
- **`src/migrations/`**: Database schema migrations written in TypeScript.
- **`pb_hooks/` & `pb_migrations/`**: Compiled CommonJS output executed by the PocketBase JS VM. **Do not edit these manually.**
- **`Dockerfile`**: A multi-stage build that compiles the TypeScript code and bundles it into a production-ready PocketBase Alpine image.

## Development Workflow

PocketBase reads from the compiled `pb_hooks` and `pb_migrations` directories, so you must compile your TypeScript source code during development.

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Watch mode (Development):**
   Run the `tsup` compiler in watch mode to auto-rebuild on file changes:
   ```bash
   npm run dev:hooks
   npm run dev:migrations
   # Or run both:
   npm run dev
   ```

3. **Typechecking:**
   ```bash
   npm run typecheck
   ```

## Key Files

- `src/hooks/services/phase-engine.ts`: Core side-effect-free state evaluation.
- `src/hooks/services/ballot-engine.ts`: Logic for ballot finalization.
- `ci/types.d.ts`: Comprehensive type definitions for PocketBase internals.

## Adding New Migrations

1. Create a new file in `src/migrations/` (e.g., `1787500000_new_feature.pb.ts`).
2. Follow the existing template structure.
3. Ensure it is built (via `npm run build:migrations` or the watch task).
4. PocketBase will automatically apply the migration when the service restarts.
