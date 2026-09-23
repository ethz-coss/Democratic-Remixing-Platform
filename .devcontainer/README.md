# DevContainer

We provide a fully configured VS Code DevContainer to ensure a consistent development environment across all machines.

## What's included

When you open this project in the DevContainer, Docker Compose automatically provisions:
1. **`workspace`**: A Node.js and Python container where your IDE runs. Includes all necessary tooling (`tsup`, `vitest`, `python`, etc.)
2. **`pocketbase`**: The backend API and database (`localhost:18090`).
3. **`sveltekit-dev`**: The frontend dev server (`localhost:13000`).

## How to use

1. Install Docker and VS Code.
2. Install the **Dev Containers** extension (`ms-vscode-remote.remote-containers`).
3. Open the project folder in VS Code.
4. Click **"Reopen in Container"** in the bottom right popup, or run the command from the Command Palette (`Ctrl/Cmd + Shift + P`).

Once inside the container, use the VS Code tasks (Terminal -> Run Task) to manage the stack:
- `dev:up` — Starts the backend and frontend services.
- `dev:down` — Stops the services.
- `dev:logs` — Streams logs for debugging.
