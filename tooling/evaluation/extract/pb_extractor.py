"""Extract simulation data from PocketBase and compute derived analytics.

Provides helpers to pull solutions, votes, and question metadata for a
single question (experiment run) and to re-derive cluster assignments and
the focus set using the same algorithms as the backend engines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import pandas as pd

# ---------------------------------------------------------------------------
# We import PocketBaseClient from the existing simulation code so that
# the evaluation module can share the same connection / auth logic.
# ---------------------------------------------------------------------------
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError  # noqa: E402


# ── Data containers ────────────────────────────────────────────────────────

@dataclass
class SolutionRecord:
    id: str
    title: str
    state: str
    support_count: int
    current_score: float
    is_champion: bool
    in_focus: bool
    parent_solutions: list[str]
    root_solution: str
    merge_status: str
    base_parent: str
    created: str
    occurred_at: str

    # Persisted by backend recalc (preferred) or computed by clustering (fallback)
    cluster_key: str = ""
    # Legacy alias — kept for backwards compat with evaluation scripts
    cluster_id: str = ""
    # Graduated absorption: JSON array of absorbed parent cluster_keys
    absorbed_clusters: list[str] = field(default_factory=list)
    # Label IDs attached to this solution
    labels: list[str] = field(default_factory=list)
    # Primary (cluster) label ID
    primary_label: str = ""


@dataclass
class VoteRecord:
    id: str
    solution: str
    user: str
    vote: int
    created: str
    occurred_at: str = ""


@dataclass
class ActionLogRecord:
    id: str
    question: str
    action_type: str
    target_id: str
    occurred_at: str
    user: str = ""
    metadata_json: dict[str, Any] = field(default_factory=dict)

@dataclass
class QuestionPhaseRecord:
    id: str
    phase_name: str
    started_at: str
    ended_at: str = ""

@dataclass
class QuestionData:
    question_id: str
    title: str
    focus_quorum: int
    solutions: list[SolutionRecord]
    votes: list[VoteRecord]
    action_logs: list[ActionLogRecord]
    phases: list[QuestionPhaseRecord] = field(default_factory=list)
    # Merge summary (populated by extract_question_data)
    merge_none_count: int = 0
    merge_pending_count: int = 0
    merge_partial_count: int = 0
    merge_accepted_count: int = 0
    # Resolved label names: label_id → short_name string
    label_names: dict[str, str] = field(default_factory=dict)


# ── Extraction ─────────────────────────────────────────────────────────────

import json as _json


def _parse_absorbed(raw: Any) -> list[str]:
    """Parse the absorbed_clusters field from DB (JSON text or already a list)."""
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if not raw:
        return []
    try:
        parsed = _json.loads(str(raw))
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (ValueError, TypeError):
        pass
    return []

def _paginate_all(
    pb: PocketBaseClient,
    collection: str,
    *,
    filter_expr: str | None = None,
    sort: str | None = None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch *all* records using basic pagination (200 per page)."""
    all_items: list[dict[str, Any]] = []
    page = 1
    while True:
        params: dict[str, Any] = {"page": page, "perPage": 200}
        if filter_expr:
            params["filter"] = filter_expr
        if sort:
            params["sort"] = sort
        data = pb.request("GET", f"/api/collections/{collection}/records", params=params, token=token)
        items = data.get("items", [])
        all_items.extend(items)
        total_pages = data.get("totalPages", 1)
        if page >= total_pages or not items:
            break
        page += 1
    return all_items


def extract_question(pb: PocketBaseClient, question_id: str) -> dict[str, Any]:
    """Return the raw question record."""
    return pb.get_record("questions", question_id)


