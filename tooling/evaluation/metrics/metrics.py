"""Evaluation metrics engine for simulation and human-trial data.

Computes numeric metrics from ``QuestionData`` (from either ``pb_extractor``
or ``json_extractor``).  Every metric returns a scalar or small dict of
scalars so the results can be tabled, compared, and exported to JSON/CSV.

Usage::

    from tooling.evaluation.extract.pb_extractor import extract_question_data
    from tooling.evaluation.metrics.metrics import compute_all_metrics

    data = extract_question_data(pb, question_id)
    report = compute_all_metrics(data)
    print(report.to_dict())
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import networkx as nx
import numpy as np

from tooling.evaluation.extract.pb_extractor import (
    QuestionData,
    SolutionRecord,
    VoteRecord,
    ActionLogRecord,
    _parse_ts,
)


# ── MetricsReport ──────────────────────────────────────────────────────────

@dataclass
class MetricsReport:
    """Container for all computed metrics."""

    participation: dict[str, Any] = field(default_factory=dict)
    graph: dict[str, Any] = field(default_factory=dict)
    merges: dict[str, Any] = field(default_factory=dict)
    convergence: dict[str, Any] = field(default_factory=dict)
    labels: dict[str, Any] = field(default_factory=dict)
    temporal: dict[str, Any] = field(default_factory=dict)
    behavioral: dict[str, Any] = field(default_factory=dict)
    computed_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "participation": self.participation,
            "graph": self.graph,
            "merges": self.merges,
            "convergence": self.convergence,
            "labels": self.labels,
            "temporal": self.temporal,
            "behavioral": self.behavioral,
            "computed_at": self.computed_at,
        }

    def to_flat_dict(self) -> dict[str, float]:
        """Flatten all metrics into a single dict for CSV/comparison tables."""
        flat: dict[str, float] = {}
        for category, metrics in self.to_dict().items():
            if category == "computed_at":
                continue
            if isinstance(metrics, dict):
                for key, val in metrics.items():
                    if isinstance(val, (int, float)):
                        flat[f"{category}.{key}"] = float(val)
                    elif isinstance(val, dict):
                        for k2, v2 in val.items():
                            if isinstance(v2, (int, float)):
                                flat[f"{category}.{key}.{k2}"] = float(v2)
        return flat

    def save(self, path: str) -> None:
        """Save metrics to a JSON file."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, default=str)


# ── Participation Metrics ──────────────────────────────────────────────────

def _unique_actors(data: QuestionData) -> set[str]:
    """All unique user IDs who performed any action."""
    actors: set[str] = set()
    for v in data.votes:
        if v.user:
            actors.add(v.user)
    for s in data.solutions:
        # author field isn't in SolutionRecord, but we can infer from
        # action_logs or just count solution creators
        pass
    for log in data.action_logs:
        if log.user:
            actors.add(log.user)
    return actors


def _solution_authors(data: QuestionData) -> set[str]:
    """User IDs who authored at least one solution."""
    authors: set[str] = set()
    for log in data.action_logs:
        if log.action_type in ("create_solution", "root_solution", "branch_solution",
                                "merge_solution", "focus_enter"):
            # focus_enter is logged for all actions, so filter to create types
            pass
    # Fallback: count unique users from votes as proxy for total participants
    # and look for creation events in action_logs
    create_types = {"create_solution", "root_solution", "branch_solution", "merge_solution"}
    for log in data.action_logs:
        if log.action_type in create_types and log.user:
            authors.add(log.user)
    return authors


