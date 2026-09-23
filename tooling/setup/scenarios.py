import random
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.setup.core import (
    create_group,
    create_question,
    create_seed_user,
    ensure_user_in_group,
    simulate_ballot_votes,
    transition_phase,
    slugify,
    SEED_USER_EMAIL_SUFFIX,
    USER_PASSWORD
)

def _esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')

def _is_seed_email(email: str) -> bool:
    return email.endswith(SEED_USER_EMAIL_SUFFIX)

def _random_past_dt(min_days: int, max_days: int) -> datetime:
    """Return a UTC datetime randomly between min_days and max_days ago."""
    days = random.uniform(min_days, max_days)
    return datetime.now(timezone.utc) - timedelta(days=days)

def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _get_or_create_author(pb: PocketBaseClient) -> dict[str, Any]:
    users = pb.list_records("users", per_page=1)
    if users:
        return users[0]
    # Fallback to create one
    return create_seed_user(pb, "Default Author", 0, "Default")

def _setup_single_question(
    pb: PocketBaseClient, question_data: dict[str, Any], author_id: str, group_id: str
) -> None:
    """Create a single question from config data and set up its initial phase."""
    from datetime import datetime, timezone, timedelta

    print(f"\n--- Creating Question: {question_data.get('title', 'Question')} ---")

    # Delete existing questions with the exact same title to avoid duplicates during testing
    title_esc = question_data.get("title", "Question").replace("\\", "\\\\").replace('"', '\\"')
    existing_probs = pb.list_records("questions", filter_expr=f'title ~ "{title_esc}" && group = "{group_id}"')
    for ep in existing_probs:
        try:
            pb.delete_record("questions", ep["id"])
        except PocketBaseError:
            pass

    question = create_question(
        pb,
        title=question_data.get("title", "Question"),
        description=question_data.get("description", ""),
        constraints=question_data.get("constraints", []),
        author_id=author_id,
        group_id=group_id,
    )
    question_id = question["id"]
    print(f"Created question: {question['title']} ({question_id})")

    phases = question_data.get("phases", [])
    if not phases:
        return

    now = datetime.now(timezone.utc)
    timeline_cursor = now

    deadlines = {}
    first_active_phase = None

    for p in phases:
        p_name = p.get("name")
        p_duration = p.get("duration_days", 0)

        start_str = p.get("started_at") or p.get("start_at")
        if start_str:
            try:
                p_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            except ValueError:
                p_start = timeline_cursor
        else:
            p_start = timeline_cursor

        end_str = p.get("ended_at") or p.get("end_at")
        if end_str:
            try:
                p_end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except ValueError:
                p_end = p_start + timedelta(days=p_duration) if p_duration > 0 else None
        else:
            p_end = p_start + timedelta(days=p_duration) if p_duration > 0 else None

        if p_end:
            timeline_cursor = p_end

        if p_name == "AnswerSearch" and p_end:
            deadlines["discussion_deadline"] = p_end.isoformat().replace('+00:00', 'Z')
        elif p_name == "Closing" and p_end:
            deadlines["closing_window_deadline"] = p_end.isoformat().replace('+00:00', 'Z')
        elif p_name == "Voting" and p_end:
            deadlines["vote_deadline"] = p_end.isoformat().replace('+00:00', 'Z')

        if first_active_phase is None and (p_duration > 0 or p_name != "Proposed"):
            first_active_phase = {
                "name": p_name,
                "start": p_start,
                "end": p_end,
                "duration": p_duration
            }

    if first_active_phase is None and phases:
        first_active_phase = {
            "name": phases[0].get("name", "AnswerSearch"),
            "start": now,
            "end": None,
            "duration": 0
        }

    phase_name = first_active_phase["name"]
    p_start = first_active_phase["start"]
    p_end = first_active_phase["end"]

    phase_record = pb.create_record(
        "question_phases",
        {
            "question": question_id,
            "phase_name": phase_name,
            "started_at": p_start.isoformat().replace('+00:00', 'Z'),
            "ended_at": p_end.isoformat().replace('+00:00', 'Z') if p_end else "",
            "previous_phase": None,
            "transition_type": "setup_json",
        },
    )

    updates = {
        "current_phase": phase_record["id"],
        "current_phase_name": phase_name,
        **deadlines
    }

    pb.update_record("questions", question_id, updates)
    print(f"  -> Added initial phase {phase_name} (Deadlines: {deadlines})")


