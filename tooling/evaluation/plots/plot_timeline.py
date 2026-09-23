"""Plots of idea support, colored by cluster.

Supports two rendering modes:

1. **Timeline mode** (votes have timestamps): step-function lines showing
   cumulative support over time.
2. **Snapshot mode** (only final support counts): horizontal bar chart
   with solutions grouped by cluster and ordered by emergence time.

Both modes show:
  - ◆ markers for idea emergence.
  - ★ markers for cluster champions.
  - Focus solutions highlighted (thick lines / bright bars).
"""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import matplotlib

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches
import pandas as pd

from tooling.evaluation.extract.pb_extractor import QuestionData, SolutionRecord, ActionLogRecord


# ── Color palette ──────────────────────────────────────────────────────────

_CLUSTER_CMAP = plt.get_cmap("tab10")


def _cluster_color(cluster_id: str, cluster_ids: list[str]) -> tuple:
    if not cluster_ids:
        return (0.5, 0.5, 0.5, 1.0)
    try:
        idx = cluster_ids.index(cluster_id)
    except ValueError:
        idx = 0
    return _CLUSTER_CMAP(idx % 10)


# ── Helpers ────────────────────────────────────────────────────────────────

def _truncate(text: str, maxlen: int = 30) -> str:
    if len(text) <= maxlen:
        return text
    return text[: maxlen - 1] + "…"


def _parse_ts(iso_str: str) -> float:
    if not iso_str:
        return 0
    try:
        raw = iso_str.replace("Z", "+00:00")
        return datetime.fromisoformat(raw).timestamp()
    except (ValueError, TypeError):
        return 0


# ── Champion replay (for timeline mode) ───────────────────────────────────

def _find_champion_transitions(
    timeline: pd.DataFrame,
    solutions: list[SolutionRecord],
    cluster_ids: list[str],
) -> list[dict[str, Any]]:
    """Replay the vote timeline and detect champion changes per cluster."""
    sol_by_id = {s.id: s for s in solutions}
    transitions: list[dict[str, Any]] = []
    if timeline.empty:
        return transitions

    support: dict[str, int] = {s.id: 0 for s in solutions}
    current_champion: dict[str, str] = {}

    events = timeline.sort_values("timestamp")
    for _, row in events.iterrows():
        sid = row["solution_id"]
        support[sid] = int(row["cumulative_support"])

        sol = sol_by_id.get(sid)
        if not sol:
            continue
        cid = sol.cluster_id

        cluster_members = [s for s in solutions if s.cluster_id == cid]
        best = max(
            cluster_members,
            key=lambda s: (support.get(s.id, 0), -_parse_ts(s.created)),
        )

        if support.get(best.id, 0) >= 1 and current_champion.get(cid) != best.id:
            current_champion[cid] = best.id
            transitions.append({
                "timestamp": row["timestamp"],
                "solution_id": best.id,
                "support": support[best.id],
            })

    return transitions


# ── Shared setup ──────────────────────────────────────────────────────────

def _build_cluster_info(solutions: list[SolutionRecord]):
    """Return (cluster_ids, cluster_labels) for all solutions."""
    cluster_ids_set: set[str] = set()
    for sol in solutions:
        cluster_ids_set.add(sol.cluster_id)
    cluster_ids = sorted(cluster_ids_set)

    cluster_labels: dict[str, str] = {}
    for cid in cluster_ids:
        members = [s for s in solutions if s.cluster_id == cid]
        champion = next((s for s in members if s.is_champion), None)
        if champion:
            cluster_labels[cid] = _truncate(champion.title or f"Cluster {cid}")
        elif members:
            best = max(members, key=lambda s: s.support_count)
            cluster_labels[cid] = _truncate(best.title or f"Cluster {cid}")
        else:
            cluster_labels[cid] = f"Cluster {cid}"

    return cluster_ids, cluster_labels


