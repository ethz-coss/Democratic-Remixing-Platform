from __future__ import annotations

import argparse
import json
import os
import random
import sys

from tooling.simulations.engine.config import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_LLM_API_BASE,
    BehaviorProfile,
    SimulationConfig,
    env_default_base_url,
    load_env_files,
)
from tooling.simulations.engine.cleanup import cleanup_run_artifacts
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.scenarios.registry import create_scenario


def parse_args() -> tuple[SimulationConfig, str, str | None, str | None]:
    load_env_files("/workspace/.env", "/workspace/simulations/.env")

    parser = argparse.ArgumentParser(description="Run PocketBase workflow simulations")
    parser.add_argument("--base-url", default=env_default_base_url())
    parser.add_argument("--admin-email", default=os.environ.get("PB_SUPERUSER_EMAIL") or os.environ.get("PB_ADMIN_EMAIL") or DEFAULT_ADMIN_EMAIL)
    parser.add_argument("--admin-password", default=os.environ.get("PB_SUPERUSER_PASSWORD") or os.environ.get("PB_ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD)
    parser.add_argument("--agents", type=int, default=50)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--scenario", default="convergence")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--cleanup-run-id", default=None)
    parser.add_argument("--max-steps", type=int, default=30)
    parser.add_argument("--json-out", default=None)
    parser.add_argument("--llm-provider", default="github-models")
    parser.add_argument("--llm-api-base", default=DEFAULT_LLM_API_BASE)
    parser.add_argument("--llm-model", default="openai/gpt-4.1-mini")
    parser.add_argument("--llm-api-key", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_MODELS_TOKEN") or os.environ.get("SIM_LLM_API_KEY"))
    parser.add_argument("--llm-temperature", type=float, default=0.7)
    parser.add_argument("--disable-llm", action="store_true")
    parser.add_argument("--time-min-hours", type=int, default=1)
    parser.add_argument("--time-max-hours", type=int, default=24)
    parser.add_argument("--time-long-jump-chance", type=float, default=0.2)
    parser.add_argument("--time-long-jump-min-days", type=int, default=1)
    parser.add_argument("--time-long-jump-max-days", type=int, default=4)
    parser.add_argument("--target-duration-days", type=int, default=14)
    parser.add_argument("--progress-every-steps", type=int, default=5)
    parser.add_argument("--start-at", default=None, help="Initial simulated timestamp (ISO-8601, e.g. 2026-01-01T09:00:00Z)")
    parser.add_argument("--initial-solution-min-delay-days", type=int, default=2)
    parser.add_argument("--initial-solution-max-delay-days", type=int, default=4)
    parser.add_argument("--remix-probability", type=float, default=0.15)
    parser.add_argument("--merge-probability", type=float, default=0.05)
    parser.add_argument("--question-title-prefix", default="", help="Prefix for question title")
    parser.add_argument("--language", default="de", choices=["de", "en"], help="Content language: 'de' (German, default) or 'en' (English)")
    parser.add_argument("--question-id", default=None, help="If provided, attach to an existing question instead of creating a new one")
    parser.add_argument("--config", default=None, metavar="PATH", help="Path to a JSON config file with 'question' (and optionally 'group') keys. Required unless --question-id is set.")

    args = parser.parse_args()

    if args.agents < 2:
        raise SystemExit("--agents must be at least 2")
    if args.max_steps < 1:
        raise SystemExit("--max-steps must be at least 1")
    if args.time_min_hours < 1 or args.time_max_hours < args.time_min_hours:
        raise SystemExit("invalid --time-min-hours/--time-max-hours")
    if args.time_long_jump_min_days < 1 or args.time_long_jump_max_days < args.time_long_jump_min_days:
        raise SystemExit("invalid long-jump day bounds")
    if args.target_duration_days < 1:
        raise SystemExit("--target-duration-days must be at least 1")
    if args.progress_every_steps < 0:
        raise SystemExit("--progress-every-steps must be at least 0")
    if args.initial_solution_min_delay_days < 0 or args.initial_solution_max_delay_days < args.initial_solution_min_delay_days:
        raise SystemExit("invalid initial solution delay bounds")
    if args.remix_probability < 0 or args.remix_probability > 1:
        raise SystemExit("--remix-probability must be between 0 and 1")
    if args.merge_probability < 0 or args.merge_probability > 1:
        raise SystemExit("--merge-probability must be between 0 and 1")
    if args.config is None and args.question_id is None:
        raise SystemExit(
            "error: either --config <path> or --question-id <id> is required. "
            "--config must point to a JSON file with a 'question' key."
        )

    if args.cleanup_run_id and not args.cleanup_run_id.strip():
        raise SystemExit("--cleanup-run-id cannot be empty")

    # Load BehaviorProfile from config JSON "behavior" key (or use WG defaults)
    behavior_profile = BehaviorProfile()  # WG-calibrated defaults
    if args.config:
        try:
            with open(args.config, "r", encoding="utf-8") as _f:
                _cfg_data = json.load(_f)
            if "behavior" in _cfg_data and isinstance(_cfg_data["behavior"], dict):
                behavior_profile = BehaviorProfile.from_dict(_cfg_data["behavior"])
                print(f"[behavior] Loaded BehaviorProfile from '{args.config}' (study: {behavior_profile.source_study})")
        except (json.JSONDecodeError, OSError):
            pass  # config loading is handled later in scenario; ignore here

    cfg = SimulationConfig(
        base_url=args.base_url,
        admin_email=args.admin_email,
        admin_password=args.admin_password,
        agents=args.agents,
        seed=args.seed,
        max_steps=args.max_steps,
        json_out=args.json_out,
        llm_provider=args.llm_provider,
        llm_api_base=args.llm_api_base,
        llm_model=args.llm_model,
        llm_api_key=args.llm_api_key,
        llm_temperature=args.llm_temperature,
        disable_llm=args.disable_llm,
        time_min_hours=args.time_min_hours,
        time_max_hours=args.time_max_hours,
        time_long_jump_chance=args.time_long_jump_chance,
        time_long_jump_min_days=args.time_long_jump_min_days,
        time_long_jump_max_days=args.time_long_jump_max_days,
        target_duration_days=args.target_duration_days,
        progress_every_steps=args.progress_every_steps,
        start_at=args.start_at,
        initial_solution_min_delay_days=args.initial_solution_min_delay_days,
        initial_solution_max_delay_days=args.initial_solution_max_delay_days,
        remix_probability=args.remix_probability,
        merge_probability=args.merge_probability,
        question_title_prefix=args.question_title_prefix,
        language=args.language,
        behavior=behavior_profile,
    )
    return cfg, args.scenario, args.run_id, args.cleanup_run_id, args.question_id, args.config


def build_run_id(seed: int, explicit: str | None) -> str:
    if explicit:
        return explicit
    return f"seed_{seed}"


def main() -> None:
    cfg, scenario_name, explicit_run_id, cleanup_run_id, question_id, config_path = parse_args()

    pb = PocketBaseClient(cfg.base_url)
    if cleanup_run_id:
        try:
            pb.admin_auth(cfg.admin_email, cfg.admin_password)
        except PocketBaseError as err:
            print(
                json.dumps(
                    {
                        "cleanup_run_id": cleanup_run_id,
                        "ok": False,
                        "error": "superuser_auth_failed",
                        "message": str(err),
                        "hint": "Set valid PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD or pass --admin-email/--admin-password.",
                    },
                    indent=2,
                )
            )
            raise SystemExit(2)
        report = cleanup_run_artifacts(pb, cleanup_run_id)
        print(json.dumps(report.to_dict(), indent=2))
        return

    try:
        pb.admin_auth(cfg.admin_email, cfg.admin_password)
    except PocketBaseError as err:
        print(
            f"warning: admin auth unavailable, continuing in user-auth mode ({err})",
            file=sys.stderr,
        )

    rng = random.Random(cfg.seed)
    run_id = build_run_id(cfg.seed, explicit_run_id)

    # Load question/group content from --config file if provided
    question_config: dict | None = None
    group_config: dict | None = None
    if config_path:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg_data = json.load(f)
        question_config = cfg_data.get("question")
        group_config = cfg_data.get("group")
        if question_config is None:
            raise SystemExit(f"error: config file '{config_path}' has no 'question' key.")

    scenario = create_scenario(
        name=scenario_name,
        pb=pb,
        rng=rng,
        run_id=run_id,
        agent_count=cfg.agents,
        max_steps=cfg.max_steps,
        seed=cfg.seed,
        llm_provider=cfg.llm_provider,
        llm_api_base=cfg.llm_api_base,
        llm_model=cfg.llm_model,
        llm_api_key=cfg.llm_api_key,
        llm_temperature=cfg.llm_temperature,
        llm_enabled=not cfg.disable_llm,
        time_min_hours=cfg.time_min_hours,
        time_max_hours=cfg.time_max_hours,
        time_long_jump_chance=cfg.time_long_jump_chance,
        time_long_jump_min_days=cfg.time_long_jump_min_days,
        time_long_jump_max_days=cfg.time_long_jump_max_days,
        target_duration_days=cfg.target_duration_days,
        progress_every_steps=cfg.progress_every_steps,
        start_at=cfg.start_at,
        initial_solution_min_delay_days=cfg.initial_solution_min_delay_days,
        initial_solution_max_delay_days=cfg.initial_solution_max_delay_days,
        remix_probability=cfg.remix_probability,
        merge_probability=cfg.merge_probability,
        question_title_prefix=cfg.question_title_prefix,
        language=cfg.language,
        question_id=question_id,
        question_config=question_config,
        group_config=group_config,
        behavior_profile=cfg.behavior,
    )
    report = scenario.run()

    data = report.to_dict()
    summary = {
        "run_id": data["run_id"],
        "question_id": data["question_id"],
        "seed": data["seed"],
        "agent_count": data["agent_count"],
        "steps": data["steps"],
        "converged": data["converged"],
        "reason": data["convergence_reason"],
        "final_solution_id": data["final_solution_id"],
        "final_solution_title": data["final_solution_title"],
        "time_events": len(data.get("time_events", [])),
        "decisions": len(data.get("decision_log", [])),
        "content_generations": len(data.get("content_generation_log", [])),
        "llm_token_usage": data.get("llm_token_usage", {}),
    }
    print(json.dumps(summary, indent=2))

    if cfg.json_out:
        out_dir = os.path.dirname(cfg.json_out)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(cfg.json_out, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)


if __name__ == "__main__":
    main()