def setup_from_json(pb: PocketBaseClient, json_path: str) -> None:
    """Setup a study group and question(s) from a JSON configuration.
    
    Supports both single-question format (``"question": {...}``) and
    multi-question format (``"questions": [...]``).
    """
    import json
    import os

    if not os.path.exists(json_path):
        print(f"Error: JSON setup file not found at {json_path}")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    author = _get_or_create_author(pb)
    author_id = author["id"]

    group_data = data.get("group", {})

    print(f"\n--- Creating Group: {group_data.get('name', 'Study Group')} ---")
    group = create_group(
        pb,
        name=group_data.get("name", "Study Group"),
        author_id=author_id,
        description=group_data.get("description", ""),
        visibility=group_data.get("visibility", "Public"),
    )
    group_id = group["id"]
    ensure_user_in_group(pb, group_id, author_id, "Admin")
    print(f"Created/Fetched group: {group['name']} ({group_id})")

    # Support both single-question ("question") and multi-question ("questions") formats
    questions_list: list[dict[str, Any]] = data.get("questions", [])
    if not questions_list:
        single = data.get("question")
        if single:
            questions_list = [single]

    if not questions_list:
        print("Warning: No question(s) found in the config file.")
        return

    for question_data in questions_list:
        _setup_single_question(pb, question_data, author_id, group_id)


def setup_office_study(pb: PocketBaseClient) -> None:
    """Seed script to populate an 'Office Study Group' with 3 test questions."""
    author = _get_or_create_author(pb)
    author_id = author["id"]
    
    print("\n--- Creating Office Study Group ---")
    group = create_group(
        pb, 
        name="Office Study Group", 
        author_id=author_id, 
        description="Test group for the full survey and app testing."
    )
    group_id = group["id"]
    ensure_user_in_group(pb, group_id, author_id, "Admin")
    print(f"Created/Fetched group: Office Study Group ({group_id})")

    questions_data = [
        {
            "title": "2026 Retreat Activities",
            "description": "<p>What activities to do during the 2026 retreat?...</p>",
            "constraints": [
                "Must be feasible within a 2-day timeframe",
                "Must include both professional and social elements",
                "Should be accessible to all team members",
                "Must fit within the standard retreat budget"
            ]
        },
        {
            "title": "Christmas Dinner 2026",
            "description": "<p>What to do for the Christmas dinner?...</p>",
            "constraints": [
                "Must be located within 30 minutes of the Zürich office",
                "Must accommodate dietary restrictions (vegan, gluten-free, etc.)",
                "Total cost per person should be reasonable and under 100 CHF"
            ]
        },
        {
            "title": "[TRY TO BREAK THIS] Decrease Car Use in Zürich",
            "description": "<p>How to decrease the use of cars...</p>",
            "constraints": [
                "Must be legally implementable by the city council",
                "Cannot unfairly penalize essential workers who commute",
                "Must show measurable reduction in emissions within 2 years",
                "Must include alternatives for those with mobility issues"
            ]
        }
    ]

    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    print("\n--- Creating Questions ---")
    for p_data in questions_data:
        # Delete existing questions with same title
        title_esc = p_data["title"].replace("\\", "\\\\").replace('"', '\\"')
        existing_probs = pb.list_records("questions", filter_expr=f'title ~ "{title_esc}" && group = "{group_id}"')
        for ep in existing_probs:
            try:
                pb.delete_record("questions", ep["id"])
            except PocketBaseError:
                pass
                
        question = create_question(
            pb,
            title=p_data["title"],
            description=p_data["description"],
            constraints=p_data["constraints"],
            author_id=author_id,
            group_id=group_id,
        )
        question_id = question["id"]
        print(f"Created question: {p_data['title']} ({question_id})")
        
        transition_phase(pb, question_id, "AnswerSearch", started_at=now)
        print("  -> Forced phase to AnswerSearch")
        
    print("\n--- Done ---")


