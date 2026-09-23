# Simulations

Multi-agent simulation engine for the Remix Platform. Populates PocketBase with realistic proposal authoring, remixing, merging, voting, and vote-migration behavior — used to stress-test convergence mechanics and generate demo data for human user trials.

> **Design document**: See [simulation_design.md](simulation_design.md) for architecture, calibration, and LLM integration details.
>
> **Evaluation guide**: See [../evaluation/README.md](../evaluation/README.md) for metrics, plots, bundles, and analysis workflows.

## Setup

1. Install dependencies:

```bash
cd simulations
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Ensure PocketBase is running and reachable (via `dev:up` from workspace root).

3. Create a local env file for credentials:

```bash
cp .env.example .env
# Fill in PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD
# Optional: GITHUB_TOKEN or GH_MODELS_TOKEN for LLM content generation
```

The CLI auto-loads env vars from:
- `/workspace/.env`
- `/workspace/simulations/.env` (takes precedence if a variable is not already exported)

## Quick Start

```bash
cd simulations

# Quick German demo — 10 agents, 7 days, no LLM costs:
python run.py --agents 10 --seed 42 --language de --disable-llm \
  --json-out output/demo_de.json

# LLM-powered German simulation — 50 agents, 14 days:
python run.py --agents 50 --seed 7 --language de \
  --json-out output/run_de.json

# English content mode:
python run.py --agents 20 --seed 7 --language en --disable-llm \
  --json-out output/run_en.json

# Full pipeline — simulate + evaluate + bundle:
./run_e2e_pipeline.sh

# Full pipeline without LLM costs:
./run_e2e_pipeline.sh --disable-llm
```

## Example Usages

### Generate German demo data for user testing

```bash
python run.py \
  --agents 30 \
  --seed 42 \
  --language de \
  --target-duration-days 14 \
  --remix-probability 0.15 \
  --merge-probability 0.10 \
  --run-id user_trial_01 \
  --json-out output/user_trial_01.json
```

Creates a 14-day simulation with 30 German-speaking agents producing proposals about fair WG cost-sharing. All titles, content, comments, and merge rationales will be in German.

### Quick dry-run to validate graph structure

```bash
python run.py \
  --agents 20 \
  --seed 99 \
  --disable-llm \
  --target-duration-days 7 \
  --max-steps 15 \
  --json-out output/dry_run.json
```

Uses deterministic fallback content (no API calls), runs fast. Useful for testing graph topology, vote migration, and merge mechanics.

### Batch experiments from YAML configs

```bash
# Run all YAML configs in configs/ with metrics and bundles:
python run_experiments.py --config-dir configs/ --compute-metrics --bundle

# Override agent count for all experiments:
python run_experiments.py --config-dir configs/ --agents 50 --disable-llm
```

### Set up local state for UI testing

```bash
# Seed 4 questions in different phases (AnswerSearch, Closing, Voting, Decided)
python generate_local_states.py --agents 15 --max-steps 10 --disable-llm
```

### Clean up simulation data

```bash
# Safely wipe only simulation data (keeps real user data intact)
python -m setup.cli cleanup
```

## CLI Reference

### Simulation (`engine/main.py`)

| Flag | Default | Description |
|------|---------|-------------|
| `--agents` | 50 | Number of simulated agents |
| `--seed` | 7 | Random seed for reproducibility |
| `--scenario` | `convergence` | Scenario name |
| `--run-id` | `seed_<seed>` | Unique run identifier (tagged in usernames/titles) |
| `--max-steps` | 30 | Maximum simulation steps |
| `--target-duration-days` | 14 | Simulated duration before auto-stop |
| `--json-out` | — | Write full JSON report to this path |
| `--start-at` | — | Initial simulated timestamp (ISO-8601) |
| `--cleanup-run-id` | — | Delete all artifacts for this run ID, then exit |

#### Language

| Flag | Default | Description |
|------|---------|-------------|
| `--language` | `de` | Content language: `de` (German) or `en` (English) |

Controls the language of all generated content: question title & description, proposal titles & bodies, remix change rationales, merge syntheses, and comments. Applies to both LLM-generated and deterministic fallback content.

#### LLM Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--llm-provider` | `github-models` | API provider |
| `--llm-api-base` | `https://models.github.ai/inference` | API endpoint |
| `--llm-model` | `openai/gpt-4.1-mini` | Model name |
| `--llm-api-key` | `$GITHUB_TOKEN` | API key (env fallback: `GH_MODELS_TOKEN`, `SIM_LLM_API_KEY`) |
| `--llm-temperature` | 0.7 | Generation temperature |
| `--disable-llm` | off | Skip all LLM calls, use deterministic fallbacks |

#### Behavior Tuning

