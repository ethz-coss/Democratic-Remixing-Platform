"""Shared helper functions for state seeding.

Extracted from the duplicated code in generate_local_states.py and
generate_wg_study_states.py.
"""
from __future__ import annotations

import datetime
import random
import sys

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.setup.core import simulate_ballot_votes, transition_phase


def simulate_closing_readiness(
    pb: PocketBaseClient,
    question_id: str,
    rng: random.Random,
    percentage: float,
) -> None:
    """Signal readiness-to-close for a fraction of sim users."""
    users = pb.list_records(
        "users", filter_expr="email ~ 'sim.local' && simulation=true"
    )
    if not users:
        return

    k = int(len(users) * percentage)
    if k == 0:
        return

    signaling_users = rng.sample(users, k)
    user_ids = [u["id"] for u in signaling_users]

    try:
        pb.update_record("questions", question_id, {"motion_to_finalize": user_ids})
        print(f"  -> Simulated {len(user_ids)} readiness signals.")
    except PocketBaseError as e:
        print(f"Error simulating readiness: {e}", file=sys.stderr)


def transition_phases(
    pb: PocketBaseClient,
    question_id: str,
    current_phase_id: str,
    phases_to_create: list[str],
    end_times: list[datetime.datetime],
    rng: random.Random,
) -> None:
    """Advance a question through a sequence of phases."""
    # Apply closing readiness since AnswerSearch is ending
    simulate_closing_readiness(pb, question_id, rng, percentage=1.0)

    for i, target_phase in enumerate(phases_to_create):
        start_time = end_times[i]
        start_iso = start_time.isoformat().replace("+00:00", "Z")
        transition_phase(pb, question_id, target_phase, started_at=start_iso)

        if target_phase == "Decided":
            simulate_ballot_votes(pb, question_id, rng, percentage=1.0)