def setup_showcase_group(pb: PocketBaseClient, agent_count: int = 50, seed: int = 42) -> None:
    """Create the Showcase Group and the blank questions for simulation."""
    author = _get_or_create_author(pb)
    
    print("\n--- Creating Showcase Group ---")
    group = create_group(
        pb,
        name="Showcase Group",
        author_id=author["id"],
        description="A showcase of the shared goods simulation runs at various stages."
    )
    group_id = group["id"]
    print(f"Created/Fetched group: Showcase Group ({group_id})")
    
    # We create the users first, so we can add them to the group.
    # We will simulate agent behavior via simulations/runner.py later, but we need
    # to prepare the questions now.
    from tooling.simulations.engine.agents.decision_engine import PERSONAS
    user_ids = []
    for i in range(1, agent_count + 1):
        persona = PERSONAS[(i - 1) % len(PERSONAS)]
        display_name = persona.split(",")[0].strip()
        user = create_seed_user(pb, display_name, i, persona)
        user_ids.append(user["id"])
        ensure_user_in_group(pb, group_id, user["id"], "Member")
        
    print(f"Ensured {agent_count} simulated users are in the Showcase Group.")
    
    QUESTIONS = [
        {"target_phase": "AnswerSearch", "label": "Early"},
        {"target_phase": "AnswerSearch", "label": "Mid"},
        {"target_phase": "AnswerSearch", "label": "Late"},
        {"target_phase": "AnswerSearch", "label": "Mature"},
        {"target_phase": "Voting", "label": "Voting"},
    ]
    
    label_to_suffix = {
        "Early": "[E]", "Mid": "[M]", "Late": "[L]", "Mature": "[Ma]", "Voting": "[V]"
    }
    
    now = datetime.now(timezone.utc)
    phase_duration_days = 3.0
    
    for i, q_cfg in enumerate(QUESTIONS):
        target_phase = q_cfg["target_phase"]
        label = q_cfg["label"]
        suffix = label_to_suffix.get(label, f"[{label}]")
        
        # We define a standard title for the demo
        title = f"Fair Cost Sharing for Collective Goods {suffix}"
        
        question = create_question(
            pb,
            title=title,
            description="We are a shared flat (WG) with several flatmates...",
            constraints=[
                "All costs are covered: the sum of payments equals the total shared expenses.",
                "No negative payments: each person pays a non-negative amount.",
            ],
            author_id=author["id"],
            group_id=group_id
        )
        question_id = question["id"]
        
        # NOTE: Instead of running the scenario here, we just create the question
        # and transition it to AnswerSearch. The actual simulation engine will be invoked
        # after this script runs, using --question-id.
        transition_phase(pb, question_id, "AnswerSearch")
        print(f"Created Showcase Question: {title} ({question_id})")
        
        # Note: If target phase is Voting, the simulation runner must be called,
        # and then we must transition to Closing/Voting later. For full showcase setup, 
        # it is often best to run `setup`, then `simulate`, then `finalize` phases.
        # This split is achieved via external orchestration (bash scripts).

def wipe_seed_data(pb: PocketBaseClient, group_name: str | None = None) -> None:
    """Delete only data created by the seed script (simulation users and their content)."""
    
    def _delete_all_filtered(collection: str, filter_expr: str) -> int:
        deleted = 0
        for _ in range(20):
            try:
                rows = pb.list_records(collection, filter_expr=filter_expr, per_page=500)
            except PocketBaseError:
                return deleted
            if not rows:
                break
            for row in rows:
                if row.get("id"):
                    try:
                        pb.delete_record(collection, row["id"])
                        deleted += 1
                    except PocketBaseError:
                        pass
        return deleted

    seed_user_ids = []
    if not group_name:
        print("Please specify a group to clean up using --group-name \"<name>\"")
        print("Available groups that can be cleaned:")
        all_groups = pb.list_records("groups", per_page=100)
        if not all_groups:
            print("  (No groups found)")
        else:
            for g in all_groups:
                print(f"  - {g['name']}")
        return

    seed_group_names = [group_name]

    seed_group_ids = []
    for gname in seed_group_names:
        groups = pb.list_records("groups", filter_expr=f'name = "{_esc(gname)}"', per_page=100)
        for g in groups:
            seed_group_ids.append(g["id"])

    if not seed_user_ids and not seed_group_ids:
        print("  No seed data found (users or setup groups) – nothing to clean.")
        return

    print(f"  Found {len(seed_user_ids)} seed/simulation users and {len(seed_group_ids)} seed groups to clean up")
    
    # Add safety warning
    print("\n⚠️  WARNING: You are about to permanently delete the above groups and users! ⚠️")
    ans = input("Are you sure you want to proceed? [y/N]: ")
    if ans.lower() != 'y':
        print("Aborting cleanup.")
        return

    seed_question_ids = []
    for uid in seed_user_ids:
        questions = pb.list_records("questions", filter_expr=f'author = "{_esc(uid)}"', per_page=500)
        for p in questions:
            if p["id"] not in seed_question_ids:
                seed_question_ids.append(p["id"])

    for gid in seed_group_ids:
        questions = pb.list_records("questions", filter_expr=f'group = "{_esc(gid)}"', per_page=500)
        for p in questions:
            if p["id"] not in seed_question_ids:
                seed_question_ids.append(p["id"])

    for pid in seed_question_ids:
        esc_pid = _esc(pid)
        proposals = pb.list_records("proposals", filter_expr=f'question = "{esc_pid}"', per_page=500)
        for sol in proposals:
            sid = _esc(sol["id"])
            _delete_all_filtered("proposal_votes", f'proposal = "{sid}"')
            _delete_all_filtered("proposal_hides", f'proposal = "{sid}"')
            _delete_all_filtered("proposal_comments", f'proposal = "{sid}"')

        for coll in ["ballot_responses", "question_phases", "labels", "proposals", "question_votes"]:
            _delete_all_filtered(coll, f'question = "{esc_pid}"')

    for uid in seed_user_ids:
        _delete_all_filtered("group_members", f'user = "{_esc(uid)}"')
        _delete_all_filtered("groups", f'author = "{_esc(uid)}"')

    for gid in seed_group_ids:
        _delete_all_filtered("group_members", f'group = "{_esc(gid)}"')
        try:
            pb.delete_record("groups", gid)
        except PocketBaseError:
            pass

    for pid in seed_question_ids:
        try:
            pb.delete_record("questions", pid)
        except PocketBaseError:
            pass

    for uid in seed_user_ids:
        try:
            pb.delete_record("users", uid)
        except PocketBaseError:
            pass
            
    print(f"  Deleted {len(seed_user_ids)} seed users, {len(seed_group_ids)} seed groups, and {len(seed_question_ids)} related questions.")

