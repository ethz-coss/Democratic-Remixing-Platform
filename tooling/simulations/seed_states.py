#!/usr/bin/env python3
"""Unified state seeder — replaces 6 scattered generator scripts.

Usage:
    # From repo root (PYTHONPATH=.):
    python -m tooling.simulations.seed_states --preset local
    python -m tooling.simulations.seed_states --preset wg_study
    python -m tooling.simulations.seed_states --preset fast_test
    python -m tooling.simulations.seed_states --preset custom_demos

    # Override defaults:
    python -m tooling.simulations.seed_states --preset local --agents 30 --max-steps 20

    # Fully custom (no preset):
    python -m tooling.simulations.seed_states --config custom.yaml
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import random
import subprocess
import sys

from tooling._paths import SIMULATIONS_OUTPUT, SETUP_CONFIGS, ensure_output_dirs
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.scenarios.registry import create_scenario
from tooling.simulations.engine.config import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
    env_default_base_url,
    load_env_files,
)
from tooling.simulations.seed_helpers import (
    simulate_closing_readiness,
    transition_phases,
)
from tooling.simulations.seed_presets import PRESETS, CUSTOM_DEMO_RUNS, SeedPreset
from tooling.setup.core import create_seed_user, simulate_ballot_votes, transition_phase


def _run_preset_phased(
    preset: SeedPreset,
    pb: PocketBaseClient,
    args: argparse.Namespace,
) -> None:
    """Seed questions across lifecycle phases (local / wg_study presets)."""
    from tooling.simulations.engine.main import parse_args as engine_parse_args

    # Build engine CLI args (will be parsed by the engine's argparse)
    engine_argv = [
        "--base-url", args.base_url,
        "--admin-email", args.admin_email,
        "--admin-password", args.admin_password,
        "--agents", str(args.agents or preset.agents),
        "--max-steps", str(args.max_steps or preset.max_steps),
        "--target-duration-days", str(preset.target_duration_days),
        "--disable-llm" if preset.disable_llm else "",
        "--language", preset.language,
        "--time-min-hours", str(getattr(args, "time_min_hours", 2)),
        "--time-max-hours", str(getattr(args, "time_max_hours", 12)),
        "--time-long-jump-chance", str(getattr(args, "time_long_jump_chance", 0.05)),
        "--time-long-jump-min-days", str(getattr(args, "time_long_jump_min_days", 1)),
        "--time-long-jump-max-days", str(getattr(args, "time_long_jump_max_days", 2)),
    ]
    engine_argv = [a for a in engine_argv if a]  # filter blanks

    # Parse with the engine's parser to get a SimConfig
    old_argv = sys.argv
    sys.argv = ["seed_states"] + engine_argv
    try:
        cfg, _, _, _ = engine_parse_args()
    finally:
        sys.argv = old_argv

    # Load group/question config if preset specifies one
    wg_question_config = None
    wg_group_config = None
    config_path = args.config or preset.config_path
    if config_path:
        with open(config_path, "r", encoding="utf-8") as f:
            wg_cfg = json.load(f)
        wg_question_config = wg_cfg.get("question")
        wg_group_config = wg_cfg.get("group")

    now = datetime.datetime.now(datetime.timezone.utc)
    sim_duration_days = cfg.max_steps * 1.5 if preset.name == "local" else float(cfg.target_duration_days)

    for i, target_phase in enumerate(preset.phases):
        run_seed = cfg.seed + i + preset.seed_offset
        rng = random.Random(run_seed)
        run_id = f"{preset.name}_{target_phase.lower()}"

        phases_after = i
        answer_search_end_time = now - datetime.timedelta(days=(phases_after * preset.phase_duration_days))
        start_time = answer_search_end_time - datetime.timedelta(days=sim_duration_days)
        start_at_iso = start_time.isoformat().replace("+00:00", "Z")

        title_prefix = preset.title_prefix.format(phase=target_phase)

        scenario_kwargs = dict(
            name="convergence",
            pb=pb,
            rng=rng,
            run_id=run_id,
            agent_count=cfg.agents,
            max_steps=cfg.max_steps,
            seed=run_seed,
            llm_provider=cfg.llm_provider,
            llm_api_base=cfg.llm_api_base,
            llm_model=cfg.llm_model,
            llm_api_key=cfg.llm_api_key,
            llm_temperature=cfg.llm_temperature,
            llm_enabled=not cfg.disable_llm,
            discussion_agents=cfg.discussion_agents,
            time_min_hours=cfg.time_min_hours,
            time_max_hours=cfg.time_max_hours,
            time_long_jump_chance=cfg.time_long_jump_chance,
            time_long_jump_min_days=cfg.time_long_jump_min_days,
            time_long_jump_max_days=cfg.time_long_jump_max_days,
            target_duration_days=cfg.target_duration_days,
            branch_pressure=cfg.branch_pressure,
            progress_every_steps=cfg.progress_every_steps,
            start_at=start_at_iso,
            initial_solution_min_delay_days=cfg.initial_solution_min_delay_days,
            initial_solution_max_delay_days=cfg.initial_solution_max_delay_days,
            remix_probability=cfg.remix_probability,
            merge_probability=cfg.merge_probability,
            question_title_prefix=title_prefix,
            language=cfg.language,
        )
        if wg_question_config:
            scenario_kwargs["question_config"] = wg_question_config
        if wg_group_config:
            scenario_kwargs["group_config"] = wg_group_config

        scenario = create_scenario(**scenario_kwargs)

        print(f"\n=== Seeding state: {target_phase} (preset={preset.name}) ===")
        print(f"  -> Simulation starts at: {start_at_iso}")
        report = scenario.run()
        question_id = report.question_id
        print(f"  -> Generated question {question_id} in {report.steps} steps.")

        # Apply phase-specific post-processing
        if target_phase == "Closing":
            simulate_closing_readiness(pb, question_id, rng, percentage=0.4)
        if target_phase == "Voting":
            simulate_ballot_votes(pb, question_id, rng, percentage=0.6)

        # Advance through phases if needed
        if phases_after > 0:
            question = pb.get_record("questions", question_id)
            current_phase_id = str(question.get("current_phase", "")).strip()
            phases_to_create = preset.phases[1 : i + 1]
            end_times = [
                answer_search_end_time + datetime.timedelta(days=(j * preset.phase_duration_days))
                for j in range(phases_after)
            ]
            transition_phases(pb, question_id, current_phase_id, phases_to_create, end_times, rng)


def _run_fast_test(pb: PocketBaseClient, args: argparse.Namespace) -> None:
    """Create a single question with ultra-short phase deadlines."""
    author = create_seed_user(pb, "Notification Tester", 999, "Testing notifications")
    author_id = author["id"]

    group_name = "WG Study"
    groups = pb.list_records("groups", filter_expr=f"name ~ '{group_name}'")
    if not groups:
        import string
        rng = random.Random()
        invite_token = "".join(rng.choices(string.ascii_letters + string.digits, k=32))
        group = pb.create_record("groups", {
            "name": group_name,
            "description": "Auto-created group for WG Study",
            "visibility": "Public",
            "invite_token": invite_token,
            "author": author_id,
        })
    else:
        group = groups[0]

    group_id = group["id"]
    print(f"Using group: {group['name']} ({group_id})")

    # Ensure author is a member
    existing_members = pb.list_records("group_members", filter_expr=f"group='{group_id}' && user='{author_id}'")
    if not existing_members:
        pb.create_record("group_members", {"group": group_id, "user": author_id, "role": "Member"})

    # Ensure admins are members too
    admins = pb.list_records("users", filter_expr="role='admin'")
    for admin in admins:
        admin_id = admin["id"]
        existing = pb.list_records("group_members", filter_expr=f"group='{group_id}' && user='{admin_id}'")
        if not existing:
            pb.create_record("group_members", {"group": group_id, "user": admin_id, "role": "Member"})

    now = datetime.datetime.now(datetime.timezone.utc)
    ans_search_deadline = now + datetime.timedelta(minutes=4)
    closing_deadline = ans_search_deadline + datetime.timedelta(minutes=4)
    vote_deadline = closing_deadline + datetime.timedelta(minutes=4)

    question = pb.create_record("questions", {
        "title": f"[Fast Test] E2E Notification Verification ({now.strftime('%H:%M:%S')})",
        "description": "Auto-generated question to test the Push Engine with very short phase intervals.",
        "author": author_id,
        "group": group_id,
        "visibility": "Group",
        "constraints": ["Test constraint"],
        "discussion_deadline": ans_search_deadline.isoformat().replace("+00:00", "Z"),
        "closing_window_deadline": closing_deadline.isoformat().replace("+00:00", "Z"),
        "vote_deadline": vote_deadline.isoformat().replace("+00:00", "Z"),
    })
    q_id = question["id"]

    start_iso = now.isoformat().replace("+00:00", "Z")
    phase = pb.create_record("question_phases", {
        "question": q_id,
        "phase_name": "AnswerSearch",
        "started_at": start_iso,
        "ended_at": "",
        "transition_type": "simulation_force_transition",
    })
    pb.update_record("questions", q_id, {
        "current_phase": phase["id"],
        "current_phase_name": "AnswerSearch",
    })

    print(f"\n--- Fast Test Question Created: {q_id} ---")
    print(f"AnswerSearch ends: {ans_search_deadline.strftime('%H:%M:%S UTC')} (in 4 min)")
    print(f"Closing ends:      {closing_deadline.strftime('%H:%M:%S UTC')} (in 8 min)")
    print(f"Voting ends:       {vote_deadline.strftime('%H:%M:%S UTC')} (in 12 min)")


def _run_custom_demos(args: argparse.Namespace) -> None:
    """Run the batch of 6 demo simulations via subprocess."""
    from tooling.simulations.engine.cleanup import cleanup_all

    pb = PocketBaseClient(args.base_url)
    pb.admin_auth(args.admin_email, args.admin_password)

    # Cleanup
    print("=" * 60)
    print(f"Cleaning all simulation data on {args.base_url}")
    print("=" * 60)
    report = cleanup_all(pb)
    print(json.dumps(report.to_dict(), indent=2))

    ensure_output_dirs()

    os.environ["FRONTEND_INTERNAL_URL"] = os.environ.get(
        "FRONTEND_INTERNAL_URL", "http://localhost:5173"
    )

    print(f"\n{'=' * 60}")
    print(f"Running {len(CUSTOM_DEMO_RUNS)} simulations")
    print("=" * 60)

    for i, run in enumerate(CUSTOM_DEMO_RUNS, 1):
        print(f"\n{'─' * 60}\n[{i}/{len(CUSTOM_DEMO_RUNS)}] {run.label}\n{'─' * 60}")

        cmd = [
            sys.executable, "-m", "tooling.simulations.engine.main",
            "--base-url", args.base_url,
            "--admin-email", args.admin_email,
            "--admin-password", args.admin_password,
        ] + run.args

        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")),
        )
        if proc.returncode != 0:
            print(f"  ❌ FAILED (exit {proc.returncode})")
            if proc.stderr:
                print(f"  stderr: {proc.stderr[-500:]}")
        else:
            print(f"  ✅ {run.label} completed")


def main() -> None:
    load_env_files(
        "/workspace/.env",
        os.path.join(os.path.dirname(__file__), ".env"),
    )

    parser = argparse.ArgumentParser(
        description="Unified state seeder for the remix platform.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Presets: " + ", ".join(PRESETS.keys()) + ", custom_demos",
    )
    parser.add_argument(
        "--preset", choices=list(PRESETS.keys()) + ["custom_demos"],
        help="Named preset to run.",
    )
    parser.add_argument("--config", default=None, help="Custom JSON/YAML config file.")
    parser.add_argument("--base-url", default=os.environ.get("PRIVATE_POCKETBASE_URL", "http://localhost:18090"))
    parser.add_argument("--admin-email", default=os.environ.get("PB_SUPERUSER_EMAIL") or DEFAULT_ADMIN_EMAIL)
    parser.add_argument("--admin-password", default=os.environ.get("PB_SUPERUSER_PASSWORD") or DEFAULT_ADMIN_PASSWORD)
    parser.add_argument("--agents", type=int, default=None, help="Override agent count.")
    parser.add_argument("--max-steps", type=int, default=None, help="Override max steps.")
    args = parser.parse_args()

    if not args.preset and not args.config:
        parser.error("Provide --preset or --config")

    if args.preset == "custom_demos":
        _run_custom_demos(args)
        return

    if args.preset == "fast_test":
        pb = PocketBaseClient(args.base_url)
        pb.admin_auth(args.admin_email, args.admin_password)
        _run_fast_test(pb, args)
        return

    preset = PRESETS[args.preset]
    pb = PocketBaseClient(args.base_url)
    try:
        pb.admin_auth(args.admin_email, args.admin_password)
    except PocketBaseError as err:
        print(f"warning: admin auth failed ({err}), continuing", file=sys.stderr)

    _run_preset_phased(preset, pb, args)
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