| Flag | Default | Description |
|------|---------|-------------|
| `--branch-pressure` | 0.5 | How strongly agents prefer remixing vs. new roots |
| `--remix-probability` | 0.15 | Probability of remix action per decision |
| `--merge-probability` | 0.05 | Probability of merge action |

| `--discussion-agents` | 3 | Agents participating in each discussion step |
| `--initial-solution-min-delay-days` | 0 | Min delay before initial proposals |
| `--initial-solution-max-delay-days` | 0 | Max delay before initial proposals |
| `--question-title-prefix` | — | Prefix prepended to the question title |

#### Time Model

| Flag | Default | Description |
|------|---------|-------------|
| `--time-min-hours` | 1 | Min time jump per step |
| `--time-max-hours` | 24 | Max time jump per step |
| `--time-long-jump-chance` | 0.2 | Probability of multi-day gap |
| `--time-long-jump-min-days` | 1 | Min long-jump days |
| `--time-long-jump-max-days` | 4 | Max long-jump days |
| `--progress-every-steps` | 5 | Print progress snapshot every N steps |

#### Connection

| Flag | Default | Description |
|------|---------|-------------|
| `--base-url` | auto-discovered | PocketBase URL |
| `--admin-email` | `$PB_SUPERUSER_EMAIL` | Admin email |
| `--admin-password` | `$PB_SUPERUSER_PASSWORD` | Admin password |

### Multi-Experiment Runner (`run_experiments.py`)

```bash
# Run all experiments with default settings:
python run_experiments.py

# From YAML config directory:
python run_experiments.py --config-dir configs/

# With evaluation and bundling:
python run_experiments.py --compute-metrics --bundle

# Dry run with metrics:
python run_experiments.py --disable-llm --compute-metrics --bundle
```

| Flag | Description |
|------|-------------|
| `--config-dir` | Load YAML experiment configs from this directory |
| `--disable-llm` | Disable LLM for all experiments |
| `--compute-metrics` | Compute evaluation metrics after each run |
| `--bundle` | Create experiment bundle after each run |
| `--no-clean` | Skip database cleanup between runs |
| `--agents` | Override agent count for all experiments |
| `--seed` | Override seed for all experiments |

### YAML Experiment Config

Experiment configs live in `configs/` and follow this schema:

```yaml
experiment:
  name: "14-day convergence with 100 agents"
  description: "Convergence test with merge dynamics"
  run_id: "exp_01"
  label: "Exp 1"

  simulation:
    agents: 100
    seed: 42
    target_duration_days: 14
    max_steps: 120
    remix_probability: 0.15
    merge_probability: 0.10
    migration_move_probability: 0.5
    branch_pressure: 0.5
    initial_solution_min_delay_days: 0
    initial_solution_max_delay_days: 0
    progress_every_steps: 5
    language: "de"              # "de" or "en"

  llm:
    provider: "github-models"
    model: "openai/gpt-4.1-mini"
    temperature: 0.7
    enabled: true
    token_budget: 0             # 0 = unlimited

  pocketbase:
    base_url: "http://localhost:18090"
    admin_email: ""
    admin_password: ""
```

### Evaluation (`python -m evaluation.run_evaluation`)

See [../evaluation/README.md](../evaluation/README.md) for full CLI reference.

```bash
# Offline evaluation with metrics and bundle:
python -m evaluation.run_evaluation --json-result output/run.json --offline --compute-metrics --bundle

# Compare experiment bundles:
python -m evaluation.run_evaluation --compare output/experiments/exp_a_*/ output/experiments/exp_b_*/
```

## Architecture

```
simulations/
├── run.py                          # Entry point (delegates to simulations.main)
├── run_experiments.py              # Batch experiment runner
├── run_e2e_pipeline.sh             # Full simulate → evaluate → bundle pipeline
├── generate_local_states.py        # Generates multiple questions in different lifecycle phases
├── configs/                        # YAML experiment configurations
│   ├── day14_100agents.yaml
│   └── day30_100agents.yaml
│
├── ... (other dirs)
│
├── simulations/                    # Core simulation package
│   ├── main.py                     # CLI argument parsing & orchestration
│   ├── config.py                   # SimulationConfig dataclass
│   ├── models.py                   # Data models (SimUser, SimSolution, Report…)
│   ├── pb_client.py                # PocketBase REST client
│   ├── frontend_client.py          # SvelteKit frontend action client
│   ├── llm_client.py               # OpenAI-compatible LLM client
│   ├── cleanup.py                  # Run artifact cleanup
│   ├── quality_registry.py         # Proposal quality registry
│   ├── quality_model.py            # Latent quality assignment model
│   ├── time_model.py               # Simulated clock and time progression
│   ├── snapshot.py                 # Simulation state snapshot logic
│   ├── bootstrap.py                # Setup context and users
│   │
│   ├── agents/
│   │   ├── content_generator.py    # LLM-powered content generation (DE/EN)
│   │   ├── decision_engine.py      # Agent action decisions + 60 personas
│   │   ├── agent_memory.py         # Per-agent action history for LLM context
│   │   └── activity_model.py       # Time-of-day & attention decay model
│   │
│   ├── scenarios/
│   │   ├── registry.py             # Scenario factory
│   │   └── convergence.py          # Main convergence scenario
│   │
│   └── graph_engine/               # Graph analysis utilities
│       ├── clustering.py
│       ├── rules.py
│       └── simulator.py
│
├── evaluation/                     # Analysis & metrics pipeline
│   └── (see ../evaluation/README.md)
│
└── output/                         # Simulation outputs
    ├── *.json                      # Raw simulation reports
    ├── experiments/                # Experiment bundles
    └── analysis/                   # Analysis artifacts
```