def setup_fresh_ideation(pb: PocketBaseClient) -> None:
    """Create questions in Ideation phase with solutions and comments."""
    SEED_PROBLEMS = [
        {
            "title": "Sustainable Urban Mobility in Dense Cities",
            "description": "<p>How can dense urban areas transition to sustainable transportation systems...</p>",
            "constraints": ["Must reduce CO2 by 40% within 10 years", "Budget-neutral for residents"],
            "proposals": [
                {
                    "title": "Integrated Micro-Transit Network",
                    "content": "<p>Deploy a network of on-demand electric micro-transit vehicles...</p>",
                    "comments": ["This could work well in areas where bus routes are underutilized."],
                }
            ],
        }
    ]

    user_names = ["Alice Chen", "Bob Martinez", "Clara Johansson", "David Okafor"]
    user_ids = []
    for i, name in enumerate(user_names):
        u = create_seed_user(pb, name, i)
        user_ids.append(u["id"])

    group1 = create_group(pb, "Urban Policy Research", user_ids[0])
    
    for i, uid in enumerate(user_ids):
        ensure_user_in_group(pb, group1["id"], uid, "Admin" if i == 0 else "Member")

    for prob_idx, prob_data in enumerate(SEED_PROBLEMS):
        author_id = user_ids[prob_idx % len(user_ids)]
        
        proposed_at = _random_past_dt(min_days=14, max_days=56)
        ideation_at = proposed_at + timedelta(days=7)
        solution_base = ideation_at + timedelta(hours=2)
        
        question = pb.create_record("questions", {
            "title": prob_data["title"],
            "description": prob_data["description"],
            "constraints": [{"description": c} for c in prob_data["constraints"]],
            "author": author_id,
            "group": group1["id"],
            "occurred_at": _iso(proposed_at),
        })
        question_id = question["id"]
        
        transition_phase(pb, question_id, "Ideation", started_at=_iso(ideation_at))
        
        for sol_idx, sol_data in enumerate(prob_data.get("proposals", [])):
            sol_author = user_ids[(prob_idx + sol_idx + 1) % len(user_ids)]
            sol_at = solution_base + timedelta(hours=sol_idx)
            
            sol = pb.create_record("proposals", {
                "question": question_id,
                "author": sol_author,
                "title": sol_data["title"],
                "content": sol_data["content"],
                "state": "Proposed",
                "occurred_at": _iso(sol_at),
            })
            
            for com_idx, comment_text in enumerate(sol_data.get("comments", [])):
                com_author = user_ids[(prob_idx + sol_idx + com_idx + 2) % len(user_ids)]
                pb.create_record("proposal_comments", {
                    "proposal": sol["id"],
                    "author": com_author,
                    "content": comment_text,
                })
        print(f"Created Ideation question: {prob_data['title']}")