def _is_timeline_mode(timeline: pd.DataFrame) -> bool:
    """Return True if the timeline has actual temporal spread (not snapshot)."""
    if timeline.empty:
        return False
    t_min = timeline["timestamp"].min()
    t_max = timeline["timestamp"].max()
    # If all points clump into a 1-second window → snapshot
    diff = (t_max - t_min).total_seconds()
    # For snapshot mode the "end" column is exactly +1 day from last creation,
    # but ALL intermediate points are at creation time (support=0).
    # Detect by checking if more than 2 unique timestamps exist with support > 0.
    with_support = timeline[timeline["cumulative_support"] > 0]
    unique_ts = with_support["timestamp"].nunique()
    return unique_ts > 2 and diff > 3600  # more than 1 hour spread


# ── Snapshot bar chart ────────────────────────────────────────────────────

def _plot_snapshot(
    data: QuestionData,
    timeline: pd.DataFrame,
    *,
    output_path: str,
    figsize: tuple[float, float],
    dpi: int,
) -> str:
    """Horizontal bar chart for snapshot-mode data (no vote timestamps)."""
    solutions = data.solutions
    cluster_ids, cluster_labels = _build_cluster_info(solutions)

    # Sort solutions: by cluster order, then by creation time within cluster
    solutions_sorted = sorted(
        solutions,
        key=lambda s: (
            cluster_ids.index(s.cluster_id) if s.cluster_id in cluster_ids else 999,
            _parse_ts(s.occurred_at or s.created),
        ),
    )

    # Dynamic figure height based on solution count
    bar_height = 0.65
    n = len(solutions_sorted)
    fig_h = max(5, 1.2 + n * (bar_height + 0.15))
    fig, ax = plt.subplots(figsize=(figsize[0], fig_h))

    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")
    ax.tick_params(colors="#e0e0e0", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#333355")

    y_positions = list(range(n))
    bar_colors = []
    bar_labels = []
    bar_vals = []

    for i, sol in enumerate(solutions_sorted):
        color = _cluster_color(sol.cluster_id, cluster_ids)
        alpha = 1.0 if sol.in_focus else 0.5
        edge = "white" if sol.is_champion else "none"
        lw = 1.5 if sol.is_champion else 0

        ax.barh(
            i, sol.support_count,
            height=bar_height,
            color=(*color[:3], alpha),
            edgecolor=edge,
            linewidth=lw,
            zorder=5,
        )

        bar_vals.append(sol.support_count)

        # Title label with emergence date
        title = _truncate(sol.title, 35)
        ts = _parse_ts(sol.occurred_at or sol.created)
        emerged = ""
        if ts > 0:
            emerged = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%b %d")

        label = f"◆ {emerged}  {title}" if emerged else title
        bar_labels.append(label)

        # Champion star marker on the bar end
        if sol.is_champion:
            ax.scatter(
                [sol.support_count + 0.3], [i],
                marker="*", s=120, color=color, edgecolors="white",
                linewidths=0.6, zorder=10,
            )

    ax.set_yticks(y_positions)
    ax.set_yticklabels(bar_labels, fontsize=7.5, color="#e0e0e0")
    ax.invert_yaxis()

    ax.set_xlabel("Support (Likes)", color="#e0e0e0", fontsize=11)
    ax.set_title(
        f"Idea Support — {_truncate(data.title, 70)}",
        color="#e0e0e0", fontsize=13, fontweight="bold", pad=12,
    )

    # Cluster separator lines
    prev_cluster = None
    for i, sol in enumerate(solutions_sorted):
        if prev_cluster is not None and sol.cluster_id != prev_cluster:
            ax.axhline(y=i - 0.5, color="#555577", linewidth=0.8, linestyle="--", alpha=0.6)
        prev_cluster = sol.cluster_id

    # Legend
    legend_handles = []
    for cid in cluster_ids:
        color = _cluster_color(cid, cluster_ids)
        label = cluster_labels.get(cid, cid)
        patch = mpatches.Patch(color=color, label=label)
        legend_handles.append(patch)

    champion_marker = plt.Line2D(
        [0], [0], marker="*", color="white", markersize=10,
        linestyle="None", label="Champion ★",
    )
    focus_patch = mpatches.Patch(
        facecolor="white", alpha=0.3, label="In Focus (bright)",
    )
    legend_handles.extend([champion_marker, focus_patch])

    ax.legend(
        handles=legend_handles, loc="lower right", fontsize=7,
        facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
        ncol=min(3, max(1, len(cluster_ids))),
    )

    ax.grid(True, axis="x", alpha=0.15, color="#555577")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)

    abs_path = os.path.abspath(output_path)
    print(f"[eval] Saved plot → {abs_path}")
    return abs_path