### Data Flow

```
CLI args / YAML config
        ↓
  ConvergenceScenario
        ↓
  ┌─────────────────────────┐
  │ For each simulation step │
  │  ├─ AgentDecisionEngine  │  → picks action per agent (root, remix, merge, vote, comment)
  │  ├─ ContentGenerator     │  → LLM or fallback content in DE/EN
  │  └─ FrontendApiClient    │  → posts to SvelteKit server actions
  │        ↓                 │
  │     PocketBase           │  ← proposals, proposal_votes, proposal_comments
  └─────────────────────────┘
        ↓
  SimulationReport (JSON)
        ↓
  Evaluation pipeline → metrics, plots, bundles
```

### PocketBase Collections Used

| Collection | Purpose |
|---|---|
| `users` | Simulated user accounts |
| `questions` | Question definitions |
| `proposals` | Root proposals, remixes, and merges |
| `proposal_votes` | Support/oppose votes on proposals |
| `proposal_comments` | Comments on proposals |

| `action_logs` | Timeline of all agent actions |
| `solution_titles` | Title history tracking |

### Agent Personas

The simulation includes 60 diverse personas (defined in `engine/data/personas.json`) classified into archetypes that influence behavior:

- **Innovator** — proposes new roots, embraces novel approaches
- **Consensus Builder** — favors merges and compromise
- **Evaluator** — comments more, votes carefully
- **Practical Thinker** — remixes with pragmatic improvements
- **Balanced** — mixed behavior across all action types

### Agent Decision Model (CSS Grounding)

The agent decision loop uses a **Bounded-Attention Pool** model, structurally aligned with Carpentras et al. (2025) while introducing platform-specific attention routing based on Computational Social Science (CSS) literature:

1. **Fixed Session Budget:** Each agent logs in $K$ times (default $K \sim N(15, 3)$) and takes exactly 1 action per session, mirroring the fixed evaluation budget ($v=10$) in Carpentras (2025).
2. **Bounded Pool:** Agents evaluate a combined pool of ~11 unique candidates surfaced by the platform's three UI tabs (ForYou, Notifications, Ballot).
3. **Position-Weighted Selection:** The probability of selecting a target from the pool is modeled via attention weights:
   - **ForYou Feed:** Modeled with harmonic decay ($1/\text{rank}$) to account for strong **Position Bias** (Joachims et al. 2005; Craswell et al. 2008), where users scan ranked lists top-to-bottom.
   - **Siphon Notifications:** Weighted 3.0× as high-scent interrupts (Information Foraging Theory, Pirolli & Card 1999), reflecting the empirical 42% notification-to-migration conversion rate observed in the WG studies.
   - **Ballot:** Weighted 1.5× to reflect the visibility of explicit social signals (Salganik, Dodds & Watts 2006).
4. **Separation of Attention and Action:** Unlike the mathematical Carpentras model where utility dictates adoption, this engine separates the two. Utility (or UI bias) determines *Target Selection* (what the agent looks at), but the subsequent *Action Roll* (Vote, Remix, Merge) is driven by static global probabilities. This forces the algorithmic routing to shoulder the burden of convergence, isolating the platform's structural mechanics from mathematical assumptions.

This model ensures the simulation explicitly tests the platform's novel mechanisms against realistic cognitive limits (bounded rationality and limited attention) rather than assuming agents evaluate random proposals or have perfect visibility of the DAG. By default, `deterministic_target` is False, meaning these weights drive probabilistic selection rather than a deterministic override.

### The Dual-Agent Modeling System

The simulation engine implements two distinct agent tracks to isolate the platform's algorithmic routing from mathematical utility optimization.

1. **Attention-Driven Null Model (Studies 1–5):**
   Agents are entirely blind to objective quality. They select which proposals to interact with purely based on UI placement (Position Bias via the ForYou feed, Ballot visibility, and Siphon notifications). This tests the platform's organic capacity to route attention and filter noise using algorithms alone.
