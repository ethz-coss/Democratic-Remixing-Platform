from __future__ import annotations

import random

from tooling.simulations.engine.config import BehaviorProfile
from tooling.simulations.engine.pb_client import PocketBaseClient
from tooling.simulations.engine.scenarios.convergence import ConvergenceScenario


def create_scenario(
    *,
    name: str,
    pb: PocketBaseClient,
    rng: random.Random,
    run_id: str,
    agent_count: int,
    max_steps: int,
    seed: int,
    llm_provider: str,
    llm_api_base: str,
    llm_model: str,
    llm_api_key: str | None,
    llm_temperature: float,
    llm_enabled: bool,
    time_min_hours: int,
    time_max_hours: int,
    time_long_jump_chance: float,
    time_long_jump_min_days: int,
    time_long_jump_max_days: int,
    target_duration_days: int,
    progress_every_steps: int,
    start_at: str | None,
    initial_solution_min_delay_days: int,
    initial_solution_max_delay_days: int,
    remix_probability: float,
    merge_probability: float,

    question_title_prefix: str = "",
    question_title_suffix: str = "",
    language: str = "de",
    question_id: str | None = None,
    question_config: dict | None = None,
    group_config: dict | None = None,
    behavior_profile: BehaviorProfile | None = None,
) -> ConvergenceScenario:
    if name == "convergence":
        return ConvergenceScenario(
            pb=pb,
            rng=rng,
            run_id=run_id,
            agent_count=agent_count,
            max_steps=max_steps,
            simulation_seed=seed,
            llm_provider=llm_provider,
            llm_api_base=llm_api_base,
            llm_model=llm_model,
            llm_api_key=llm_api_key,
            llm_temperature=llm_temperature,
            llm_enabled=llm_enabled,
            time_min_hours=time_min_hours,
            time_max_hours=time_max_hours,
            time_long_jump_chance=time_long_jump_chance,
            time_long_jump_min_days=time_long_jump_min_days,
            time_long_jump_max_days=time_long_jump_max_days,
            target_duration_days=target_duration_days,
            progress_every_steps=progress_every_steps,
            start_at=start_at,
            initial_solution_min_delay_days=initial_solution_min_delay_days,
            initial_solution_max_delay_days=initial_solution_max_delay_days,
            remix_probability=remix_probability,
            merge_probability=merge_probability,

            question_title_prefix=question_title_prefix,
            question_title_suffix=question_title_suffix,
            language=language,
            question_id=question_id,
            question_config=question_config,
            group_config=group_config,
            behavior_profile=behavior_profile or BehaviorProfile(),
        )
    raise ValueError(f"Unknown scenario: {name}")