def compute_participation_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute participation-related metrics."""
    actors = _unique_actors(data)
    authors = _solution_authors(data)
    total_solutions = len(data.solutions)
    total_votes = len([v for v in data.votes if v.vote > 0])

    # Actions per user
    action_counts: dict[str, int] = defaultdict(int)
    for v in data.votes:
        action_counts[v.user] += 1
    for log in data.action_logs:
        if log.user and log.action_type not in ("focus_enter", "focus_exit"):
            action_counts[log.user] += 1

    counts = list(action_counts.values()) if action_counts else [0]
    counts_arr = np.array(counts, dtype=float)

    # Phase activity distribution using explicit phase boundaries (if available)
    timestamps = []
    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0:
            timestamps.append(ts)
    for log in data.action_logs:
        ts = _parse_ts(log.occurred_at)
        if ts > 0:
            timestamps.append(ts)

    if data.phases:
        phase_dist = {"Proposed": 0, "AnswerSearch": 0, "Closing": 0, "Voting": 0, "Decided": 0}
        phases_by_start = []
        for p in data.phases:
            t_start = _parse_ts(p.started_at)
            t_end = _parse_ts(p.ended_at) if p.ended_at else float('inf')
            phases_by_start.append((t_start, t_end, p.phase_name))
        phases_by_start.sort(key=lambda x: x[0])
        
        for ts in timestamps:
            assigned = False
            for t_start, t_end, p_name in phases_by_start:
                if t_start <= ts <= t_end:
                    phase_dist.setdefault(p_name, 0)
                    phase_dist[p_name] += 1
                    assigned = True
                    break
            if not assigned:
                fallback_name = "Proposed"
                for t_start, t_end, p_name in phases_by_start:
                    if ts >= t_start:
                        fallback_name = p_name
                phase_dist.setdefault(fallback_name, 0)
                phase_dist[fallback_name] += 1
    else:
        phase_dist = {"early": 0, "mid": 0, "late": 0}
        if timestamps:
            t_min, t_max = min(timestamps), max(timestamps)
            t_range = t_max - t_min
            if t_range > 0:
                for ts in timestamps:
                    progress = (ts - t_min) / t_range
                    if progress < 0.33:
                        phase_dist["early"] += 1
                    elif progress < 0.66:
                        phase_dist["mid"] += 1
                    else:
                        phase_dist["late"] += 1

    # ── New calibration metrics ──────────────────────────────────────────────
    # proposals_per_actor → maps to p_create_root in BehaviorProfile
    proposals_per_actor = round(total_solutions / max(1, len(actors)), 2)

    # remix_fraction → maps to remix_probability in BehaviorProfile
    remix_count = sum(
        1 for s in data.solutions
        if s.parent_solutions and len(s.parent_solutions) == 1
    )
    remix_fraction = round(remix_count / max(1, total_solutions), 4)

    # votes_per_actor: count support events (proposal_votes + subscribe action_logs)
    # → maps to p_vote in BehaviorProfile
    support_event_count = sum(1 for v in data.votes if v.vote > 0)
    support_event_count += sum(
        1 for log in data.action_logs if log.action_type == "subscribe"
    )
    votes_per_actor = round(support_event_count / max(1, len(actors)), 2)

    # power_user_ratio: fraction of actors with >2× median action count
    # → maps to engagement_alpha/beta in BehaviorProfile
    if len(counts) > 1:
        median_actions = float(np.median(counts_arr))
        power_users = sum(1 for c in counts if c > 2 * max(1.0, median_actions))
        power_user_ratio = round(power_users / max(1, len(counts)), 4)
    else:
        power_user_ratio = 0.0

    return {
        "total_actors": len(actors),
        "total_solutions": total_solutions,
        "total_votes": total_votes,
        "content_creation_rate": len(authors) / max(1, len(actors)),
        "voting_engagement": total_votes / max(1, len(actors)),
        "actions_per_agent_mean": float(np.mean(counts_arr)),
        "actions_per_agent_median": float(np.median(counts_arr)),
        "actions_per_agent_std": float(np.std(counts_arr)),
        "actions_per_agent_max": float(np.max(counts_arr)),
        "phase_activity_distribution": phase_dist,
        # Calibration metrics (map directly to BehaviorProfile parameters)
        "proposals_per_actor": proposals_per_actor,
        "remix_fraction": remix_fraction,
        "votes_per_actor": votes_per_actor,
        "power_user_ratio": power_user_ratio,
    }


# ── Graph Metrics ──────────────────────────────────────────────────────────

def _build_solution_graph(data: QuestionData) -> nx.DiGraph:
    """Build a directed graph from solution parent relationships."""
    G = nx.DiGraph()
    for sol in data.solutions:
        G.add_node(sol.id, **{
            "title": sol.title,
            "support": sol.support_count,
            "score": sol.current_score,
            "cluster": sol.cluster_key or sol.cluster_id,
            "is_champion": sol.is_champion,
            "in_focus": sol.in_focus,
            "merge_status": sol.merge_status,
            "created": sol.created,
        })
    for sol in data.solutions:
        for pid in sol.parent_solutions:
            if pid in G:
                G.add_edge(pid, sol.id)
    return G


def compute_graph_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute graph-theoretic metrics on the solution DAG."""
    G = _build_solution_graph(data)

    if G.number_of_nodes() == 0:
        return {
            "node_count": 0, "edge_count": 0, "density": 0,
            "connected_components": 0, "giant_component_fraction": 0,
            "max_depth": 0, "mean_depth": 0, "median_depth": 0,
            "branching_factor": 0, "cluster_count": 0,
            "convergence_ratio": 0,
        }

    # Basic counts
    node_count = G.number_of_nodes()
    edge_count = G.number_of_edges()
    density = nx.density(G)

    # Connected components (undirected view)
    G_undirected = G.to_undirected()
    components = list(nx.connected_components(G_undirected))
    n_components = len(components)
    giant_size = max(len(c) for c in components) if components else 0
    giant_fraction = giant_size / max(1, node_count)

    # Depth: longest path from any root to each node
    roots = [n for n in G.nodes() if G.in_degree(n) == 0]
    depths: list[int] = []
    for root in roots:
        lengths = nx.single_source_shortest_path_length(G, root)
        depths.extend(lengths.values())
    depths_arr = np.array(depths, dtype=float) if depths else np.array([0.0])

    # Branching factor: average out-degree of non-leaf nodes
    non_leaf_degrees = [G.out_degree(n) for n in G.nodes() if G.out_degree(n) > 0]
    branching = float(np.mean(non_leaf_degrees)) if non_leaf_degrees else 0.0

    # Cluster count
    clusters = set()
    for sol in data.solutions:
        cid = sol.cluster_key or sol.cluster_id
        if cid:
            clusters.add(cid)

    # Convergence ratio: edges from merge solutions / total edges
    merge_edge_count = 0
    for sol in data.solutions:
        if len(sol.parent_solutions) >= 2:
            merge_edge_count += len(sol.parent_solutions)
    convergence_ratio = merge_edge_count / max(1, edge_count)

    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "density": round(density, 4),
        "connected_components": n_components,
        "giant_component_fraction": round(giant_fraction, 4),
        "max_depth": int(np.max(depths_arr)),
        "mean_depth": round(float(np.mean(depths_arr)), 2),
        "median_depth": round(float(np.median(depths_arr)), 2),
        "branching_factor": round(branching, 2),
        "cluster_count": len(clusters),
        "convergence_ratio": round(convergence_ratio, 4),
    }