def _get_dynamic_focus_intervals(
    timeline: pd.DataFrame, solutions: list[SolutionRecord]
) -> dict[str, list[tuple[pd.Timestamp, pd.Timestamp]]]:
    from collections import defaultdict
    intervals = defaultdict(list)
    active_focus = set()
    active_start = {}
    
    sol_by_id = {s.id: s for s in solutions}
    created_ts = {s.id: _parse_ts(s.created) for s in solutions}
    cluster_of = {s.id: s.cluster_id for s in solutions}
    
    unique_times = sorted(timeline["timestamp"].unique())
    current_support = {s.id: 0 for s in solutions}
    grouped = timeline.groupby("timestamp")
    
    for t in unique_times:
        group = grouped.get_group(t)
        for _, row in group.iterrows():
            current_support[row["solution_id"]] = row["cumulative_support"]
            
        cluster_groups = defaultdict(list)
        for sid in current_support:
            cluster_groups[cluster_of[sid]].append(sid)
            
        champion_ids = set()
        for cid, members in cluster_groups.items():
            if not members:
                continue
            best_sid = max(members, key=lambda sid: (current_support[sid], -created_ts[sid]))
            champion_ids.add(best_sid)
            
        quorum_champions = [sid for sid in champion_ids if current_support[sid] >= 9]
        quorum_champions.sort(key=lambda sid: (-current_support[sid], created_ts[sid]))
        
        new_focus = set(quorum_champions[:7])
        
        remaining = quorum_champions[7:]
        velocity_items = []
        now_ts = t.timestamp()
        for sid in remaining:
            hours = max(1.0, (now_ts - created_ts[sid]) / 3600.0)
            vel = current_support[sid] / hours
            velocity_items.append((sid, vel))
        velocity_items.sort(key=lambda x: -x[1])
        for sid, _ in velocity_items[:3]:
            new_focus.add(sid)
            
        entered = new_focus - active_focus
        exited = active_focus - new_focus
        
        for sid in entered:
            active_start[sid] = t
        for sid in exited:
            intervals[sid].append((active_start[sid], t))
            del active_start[sid]
            
        active_focus = new_focus
        
    t_max = unique_times[-1] if unique_times else pd.Timestamp.now(tz="UTC")
    for sid, st in active_start.items():
        intervals[sid].append((st, t_max))
        
    return dict(intervals)


# ── Timeline step plot ────────────────────────────────────────────────────

