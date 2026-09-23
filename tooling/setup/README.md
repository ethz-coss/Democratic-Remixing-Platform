# Study Setup CLI

The `setup` package contains the core logic for bootstrapping test environments, user study cohorts, and pre-configured showcase scenarios on the Remix Platform. It connects to a target PocketBase instance and predictably populates it with users, groups, and questions.

## Architecture

* `core.py`: Atomic, idempotent helper functions to interact with PocketBase (create users, groups, memberships, phase transitions, and voting actions).
* `scenarios.py`: High-level scenario definitions orchestrating `core.py` functions (e.g. `setup_office_study`, `setup_showcase_group`).
* `cli.py`: The single command-line interface entry point wrapping the scenarios.

## Usage

You can run the setup scripts securely either against your local development environment or an online production/staging server.

```bash
# Basic usage pointing to the default local dev container (http://localhost:18090)
python -m setup.cli <scenario_name>
```

### Available Scenarios

#### 1. `office_study`
Generates groups and users for a controlled user study.
- Provisions 6 discrete focus groups.
- Creates test participants associated with those groups.
- Initializes questions about AI adoption in office workspaces.

#### 2. `showcase_group`
Sets up a public demonstration group ("The Remix Platform Showcase").
- Creates standard test users (Alice, Bob, Charlie).
- Ideal for quick local testing of the UI.

#### 3. `fresh_ideation`
A minimal bootstrap setup.
- Wipes all previous simulated data.
- Sets up a fresh "Simulations" group with 4 user agents (Alice, Bob, Clara, David).
- Seeds a default question for the agent swarm to discuss.

#### 4. `cleanup`
A destructive (but sandboxed) wipe of simulation data.
- **List mode:** Running `python setup/cli.py cleanup` without arguments will list all available groups.
- **Scoped Wipe:** Use `python setup/cli.py cleanup --group-name "My Group"` to safely delete a specific group and its questions without affecting the simulated users or other groups.

#### 5. `custom`
Set up a custom study by providing a JSON configuration file. This is the **primary recommended way** to generate custom studies for simulations or manual user trials.

**Usage:**
```bash
python setup/cli.py custom --json-path setup/my_study.json
```

**Template:**
A ready-to-use template is available at [`setup/study_template.json`](file:///home/nick/Nextcloud/ETH/master/Master_Thesis/code/remix_platform/setup/study_template.json). Copy this file and adjust the parameters (group name, question title, durations) to fit your needs.

## Connecting to Online Environments

The CLI supports standard arguments to target remote servers. Pass your PocketBase URL and admin credentials via flags:

```bash
python -m setup.cli showcase_group \
  --base-url "https://api.your-production-url.com" \
  --admin-email "admin@example.com" \
  --admin-password "secret123"
```

*Alternatively, the CLI will automatically pick up `PRIVATE_POCKETBASE_URL`, `PB_SUPERUSER_EMAIL`, and `PB_SUPERUSER_PASSWORD` from your `.env` file.*