2. **Quality-Aware Model (Studies 6–10):**
   Agents perfectly match the theoretical behavior in Carpentras (2025). When an agent evaluates the candidates surfaced by the UI, they select a target based on the utility equation:
   $$u_i(s) = q(s) + \varepsilon_i(s)$$
   *(where $q(s)$ is the objective quality and $\varepsilon_i(s) \sim N(0, \sigma)$ is idiosyncratic personal noise).* This tests whether the UI algorithms successfully surface the mathematically optimal solutions to the agents.

### Latent Quality Assignment Rules

For Quality-Aware runs and post-hoc evaluation, objective quality $q(s)$ is deterministically assigned to the DAG topology:
- **Roots:** $q(s) = |N(0, 1)|$
- **Remixes:** $q(s) = \max(0, q(parent) + N(0, 0.5))$ (Incremental random walk)
- **Merges:** $q(s) = \max(parent_1, parent_2) + |N(0, 0.3)|$ (Synergistic combination)

### Algorithmic Scaling and Attention Scarcity

A key finding tested by **Study 5 vs. Study 10** is the limit of collective intelligence under attention scarcity. The Carpentras mathematical model assumes utility scales logarithmically with population size. However, the simulation proves that at high volumes (e.g., 200 agents producing 400+ proposals), default feed parameters fail due to **attention starvation**. 
To achieve the theoretical scaling limit, the algorithm's **Exploration** parameters (e.g., `unseenMultiplier`) must be cranked up (`max_exploration` configs) to artificially route the crowd to late-stage remixes that would otherwise be buried by filter bubbles.

### Experiment Suite Breakdown (168 Runs)

The simulation generates 12 distinct studies across 3 random seeds:

**Track 1: Algorithmic Engagement (Attention-Driven)**
- **S1 (OAT PersonalFocus):** Sensitivity analysis over 8 feed algorithm parameters (17 variations × 3 seeds = 51 runs). Evaluates exploration vs. exploitation trade-offs. *(Note: Runs as quality-aware to measure objective convergence).*
- **S2 (Ballot Variations):** Ablation of Ballot size (`maxSlots`) and inclusivity rules.
- **S3 (Dual-Window Ablation):** Isolates the impact of the PersonalFocus feed vs. Ballot visibility.
- **S4 (Siphon Ablation):** Turns off vote-migration notifications to test network bridging.
- **S5 (Null-Model Scaling):** Tests 10 to 200 agents with default feed settings to observe cognitive breakdown.

**Track 2: Quality-Aware Convergence (Carpentras Match)**
- **S6 (Quality Baseline):** The full platform running with Quality-Aware agents.
- **S7 (Attention Ablation):** Tests if Quality-Aware agents can succeed without the PersonalFocus feed sorting.
- **S8 (Siphon Ablation):** Tests if the migration prompt improves quality convergence.
- **S9 (Design Contract Ablation):** Removes Ballot diversity limits.
- **S10 (Quality-Aware Scaling):** Tests 10 to 200 agents with `max_exploration` feed settings to validate logarithmic utility scaling.
- **S11 (Quality-Aware No-PF Scaling):** Tests 10 to 200 agents with a random feed to show scaling degradation without algorithmic routing.
- **S12 (Quality-Aware Standard PF Scaling):** Tests 10 to 200 agents with default PersonalFocus weights to contrast against S10.

## Output Structure

```
output/
├── *.json                        # Raw simulation reports
├── plots/                        # Generated evaluation plots
│   └── <label>/
│       └── run_<timestamp>/
│           ├── support_timeline.png
│           ├── merge_progression.png
│           ├── participation_heatmap.png
│           ├── remix_graph.png
│           └── ...
└── experiments/                  # Self-contained experiment bundles
    └── <label>_<timestamp>/
        ├── config.yaml
        ├── report.json
        ├── metrics.json
        ├── summary.md
        ├── extracted/            # CSVs (proposals, votes, edges, actions)
        └── plots/                # All plots for this experiment
```

## Notes

- The simulation uses admin API access and writes records into your current PocketBase instance.
- GitHub Models API calls need a GitHub token with `models:read` scope and may be rate-limited.
- Run artifacts are tagged with a `run_id` inside titles and usernames.
- Default `run_id` is deterministic (`seed_<seed>`), so repeated runs on the same DB should pass a unique `--run-id`.
- LLM token usage is reported in the simulation summary and included in the JSON report.
- Use `--disable-llm` for cost-free dry runs that still produce realistic graph structures.
- Content language defaults to German (`de`) for user-testing scenarios with German-speaking participants.
- The convergence scenario uses a fixed WG (shared flat) cost-sharing question as the deliberation topic.