def extract_solutions(pb: PocketBaseClient, question_id: str) -> list[SolutionRecord]:
    """Pull all solutions for a question."""
    rows = _paginate_all(pb, "proposals", filter_expr=f'question = "{question_id}"')
    results: list[SolutionRecord] = []
    for r in rows:
        parent_raw = r.get("parent_proposals") or []
        parents = [str(p) for p in parent_raw] if isinstance(parent_raw, list) else []
        root_raw = r.get("root_proposal", "")
        root_id = str(root_raw[0]) if isinstance(root_raw, list) and root_raw else str(root_raw or "")
        label_raw = r.get("labels") or []
        labels = [str(l) for l in label_raw] if isinstance(label_raw, list) else []
        results.append(SolutionRecord(
            id=r["id"],
            title=r.get("title", ""),
            state=r.get("state", ""),
            support_count=int(r.get("support_count", 0) or 0),
            current_score=float(r.get("current_score", 0) or 0),
            is_champion=bool(r.get("is_champion")),
            in_focus=bool(r.get("in_focus")),
            parent_solutions=parents,
            root_solution=root_id or r["id"],
            merge_status=r.get("merge_status", "none") or "none",
            base_parent=str(r.get("base_parent", "") or ""),
            created=r.get("created", ""),
            occurred_at=r.get("occurred_at", "") or r.get("created", ""),
            cluster_key=str(r.get("cluster_key", "") or ""),
            absorbed_clusters=_parse_absorbed(r.get("absorbed_clusters", "")),
            labels=labels,
            primary_label=str(r.get("primary_label", "") or ""),
        ))
    return results


def extract_votes(pb: PocketBaseClient, question_id: str) -> list[VoteRecord]:
    """Pull all votes for solutions in this question.

    Note: the PB API for proposal_votes may not expose the ``created``
    field or support sorting by it.  We fetch without sorting and let
    consumers handle ordering.
    """
    rows = _paginate_all(
        pb, "proposal_votes",
        filter_expr=f'question = "{question_id}"',
    )
    results: list[VoteRecord] = []
    for r in rows:
        created_val = r.get("created", "")
        occurred_at_val = r.get("occurred_at", "")
        results.append(VoteRecord(
            id=r["id"],
            solution=str(r.get("proposal", "")),
            user=str(r.get("user", "")),
            vote=int(r.get("vote", 0) or 0),
            created=created_val,
            occurred_at=occurred_at_val or created_val,
        ))
    return results

def extract_action_logs(pb: PocketBaseClient, question_id: str) -> list[ActionLogRecord]:
    """Pull all action logs for a question."""
    # Action logs collection is usually named action_logs
    rows = _paginate_all(
        pb, "action_logs",
        filter_expr=f'question = "{question_id}"',
    )
    results: list[ActionLogRecord] = []
    for r in rows:
        results.append(ActionLogRecord(
            id=r["id"],
            question=str(r.get("question", "")),
            action_type=str(r.get("action_type", "")),
            target_id=str(r.get("target_id", "")),
            occurred_at=r.get("occurred_at", "") or r.get("created", ""),
            user=str(r.get("user", "")),
            metadata_json=r.get("metadata_json", {}) or {}
        ))
    return results

def extract_question_phases(pb: PocketBaseClient, question_id: str) -> list[QuestionPhaseRecord]:
    """Pull all explicit phase transitions for a question."""
    try:
        rows = _paginate_all(
            pb, "question_phases",
            filter_expr=f'question = "{question_id}"',
            sort="created",
        )
        results: list[QuestionPhaseRecord] = []
        for r in rows:
            results.append(QuestionPhaseRecord(
                id=r["id"],
                phase_name=str(r.get("phase_name", "")),
                started_at=str(r.get("started_at", "")),
                ended_at=str(r.get("ended_at", "")),
            ))
        return results
    except PocketBaseError:
        return []

# ── Clustering ──────────────────────────────────────────────────────────────

def get_clusters_from_persisted(solutions: list[SolutionRecord]) -> dict[str, str] | None:
    """Read cluster assignments from the persisted ``cluster_key`` field.

    Returns a dict mapping solution_id → cluster_key, or None if the
    backend has not yet populated cluster_key on all solutions.
    """
    result: dict[str, str] = {}
    for s in solutions:
        if not s.cluster_key:
            return None  # Not all solutions have persisted cluster_key
        result[s.id] = s.cluster_key
    return result


# ── Legacy clustering (Python port of champion-engine.ts) ──────────────────
# Kept as fallback for offline JSON data and pre-migration databases.