# ── Merge Dynamics Metrics ─────────────────────────────────────────────────

def compute_merge_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute merge-related metrics."""
    total = len(data.solutions)
    merge_solutions = [s for s in data.solutions if len(s.parent_solutions) >= 2]
    n_merges = len(merge_solutions)

    status_counts = {
        "none": data.merge_none_count,
        "pending": data.merge_pending_count,
        "partial": data.merge_partial_count,
        "accepted": data.merge_accepted_count,
    }

    # Acceptance rate (out of merge proposals)
    acceptance_rate = 0.0
    if n_merges > 0:
        acceptance_rate = data.merge_accepted_count / n_merges

    # Partial rate
    partial_rate = 0.0
    if n_merges > 0:
        partial_rate = data.merge_partial_count / n_merges

    # Vote migration analysis
    migration_logs = [
        log for log in data.action_logs
        if log.action_type == "vote_migration"
    ]
    migration_count = len(migration_logs)

    # Siphon effect: compute how much total support transferred from parents
    # to children over the course of the experiment
    child_support = sum(s.support_count for s in data.solutions if s.parent_solutions)
    root_support = sum(s.support_count for s in data.solutions if not s.parent_solutions)
    total_support = child_support + root_support
    siphon_ratio = child_support / max(1, total_support)

    return {
        "total_merge_solutions": n_merges,
        "merge_fraction": round(n_merges / max(1, total), 4),
        "status_counts": status_counts,
        "acceptance_rate": round(acceptance_rate, 4),
        "partial_rate": round(partial_rate, 4),
        "vote_migration_count": migration_count,
        "siphon_ratio": round(siphon_ratio, 4),
    }


# ── Convergence Metrics ────────────────────────────────────────────────────

def _gini_coefficient(values: list[float]) -> float:
    """Compute the Gini coefficient (0=perfect equality, 1=max inequality)."""
    if not values or all(v == 0 for v in values):
        return 0.0
    arr = np.array(sorted(values), dtype=float)
    n = len(arr)
    index = np.arange(1, n + 1)
    return float((2 * np.sum(index * arr) - (n + 1) * np.sum(arr)) / (n * np.sum(arr)))


def compute_convergence_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute convergence and concentration metrics."""
    support_values = [float(s.support_count) for s in data.solutions]
    score_values = [float(s.current_score) for s in data.solutions if s.current_score > 0]

    # Gini coefficient of support distribution
    gini = _gini_coefficient(support_values)

    # Effective solution count (inverse Simpson's index)
    # Measures how many solutions effectively share the support
    total_support = sum(support_values)
    if total_support > 0:
        proportions = [v / total_support for v in support_values if v > 0]
        hhi = sum(p ** 2 for p in proportions)
        effective_count = 1.0 / hhi if hhi > 0 else 0.0
    else:
        effective_count = 0.0

    # Champion dominance: ratio of top champion support to 2nd place
    champions = [s for s in data.solutions if s.is_champion]
    champion_supports = sorted([s.support_count for s in champions], reverse=True)
    if len(champion_supports) >= 2 and champion_supports[1] > 0:
        dominance = champion_supports[0] / champion_supports[1]
    elif champion_supports:
        dominance = float(champion_supports[0])
    else:
        dominance = 0.0

    # Solutions with any support
    solutions_with_support = sum(1 for s in data.solutions if s.support_count > 0)

    # Focus concentration: fraction of total support held by focus solutions
    focus_support = sum(s.support_count for s in data.solutions if s.in_focus)
    focus_concentration = focus_support / max(1, total_support) if total_support > 0 else 0.0

    return {
        "support_gini": round(gini, 4),
        "effective_solution_count": round(effective_count, 2),
        "champion_dominance_ratio": round(dominance, 2),
        "solutions_with_support": solutions_with_support,
        "total_support": int(total_support),
        "focus_concentration": round(focus_concentration, 4),
        "champion_count": len(champions),
    }


