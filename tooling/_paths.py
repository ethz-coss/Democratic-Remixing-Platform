"""Centralised path constants for all tooling pipelines.

Every script should import paths from here instead of computing them
with os.path.dirname(__file__) chains.
"""
from __future__ import annotations

import os

TOOLING_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOLING_ROOT)

# ── Output directories (all gitignored) ──────────────────────────────────
OUTPUT_ROOT = os.path.join(TOOLING_ROOT, "output")
SIMULATIONS_OUTPUT = os.path.join(OUTPUT_ROOT, "simulations")
EXPERIMENTS_OUTPUT = os.path.join(OUTPUT_ROOT, "experiments")
EXPORTS_OUTPUT = os.path.join(OUTPUT_ROOT, "exports")
PLOTS_OUTPUT = os.path.join(OUTPUT_ROOT, "plots")

# ── Canonical data bundle (committed to git) ─────────────────────────────
DATA_ROOT = os.path.join(PROJECT_ROOT, "experiment_data")
HUMAN_STUDIES_DATA = os.path.join(DATA_ROOT, "human_studies")
SIM_EXPERIMENTS_DATA = os.path.join(DATA_ROOT, "simulation_experiments")


# ── Config directories ───────────────────────────────────────────────────
SETUP_CONFIGS = os.path.join(TOOLING_ROOT, "setup", "configs")
SIM_CONFIGS = os.path.join(TOOLING_ROOT, "simulations", "configs")

# ── Convenience ──────────────────────────────────────────────────────────
BACKEND_ROOT = os.path.join(PROJECT_ROOT, "backend")
FRONTEND_ROOT = os.path.join(PROJECT_ROOT, "frontend")


def ensure_output_dirs() -> None:
    """Create all output directories if they don't exist."""
    for d in (OUTPUT_ROOT, SIMULATIONS_OUTPUT, EXPERIMENTS_OUTPUT,
              EXPORTS_OUTPUT, PLOTS_OUTPUT):
        os.makedirs(d, exist_ok=True)
