"""Additional evaluation visualizations.

Provides metric-based matplotlib plots complementing the existing
support-timeline and merge analysis charts. All plots follow the same
dark-theme visual style used in ``plot_timeline.py``.

All public functions share the signature:

    fn(data: QuestionData, output_path: str, **kwargs) -> str

and return the absolute path of the saved figure.
"""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import matplotlib

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd

from tooling.evaluation.extract.pb_extractor import QuestionData, SolutionRecord, _parse_ts

# ── Style helpers (matching plot_timeline.py dark theme) ───────────────────

_CLUSTER_CMAP = plt.get_cmap("tab10")
_DPI = 150
_BG_DARK = "#1a1a2e"
_BG_AX = "#16213e"
_TEXT_COLOR = "#e0e0e0"
_GRID_COLOR = "#555577"


def _apply_dark_style(fig: plt.Figure, ax: plt.Axes) -> None:
    """Apply the project's dark style to a figure."""
    fig.patch.set_facecolor(_BG_DARK)
    ax.set_facecolor(_BG_AX)
    ax.tick_params(colors=_TEXT_COLOR, labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#333355")
    ax.grid(True, alpha=0.15, color=_GRID_COLOR)


def _cluster_color(cluster_id: str, cluster_ids: list[str]) -> tuple:
    if not cluster_ids:
        return (0.5, 0.5, 0.5, 1.0)
    try:
        idx = cluster_ids.index(cluster_id)
    except ValueError:
        idx = 0
    return _CLUSTER_CMAP(idx % 10)


def _truncate(text: str, maxlen: int = 25) -> str:
    if len(text) <= maxlen:
        return text
    return text[: maxlen - 1] + "…"


def _save(fig: plt.Figure, path: str) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fig.savefig(path, dpi=_DPI, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return os.path.abspath(path)


# ── 1. Participation heatmap ──────────────────────────────────────────────

def plot_participation_heatmap(data: QuestionData, output_path: str) -> str:
    """Agent × time-bucket activity heatmap."""
    # Collect (user, timestamp) pairs from votes and action logs
    events: list[tuple[str, float]] = []
    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0 and v.user:
            events.append((v.user, ts))
    for log in data.action_logs:
        ts = _parse_ts(log.occurred_at)
        if ts > 0 and log.user and log.action_type not in ("focus_enter", "focus_exit"):
            events.append((log.user, ts))

    if not events:
        # Create a placeholder figure
        fig, ax = plt.subplots(figsize=(12, 4))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No participation data available",
                transform=ax.transAxes, ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    users = sorted(set(e[0] for e in events))
    timestamps = [e[1] for e in events]
    t_min, t_max = min(timestamps), max(timestamps)

    # Create time buckets (10-15 buckets)
    n_buckets = min(15, max(5, len(set(int(t) for t in timestamps)) // 2))
    bucket_edges = np.linspace(t_min, t_max + 1, n_buckets + 1)
    bucket_labels = []
    for i in range(n_buckets):
        dt = datetime.fromtimestamp(bucket_edges[i], tz=timezone.utc)
        bucket_labels.append(dt.strftime("%b %d\n%H:%M"))

    # Build heatmap matrix
    user_idx = {u: i for i, u in enumerate(users)}
    matrix = np.zeros((len(users), n_buckets), dtype=float)
    for user, ts in events:
        bucket = int(np.searchsorted(bucket_edges[1:], ts, side="left"))
        bucket = min(bucket, n_buckets - 1)
        matrix[user_idx[user], bucket] += 1

    # Sort users by total activity (most active at top)
    totals = matrix.sum(axis=1)
    sort_idx = np.argsort(-totals)
    matrix = matrix[sort_idx]
    users = [users[i] for i in sort_idx]

    # Limit to top 40 most active agents for readability
    max_agents = 40
    if len(users) > max_agents:
        matrix = matrix[:max_agents]
        users = users[:max_agents]

    fig_h = max(6, 0.3 * len(users) + 2)
    fig, ax = plt.subplots(figsize=(14, fig_h))
    _apply_dark_style(fig, ax)

    im = ax.imshow(matrix, aspect="auto", cmap="YlOrRd", interpolation="nearest")
    cbar = fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)
    cbar.set_label("Actions", color=_TEXT_COLOR, fontsize=10)
    cbar.ax.tick_params(colors=_TEXT_COLOR)

    ax.set_xticks(range(n_buckets))
    ax.set_xticklabels(bucket_labels, fontsize=7, rotation=45, ha="right")
    ax.set_yticks(range(len(users)))
    ax.set_yticklabels([u[:12] for u in users], fontsize=7)

    ax.set_xlabel("Time", color=_TEXT_COLOR, fontsize=11)
    ax.set_ylabel("Agent", color=_TEXT_COLOR, fontsize=11)
    ax.set_title("Participation Heatmap — Agent Activity Over Time",
                 color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12)

    return _save(fig, output_path)


# ── 2. Remix DAG visualization ────────────────────────────────────────────

def plot_remix_graph(data: QuestionData, output_path: str) -> str:
    """Draw the solution DAG with nodes colored by cluster."""
    try:
        import networkx as nx
    except ImportError:
        fig, ax = plt.subplots(figsize=(10, 8))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "networkx not installed", transform=ax.transAxes,
                ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    G = nx.DiGraph()
    for sol in data.solutions:
        G.add_node(sol.id)
    for sol in data.solutions:
        for pid in sol.parent_solutions:
            if pid in G:
                G.add_edge(pid, sol.id)

    if G.number_of_nodes() == 0:
        fig, ax = plt.subplots(figsize=(10, 8))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No solutions to graph", transform=ax.transAxes,
                ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    sol_by_id = {s.id: s for s in data.solutions}
    cluster_ids = sorted(set(s.cluster_id for s in data.solutions))

    try:
        # Custom Left-to-Right layout, grouped by clusters.
        # To handle potential cycles gracefully, we compute topological depth 
        # by building a strict DAG where edges only go forward in time.
        H_dag = nx.DiGraph()
        H_dag.add_nodes_from(G.nodes())
        for u, v in G.edges():
            t_u = _parse_ts(sol_by_id[u].occurred_at or sol_by_id[u].created) if u in sol_by_id else 0
            t_v = _parse_ts(sol_by_id[v].occurred_at or sol_by_id[v].created) if v in sol_by_id else 0
            if t_u < t_v or (t_u == t_v and u < v):
                H_dag.add_edge(u, v)

        # OVERRIDE G to only contain strictly forward edges! This eliminates all circle-backs
        G = H_dag

        depths = {}
        for node in nx.topological_sort(G):
            preds = list(G.predecessors(node))
            if not preds:
                depths[node] = 0
            else:
                depths[node] = max(depths[p] for p in preds) + 1

        # Group nodes by track (lineage) to visualize merges properly
        # Roots and Merge nodes start new tracks. Remixes inherit tracks.
        track_ids = {}
        for node in nx.topological_sort(G):
            preds = list(G.predecessors(node))
            if not preds:
                track_ids[node] = node
            elif len(preds) == 1:
                track_ids[node] = track_ids[preds[0]]
            else:
                track_ids[node] = node

        tracks = defaultdict(list)
        for node in G.nodes():
            tracks[track_ids[node]].append(node)
            
        def track_sort_key(tid):
            sol = sol_by_id.get(tid)
            cid = sol.cluster_id if sol else "unknown"
            
            members = [s for s in data.solutions if s.cluster_id == cid]
            champ = next((s for s in members if s.is_champion), None)
            c_title = champ.title if champ else (members[0].title if members else str(cid))
            
            return (c_title, cid, tid)
            
        sorted_tids = sorted(tracks.keys(), key=track_sort_key)
        
        pos = {}
        y_spacing = 80
        x_spacing = 150
        
        for i, tid in enumerate(sorted_tids):
            base_y = -i * y_spacing
            nodes_in_track = tracks[tid]
            
            nodes_by_depth = defaultdict(list)
            for n in nodes_in_track:
                nodes_by_depth[depths[n]].append(n)
                
            for d, nodes_at_depth in nodes_by_depth.items():
                nodes_at_depth.sort(key=lambda n: (_parse_ts(sol_by_id[n].occurred_at or sol_by_id[n].created) if n in sol_by_id else 0, n))
                count = len(nodes_at_depth)
                for j, n in enumerate(nodes_at_depth):
                    y_offset = (j - (count - 1) / 2.0) * 40
                    pos[n] = (d * x_spacing, base_y - y_offset)
                    
    except Exception as e:
        print(f"Custom layout failed: {e}")
        pos = nx.spring_layout(G, k=2.0, iterations=100, seed=42)
        unique_tids = list(dict.fromkeys(sorted_tids))

    fig, ax = plt.subplots(figsize=(16, 10))
    _apply_dark_style(fig, ax)
    ax.set_axis_off()

    # Node attributes
    node_colors = []
    node_sizes = []
    node_edgecolors = []
    node_linewidths = []
    labels = {}
    unique_tids = list(dict.fromkeys(sorted_tids))

    for nid in G.nodes():
        sol = sol_by_id.get(nid)
        if sol:
            tid = track_ids[nid]
            color = _cluster_color(tid, unique_tids)
            node_colors.append(color)
            size = max(80, 80 + sol.support_count * 30)
            node_sizes.append(min(size, 1200))
            node_edgecolors.append("gold" if sol.is_champion else "white")
            node_linewidths.append(1.5 if sol.is_champion else 0.5)
            labels[nid] = _truncate(sol.title, 15)
        else:
            node_colors.append((0.5, 0.5, 0.5, 1.0))
            node_sizes.append(80)
            node_edgecolors.append("white")
            node_linewidths.append(0.5)
            labels[nid] = nid[:8]

    # Separate edges: merge (dashed) vs remix (solid)
    merge_edges = []
    remix_edges = []
    for sol in data.solutions:
        if len(sol.parent_solutions) >= 2:
            for pid in sol.parent_solutions:
                if pid in G:
                    merge_edges.append((pid, sol.id))
        elif len(sol.parent_solutions) == 1:
            pid = sol.parent_solutions[0]
            if pid in G:
                remix_edges.append((pid, sol.id))

    nx.draw_networkx_edges(
        G, pos, edgelist=remix_edges, ax=ax,
        edge_color="#7788aa", alpha=0.6, width=1.0,
        arrows=True, arrowsize=8, arrowstyle="-|>",
        connectionstyle="arc3,rad=0.08",
    )
    nx.draw_networkx_edges(
        G, pos, edgelist=merge_edges, ax=ax,
        edge_color="#ff9800", alpha=0.7, width=1.5, style="dashed",
        arrows=True, arrowsize=10, arrowstyle="-|>",
        connectionstyle="arc3,rad=0.3",
    )

    # Draw nodes
    nx.draw_networkx_nodes(
        G, pos, ax=ax,
        node_color=node_colors, node_size=node_sizes,
        edgecolors=node_edgecolors, linewidths=node_linewidths,
        alpha=0.9,
    )

    # Labels
    nx.draw_networkx_labels(
        G, pos, labels=labels, ax=ax,
        font_size=6, font_color=_TEXT_COLOR,
    )

    # Legend
    legend_handles = []
    for cid in cluster_ids[:10]:  # limit legend entries
        color = _cluster_color(cid, cluster_ids)
        members = [s for s in data.solutions if s.cluster_id == cid]
        champ = next((s for s in members if s.is_champion), None)
        label = _truncate(champ.title, 20) if champ else f"Cluster {cid}"
        legend_handles.append(mpatches.Patch(color=color, label=label))

    legend_handles.append(plt.Line2D([0], [0], color="#7788aa", linewidth=1.0,
                                      label="Remix edge"))
    legend_handles.append(plt.Line2D([0], [0], color="#ff9800", linewidth=1.5,
                                      linestyle="dashed", label="Merge edge"))
    legend_handles.append(plt.Line2D([0], [0], marker="o", color="gold",
                                      markersize=10, markeredgecolor="gold",
                                      linestyle="None", label="Champion ★"))

    ax.legend(handles=legend_handles, loc="upper left", fontsize=7,
              facecolor=_BG_DARK, edgecolor="#444466", labelcolor=_TEXT_COLOR)

    ax.set_title("Solution Remix & Merge Graph",
                 color=_TEXT_COLOR, fontsize=14, fontweight="bold", pad=12)

    return _save(fig, output_path)


# ── 3. Convergence curve ──────────────────────────────────────────────────

def plot_convergence_curve(data: QuestionData, output_path: str) -> str:
    """Plot support Gini coefficient and effective solution count over time."""
    # Replay votes chronologically
    timed_votes: list[tuple[float, str, int]] = []
    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0:
            timed_votes.append((ts, v.solution, v.vote))

    if len(timed_votes) < 3:
        fig, ax = plt.subplots(figsize=(12, 6))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "Not enough vote data for convergence curve",
                transform=ax.transAxes, ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    timed_votes.sort(key=lambda x: x[0])

    # Compute running Gini and effective solution count
    support: dict[str, int] = defaultdict(int)
    user_votes: dict[str, dict[str, int]] = defaultdict(dict)  # user -> {sol: vote}
    gini_points: list[tuple[float, float]] = []
    eff_points: list[tuple[float, float]] = []

    # Sample at regular intervals to avoid O(n²)
    sample_interval = max(1, len(timed_votes) // 100)

    for i, (ts, sol_id, vote_val) in enumerate(timed_votes):
        # Simple accumulation (no per-user tracking for speed)
        if vote_val > 0:
            support[sol_id] += 1
        else:
            support[sol_id] = max(0, support.get(sol_id, 0) - 1)

        if i % sample_interval != 0 and i != len(timed_votes) - 1:
            continue

        values = list(support.values())
        if not values or sum(values) == 0:
            continue

        # Gini coefficient
        arr = np.array(sorted(values), dtype=float)
        n = len(arr)
        index = np.arange(1, n + 1)
        total = np.sum(arr)
        if total > 0:
            gini = float((2 * np.sum(index * arr) - (n + 1) * total) / (n * total))
        else:
            gini = 0.0
        gini_points.append((ts, gini))

        # Effective solution count (inverse HHI)
        proportions = [v / total for v in values if v > 0]
        hhi = sum(p ** 2 for p in proportions)
        eff = 1.0 / hhi if hhi > 0 else 0.0
        eff_points.append((ts, eff))

    fig, ax1 = plt.subplots(figsize=(14, 6))
    _apply_dark_style(fig, ax1)

    # Gini (left y-axis)
    if gini_points:
        gini_ts = [datetime.fromtimestamp(t, tz=timezone.utc) for t, _ in gini_points]
        gini_vals = [v for _, v in gini_points]
        ax1.plot(gini_ts, gini_vals, color="#e91e63", linewidth=2, alpha=0.9, label="Support Gini")
        ax1.fill_between(gini_ts, gini_vals, alpha=0.1, color="#e91e63")

    ax1.set_ylabel("Gini Coefficient", color="#e91e63", fontsize=11)
    ax1.set_ylim(0, 1)
    ax1.tick_params(axis="y", labelcolor="#e91e63")

    # Effective solutions (right y-axis)
    ax2 = ax1.twinx()
    ax2.set_facecolor("none")
    if eff_points:
        eff_ts = [datetime.fromtimestamp(t, tz=timezone.utc) for t, _ in eff_points]
        eff_vals = [v for _, v in eff_points]
        ax2.plot(eff_ts, eff_vals, color="#2196f3", linewidth=2, alpha=0.9,
                 linestyle="--", label="Effective Solutions")
    ax2.set_ylabel("Effective Solution Count", color="#2196f3", fontsize=11)
    ax2.tick_params(axis="y", labelcolor="#2196f3")

    ax1.set_xlabel("Simulated Time", color=_TEXT_COLOR, fontsize=10)
    ax1.set_title("Convergence: Support Concentration Over Time",
                  color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12)

    import matplotlib.dates as mdates
    ax1.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=30, ha="right")

    # Combined legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left", fontsize=9,
               facecolor=_BG_DARK, edgecolor="#444466", labelcolor=_TEXT_COLOR)

    return _save(fig, output_path)


# ── 4. Vote distribution bar chart ───────────────────────────────────────

def plot_vote_distribution(data: QuestionData, output_path: str) -> str:
    """Horizontal bar chart of solutions ranked by support count."""
    solutions = sorted(data.solutions, key=lambda s: s.support_count, reverse=True)
    solutions = [s for s in solutions if s.support_count > 0]

    if not solutions:
        fig, ax = plt.subplots(figsize=(10, 4))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No solutions with support",
                transform=ax.transAxes, ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    # Limit to top 30
    solutions = solutions[:30]
    cluster_ids = sorted(set(s.cluster_id for s in data.solutions))

    fig_h = max(5, 0.45 * len(solutions) + 2)
    fig, ax = plt.subplots(figsize=(12, fig_h))
    _apply_dark_style(fig, ax)

    y_pos = range(len(solutions))
    for i, sol in enumerate(solutions):
        color = _cluster_color(sol.cluster_id, cluster_ids)
        alpha = 1.0 if sol.in_focus else 0.65
        edge = "gold" if sol.is_champion else "none"
        lw = 2.0 if sol.is_champion else 0

        ax.barh(i, sol.support_count, height=0.6,
                color=(*color[:3], alpha), edgecolor=edge, linewidth=lw, zorder=5)

        if sol.is_champion:
            ax.scatter([sol.support_count + 0.3], [i], marker="*", s=100,
                       color="gold", edgecolors="white", linewidths=0.5, zorder=10)

    labels = [_truncate(s.title, 30) for s in solutions]
    ax.set_yticks(list(y_pos))
    ax.set_yticklabels(labels, fontsize=7.5, color=_TEXT_COLOR)
    ax.invert_yaxis()

    ax.set_xlabel("Support (Likes)", color=_TEXT_COLOR, fontsize=11)
    ax.set_title("Solution Support Ranking",
                 color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12)

    return _save(fig, output_path)


# ── 5. Action composition over time ──────────────────────────────────────

def plot_action_composition(data: QuestionData, output_path: str) -> str:
    """Stacked bar chart showing action type distribution over time buckets."""
    # Collect timestamped actions
    actions: list[tuple[float, str]] = []

    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0:
            actions.append((ts, "vote"))

    for log in data.action_logs:
        ts = _parse_ts(log.occurred_at)
        if ts > 0:
            atype = log.action_type
            if atype in ("focus_enter", "focus_exit"):
                continue
            if "merge" in atype:
                actions.append((ts, "merge"))
            elif atype in ("create_solution", "root_solution", "branch_solution"):
                actions.append((ts, "create"))
            elif "comment" in atype:
                actions.append((ts, "comment"))
            else:
                actions.append((ts, "other"))

    if not actions:
        fig, ax = plt.subplots(figsize=(12, 6))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No action data available",
                transform=ax.transAxes, ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    actions.sort()
    t_min = actions[0][0]
    t_max = actions[-1][0]

    n_buckets = min(12, max(4, len(actions) // 10))
    bucket_edges = np.linspace(t_min, t_max + 1, n_buckets + 1)
    bucket_labels = []
    for i in range(n_buckets):
        dt = datetime.fromtimestamp(bucket_edges[i], tz=timezone.utc)
        bucket_labels.append(dt.strftime("%b %d"))

    categories = ["vote", "create", "merge", "comment", "other"]
    cat_colors = {"vote": "#4caf50", "create": "#2196f3", "merge": "#ff9800",
                  "comment": "#9c27b0", "other": "#607d8b"}

    # Build matrix
    matrix = {cat: np.zeros(n_buckets) for cat in categories}
    for ts, atype in actions:
        bucket = int(np.searchsorted(bucket_edges[1:], ts, side="left"))
        bucket = min(bucket, n_buckets - 1)
        if atype in matrix:
            matrix[atype][bucket] += 1

    fig, ax = plt.subplots(figsize=(14, 6))
    _apply_dark_style(fig, ax)

    x = np.arange(n_buckets)
    width = 0.7
    bottom = np.zeros(n_buckets)

    for cat in categories:
        vals = matrix[cat]
        if np.sum(vals) == 0:
            continue
        ax.bar(x, vals, width, bottom=bottom, label=cat.capitalize(),
               color=cat_colors[cat], alpha=0.85, edgecolor="none")
        bottom += vals

    ax.set_xticks(x)
    ax.set_xticklabels(bucket_labels, fontsize=8, rotation=30, ha="right")
    ax.set_ylabel("Action Count", color=_TEXT_COLOR, fontsize=11)
    ax.set_xlabel("Time", color=_TEXT_COLOR, fontsize=10)
    ax.set_title("Action Composition Over Time",
                 color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12)

    ax.legend(loc="upper left", fontsize=9,
              facecolor=_BG_DARK, edgecolor="#444466", labelcolor=_TEXT_COLOR)

    return _save(fig, output_path)


# ── 6. Metrics comparison table ──────────────────────────────────────────

def plot_comparison_table(
    reports: list[tuple[str, "MetricsReport"]],
    output_path: str,
) -> str:
    """Render a side-by-side metrics comparison as a matplotlib table."""
    from tooling.evaluation.metrics.metrics import MetricsReport

    if not reports:
        fig, ax = plt.subplots(figsize=(8, 4))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No reports to compare",
                transform=ax.transAxes, ha="center", color=_TEXT_COLOR, fontsize=14)
        return _save(fig, output_path)

    # Select key metrics for display
    key_metrics = [
        ("participation.total_actors", "Active Participants"),
        ("participation.total_solutions", "Total Solutions"),
        ("participation.total_votes", "Total Votes"),
        ("participation.voting_engagement", "Votes/Agent"),
        ("graph.node_count", "Graph Nodes"),
        ("graph.edge_count", "Graph Edges"),
        ("graph.max_depth", "Max Remix Depth"),
        ("graph.cluster_count", "Clusters"),
        ("graph.giant_component_fraction", "Giant Component %"),
        ("merges.total_merge_solutions", "Merge Solutions"),
        ("merges.acceptance_rate", "Merge Accept Rate"),
        ("merges.siphon_ratio", "Siphon Ratio"),
        ("convergence.support_gini", "Support Gini"),
        ("convergence.effective_solution_count", "Effective Solutions"),
        ("convergence.focus_concentration", "Focus Concentration"),
    ]

    col_labels = ["Metric"] + [name for name, _ in reports]
    cell_text = []

    for key, label in key_metrics:
        row = [label]
        for _, report in reports:
            flat = report.to_flat_dict()
            val = flat.get(key, "—")
            if isinstance(val, float):
                if val < 1 and val > 0:
                    row.append(f"{val:.3f}")
                else:
                    row.append(f"{val:.1f}")
            else:
                row.append(str(val))
        cell_text.append(row)

    fig_w = max(8, 3 + 2 * len(reports))
    fig_h = max(5, 0.4 * len(key_metrics) + 2)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.patch.set_facecolor(_BG_DARK)
    ax.set_axis_off()

    table = ax.table(
        cellText=cell_text,
        colLabels=col_labels,
        loc="center",
        cellLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1.0, 1.4)

    # Style cells
    for (row, col), cell in table.get_celld().items():
        cell.set_facecolor(_BG_AX if row > 0 else "#333355")
        cell.set_edgecolor("#444466")
        cell.set_text_props(color=_TEXT_COLOR)
        if col == 0 and row > 0:
            cell.set_text_props(color=_TEXT_COLOR, fontweight="bold", ha="left")

    ax.set_title("Experiment Metrics Comparison",
                 color=_TEXT_COLOR, fontsize=14, fontweight="bold", pad=20)

    return _save(fig, output_path)


# ── Temporal Convergence Plot ──────────────────────────────────────────────

def plot_temporal_convergence(
    data: QuestionData,
    output_path: str,
    gini_curve: list[dict] | None = None,
    **kwargs: Any,
) -> str:
    """Plot Gini coefficient and effective solution count over normalized time.

    If *gini_curve* is not provided, it is computed on the fly from *data*.

    The x-axis is normalized time (0 = first vote, 1 = last vote).
    Left y-axis shows Gini (0=equal, 1=concentrated).
    Right y-axis shows effective solution count (inverse Simpson index).
    """
    from tooling.evaluation.metrics.metrics import compute_temporal_metrics

    if gini_curve is None:
        temporal = compute_temporal_metrics(data)
        gini_curve = temporal.get("gini_curve", [])

    if not gini_curve:
        fig, ax = plt.subplots(figsize=(8, 4))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No temporal data available",
                ha="center", va="center", color=_TEXT_COLOR, fontsize=12,
                transform=ax.transAxes)
        ax.set_title("Temporal Convergence", color=_TEXT_COLOR, fontsize=13, fontweight="bold")
        return _save(fig, output_path)

    t_vals = [pt["t"] for pt in gini_curve]
    gini_vals = [pt["gini"] for pt in gini_curve]
    eff_vals = [pt["effective_count"] for pt in gini_curve]

    fig, ax1 = plt.subplots(figsize=(10, 5))
    _apply_dark_style(fig, ax1)

    color_gini = "#7ec8e3"
    color_eff = "#f4a261"

    # Gini line (left axis)
    ax1.plot(t_vals, gini_vals, color=color_gini, linewidth=2.5,
             label="Gini coefficient", marker="o", markersize=4, zorder=3)
    ax1.fill_between(t_vals, gini_vals, alpha=0.15, color=color_gini)
    ax1.axhline(0.5, color=color_gini, linestyle="--", alpha=0.4, linewidth=1,
                label="Convergence threshold (0.5)")
    ax1.set_ylabel("Gini coefficient", color=color_gini, fontsize=11)
    ax1.tick_params(axis="y", colors=color_gini)
    ax1.set_ylim(-0.05, 1.05)

    # Effective count line (right axis)
    ax2 = ax1.twinx()
    ax2.set_facecolor(_BG_AX)
    ax2.plot(t_vals, eff_vals, color=color_eff, linewidth=2.5,
             label="Effective solution count", marker="s", markersize=4,
             linestyle="--", zorder=3)
    ax2.set_ylabel("Effective solution count", color=color_eff, fontsize=11)
    ax2.tick_params(axis="y", colors=color_eff)
    ax2.spines["right"].set_color(color_eff)

    ax1.set_xlabel("Normalized time (0 = first vote → 1 = last vote)",
                   color=_TEXT_COLOR, fontsize=10)
    ax1.tick_params(axis="x", colors=_TEXT_COLOR)

    # Convergence step marker
    convergence_idx = next(
        (i for i, g in enumerate(gini_vals) if g >= 0.5), None
    )
    if convergence_idx is not None:
        ax1.axvline(t_vals[convergence_idx], color="#ff6b6b", linestyle=":",
                    linewidth=1.5, label=f"Converged at t={t_vals[convergence_idx]:.2f}")

    # Combined legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper left",
               fontsize=8, facecolor=_BG_AX, edgecolor="#444466",
               labelcolor=_TEXT_COLOR)

    ax1.set_title("Temporal Convergence — Gini & Effective Solution Count",
                  color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12)
    fig.tight_layout()

    return _save(fig, output_path)


# ── Label Distribution Plot ────────────────────────────────────────────────

def plot_label_distribution(
    data: QuestionData,
    output_path: str,
    **kwargs: Any,
) -> str:
    """Plot top label clusters by proposal count and total support.

    Horizontal grouped bar chart showing for each label:
    - number of proposals (bars)
    - total support received (markers / secondary axis)
    """
    from tooling.evaluation.metrics.metrics import compute_label_metrics

    label_metrics = compute_label_metrics(data)
    top_labels = label_metrics.get("top_labels", [])

    if not top_labels:
        fig, ax = plt.subplots(figsize=(8, 4))
        _apply_dark_style(fig, ax)
        ax.text(0.5, 0.5, "No label data available",
                ha="center", va="center", color=_TEXT_COLOR, fontsize=12,
                transform=ax.transAxes)
        ax.set_title("Label Distribution", color=_TEXT_COLOR, fontsize=13, fontweight="bold")
        return _save(fig, output_path)

    names = [_truncate(lbl["name"], 20) for lbl in top_labels]
    proposal_counts = [lbl["proposal_count"] for lbl in top_labels]
    supports = [lbl["support"] for lbl in top_labels]

    y_pos = np.arange(len(names))
    fig, ax1 = plt.subplots(figsize=(10, max(4, 0.6 * len(names) + 2)))
    _apply_dark_style(fig, ax1)

    color_proposals = "#7ec8e3"
    color_support = "#f4a261"

    bars = ax1.barh(y_pos, proposal_counts, color=color_proposals, alpha=0.85,
                    label="Proposals", height=0.5)
    ax1.set_xlabel("Proposal count", color=color_proposals, fontsize=10)
    ax1.tick_params(axis="x", colors=color_proposals)
    ax1.set_yticks(y_pos)
    ax1.set_yticklabels(names, fontsize=9, color=_TEXT_COLOR)

    # Support overlay on right axis
    ax2 = ax1.twiny()
    ax2.set_facecolor(_BG_AX)
    ax2.scatter(supports, y_pos, color=color_support, zorder=5,
                s=60, marker="D", label="Total support")
    ax2.set_xlabel("Total support", color=color_support, fontsize=10)
    ax2.tick_params(axis="x", colors=color_support)
    ax2.spines["top"].set_color(color_support)

    # Value labels on bars
    for bar, count in zip(bars, proposal_counts):
        if count > 0:
            ax1.text(bar.get_width() + 0.05, bar.get_y() + bar.get_height() / 2,
                     str(count), va="center", ha="left", color=color_proposals,
                     fontsize=8)

    # Summary annotation
    coverage = label_metrics.get("label_coverage", 0)
    unique = label_metrics.get("unique_labels", 0)
    ax1.set_title(
        f"Label Distribution  (coverage={coverage:.0%}, {unique} unique labels)",
        color=_TEXT_COLOR, fontsize=13, fontweight="bold", pad=12,
    )

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="lower right",
               fontsize=8, facecolor=_BG_AX, edgecolor="#444466",
               labelcolor=_TEXT_COLOR)

    fig.tight_layout()
    return _save(fig, output_path)
