from __future__ import annotations
import sys
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.models import SimulationReport, RoundSnapshot, EvaluationSnapshot, SimSolution


class SnapshotCapture:
    def __init__(self, pb: PocketBaseClient):
        self.pb = pb

    def capture_snapshot(self, proposed: list[SimSolution], report: SimulationReport, simulated_now_iso: str) -> None:
        cluster_keys = set()
        for s in proposed:
            pl = getattr(s, 'primary_label', '') or ''
            if pl:
                cluster_keys.add(pl)
        total_votes = sum(s.current_vote_count for s in proposed)
        report.snapshots.append(
            RoundSnapshot(
                round_index=len(report.snapshots) + 1,
                proposed_count=len(proposed),
                pending_merge_count=0,
                partial_merge_count=0,
                accepted_merge_count=0,
                total_vote_count=total_votes,
                cluster_count=len(cluster_keys) if cluster_keys else 0,
                simulated_at=simulated_now_iso,
            )
        )

    def log_progress(
        self, step: int, elapsed_days: int, proposed_count: int, report: SimulationReport
    ) -> None:
        print(
            f"[progress] step={step} days={elapsed_days} proposed={proposed_count} "
            f"events={len(report.time_events)} decisions={len(report.decision_log)}",
            file=sys.stderr,
            flush=True,
        )

    def capture_evaluation_snapshot(self, question_id: str) -> EvaluationSnapshot:
        """Capture all proposal states, votes, and labels for self-contained analysis."""
        snapshot = EvaluationSnapshot()

        # Proposals
        try:
            page = 1
            while True:
                rows = self.pb.list_records(
                    "proposals",
                    filter_expr=f'question = "{question_id}"',
                    per_page=100,
                    page=page,
                )
                if not rows:
                    break
                for row in rows:
                    snapshot.proposals.append({
                        "id": row.get("id", ""),
                        "title": row.get("title", ""),
                        "state": row.get("state", ""),
                        "subscription_count": int(row.get("subscription_count", 0) or 0),
                        "labels": [str(lid) for lid in (row.get("labels") or [])],
                        "primary_label": str(row.get("primary_label") or ""),
                        "in_focus": bool(row.get("in_focus")),
                        "is_champion": bool(row.get("is_champion")),
                        "parent_proposals": [str(pid) for pid in (row.get("parent_proposals") or [])],
                        "author": row.get("author", ""),
                        "created": row.get("created", ""),
                    })
                if len(rows) < 100:
                    break
                page += 1
        except PocketBaseError as e:
            print(f"[eval-snapshot] failed to fetch proposals: {e}", file=sys.stderr)

        # Votes
        try:
            page = 1
            while True:
                vote_rows = self.pb.list_records(
                    "proposal_votes",
                    filter_expr=f'question = "{question_id}"',
                    per_page=500,
                    page=page,
                )
                if not vote_rows:
                    break
                for v in vote_rows:
                    snapshot.votes.append({
                        "user": v.get("user", ""),
                        "proposal": v.get("proposal", ""),
                        "vote": int(v.get("vote", 0) or 0),
                    })
                if len(vote_rows) < 500:
                    break
                page += 1
        except PocketBaseError as e:
            print(f"[eval-snapshot] failed to fetch votes: {e}", file=sys.stderr)

        # Labels (collect unique label IDs from proposals, then fetch)
        label_ids = set()
        for p in snapshot.proposals:
            for lid in p.get("labels", []):
                if lid:
                    label_ids.add(lid)
        if label_ids:
            try:
                l_list = list(label_ids)
                # fetch in batches to avoid extremely long filter strings
                for i in range(0, len(l_list), 50):
                    batch = l_list[i:i+50]
                    id_filter = " || ".join(f'id = "{lid}"' for lid in batch)
                    label_rows = self.pb.get_full_list(
                        "labels",
                        filter_expr=id_filter,
                    )
                    for l in label_rows:
                        snapshot.labels.append({
                            "id": l.get("id", ""),
                            "short_name": l.get("short_name", ""),
                            "color": l.get("color", ""),
                        })
            except PocketBaseError as e:
                print(f"[eval-snapshot] failed to fetch labels: {e}", file=sys.stderr)

        return snapshot
