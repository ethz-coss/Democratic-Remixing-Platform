from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable
from datetime import datetime, timezone, timedelta

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError


@dataclass
class CleanupReport:
    run_id: str
    timeline_events_deleted: int = 0
    proposal_votes_deleted: int = 0
    proposals_deleted: int = 0
    question_votes_deleted: int = 0
    questions_deleted: int = 0
    users_deleted: int = 0
    proposal_hides_deleted: int = 0
    labels_deleted: int = 0
    ballot_responses_deleted: int = 0
    user_proposal_views_deleted: int = 0
    action_logs_deleted: int = 0
    group_members_deleted: int = 0
    simulation_runs_deleted: int = 0
    simulation_actions_deleted: int = 0

    def to_dict(self) -> dict[str, int | str]:
        return {
            "run_id": self.run_id,
            "timeline_events_deleted": self.timeline_events_deleted,
            "proposal_votes_deleted": self.proposal_votes_deleted,
            "proposals_deleted": self.proposals_deleted,
            "question_votes_deleted": self.question_votes_deleted,
            "questions_deleted": self.questions_deleted,
            "users_deleted": self.users_deleted,
            "proposal_hides_deleted": self.proposal_hides_deleted,
            "labels_deleted": self.labels_deleted,
            "ballot_responses_deleted": self.ballot_responses_deleted,
            "user_proposal_views_deleted": self.user_proposal_views_deleted,
            "action_logs_deleted": self.action_logs_deleted,
            "group_members_deleted": self.group_members_deleted,
            "simulation_runs_deleted": self.simulation_runs_deleted,
            "simulation_actions_deleted": self.simulation_actions_deleted,
        }


