"""Preset configurations for the unified seed_states runner.

Each preset defines the parameters needed to seed one or more questions
into PocketBase, optionally advancing them through phases.

Adding a new preset is all that's needed to support a new simulation
scenario — no new scripts required.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

from tooling._paths import SETUP_CONFIGS, SIMULATIONS_OUTPUT


@dataclass
class SeedPreset:
    """A single seeding preset."""
    name: str
    description: str
    # Phase sequence to seed (one question per phase)
    phases: list[str] = field(default_factory=lambda: ["AnswerSearch"])
    # Default simulation parameters
    agents: int = 15
    max_steps: int = 10
    target_duration_days: float = 999
    phase_duration_days: float = 3.0
    seed_offset: int = 0
    # Optional JSON config path (for group/question config)
    config_path: Optional[str] = None
    # Title prefix template ({phase} is replaced)
    title_prefix: str = "[{phase}] "
    # Whether to disable LLM by default
    disable_llm: bool = True
    # Language
    language: str = "de"


# ── Built-in presets ─────────────────────────────────────────────────────

PRESETS: dict[str, SeedPreset] = {
    "local": SeedPreset(
        name="local",
        description="4 questions in different lifecycle phases (AnswerSearch→Decided)",
        phases=["AnswerSearch", "Closing", "Voting", "Decided"],
        agents=15,
        max_steps=10,
        target_duration_days=999,
        phase_duration_days=3.0,
        title_prefix="[{phase}] ",
    ),
    "wg_study": SeedPreset(
        name="wg_study",
        description="WG study group: single AnswerSearch question with 14-day sim",
        phases=["AnswerSearch"],
        agents=80,
        max_steps=40,
        target_duration_days=14,
        phase_duration_days=7.0,
        seed_offset=1000,
        config_path=os.path.join(SETUP_CONFIGS, "wg_study.json"),
        title_prefix="[WG-Study {phase}] ",
    ),
    "fast_test": SeedPreset(
        name="fast_test",
        description="Single question with ultra-short phase deadlines (4 min each) for testing",
        phases=["AnswerSearch"],
        agents=0,  # No simulation agents — just creates the question
        max_steps=0,
        target_duration_days=1,
        title_prefix="[Fast Test] ",
    ),
}


# ── Custom demos preset (batch of 6 runs via subprocess) ─────────────────

@dataclass
class BatchRunConfig:
    """One run inside a batch preset (e.g. custom_demos)."""
    label: str
    args: list[str]


CUSTOM_DEMO_RUNS: list[BatchRunConfig] = [
    # German
    BatchRunConfig("DE Early (Day 7)", [
        "--agents", "80", "--seed", "101", "--language", "de",
        "--run-id", "de_early_7d", "--target-duration-days", "7", "--max-steps", "20",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.10", "--merge-probability", "0.0",
        "--migration-move-probability", "0.5", "--progress-every-steps", "3",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "de_early_7d.json"),
    ]),
    BatchRunConfig("DE Mid (Day 14)", [
        "--agents", "80", "--seed", "202", "--language", "de",
        "--run-id", "de_mid_14d", "--target-duration-days", "14", "--max-steps", "40",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.20", "--merge-probability", "0.08",
        "--migration-move-probability", "0.6", "--progress-every-steps", "5",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "de_mid_14d.json"),
    ]),
    BatchRunConfig("DE Late (Day 30)", [
        "--agents", "80", "--seed", "303", "--language", "de",
        "--run-id", "de_late_30d", "--target-duration-days", "30", "--max-steps", "100",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.25", "--merge-probability", "0.15",
        "--migration-move-probability", "0.7", "--progress-every-steps", "10",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "de_late_30d.json"),
    ]),
    # English
    BatchRunConfig("EN Early (Day 7)", [
        "--agents", "80", "--seed", "401", "--language", "en",
        "--run-id", "en_early_7d", "--target-duration-days", "7", "--max-steps", "20",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.10", "--merge-probability", "0.0",
        "--migration-move-probability", "0.5", "--progress-every-steps", "3",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "en_early_7d.json"),
    ]),
    BatchRunConfig("EN Mid (Day 14)", [
        "--agents", "80", "--seed", "502", "--language", "en",
        "--run-id", "en_mid_14d", "--target-duration-days", "14", "--max-steps", "40",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.20", "--merge-probability", "0.08",
        "--migration-move-probability", "0.6", "--progress-every-steps", "5",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "en_mid_14d.json"),
    ]),
    BatchRunConfig("EN Late (Day 30)", [
        "--agents", "80", "--seed", "603", "--language", "en",
        "--run-id", "en_late_30d", "--target-duration-days", "30", "--max-steps", "100",
        "--initial-solution-min-delay-days", "0", "--initial-solution-max-delay-days", "0",
        "--remix-probability", "0.25", "--merge-probability", "0.15",
        "--migration-move-probability", "0.7", "--progress-every-steps", "10",
        "--question-title-prefix", "", "--disable-llm",
        "--json-out", os.path.join(SIMULATIONS_OUTPUT, "en_late_30d.json"),
    ]),
]
