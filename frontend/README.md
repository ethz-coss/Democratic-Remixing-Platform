# Frontend — Remix Platform

The user interface for the Remix Platform, built with Svelte 5 (Runes) and SvelteKit.

## Tech Stack

- **Framework**: SvelteKit
- **Reactivity**: Svelte 5 (using `$state`, `$derived`, `$effect`)
- **Styling**: Tailwind CSS
- **Data Fetching**: PocketBase JS SDK
- **i18n**: Paraglide JS

## Structure

```
frontend/
├── src/
│   ├── lib/              # Reusable components, state, and utilities
│   │   ├── components/   # UI components
│   │   ├── server/       # Server-only utilities (PocketBase auth)
│   │   ├── stores/       # Application state
│   │   └── paraglide/    # Generated i18n messages
│   └── routes/           # SvelteKit routing
│       ├── admin/        # Platform administration dashboard
│       ├── ballot/       # Voting and ranking interfaces
│       ├── discourse/    # Discussion and remixing interfaces
│       ├── groups/       # Group and question lists
│       ├── login/        # Authentication
│       └── ...
└── static/               # Public assets
```

## Development

The frontend is tightly coupled to the PocketBase backend. Always run the full stack via the `dev:up` task in the workspace root.

If you need to run frontend-specific checks:

```sh
# Type checking
npm run check

# Linting
npm run lint

# Testing
npm run test
```

## Internal API Routing

The frontend acts as a proxy for the PocketBase backend. API requests to `/api/*` are handled in `src/hooks.server.ts` or directly proxied via Caddy in production, ensuring the browser never needs to talk directly to PocketBase, masking the backend architecture.
