# Synesis - Democratic Remix Platform

A scalable democratic co-creation platform designed to overcome the friction of traditional deliberation. Built for the Master's Thesis: *"Remixing for Democratic Collective Intelligence: Design and Implementation of a Scalable Platform"*.

## Architecture

This repository is structured into 5 main parts:

1. **`frontend/`**: The web application (Svelte 5 / SvelteKit).
2. **`backend/`**: The data layer and business logic (PocketBase / TypeScript).
3. **`tooling/`**: The multi-agent simulation engine, study setup CLI, and evaluation pipeline (Python).
4. **`experiment_data/`**: The self-contained raw data bundle for thesis reproducibility.
5. **`thesis/`**: The written thesis and presentation.

## Thesis and Citation

The academic framing, design rationale, and empirical evaluation of this platform can be found in the `thesis/` directory.

```bibtex
@mastersthesis{bachmann2026remix,
  author  = {Bachmann, Yanick},
  title   = {Remixing for Democratic Collective Intelligence: Design and Implementation of a Scalable Platform},
  school  = {ETH Z\"{u}rich},
  year    = {2026},
  type    = {Master's Thesis}
}
```

## Development Setup

The preferred local development environment uses VS Code DevContainers.

1. Clone the repository.
2. Open the folder in VS Code.
3. When prompted, click **Reopen in Container**.
4. The backend watcher starts automatically. Open the VS Code task menu (`Cmd/Ctrl + Shift + P` -> `Tasks: Run Task`) and run:
   - `frontend:dev (in devcontainer)` (Starts the SvelteKit development server)

*(Note: The PocketBase container is automatically started by the DevContainer configuration. You do not need to run Docker commands manually inside the container).*

Once running, the stack is available at:
- **Frontend App:** `http://localhost:5173` (VS Code forwards this port automatically)
- **PocketBase Admin:** `http://localhost:18090/_/`

### Alternative: Local Docker Compose (No DevContainer)

If you prefer not to use DevContainers, you can run the entire stack on your host machine using the provided VS Code tasks:
1. Open the folder in VS Code locally.
2. Run the `dev:up` task to build and start both the `pocketbase` and `sveltekit-dev` containers.
3. Run the `dev:logs` task to tail the logs.

Once running via this alternative method, the stack is available at:
- **Frontend App:** `http://localhost:5173`
- **PocketBase Admin:** `http://localhost:18090/_/`

### First-Time Setup (Creating Accounts)

When you spin up the platform for the very first time, the database will be entirely empty. You must create an admin account and a user account before you can log into the frontend.

1. **Create the PocketBase Admin (Superuser):**
   - For security, PocketBase v0.23+ generates a one-time secure setup URL. You cannot simply go to `http://localhost:18090/_/` directly.
   - Open a terminal and find the logs of the `pocketbase` dev container.
   - **Search the logs for this exact string:** `/#/pbinstall/`
   - You will find a link that looks like this: `http://0.0.0.0:8090/_/#/pbinstall/eyJhb...`
   - Copy that long URL and paste it into your browser, but **change `0.0.0.0:8090` to `localhost:18090`**.
   - Press enter. This will open the initial admin creation screen where you can set your email and password.
2. **Create a User:**
   - While still in the PocketBase Admin UI, navigate to the **`users`** collection on the left sidebar.
   - Click the **New record** button in the top right.
   - Fill in an `email`, `password`, and `passwordConfirm`. 
   - Set the `role` field (choose `admin` for full platform access or `participant` for a standard user).
   - Click **Create** to save the user.
3. **Log into the Frontend:**
   - Open the Frontend App (`http://localhost:5173`).
   - Log in using the **Remix Platform User** credentials you just created in step 2 (not your PocketBase superuser).

## Experiment Data & Reproducibility

The `experiment_data/` directory contains all final raw data needed to reproduce every derived result in the thesis (simulation figures, study analyses, and evaluation metrics). No live PocketBase instance or re-running of simulations is required.

**Regenerate derived outputs:**

```bash
# Recompute aggregated metrics from raw JSONs
python -m tooling.simulations.experiments.collector

# Regenerate all 72 publication figures
python -m tooling.simulations.experiments.analysis

# Run a study analysis notebook
jupyter notebook tooling/evaluation/notebooks/wg_netz_study_analysis.ipynb
```
See `experiment_data/README.md` for full details.

## Deployment

The production deployment uses Docker Compose to orchestrate PocketBase, SvelteKit, and Caddy (for automatic HTTPS). Of course you need to put int your own passwords and info.

```bash
cp .env.production.template .env.production
# Edit .env.production with your domain and secrets

# Build images
docker compose -f docker-compose.prod.yml build

# Start the stack
docker compose -f docker-compose.prod.yml up -d
```

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the [LICENSE](LICENSE) file for details.
