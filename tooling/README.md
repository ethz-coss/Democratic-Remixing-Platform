# Tooling

This directory contains all offline and out-of-band tools for the Remix Platform. It is divided into four distinct subsystems.

## 1. Simulation Engine (`tooling/simulations/`)
A multi-agent computational simulation engine. It generates synthetic groups, questions, and participant actions (proposals, remixes, votes) to stress-test platform mechanics and convergence algorithms at scale. Agents are powered by LLMs to produce realistic natural-language text.

*See [`tooling/simulations/README.md`](simulations/README.md) for details on running simulations.*

## 2. Evaluation Pipeline (`tooling/evaluation/`)
Tools to extract raw telemetry and data from PocketBase, compute quantitative metrics, and generate plots. Works seamlessly on both simulated data and real human trials.

*See [`tooling/evaluation/README.md`](evaluation/README.md) for details on data extraction and analysis.*

## 3. Study Setup (`tooling/setup/`)
A CLI for bootstrapping deterministic scenarios, focus groups, and public showcases. Used to prepare the platform database for live human trials or clean baseline states.

*See [`tooling/setup/README.md`](setup/README.md) for available setup commands.*

## 4. Operational Scripts (`tooling/scripts/`)
Miscellaneous CI and orchestration scripts:
- `run_all_experiments.sh`: Batch runner for large computational sweeps.
- `run_pending.sh`: Resumer script for interrupted simulation batches.
- `check-pocketbase-migrations.sh`: Integrity checker for database migrations.

## Common Paths (`tooling/_paths.py`)
All scripts in the `tooling/` directory rely on `_paths.py` for absolute path resolution to output directories and the `experiment_data/` bundle.