# ── Label Metrics ───────────────────────────────────────────────────

def compute_label_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute label diversity and distribution metrics."""
    # Collect all label occurrences per solution
    all_labels: list[str] = []
    labels_per_sol: list[int] = []
    for sol in data.solutions:
        n = len(sol.labels)
        labels_per_sol.append(n)
        all_labels.extend(sol.labels)

    unique_labels = len(set(all_labels))
    total_solutions = len(data.solutions)
    solutions_with_labels = sum(1 for sol in data.solutions if sol.labels)
    label_coverage = solutions_with_labels / max(1, total_solutions)

    labels_per_sol_arr = np.array(labels_per_sol, dtype=float) if labels_per_sol else np.array([0.0])
    mean_labels = float(np.mean(labels_per_sol_arr))

    # Support per label cluster: sum support of proposals in that label
    label_support: dict[str, int] = defaultdict(int)
    for sol in data.solutions:
        for lbl in sol.labels:
            label_support[lbl] += sol.support_count

    # Singleton labels: labels used by exactly 1 proposal
    label_usage_count: dict[str, int] = defaultdict(int)
    for sol in data.solutions:
        for lbl in set(sol.labels):
            label_usage_count[lbl] += 1
    orphan_label_count = sum(1 for cnt in label_usage_count.values() if cnt == 1)

    # Gini of support across label clusters
    label_support_values = list(label_support.values())
    label_gini = _gini_coefficient([float(v) for v in label_support_values])

    # Top labels by support (resolved names if available)
    top_labels: list[dict[str, Any]] = []
    for lbl_id, sup in sorted(label_support.items(), key=lambda x: -x[1])[:10]:
        top_labels.append({
            "id": lbl_id,
            "name": data.label_names.get(lbl_id, lbl_id),
            "support": sup,
            "proposal_count": label_usage_count[lbl_id],
        })

    return {
        "unique_labels": unique_labels,
        "label_coverage": round(label_coverage, 4),
        "labels_per_proposal_mean": round(mean_labels, 2),
        "label_gini": round(label_gini, 4),
        "orphan_label_count": orphan_label_count,
        "top_labels": top_labels,
    }


# ── Temporal Convergence Metrics ───────────────────────────────────

def _compute_gini_at_snapshot(
    support_by_sol: dict[str, int],
) -> tuple[float, float]:
    """Return (gini, effective_count) for a support snapshot."""
    values = list(support_by_sol.values())
    gini = _gini_coefficient([float(v) for v in values])
    total = sum(values)
    if total > 0:
        proportions = [v / total for v in values if v > 0]
        hhi = sum(p ** 2 for p in proportions)
        effective_count = 1.0 / hhi if hhi > 0 else 0.0
    else:
        effective_count = 0.0
    return round(gini, 4), round(effective_count, 2)


def compute_temporal_metrics(data: QuestionData, n_samples: int = 12) -> dict[str, Any]:
    """Compute convergence metrics over time using the vote/action log timeline.

    Replays events chronologically and snapshots the support distribution at
    ``n_samples`` evenly-spaced time points.
    """
    # Collect all timestamped events (votes and action_logs)
    events: list[tuple[float, str, str, int]] = []  # (ts, solution_id, user, vote)

    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0:
            events.append((ts, v.solution, v.user, v.vote))

    # Also reconstruct from action_logs if richer
    # Bug 1 fix: also replay subscribe/unsubscribe as vote surrogates.
    # The WG study (and any study without a formal Voting phase) uses
    # subscribe/unsubscribe events instead of vote_like/vote_repeal.
    vote_log_types = {
        "vote_like": 1,
        "vote_repeal": 0,
        "subscribe": 1,
        "unsubscribe": 0,
    }
    for log in data.action_logs:
        if log.action_type in vote_log_types:
            ts = _parse_ts(log.occurred_at)
            if ts > 0:
                events.append((ts, log.target_id, log.user, vote_log_types[log.action_type]))
        elif log.action_type == "vote_migration":
            ts = _parse_ts(log.occurred_at)
            if ts > 0:
                from_sid = log.metadata_json.get("from_solution") if log.metadata_json else None
                to_sid = log.metadata_json.get("to_solution") if log.metadata_json else None
                if from_sid:
                    events.append((ts, from_sid, log.user, 0))
                if to_sid:
                    events.append((ts, to_sid, log.user, 1))

    if not events:
        empty_curve = [{"t": i, "gini": 0.0, "effective_count": 0.0} for i in range(n_samples)]
        return {
            "gini_curve": empty_curve,
            "effective_count_curve": empty_curve,
            "convergence_step": -1,
            "convergence_speed": 0.0,
            "stability_index": 0.0,
        }

    events.sort(key=lambda x: x[0])
    t_min = events[0][0]
    t_max = events[-1][0]
    t_range = max(1.0, t_max - t_min)

    sol_ids = {s.id for s in data.solutions}
    sample_times = [t_min + (i / max(1, n_samples - 1)) * t_range for i in range(n_samples)]

    # Replay events and snapshot at each sample time
    user_votes: dict[str, dict[str, int]] = defaultdict(dict)
    support: dict[str, int] = {sid: 0 for sid in sol_ids}
    gini_curve: list[dict[str, Any]] = []
    ev_idx = 0
    n_ev = len(events)

    for i, t_sample in enumerate(sample_times):
        # Apply all events up to t_sample
        while ev_idx < n_ev and events[ev_idx][0] <= t_sample:
            ts, sid, user, vote_val = events[ev_idx]
            if sid in sol_ids:
                old_val = user_votes[user].get(sid, 0)
                if old_val > 0 and vote_val == 0:
                    support[sid] = max(0, support[sid] - 1)
                elif old_val == 0 and vote_val > 0:
                    support[sid] += 1
                user_votes[user][sid] = vote_val
            ev_idx += 1

        gini, eff = _compute_gini_at_snapshot(support)
        progress = (t_sample - t_min) / t_range
        gini_curve.append({"t": round(progress, 4), "gini": gini, "effective_count": eff})

    # Convergence step: first sample index where gini >= 0.5, AFTER the startup phase
    # (first 25% of time is excluded since Gini is trivially high with few proposals)
    convergence_step = next(
        (i for i, pt in enumerate(gini_curve) if pt["t"] >= 0.25 and pt["gini"] >= 0.5), -1
    )

    # Convergence speed: linear regression slope on gini values
    gini_values = np.array([pt["gini"] for pt in gini_curve])
    x_vals = np.arange(len(gini_values), dtype=float)
    if len(gini_values) >= 2 and gini_values.std() > 0:
        slope = float(np.polyfit(x_vals, gini_values, 1)[0])
    else:
        slope = 0.0

    # Stability index: std dev of last 3 Gini samples
    stability = float(gini_values[-3:].std()) if len(gini_values) >= 3 else 0.0

    return {
        "gini_curve": gini_curve,
        "convergence_step": convergence_step,
        "convergence_speed": round(slope, 6),
        "stability_index": round(stability, 4),
    }


# ── Behavioral Metrics ──────────────────────────────────────────────

def compute_behavioral_metrics(data: QuestionData) -> dict[str, Any]:
    """Compute behavioral realism and deliberation quality metrics."""
    # ── Action composition ────────────────────────────────────────
    # Map raw action_type strings to canonical deliberation buckets.
    # Bug 2 fix: non-deliberative browse/navigation actions are excluded
    # entirely so the composition reflects only deliberation actions.
    action_bucket_map = {
        "root_solution": "create_root",
        "branch_solution": "create_remix",
        "merge_solution": "create_merge",
        "create_solution": "create_root",
        "create_idea": "create_root",
        "remix_singular": "create_remix",
        "vote_like": "vote_support",
        "vote_repeal": "vote_retract",
        "vote_migration": "vote_migrate",
        "accept_migration": "vote_migrate",
        "subscribe": "vote_support",
        "unsubscribe": "vote_retract",
    }
    # Non-deliberative actions are excluded from composition entirely.
    # These inflate 'other' and drown deliberation signal.
    NON_DELIBERATIVE = {
        "page_view", "proposal_view", "tab_switch", "feed_filter_change",
        "session_start", "notification_panel_open", "notification_panel_click",
        "notification_panel_dismiss", "push_notification_click",
        "compare_open", "compare_add", "compare_remove",
        "hide_proposal", "restore_proposal",
        "focus_enter", "focus_exit",
    }

    action_counts: dict[str, int] = defaultdict(int)
    total_actions = 0
    for log in data.action_logs:
        if log.action_type in NON_DELIBERATIVE:
            continue  # exclude non-deliberative actions entirely
        bucket = action_bucket_map.get(log.action_type, "other")
        action_counts[bucket] += 1
        total_actions += 1

    action_composition: dict[str, float] = {}
    for bucket, cnt in sorted(action_counts.items()):
        action_composition[bucket] = round(cnt / max(1, total_actions), 4)

    # ── Retraction rate ─────────────────────────────────────────
    vote_events = action_counts.get("vote_support", 0) + action_counts.get("vote_retract", 0)
    retraction_rate = round(
        action_counts.get("vote_retract", 0) / max(1, vote_events), 4
    )

    # ── Cross-cluster engagement (reciprocity proxy) ──────────────
    # Bug 3 fix: build user_support from BOTH proposal_votes AND
    # subscribe/unsubscribe action_logs. The WG study tracks support
    # via subscriptions, not formal votes, so data.votes alone misses
    # most support events. Latest event per user×solution wins.
    sol_by_id = {s.id: s for s in data.solutions}

    # Step 1: Collect all support events with timestamps
    # (ts, user, solution_id, vote_value)
    support_events: list[tuple[float, str, str, int]] = []
    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if v.solution and v.user:
            support_events.append((ts, v.user, v.solution, v.vote))
    for log in data.action_logs:
        if log.action_type in ("subscribe", "unsubscribe") and log.user and log.target_id:
            ts = _parse_ts(log.occurred_at)
            val = 1 if log.action_type == "subscribe" else 0
            support_events.append((ts, log.user, log.target_id, val))

    # Step 2: Replay in time order; latest event per user×solution wins
    support_events.sort(key=lambda x: x[0])
    final_support: dict[tuple[str, str], int] = {}
    for _, user, sol_id, val in support_events:
        final_support[(user, sol_id)] = val

    # Step 3: Build user_support dict from final state
    user_support: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for (user, sol_id), val in final_support.items():
        if sol_id in sol_by_id:
            user_support[user][sol_id] = val

    cross_cluster_votes = 0
    total_votes_counted = 0
    for user, sol_votes in user_support.items():
        if not sol_votes:
            continue
        # Home cluster = cluster of most-voted solution
        home_sol = max(sol_votes, key=sol_votes.get)  # type: ignore[arg-type]
        home_cluster = sol_by_id[home_sol].cluster_key if home_sol in sol_by_id else ""
        for sid, cnt in sol_votes.items():
            total_votes_counted += cnt
            sol_cluster = sol_by_id[sid].cluster_key if sid in sol_by_id else ""
            if sol_cluster and home_cluster and sol_cluster != home_cluster:
                cross_cluster_votes += cnt

    cross_cluster_engagement = round(
        cross_cluster_votes / max(1, total_votes_counted), 4
    )

    # ── Dissatisfaction ratio ────────────────────────────────
    # Bug 3 fix: use the same merged final_support (from votes + subscribe events)
    # built above, rather than re-reading data.votes which may be incomplete.
    champion_ids = {s.id for s in data.solutions if s.is_champion}
    # Build final_user_votes from the already-merged final_support dict
    final_user_votes: dict[str, dict[str, int]] = defaultdict(dict)
    for (user, sol_id), val in final_support.items():
        final_user_votes[user][sol_id] = val

    satisfied = 0
    dissatisfied = 0
    for user, votes in final_user_votes.items():
        supported_ids = {sid for sid, val in votes.items() if val > 0}
        if not supported_ids:
            continue
        if supported_ids & champion_ids:  # at least one supported proposal is a champion
            satisfied += 1
        else:
            dissatisfied += 1

    total_voters = satisfied + dissatisfied
    dissatisfaction_ratio = round(dissatisfied / max(1, total_voters), 4)

    return {
        "action_composition": action_composition,
        "retraction_rate": retraction_rate,
        "cross_cluster_engagement": cross_cluster_engagement,
        "dissatisfaction_ratio": dissatisfaction_ratio,
        "total_voting_actors": total_voters,
    }


# ── Aggregate ──────────────────────────────────────────────────────────────

def compute_all_metrics(data: QuestionData) -> MetricsReport:
    """Compute all metrics for a QuestionData instance.

    Works identically on simulated and human-generated data.
    """
    return MetricsReport(
        participation=compute_participation_metrics(data),
        graph=compute_graph_metrics(data),
        merges=compute_merge_metrics(data),
        convergence=compute_convergence_metrics(data),
        labels=compute_label_metrics(data),
        temporal=compute_temporal_metrics(data),
        behavioral=compute_behavioral_metrics(data),
        computed_at=datetime.now(timezone.utc).isoformat(),
    )
