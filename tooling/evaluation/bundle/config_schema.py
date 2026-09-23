"""Structured experiment configuration for reproducible simulation runs.

Defines the schema for YAML-based experiment configs, replacing the
hardcoded dicts in ``run_experiments.py``.

Usage::

    from tooling.evaluation.bundle.config_schema import ExperimentConfig, load_config

    config = load_config("configs/day30_100agents.yaml")
    print(config.simulation.agents)
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any

import yaml


@dataclass
class SimulationConfig:
    """Parameters controlling the simulation engine."""
    agents: int = 50
    seed: int = 42
    target_duration_days: int = 30
    max_steps: int = 200
    remix_probability: float = 0.15
    merge_probability: float = 0.05
    migration_move_probability: float = 0.8
    branch_pressure: float = 0.5
    initial_solution_min_delay_days: int = 0
    initial_solution_max_delay_days: int = 0
    progress_every_steps: int = 5
    language: str = "de"  # "de" or "en"


@dataclass
class LLMConfig:
    """Parameters controlling LLM-powered content generation."""
    provider: str = "github-models"
    model: str = "openai/gpt-4.1-mini"
    temperature: float = 0.7
    enabled: bool = True
    token_budget: int = 0  # 0 = unlimited


@dataclass
class PocketBaseConfig:
    """Connection details for PocketBase."""
    base_url: str = "http://localhost:18090"
    admin_email: str = ""
    admin_password: str = ""


@dataclass
class ExperimentConfig:
    """Top-level experiment configuration."""
    name: str = ""
    description: str = ""
    run_id: str = ""
    label: str = ""
    simulation: SimulationConfig = field(default_factory=SimulationConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    pocketbase: PocketBaseConfig = field(default_factory=PocketBaseConfig)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_config(path: str) -> ExperimentConfig:
    """Load an experiment config from a YAML file."""
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}

    exp = raw.get("experiment", raw)
    sim_raw = exp.get("simulation", {})
    llm_raw = exp.get("llm", {})
    pb_raw = exp.get("pocketbase", {})

    return ExperimentConfig(
        name=exp.get("name", ""),
        description=exp.get("description", ""),
        run_id=exp.get("run_id", ""),
        label=exp.get("label", ""),
        simulation=SimulationConfig(**{
            k: v for k, v in sim_raw.items()
            if k in SimulationConfig.__dataclass_fields__
        }),
        llm=LLMConfig(**{
            k: v for k, v in llm_raw.items()
            if k in LLMConfig.__dataclass_fields__
        }),
        pocketbase=PocketBaseConfig(**{
            k: v for k, v in pb_raw.items()
            if k in PocketBaseConfig.__dataclass_fields__
        }),
    )


def load_configs_from_dir(config_dir: str) -> list[ExperimentConfig]:
    """Load all YAML configs from a directory, sorted by filename."""
    configs: list[ExperimentConfig] = []
    for fname in sorted(os.listdir(config_dir)):
        if fname.endswith((".yaml", ".yml")):
            configs.append(load_config(os.path.join(config_dir, fname)))
    return configs


def save_config(config: ExperimentConfig, path: str) -> None:
    """Save an experiment config to a YAML file."""
    data = {"experiment": config.to_dict()}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


def config_from_legacy(
    run_id: str,
    label: str,
    days: int,
    agents: int,
    seed: int,
    base_url: str = "http://localhost:18090",
    admin_email: str = "",
    admin_password: str = "",
    disable_llm: bool = False,
) -> ExperimentConfig:
    """Create an ExperimentConfig from the old run_experiments.py style."""
    return ExperimentConfig(
        name=label,
        description=f"Simulation: {agents} agents, {days} days",
        run_id=run_id,
        label=label,
        simulation=SimulationConfig(
            agents=agents,
            seed=seed,
            target_duration_days=days,
        ),
        llm=LLMConfig(enabled=not disable_llm),
        pocketbase=PocketBaseConfig(
            base_url=base_url,
            admin_email=admin_email,
            admin_password=admin_password,
        ),
    )


def diff_configs(a: ExperimentConfig, b: ExperimentConfig) -> dict[str, tuple[Any, Any]]:
    """Return a dict of fields that differ between two configs.

    Returns ``{field_path: (value_a, value_b)}`` for each difference.
    """
    diffs: dict[str, tuple[Any, Any]] = {}

    def _compare(prefix: str, d1: dict, d2: dict) -> None:
        all_keys = set(d1.keys()) | set(d2.keys())
        for key in sorted(all_keys):
            v1, v2 = d1.get(key), d2.get(key)
            full_key = f"{prefix}.{key}" if prefix else key
            if isinstance(v1, dict) and isinstance(v2, dict):
                _compare(full_key, v1, v2)
            elif v1 != v2:
                diffs[full_key] = (v1, v2)

    _compare("", a.to_dict(), b.to_dict())
    return diffs