def _esc_filter(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _delete_records(
    pb: PocketBaseClient,
    collection: str,
    rows: Iterable[dict[str, str]],
) -> int:
    deleted = 0
    for row in rows:
        record_id = row.get("id")
        if not record_id:
            continue
        try:
            pb.delete_record(collection, record_id)
            deleted += 1
        except PocketBaseError:
            pass
    return deleted


def _safe_list(
    pb: PocketBaseClient,
    collection: str,
    filter_expr: str,
) -> list[dict[str, str]]:
    """List records, returning empty list if the collection doesn't exist."""
    try:
        return pb.get_full_list(collection, filter_expr=filter_expr)
    except PocketBaseError:
        return []


def _safe_patch(
    pb: PocketBaseClient,
    collection: str,
    record_id: str,
    data: dict,
) -> None:
    """Patch a record, ignoring errors."""
    try:
        pb.update_record(collection, record_id, data)
    except PocketBaseError:
        pass


def cleanup_run_artifacts(pb: PocketBaseClient, run_id: str) -> CleanupReport:
    report = CleanupReport(run_id=run_id)
    escaped = _esc_filter(run_id)
    run_tail = escaped[-6:]
    user_ids_to_delete: set[str] = set()

    question_rows = _safe_list(
        pb, "questions",
        filter_expr=f'title ~ "Simulation Question {escaped}"',
    )

    # Discover run artifacts via usernames.
    all_users = _safe_list(pb, "users", filter_expr="")
    user_rows = [
        row
        for row in all_users
        if (
            escaped.lower() in str(row.get("email", "")).lower()
            or (run_tail and run_tail.lower() in str(row.get("email", "")).lower())
        )
    ]
    authored_question_ids: set[str] = set()
    for user in user_rows:
        uid = user.get("id")
        if isinstance(uid, str) and uid:
            user_ids_to_delete.add(uid)
            authored = _safe_list(
                pb, "questions",
                filter_expr=f'author = "{_esc_filter(uid)}"',
            )
            for prow in authored:
                pid = prow.get("id")
                if isinstance(pid, str) and pid:
                    authored_question_ids.add(pid)
                    if all(existing.get("id") != pid for existing in question_rows):
                        question_rows.append(prow)

    question_ids = [row.get("id", "") for row in question_rows if row.get("id")]
    for row in question_rows:
        author = row.get("author")
        if isinstance(author, str) and author:
            user_ids_to_delete.add(author)

    for question_id in question_ids:
        pid = _esc_filter(question_id)

        # Question phases
        question_phase_rows = _safe_list(pb, "question_phases", filter_expr=f'question = "{pid}"')
        report.timeline_events_deleted += _delete_records(pb, "question_phases", question_phase_rows)

        # Labels for this question (must be deleted before proposals due to FK)
        label_rows = _safe_list(pb, "labels", filter_expr=f'question = "{pid}"')
        report.labels_deleted += _delete_records(pb, "labels", label_rows)

        # Ballot responses
        ballot_rows = _safe_list(pb, "ballot_responses", filter_expr=f'question = "{pid}"')
        report.ballot_responses_deleted += _delete_records(pb, "ballot_responses", ballot_rows)

        # Action logs
        action_log_rows = _safe_list(pb, "action_logs", filter_expr=f'question = "{pid}"')
        report.action_logs_deleted += _delete_records(pb, "action_logs", action_log_rows)

        # Solutions and their children
        solution_rows = _safe_list(pb, "proposals", filter_expr=f'question = "{pid}"')
        solution_ids_for_question = [s.get("id", "") for s in solution_rows if s.get("id")]

        # ── Delete FK-blocking collections BEFORE solutions ──
        for solution in solution_rows:
            uid = solution.get("author")
            if isinstance(uid, str) and uid:
                user_ids_to_delete.add(uid)
            sid_raw = solution.get("id", "")
            if not sid_raw:
                continue
            sid = _esc_filter(sid_raw)

            # Proposal votes
            vote_rows = _safe_list(pb, "proposal_votes", filter_expr=f'proposal = "{sid}"')
            for row in vote_rows:
                uid = row.get("user")
                if isinstance(uid, str) and uid:
                    user_ids_to_delete.add(uid)
            report.proposal_votes_deleted += _delete_records(pb, "proposal_votes", vote_rows)

            # Proposal hides
            hide_rows = _safe_list(pb, "proposal_hides", filter_expr=f'proposal = "{sid}"')
            report.proposal_hides_deleted += _delete_records(pb, "proposal_hides", hide_rows)

            # User proposal views
            view_rows = _safe_list(pb, "user_proposal_views", filter_expr=f'proposal = "{sid}"')
            report.user_proposal_views_deleted += _delete_records(pb, "user_proposal_views", view_rows)

        # ── Clear self-referencing FKs on proposals before deleting ──
        for sol in solution_rows:
            sid = sol.get("id", "")
            if sid:
                _safe_patch(pb, "proposals", sid, {
                    "root_proposal": "",
                    "parent_proposals": [],
                })

        report.proposals_deleted += _delete_records(pb, "proposals", solution_rows)

        # Question votes
        question_vote_rows = _safe_list(pb, "question_votes", filter_expr=f'question = "{pid}"')
        for row in question_vote_rows:
            uid = row.get("user")
            if isinstance(uid, str) and uid:
                user_ids_to_delete.add(uid)
        report.question_votes_deleted += _delete_records(pb, "question_votes", question_vote_rows)

    # ── Clear question→phase FKs before deleting questions ──
    for row in question_rows:
        pid = row.get("id", "")
        if pid:
            _safe_patch(pb, "questions", pid, {"current_phase": ""})

    report.questions_deleted += _delete_records(pb, "questions", question_rows)
    for uid in sorted(user_ids_to_delete):
        try:
            pb.delete_record("users", uid)
            report.users_deleted += 1
        except PocketBaseError:
            pass

    return report


def cleanup_all(pb: PocketBaseClient) -> CleanupReport:
    """Delete ALL simulation data from the database (not run-specific).

    Handles FK constraints by clearing blocking collections first,
    nullifying self-referencing FKs, then deleting in dependency order.
    """
    report = CleanupReport(run_id="__all__")

    # 1. Delete leaf / FK-blocking collections
    leaf_collections = [
        ("proposal_hides", "proposal_hides_deleted"),
        ("labels", "labels_deleted"),
        ("ballot_responses", "ballot_responses_deleted"),
        ("user_proposal_views", "user_proposal_views_deleted"),
        ("action_logs", "action_logs_deleted"),
        ("group_members", "group_members_deleted"),
        ("simulation_actions", "simulation_actions_deleted"),
        ("simulation_runs", "simulation_runs_deleted"),
        ("proposal_votes", "proposal_votes_deleted"),
        ("question_votes", "question_votes_deleted"),
    ]
    for coll, attr in leaf_collections:
        while True:
            rows = _safe_list(pb, coll, filter_expr="")
            if not rows:
                break
            n = _delete_records(pb, coll, rows)
            setattr(report, attr, getattr(report, attr) + n)
            if n == 0:
                break

    # 2. Clear self-referencing FKs on proposals, then delete
    while True:
        sol_rows = _safe_list(pb, "proposals", filter_expr="")
        if not sol_rows:
            break
        for sol in sol_rows:
            sid = sol.get("id", "")
            if sid:
                _safe_patch(pb, "proposals", sid, {
                    "root_proposal": "",
                    "parent_proposals": [],
                })
        n = _delete_records(pb, "proposals", sol_rows)
        report.proposals_deleted += n
        if n == 0:
            break

    # 3. Clear question→phase FK, delete phases, then questions
    prob_rows = _safe_list(pb, "questions", filter_expr="")
    for row in prob_rows:
        pid = row.get("id", "")
        if pid:
            _safe_patch(pb, "questions", pid, {"current_phase": ""})

    # Delete remaining phases
    while True:
        rows = _safe_list(pb, "question_phases", filter_expr="")
        if not rows:
            break
        n = _delete_records(pb, "question_phases", rows)
        report.timeline_events_deleted += n
        if n == 0:
            break

    report.questions_deleted += _delete_records(pb, "questions", prob_rows)

    # 4. Delete simulation users
    while True:
        rows = _safe_list(pb, "users", filter_expr="simulation = true")
        if not rows:
            break
        n = _delete_records(pb, "users", rows)
        report.users_deleted += n
        if n == 0:
            break

    return report


def cleanup_question(pb: PocketBaseClient, question_id: str, dry_run: bool = False) -> CleanupReport:
    """Delete all simulated data attached to question_id, preserving the question record itself."""
    report = CleanupReport(run_id=question_id)
    pid = _esc_filter(question_id)

    # 1. Action logs
    action_log_rows = _safe_list(pb, "action_logs", filter_expr=f'question = "{pid}"')
    if not dry_run:
        report.action_logs_deleted += _delete_records(pb, "action_logs", action_log_rows)

    # 2. Ballot responses
    ballot_rows = _safe_list(pb, "ballot_responses", filter_expr=f'question = "{pid}"')
    if not dry_run:
        report.ballot_responses_deleted += _delete_records(pb, "ballot_responses", ballot_rows)

    # 3. Labels
    label_rows = _safe_list(pb, "labels", filter_expr=f'question = "{pid}"')
    if not dry_run:
        report.labels_deleted += _delete_records(pb, "labels", label_rows)

    # 4. Proposals + their FK-children
    solution_rows = _safe_list(pb, "proposals", filter_expr=f'question = "{pid}"')

    user_ids_to_delete: set[str] = set()
    for solution in solution_rows:
        uid = solution.get("author")
        if isinstance(uid, str) and uid:
            user_ids_to_delete.add(uid)
        sid_raw = solution.get("id", "")
        if not sid_raw:
            continue
        sid = _esc_filter(sid_raw)
        if not dry_run:
            vote_rows = _safe_list(pb, "proposal_votes", filter_expr=f'proposal = "{sid}"')
            for row in vote_rows:
                u = row.get("user")
                if isinstance(u, str) and u:
                    user_ids_to_delete.add(u)
            report.proposal_votes_deleted += _delete_records(pb, "proposal_votes", vote_rows)
            report.proposal_hides_deleted += _delete_records(pb, "proposal_hides",
                _safe_list(pb, "proposal_hides", filter_expr=f'proposal = "{sid}"'))
            report.user_proposal_views_deleted += _delete_records(pb, "user_proposal_views",
                _safe_list(pb, "user_proposal_views", filter_expr=f'proposal = "{sid}"'))

    # 5. Question votes
    qvote_rows = _safe_list(pb, "question_votes", filter_expr=f'question = "{pid}"')
    if not dry_run:
        for row in qvote_rows:
            u = row.get("user")
            if isinstance(u, str) and u:
                user_ids_to_delete.add(u)
        report.question_votes_deleted += _delete_records(pb, "question_votes", qvote_rows)

    # 6. Clear self-referencing FKs, then delete proposals
    if not dry_run:
        for sol in solution_rows:
            sid = sol.get("id", "")
            if sid:
                _safe_patch(pb, "proposals", sid, {"root_proposal": "", "parent_proposals": []})
        report.proposals_deleted += _delete_records(pb, "proposals", solution_rows)

    # 7. Delete only simulated users (simulation=true flag)
    sim_users_to_delete = []
    for uid in sorted(user_ids_to_delete):
        try:
            user_rec = pb.get_record("users", uid)
            if user_rec.get("simulation") is True:
                sim_users_to_delete.append(uid)
        except PocketBaseError:
            pass
            
    if not dry_run:
        for uid in sim_users_to_delete:
            try:
                pb.delete_record("users", uid)
                report.users_deleted += 1
            except PocketBaseError:
                pass

    return report


def cleanup_group(pb: PocketBaseClient, group_name: str, delete_group: bool = False, preserve_recent_hours: int | None = None) -> CleanupReport:
    report = CleanupReport(run_id=group_name)
    groups = _safe_list(pb, "groups", filter_expr=f'name="{_esc_filter(group_name)}"')
    if not groups:
        return report

    now = datetime.now(timezone.utc)
    cutoff_time = None
    if preserve_recent_hours is not None:
        cutoff_time = now - timedelta(hours=preserve_recent_hours)

    for group in groups:
        group_id = group["id"]
        
        # Find all questions for this group
        all_questions = _safe_list(pb, "questions", filter_expr=f'group="{group_id}"')
        
        questions = []
        for q in all_questions:
            if cutoff_time is not None:
                created_str = q.get("created", "")
                if created_str:
                    try:
                        # PocketBase time format: "2026-09-11 11:55:46.959Z"
                        q_time = datetime.strptime(created_str.split(".")[0] + "Z", "%Y-%m-%d %H:%M:%SZ").replace(tzinfo=timezone.utc)
                        if q_time > cutoff_time:
                            print(f"Skipping recent question: {q.get('title')} ({q.get('id')})")
                            continue
                    except ValueError:
                        pass
            questions.append(q)

        users_to_check = set()
        
        for q in questions:
            qid = q["id"]
            if q.get("author"):
                users_to_check.add(q["author"])
                
            # Question phases
            phases = _safe_list(pb, "question_phases", filter_expr=f'question="{qid}"')
            report.timeline_events_deleted += _delete_records(pb, "question_phases", phases)
            
            # Proposals
            proposals = _safe_list(pb, "proposals", filter_expr=f'question="{qid}"')
            for p in proposals:
                if p.get("author"):
                    users_to_check.add(p["author"])
                pid = p["id"]
                # Proposal votes
                votes = _safe_list(pb, "proposal_votes", filter_expr=f'proposal="{pid}"')
                for v in votes:
                    if v.get("user"):
                        users_to_check.add(v["user"])
                report.proposal_votes_deleted += _delete_records(pb, "proposal_votes", votes)
                
                # Clear self-referencing FKs
                _safe_patch(pb, "proposals", pid, {"root_proposal": "", "parent_proposals": []})
                
            report.proposals_deleted += _delete_records(pb, "proposals", proposals)
            
            # Question votes
            q_votes = _safe_list(pb, "question_votes", filter_expr=f'question="{qid}"')
            for v in q_votes:
                if v.get("user"):
                    users_to_check.add(v["user"])
            report.question_votes_deleted += _delete_records(pb, "question_votes", q_votes)
            
            # Clear current_phase
            _safe_patch(pb, "questions", qid, {"current_phase": ""})
            
        report.questions_deleted += _delete_records(pb, "questions", questions)
        
        # Delete simulation users
        for uid in users_to_check:
            try:
                user = pb.get_record("users", uid)
                if user.get("simulation") is True:
                    pb.delete_record("users", uid)
                    report.users_deleted += 1
            except PocketBaseError:
                pass
        
        if delete_group:
            # Delete group members first
            members = _safe_list(pb, "group_members", filter_expr=f'group="{group_id}"')
            report.group_members_deleted += _delete_records(pb, "group_members", members)
            _delete_records(pb, "groups", [group])
            
    return report