def _compute_ancestors(node_id: str, parent_map: dict[str, list[str]]) -> set[str]:
    """BFS/DFS to find all ancestors of a node."""
    ancestors: set[str] = set()
    stack = [node_id]
    while stack:
        current = stack.pop()
        if current in ancestors:
            continue
        ancestors.add(current)
        for p in parent_map.get(current, []):
            if p not in ancestors:
                stack.append(p)
    return ancestors






def compute_focus_set(
    solutions: list[SolutionRecord],
    focus_quorum: int,
    node_cluster: dict[str, str],
) -> set[str]:
    """Determine which champion solutions should be in focus.

    Port of score-recalc-engine.ts Step 4-5.
    """
    # Arena = Proposed solutions with score >= 1
    arena = [s for s in solutions if s.state == "Proposed" and s.current_score >= 1]
    if not arena:
        return set()

    # Group arena solutions by cluster → elect champion per cluster
    cluster_groups: dict[str, list[SolutionRecord]] = {}
    for s in arena:
        cid = node_cluster.get(s.id, "")
        cluster_groups.setdefault(cid, []).append(s)

    champion_ids: set[str] = set()
    for members in cluster_groups.values():
        best = max(members, key=lambda s: (s.current_score, -_parse_ts(s.created)))
        champion_ids.add(best.id)

    # Filter by quorum
    quorum_champions = [
        s for s in solutions if s.id in champion_ids and s.current_score >= focus_quorum
    ]

    # Top-7 by score
    quorum_champions.sort(key=lambda s: (-s.current_score, s.created))
    focus: set[str] = set()
    for s in quorum_champions[:7]:
        focus.add(s.id)

    # Remaining: top-3 by velocity
    remaining = quorum_champions[7:]
    velocity_items = []
    for s in remaining:
        created_ts = _parse_ts(s.created)
        hours = max(1, (datetime.now(timezone.utc).timestamp() - created_ts) / 3600)
        velocity = s.current_score / hours
        velocity_items.append((s.id, velocity))
    velocity_items.sort(key=lambda x: -x[1])
    for sid, _ in velocity_items[:3]:
        focus.add(sid)

    return focus


def _parse_ts(iso_str: str) -> float:
    """Parse an ISO timestamp to epoch seconds. Returns 0 on failure."""
    if not iso_str:
        return 0
    try:
        raw = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        return dt.timestamp()
    except (ValueError, TypeError):
        return 0


# ── Vote Timeline ──────────────────────────────────────────────────────────