def _plot_timeline(
    data: QuestionData,
    timeline: pd.DataFrame,
    *,
    output_path: str,
    figsize: tuple[float, float],
    dpi: int,
) -> str:
    """Step-function timeline for data with vote timestamps."""
    solutions = data.solutions
    sol_by_id = {s.id: s for s in solutions}
    cluster_ids, cluster_labels = _build_cluster_info(solutions)

    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")
    ax.tick_params(colors="#e0e0e0", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#333355")

    if not timeline.empty:
        focus_intervals = _get_dynamic_focus_intervals(timeline, solutions)

        for sol_id in timeline["solution_id"].unique():
            sol = sol_by_id.get(sol_id)
            if not sol:
                continue

            sol_data = timeline[timeline["solution_id"] == sol_id].copy()
            sol_data = sol_data.sort_values("timestamp")

            color = _cluster_color(sol.cluster_id, cluster_ids)
            is_focus = sol.in_focus
            linewidth = 2.5 if is_focus else 1.2
            alpha = 1.0 if is_focus else 0.5
            zorder = 10 if is_focus else 2

            ax.step(
                sol_data["timestamp"], sol_data["cumulative_support"],
                where="post", color=color, linewidth=linewidth,
                alpha=alpha, zorder=zorder,
            )

            sol_intervals = focus_intervals.get(sol_id, [])

            for (t_start, t_end) in sol_intervals:
                past_events = sol_data[sol_data["timestamp"] <= t_start]
                val_start = 0 if past_events.empty else past_events.iloc[-1]["cumulative_support"]
                
                inside = sol_data[(sol_data["timestamp"] > t_start) & (sol_data["timestamp"] < t_end)]
                
                past_end = sol_data[sol_data["timestamp"] <= t_end]
                val_end = 0 if past_end.empty else past_end.iloc[-1]["cumulative_support"]
                
                chunk_times = [t_start] + list(inside["timestamp"]) + [t_end]
                chunk_vals = [val_start] + list(inside["cumulative_support"]) + [val_end]
                
                if len(chunk_times) > 1:
                    ax.step(
                        chunk_times, chunk_vals,
                        where="post", color=color, linewidth=linewidth + 3,
                        alpha=0.12, zorder=zorder - 1,
                    )

    # Emergence markers
    for sol in solutions:
        ts = _parse_ts(sol.occurred_at or sol.created)
        if ts <= 0:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        color = _cluster_color(sol.cluster_id, cluster_ids)

        ax.scatter(
            [dt], [0], marker="D", s=50, color=color,
            edgecolors="white", linewidths=0.6, zorder=15, alpha=0.9,
        )
        ax.annotate(
            _truncate(sol.title, 18), (dt, 0),
            textcoords="offset points", xytext=(0, -12),
            fontsize=5, color="#b0b0d0", ha="center", va="top",
            rotation=35, alpha=0.8,
        )

    # Champion transitions
    transitions = _find_champion_transitions(timeline, solutions, cluster_ids)
    for tr in transitions:
        sol = sol_by_id.get(tr["solution_id"])
        if not sol:
            continue
        color = _cluster_color(sol.cluster_id, cluster_ids)
        ax.scatter(
            [tr["timestamp"]], [tr["support"]],
            marker="*", s=220, color="gold",
            edgecolors="white", linewidths=0.9, zorder=20,
        )

    # Merge status markers — show synthesis solutions with their merge state
    has_merge_markers = False
    for sol in solutions:
        if sol.merge_status == "none":
            continue
        ts = _parse_ts(sol.occurred_at or sol.created)
        if ts <= 0:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        support = sol.support_count

        if sol.merge_status == "accepted":
            marker_color = "#00e676"  # green
            marker = "^"
            marker_s = 100
        elif sol.merge_status == "partial":
            marker_color = "#ffeb3b"  # yellow
            marker = "^"
            marker_s = 80
        else:  # pending_independent
            marker_color = "#ff9800"  # orange
            marker = "v"
            marker_s = 60

        ax.scatter(
            [dt], [support], marker=marker, s=marker_s, color=marker_color,
            edgecolors="white", linewidths=0.7, zorder=18, alpha=0.9,
        )
        has_merge_markers = True

    ax.set_ylabel("Cumulative Support (Likes)", color="#e0e0e0", fontsize=11)
    ax.set_xlabel("Simulated Time", color="#e0e0e0", fontsize=10)
    ax.set_title(
        f"Idea Support Timeline — {_truncate(data.title, 60)}",
        color="#e0e0e0", fontsize=13, fontweight="bold", pad=12,
    )

    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right")
    ax.grid(True, alpha=0.15, color="#555577")

    # Legend
    legend_handles = []
    for cid in cluster_ids:
        color = _cluster_color(cid, cluster_ids)
        patch = mpatches.Patch(color=color, label=f"Cluster {cid} (all variations)")
        legend_handles.append(patch)

    emerge_marker = plt.Line2D(
        [0], [0], marker="D", color="#b0b0d0", markersize=6,
        markeredgecolor="white", linestyle="None", label="Idea emerges ◆",
    )
    champion_marker = plt.Line2D(
        [0], [0], marker="*", color="gold", markersize=12,
        markeredgecolor="white", linestyle="None", label="Becomes champion ★",
    )
    focus_line = plt.Line2D(
        [0], [0], color="white", linewidth=3, alpha=0.8, label="In Focus (thick)",
    )
    legend_handles.extend([emerge_marker, champion_marker, focus_line])

    if has_merge_markers:
        merge_accepted_m = plt.Line2D(
            [0], [0], marker="^", color="#00e676", markersize=8,
            markeredgecolor="white", linestyle="None", label="Merge accepted ▲",
        )
        merge_partial_m = plt.Line2D(
            [0], [0], marker="^", color="#ffeb3b", markersize=7,
            markeredgecolor="white", linestyle="None", label="Merge partial ▲",
        )
        merge_pending_m = plt.Line2D(
            [0], [0], marker="v", color="#ff9800", markersize=6,
            markeredgecolor="white", linestyle="None", label="Merge pending ▽",
        )
        legend_handles.extend([merge_accepted_m, merge_partial_m, merge_pending_m])

    ax.legend(
        handles=legend_handles, loc="upper left", fontsize=7.5,
        facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
        ncol=min(4, max(1, len(cluster_ids) + 1)),
    )

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)

    abs_path = os.path.abspath(output_path)
    print(f"[eval] Saved plot → {abs_path}")
    return abs_path


