import logging
import os
import random
import string
import sys
from datetime import datetime, timedelta
from typing import Any

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError

logger = logging.getLogger(__name__)

USER_PASSWORD = os.environ.get("SIM_USER_PASSWORD", "changeme")
if USER_PASSWORD == "changeme":
    logger.warning("SIM_USER_PASSWORD not set — using default 'changeme'. Set the env var for production use.")
SEED_USER_EMAIL_SUFFIX = "@sim.local"

def slugify(name: str) -> str:
    slug = name.lower().replace(" ", "_").replace("-", "_")
    return "".join(c for c in slug if c.isalnum() or c == "_")

def create_seed_user(pb: PocketBaseClient, display_name: str, index: int, persona: str = "") -> dict[str, Any]:
    """Create a simulation user or return existing."""
    handle = slugify(display_name) or f"agent{index:02d}"
    username = f"{handle[:18]}_sim_{index:02d}"[:30]
    email = f"{username}{SEED_USER_EMAIL_SUFFIX}"
    
    existing = pb.list_records("users", filter_expr=f'email="{email}"')
    if existing:
        return existing[0]
        
    payload = {
        "username": username,
        "email": email,
        "password": USER_PASSWORD,
        "passwordConfirm": USER_PASSWORD,
        "name": display_name,
        "simulation": True,
        "persona": persona[:2000],
        "role": "admin" if index == 1 else "participant",
    }
    return pb.create_record("users", payload)

def create_group(pb: PocketBaseClient, name: str, author_id: str, description: str = "", visibility: str = "Public") -> dict[str, Any]:
    """Create a group or return existing."""
    existing = pb.list_records("groups", filter_expr=f'name="{name}"')
    if existing:
        return existing[0]
        
    invite_token = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    return pb.create_record("groups", {
        "name": name,
        "author": author_id,
        "description": description,
        "visibility": visibility,
        "invite_token": invite_token
    })

def ensure_user_in_group(pb: PocketBaseClient, group_id: str, user_id: str, role: str = "Member") -> None:
    """Ensure a user is a member of a group."""
    existing = pb.list_records("group_members", filter_expr=f'group="{group_id}" && user="{user_id}"')
    if not existing:
        try:
            pb.create_record("group_members", {
                "group": group_id,
                "user": user_id,
                "role": role
            })
        except PocketBaseError as e:
            logger.warning(f"PocketBase error (ignored): {e}")

def create_question(
    pb: PocketBaseClient,
    title: str,
    description: str,
    constraints: list[Any],
    author_id: str,
    group_id: str,
    visibility: str = "Group",
    occurred_at: str | None = None
) -> dict[str, Any]:
    """Create a question."""
    clean_constraints = []
    for c in constraints:
        if isinstance(c, str):
            val = c.trim() if hasattr(c, 'trim') else c.strip()
            if val:
                clean_constraints.append(val)
        elif isinstance(c, dict) and "description" in c:
            val = str(c["description"]).strip()
            if val:
                clean_constraints.append(val)

    payload = {
        "title": title[:120],
        "description": description[:4000],
        "constraints": clean_constraints,
        "author": author_id,
        "group": group_id,
        "visibility": visibility,
    }
    if occurred_at:
        payload["occurred_at"] = occurred_at
        
    return pb.create_record("questions", payload)

def transition_phase(
    pb: PocketBaseClient, 
    question_id: str, 
    target_phase: str, 
    started_at: str | None = None,
    ended_at: str | None = None
) -> None:
    """Transition a question to a specific phase."""
    now = started_at or datetime.utcnow().isoformat().replace('+00:00', 'Z')
    
    question = pb.get_record("questions", question_id)
    old_phase_id = str(question.get("current_phase", "")).strip()
    
    if old_phase_id:
        try:
            pb.update_record(
                "question_phases", old_phase_id,
                {"ended_at": now},
            )
        except PocketBaseError as e:
            logger.warning(f"PocketBase error (ignored): {e}")
            
    new_phase_payload = {
        "question": question_id,
        "phase_name": target_phase,
        "started_at": now,
        "ended_at": ended_at or "",
        "previous_phase": old_phase_id or None,
        "transition_type": "simulation_force_transition",
    }
    
    new_phase = pb.create_record("question_phases", new_phase_payload)
    
    updates = {
        "current_phase": new_phase["id"],
        "current_phase_name": target_phase,
    }
    
    if target_phase == "AnswerSearch":
        if ended_at:
            updates["discussion_deadline"] = ended_at
        elif started_at:
            try:
                dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                ends = dt + timedelta(days=14)
                updates["discussion_deadline"] = ends.isoformat().replace('+00:00', 'Z')
            except ValueError:
                pass
    elif target_phase == "Closing":
        if ended_at:
            updates["closing_window_deadline"] = ended_at
        elif started_at:
            try:
                dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                ends = dt + timedelta(days=2)
                updates["closing_window_deadline"] = ends.isoformat().replace('+00:00', 'Z')
            except ValueError:
                pass
    elif target_phase == "Voting":
        if ended_at:
            updates["vote_deadline"] = ended_at
        elif started_at:
            try:
                dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                ends = dt + timedelta(days=2)
                updates["vote_deadline"] = ends.isoformat().replace('+00:00', 'Z')
            except ValueError:
                pass
            
    pb.update_record("questions", question_id, updates)

def simulate_ballot_votes(pb: PocketBaseClient, question_id: str, rng: random.Random, percentage: float) -> None:
    """Simulate ballot votes for a question."""
    users = pb.list_records("users", filter_expr="email ~ 'sim.local' && simulation = true")
    if not users:
        return
        
    proposals = pb.list_records("proposals", filter_expr=f"question='{question_id}'")
    if not proposals:
        return
        
    active_proposals = [p for p in proposals if p.get("state") == "active" or not p.get("merge_status", "").startswith("merged_")]
    if not active_proposals:
        active_proposals = proposals
        
    proposal_ids = [p["id"] for p in active_proposals]
    k = int(len(users) * percentage)
    if k == 0:
        return
        
    voting_users = rng.sample(users, k)
    
    for u in voting_users:
        ranks = []
        shuffled = list(proposal_ids)
        rng.shuffle(shuffled)
        num_ranked = rng.randint(1, len(shuffled))
        for i in range(num_ranked):
            ranks.append({"proposalId": shuffled[i], "rank": i + 1})
            
        try:
            pb.create_record("ballot_responses", {
                "question": question_id,
                "user": u["id"],
                "ranks": ranks
            })
        except PocketBaseError as e:
            logger.warning(f"PocketBase error (ignored): {e}")
    print(f"  -> Simulated {len(voting_users)} ballot votes.")