def build_vote_timeline(
    votes: list[VoteRecord],
    action_logs: list[ActionLogRecord],
    solutions: list[SolutionRecord],
) -> pd.DataFrame:
    """Build a DataFrame of cumulative support per solution over time.

    Returns a DataFrame with columns:
        timestamp (datetime), solution_id (str), cumulative_support (int)

    When votes carry timestamps (offline / JSON mode) we replay them
    chronologically.  When timestamps are missing (live PB mode) we
    synthesise a two-point timeline per solution: support=0 at creation,
    then support=final at the end of the experiment window.
    """
    rows: list[dict[str, Any]] = []
    sol_ids = {s.id for s in solutions}

    # Check whether votes carry usable timestamps
    has_timestamps = any(_parse_ts(v.occurred_at or v.created) > 0 for v in votes) if votes else False
    
    # Alternatively, use action_logs if available and has vote_like
    vote_logs = [a for a in action_logs if a.action_type in ("vote_like", "vote_repeal", "vote_migration")]
    if vote_logs:
        has_timestamps = True

    if has_timestamps:
        # ── Replay mode (votes have timestamps) ────────────────────
        user_votes: dict[str, dict[str, int]] = {}
        support: dict[str, int] = {sid: 0 for sid in sol_ids}
        sol_by_id = {s.id: s for s in solutions}

        # Build chronological event list
        events = []

        # 1. Base events for solution creation (support = 0)
        for sol in solutions:
            ts = _parse_ts(sol.occurred_at or sol.created)
            if ts > 0:
                events.append({
                    "timestamp": ts,
                    "solution_id": sol.id,
                    "user": "",
                    "vote": -1,  # Special marker for solution creation
                })

        # 2. Events from votes (likes and repeals)
        if vote_logs:
            for log in vote_logs:
                ts_vote = _parse_ts(log.occurred_at)
                if ts_vote <= 0:
                    continue
                if log.action_type == "vote_migration":
                    # Emit repeal for from_solution and like for to_solution
                    from_sid = log.metadata_json.get("from_solution")
                    to_sid = log.metadata_json.get("to_solution")
                    if from_sid and from_sid in sol_ids:
                        events.append({
                            "timestamp": ts_vote,
                            "solution_id": from_sid,
                            "user": log.user,
                            "vote": 0
                        })
                    if to_sid and to_sid in sol_ids:
                        events.append({
                            "timestamp": ts_vote,
                            "solution_id": to_sid,
                            "user": log.user,
                            "vote": 1
                        })
                else:
                    if log.target_id not in sol_ids:
                        continue
                    events.append({
                        "timestamp": ts_vote,
                        "solution_id": log.target_id,
                        "user": log.user,
                        "vote": 1 if log.action_type == "vote_like" else 0
                    })
        else:
            for v in votes:
                if v.solution not in sol_ids:
                    continue
    
                ts_vote = _parse_ts(v.occurred_at or v.created)
                if ts_vote <= 0:
                    continue
    
                if v.vote > 0:
                    # Active like
                    events.append({
                        "timestamp": ts_vote,
                        "solution_id": v.solution,
                        "user": v.user,
                        "vote": 1,
                    })
                else:
                    # Repealed like:
                    # If there isn't already a recorded positive vote in this dataset for this user-solution,
                    # we assume the user liked it earlier. Place that original like at solution creation time.
                    has_positive_vote = any(
                        other.user == v.user and other.solution == v.solution and other.vote > 0
                        for other in votes
                    )
                    if not has_positive_vote:
                        sol = sol_by_id[v.solution]
                        ts_sol = _parse_ts(sol.occurred_at or sol.created)
                        events.append({
                            "timestamp": ts_sol + 0.1,  # Slightly after creation to avoid collision
                            "solution_id": v.solution,
                            "user": v.user,
                            "vote": 1,
                        })
    
                    # Record the repeal at vote's occurred_at
                    events.append({
                        "timestamp": ts_vote,
                        "solution_id": v.solution,
                        "user": v.user,
                        "vote": 0,
                    })

        # Sort events chronologically (creation first (-1), then likes (1), then repeals (0))
        events.sort(key=lambda x: (x["timestamp"], x["vote"]))

        for ev in events:
            sid = ev["solution_id"]
            if ev["vote"] == -1:
                rows.append({
                    "timestamp": datetime.fromtimestamp(ev["timestamp"], tz=timezone.utc),
                    "solution_id": sid,
                    "cumulative_support": 0,
                })
            else:
                user_sol_votes = user_votes.setdefault(ev["user"], {})
                old_vote = user_sol_votes.get(sid, 0)
                new_vote = ev["vote"]

                if old_vote > 0 and new_vote == 0:
                    support[sid] = max(0, support[sid] - 1)
                elif old_vote == 0 and new_vote > 0:
                    support[sid] = support[sid] + 1
                user_sol_votes[sid] = new_vote

                rows.append({
                    "timestamp": datetime.fromtimestamp(ev["timestamp"], tz=timezone.utc),
                    "solution_id": sid,
                    "cumulative_support": support[sid],
                })
    else:
        # ── Snapshot mode (votes have NO timestamps) ───────────────
        # Count unique supporters per solution from vote records
        support_by_sol: dict[str, set[str]] = {sid: set() for sid in sol_ids}
        for v in votes:
            if v.solution in sol_ids and v.vote > 0:
                support_by_sol[v.solution].add(v.user)

        # For each solution create two points: 0 at creation, final
        # support at "end" (latest solution creation + 1 day)
        creation_times: list[float] = []
        for sol in solutions:
            ts = _parse_ts(sol.occurred_at or sol.created)
            if ts > 0:
                creation_times.append(ts)

        if not creation_times:
            return pd.DataFrame(columns=["timestamp", "solution_id", "cumulative_support"])

        t_end = max(creation_times) + 86400  # +1 day

        for sol in solutions:
            ts = _parse_ts(sol.occurred_at or sol.created)
            if ts <= 0:
                continue
            support_count = len(support_by_sol.get(sol.id, set()))
            # Prefer the stored support_count if our count is zero
            if support_count == 0:
                support_count = sol.support_count

            dt_created = datetime.fromtimestamp(ts, tz=timezone.utc)
            dt_end = datetime.fromtimestamp(t_end, tz=timezone.utc)

            rows.append({
                "timestamp": dt_created,
                "solution_id": sol.id,
                "cumulative_support": 0,
            })
            rows.append({
                "timestamp": dt_end,
                "solution_id": sol.id,
                "cumulative_support": support_count,
            })

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values("timestamp").reset_index(drop=True)
    return df