# ── Public API ─────────────────────────────────────────────────────────────

def plot_support_timeline(
    data: QuestionData,
    timeline: pd.DataFrame,
    *,
    output_path: str = "support_timeline.png",
    figsize: tuple[float, float] = (16, 8),
    dpi: int = 150,
) -> str:
    """Auto-select the best plot type and save to *output_path*.

    Returns the absolute path to the saved figure.
    """
    if _is_timeline_mode(timeline):
        return _plot_timeline(
            data, timeline,
            output_path=output_path, figsize=figsize, dpi=dpi,
        )
    else:
        return _plot_snapshot(
            data, timeline,
            output_path=output_path, figsize=figsize, dpi=dpi,
        )


# ── Summary stats ──────────────────────────────────────────────────────────

def print_summary(data: QuestionData) -> None:
    """Print a text summary of the extracted question data."""
    solutions = data.solutions
    proposed = [s for s in solutions if s.state == "Proposed"]
    in_focus = [s for s in solutions if s.in_focus]
    champions = [s for s in solutions if s.is_champion]

    clusters: dict[str, list[SolutionRecord]] = defaultdict(list)
    for s in proposed:
        clusters[s.cluster_id].append(s)

    # Merge status breakdown
    merge_none = sum(1 for s in solutions if s.merge_status == "none")
    merge_pending = sum(1 for s in solutions if s.merge_status == "pending_independent")
    merge_partial = sum(1 for s in solutions if s.merge_status == "partial")
    merge_accepted = sum(1 for s in solutions if s.merge_status == "accepted")

    print(f"\n{'='*60}")
    print(f"Question: {data.title}")
    print(f"ID:      {data.question_id}")
    print(f"{'='*60}")
    print(f"  Solutions total:  {len(solutions)}")
    print(f"  Proposed (arena): {len(proposed)}")
    print(f"  Champions:        {len(champions)}")
    print(f"  In Focus:         {len(in_focus)}")
    print(f"  Clusters:         {len(clusters)}")
    print(f"  Votes:            {len(data.votes)}")
    print(f"  Focus quorum:     {data.focus_quorum}")
    print()
    print(f"  Merge Status:")
    print(f"    none:               {merge_none}")
    print(f"    pending_independent: {merge_pending}")
    print(f"    partial:            {merge_partial}")
    print(f"    accepted:           {merge_accepted}")
    print()

    for cid in sorted(clusters.keys()):
        members = clusters[cid]
        champ = next((s for s in members if s.is_champion), None)
        focus_count = sum(1 for s in members if s.in_focus)
        total_support = sum(s.support_count for s in members)
        merges = sum(1 for s in members if s.merge_status != "none")
        champ_label = f" ★ {_truncate(champ.title, 40)}" if champ else ""
        merge_label = f", merges={merges}" if merges else ""
        print(f"  Cluster {cid:>3s}: {len(members):3d} solutions, "
              f"support={total_support:3d}, focus={focus_count}{merge_label}{champ_label}")

    print()