# ── High-level extraction ─────────────────────────────────────────────────

def extract_question_data(pb: PocketBaseClient, question_id: str) -> QuestionData:
    """One-shot extraction of all data needed for evaluation plots."""
    question_rec = extract_question(pb, question_id)
    solutions = extract_solutions(pb, question_id)
    votes = extract_votes(pb, question_id)
    try:
        action_logs = extract_action_logs(pb, question_id)
    except PocketBaseError:
        action_logs = []

    phases = extract_question_phases(pb, question_id)

    focus_quorum = int(question_rec.get("focus_quorum", 1) or 1)

    # Use support_count as score when current_score is not populated
    for sol in solutions:
        if sol.current_score == 0 and sol.support_count > 0:
            sol.current_score = float(sol.support_count)

    # Read persisted clusters from backend (preferred)
    cluster_map = get_clusters_from_persisted(solutions)
    if cluster_map is None:
        cluster_map = {}
    for sol in solutions:
        sol.cluster_key = cluster_map.get(sol.id, "")
        sol.cluster_id = sol.cluster_key  # backwards compat alias

    # Compute champions and focus when DB doesn't populate them
    any_champion = any(s.is_champion for s in solutions)
    any_focus = any(s.in_focus for s in solutions)

    if not any_champion:
        # Elect champion per cluster: highest support_count wins
        cluster_groups: dict[str, list[SolutionRecord]] = {}
        for s in solutions:
            if s.state == "Proposed":
                cluster_groups.setdefault(s.cluster_id, []).append(s)
        for members in cluster_groups.values():
            best = max(
                members,
                key=lambda s: (s.support_count, -_parse_ts(s.occurred_at or s.created)),
            )
            best.is_champion = True

    if not any_focus:
        focus_ids = compute_focus_set(solutions, focus_quorum, cluster_map)
        for sol in solutions:
            sol.in_focus = sol.id in focus_ids

    # Compute merge summary
    merge_none = sum(1 for s in solutions if s.merge_status == "none")
    merge_pending = sum(1 for s in solutions if s.merge_status == "pending_independent")
    merge_partial = sum(1 for s in solutions if s.merge_status == "partial")
    merge_accepted = sum(1 for s in solutions if s.merge_status == "accepted")

    # Resolve label names from PocketBase for metric computation
    label_names: dict[str, str] = {}
    label_ids: set[str] = set()
    for sol in solutions:
        label_ids.update(sol.labels)
        if sol.primary_label:
            label_ids.add(sol.primary_label)
    if label_ids:
        try:
            # Batch fetch: split into chunks to avoid overly long filter expressions
            chunk_size = 30
            label_id_list = list(label_ids)
            for i in range(0, len(label_id_list), chunk_size):
                chunk = label_id_list[i:i + chunk_size]
                filter_expr = " || ".join(f'id = "{lid}"' for lid in chunk)
                label_records = _paginate_all(pb, "labels", filter_expr=filter_expr)
                for lr in label_records:
                    label_names[lr["id"]] = str(lr.get("short_name", "") or lr["id"])
        except PocketBaseError:
            pass

    return QuestionData(
        question_id=question_id,
        title=question_rec.get("title", question_id),
        focus_quorum=focus_quorum,
        solutions=solutions,
        votes=votes,
        action_logs=action_logs,
        phases=phases,
        merge_none_count=merge_none,
        merge_pending_count=merge_pending,
        merge_partial_count=merge_partial,
        merge_accepted_count=merge_accepted,
        label_names=label_names,
    )
