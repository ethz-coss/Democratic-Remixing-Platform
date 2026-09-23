"""Merge-specific analysis plots for simulation evaluation.

Provides four visualisation functions that focus on how merge dynamics
(pending → partial → accepted) unfold over simulated time, plus a
convenience function that generates all static plots in one call.
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

from tooling.evaluation.extract.pb_extractor import (
    QuestionData,
    SolutionRecord,
    ActionLogRecord,
    build_vote_timeline,
)


# ── Colour palette ─────────────────────────────────────────────────────────

_CLUSTER_CMAP = plt.get_cmap("tab10")

_MERGE_STATUS_COLORS: dict[str, str] = {
    "none": "#888888",
    "pending_independent": "#e67e22",
    "partial": "#f1c40f",
    "accepted": "#2ecc71",
}

_MERGE_STATUS_ORDER = ["none", "pending_independent", "partial", "accepted"]


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
    """Parse an ISO timestamp to epoch seconds. Returns 0 on failure."""
    if not iso_str:
        return 0
    try:
        raw = iso_str.replace("Z", "+00:00")
        return datetime.fromisoformat(raw).timestamp()
    except (ValueError, TypeError):
        return 0


def _apply_dark_theme(fig, ax) -> None:
    """Apply the shared dark theme to a figure + axes pair."""
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#16213e")
    ax.tick_params(colors="#e0e0e0", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#333355")
    ax.grid(True, alpha=0.15, color="#555577")


def _apply_dark_theme_ax(ax) -> None:
    """Apply the shared dark theme to an axes (no figure patch)."""
    ax.set_facecolor("#16213e")
    ax.tick_params(colors="#e0e0e0", labelsize=9)
    for spine in ax.spines.values():
        spine.set_color("#333355")
    ax.grid(True, alpha=0.15, color="#555577")


def _save_and_close(fig, output_path: str, dpi: int = 150) -> str:
    """Create output directory, save figure, close, return absolute path."""
    abs_path = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    fig.savefig(abs_path, dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"[eval] Saved plot → {abs_path}")
    return abs_path


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


# ── 1. Merge status progression (stacked area) ────────────────────────────

def plot_merge_status_progression(
    data: QuestionData,
    *,
    output_path: str,
) -> str:
    """Stacked area chart showing count of solutions in each merge_status
    over simulated time.

    X-axis: simulated time (from solution ``occurred_at`` timestamps).
    Y-axis: count of solutions.
    Areas: none (grey), pending_independent (orange), partial (yellow),
           accepted (green).

    Returns the absolute path to the saved image.
    """
    solutions = data.solutions

    # Collect all unique emergence timestamps
    events: list[tuple[float, str, str]] = []
    for sol in solutions:
        ts = _parse_ts(sol.occurred_at or sol.created)
        if ts > 0:
            events.append((ts, sol.id, sol.merge_status))

    if not events:
        # Nothing to plot — create an empty placeholder
        fig, ax = plt.subplots(figsize=(12, 6))
        _apply_dark_theme(fig, ax)
        ax.set_title("Merge Status Progression — no data", color="#e0e0e0",
                      fontsize=13, fontweight="bold")
        return _save_and_close(fig, output_path)

    events.sort(key=lambda x: x[0])

    # Build cumulative counts at each unique timestamp
    timestamps: list[datetime] = []
    counts: dict[str, list[int]] = {status: [] for status in _MERGE_STATUS_ORDER}
    current: dict[str, int] = {status: 0 for status in _MERGE_STATUS_ORDER}

    for ts_epoch, _sid, status in events:
        status_key = status if status in current else "none"
        current[status_key] += 1
        dt = datetime.fromtimestamp(ts_epoch, tz=timezone.utc)
        timestamps.append(dt)
        for s in _MERGE_STATUS_ORDER:
            counts[s].append(current[s])

    fig, ax = plt.subplots(figsize=(14, 6))
    _apply_dark_theme(fig, ax)

    # Stacked area
    y_stack = [counts[s] for s in _MERGE_STATUS_ORDER]
    colors = [_MERGE_STATUS_COLORS[s] for s in _MERGE_STATUS_ORDER]
    ax.stackplot(
        timestamps, *y_stack,
        labels=_MERGE_STATUS_ORDER,
        colors=colors,
        alpha=0.75,
        step="post",
    )

    ax.set_ylabel("Solution Count", color="#e0e0e0", fontsize=11)
    ax.set_xlabel("Simulated Time", color="#e0e0e0", fontsize=10)
    ax.set_title(
        f"Merge Status Progression — {_truncate(data.title, 60)}",
        color="#e0e0e0", fontsize=13, fontweight="bold", pad=12,
    )

    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right")

    ax.legend(
        loc="upper left", fontsize=8,
        facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
    )

    return _save_and_close(fig, output_path)


# ── 2. Merge acceptance summary (horizontal bar) ──────────────────────────

def plot_merge_acceptance_summary(
    data: QuestionData,
    *,
    output_path: str,
) -> str:
    """Horizontal bar chart summarising merge status distribution.

    Shows:
      - How many solutions have each merge_status.
      - For partial merges: how many parent clusters are absorbed
        vs total parent count.

    Returns the absolute path to the saved image.
    """
    solutions = data.solutions

    # Count solutions per status
    status_counts: dict[str, int] = {s: 0 for s in _MERGE_STATUS_ORDER}
    for sol in solutions:
        key = sol.merge_status if sol.merge_status in status_counts else "none"
        status_counts[key] += 1

    # Partial-merge absorption stats
    partial_sols = [s for s in solutions if s.merge_status == "partial"]
    total_parents_partial = sum(len(s.parent_solutions) for s in partial_sols)
    absorbed_partial = sum(len(s.absorbed_clusters) for s in partial_sols)

    fig, axes = plt.subplots(1, 2, figsize=(14, 5), gridspec_kw={"width_ratios": [2, 1]})
    fig.patch.set_facecolor("#1a1a2e")

    # ── Left panel: status distribution bar chart ──────────────────
    ax_left = axes[0]
    _apply_dark_theme_ax(ax_left)

    statuses = _MERGE_STATUS_ORDER
    counts = [status_counts[s] for s in statuses]
    colors = [_MERGE_STATUS_COLORS[s] for s in statuses]
    y_pos = range(len(statuses))

    bars = ax_left.barh(
        y_pos, counts,
        color=colors, edgecolor="#222244", linewidth=0.8,
        height=0.55, zorder=5,
    )

    # Value labels
    for bar, count in zip(bars, counts):
        if count > 0:
            ax_left.text(
                bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                str(count), va="center", ha="left",
                color="#e0e0e0", fontsize=10, fontweight="bold",
            )

    ax_left.set_yticks(list(y_pos))
    ax_left.set_yticklabels(statuses, color="#e0e0e0", fontsize=10)
    ax_left.set_xlabel("Number of Solutions", color="#e0e0e0", fontsize=10)
    ax_left.set_title(
        "Merge Status Distribution",
        color="#e0e0e0", fontsize=12, fontweight="bold", pad=10,
    )
    ax_left.invert_yaxis()

    # ── Right panel: absorption breakdown for partial merges ──────
    ax_right = axes[1]
    _apply_dark_theme_ax(ax_right)

    if partial_sols:
        remaining = max(0, total_parents_partial - absorbed_partial)
        sizes = [absorbed_partial, remaining]
        labels = [f"Absorbed ({absorbed_partial})", f"Remaining ({remaining})"]
        pie_colors = ["#2ecc71", "#e74c3c"]

        wedges, texts, autotexts = ax_right.pie(
            sizes, labels=labels, colors=pie_colors,
            autopct="%1.0f%%", startangle=90,
            textprops={"color": "#e0e0e0", "fontsize": 9},
        )
        for at in autotexts:
            at.set_color("#1a1a2e")
            at.set_fontweight("bold")

        ax_right.set_title(
            f"Partial Merges: Cluster Absorption\n({len(partial_sols)} solutions)",
            color="#e0e0e0", fontsize=10, fontweight="bold", pad=10,
        )
    else:
        ax_right.text(
            0.5, 0.5, "No partial merges",
            transform=ax_right.transAxes, ha="center", va="center",
            color="#888888", fontsize=12, style="italic",
        )
        ax_right.set_title(
            "Partial Merges: N/A",
            color="#e0e0e0", fontsize=10, fontweight="bold", pad=10,
        )
        ax_right.set_axis_off()

    fig.suptitle(
        f"Merge Acceptance — {_truncate(data.title, 55)}",
        color="#e0e0e0", fontsize=14, fontweight="bold", y=1.02,
    )
    fig.tight_layout()

    return _save_and_close(fig, output_path)


# ── 3. Merge trigger analysis (scatter) ───────────────────────────────────

def plot_merge_trigger_analysis(
    data: QuestionData,
    *,
    output_path: str,
) -> str:
    """Scatter plot showing each merge solution's support vs the max
    parent champion support, helping to understand what vote levels
    trigger merge acceptance.

    Returns the absolute path to the saved image.
    """
    solutions = data.solutions
    sol_by_id = {s.id: s for s in solutions}

    # Collect merge-related solutions
    merge_sols = [s for s in solutions if s.merge_status != "none"]

    if not merge_sols:
        fig, ax = plt.subplots(figsize=(10, 7))
        _apply_dark_theme(fig, ax)
        ax.text(
            0.5, 0.5, "No merge solutions found",
            transform=ax.transAxes, ha="center", va="center",
            color="#888888", fontsize=14, style="italic",
        )
        ax.set_title("Merge Trigger Analysis — no data", color="#e0e0e0",
                      fontsize=13, fontweight="bold")
        return _save_and_close(fig, output_path)

    fig, ax = plt.subplots(figsize=(10, 7))
    _apply_dark_theme(fig, ax)

    x_vals: list[float] = []  # max parent champion support
    y_vals: list[float] = []  # merge solution own support
    colors: list[str] = []
    labels: list[str] = []

    for sol in merge_sols:
        # Find max support among parent solutions
        parent_supports = []
        for pid in sol.parent_solutions:
            parent = sol_by_id.get(pid)
            if parent:
                parent_supports.append(parent.support_count)

        max_parent = max(parent_supports) if parent_supports else 0
        x_vals.append(max_parent)
        y_vals.append(sol.support_count)
        colors.append(_MERGE_STATUS_COLORS.get(sol.merge_status, "#888888"))
        labels.append(_truncate(sol.title, 20))

    scatter = ax.scatter(
        x_vals, y_vals,
        c=colors, s=80, alpha=0.85,
        edgecolors="white", linewidths=0.5, zorder=10,
    )

    # Diagonal reference line (merge support == parent support)
    all_vals = x_vals + y_vals
    if all_vals:
        max_val = max(all_vals) + 1
        ax.plot(
            [0, max_val], [0, max_val],
            linestyle="--", color="#555577", alpha=0.6, linewidth=1,
            label="y = x (equal support)",
        )

    # Annotate points
    for i, label in enumerate(labels):
        ax.annotate(
            label, (x_vals[i], y_vals[i]),
            textcoords="offset points", xytext=(6, 6),
            fontsize=6, color="#b0b0d0", alpha=0.85,
        )

    ax.set_xlabel("Max Parent Champion Support", color="#e0e0e0", fontsize=11)
    ax.set_ylabel("Merge Solution Support", color="#e0e0e0", fontsize=11)
    ax.set_title(
        f"Merge Trigger Analysis — {_truncate(data.title, 55)}",
        color="#e0e0e0", fontsize=13, fontweight="bold", pad=12,
    )

    # Legend
    legend_handles = []
    for status in _MERGE_STATUS_ORDER:
        if status == "none":
            continue
        patch = mpatches.Patch(
            color=_MERGE_STATUS_COLORS[status],
            label=status.replace("_", " ").title(),
        )
        legend_handles.append(patch)

    diag_line = plt.Line2D(
        [0], [0], linestyle="--", color="#555577",
        label="Equal support line",
    )
    legend_handles.append(diag_line)

    ax.legend(
        handles=legend_handles, loc="upper left", fontsize=8,
        facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
    )

    return _save_and_close(fig, output_path)


# ── 4. Likes + merges combined (two-panel) ────────────────────────────────

def plot_likes_and_merges_combined(
    data: QuestionData,
    timeline: pd.DataFrame,
    *,
    output_path: str,
) -> str:
    """Two-panel figure (vertically stacked, shared x-axis).

    Top panel
        Support timeline — step lines per solution coloured by cluster.

    Bottom panel
        Merge status change events on a timeline.  Triangles mark
        transitions:  ▲ pending→partial (yellow), ▲ partial→accepted (green).

    Returns the absolute path to the saved image.
    """
    solutions = data.solutions
    sol_by_id = {s.id: s for s in solutions}
    cluster_ids, cluster_labels = _build_cluster_info(solutions)

    fig, (ax_top, ax_bot) = plt.subplots(
        2, 1, figsize=(16, 10), sharex=True,
        gridspec_kw={"height_ratios": [2, 1]},
    )
    fig.patch.set_facecolor("#1a1a2e")
    _apply_dark_theme_ax(ax_top)
    _apply_dark_theme_ax(ax_bot)

    # ── Top panel: support timeline ───────────────────────────────
    if not timeline.empty:
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

            ax_top.step(
                sol_data["timestamp"], sol_data["cumulative_support"],
                where="post", color=color, linewidth=linewidth,
                alpha=alpha, zorder=zorder,
            )

    ax_top.set_ylabel("Cumulative Support", color="#e0e0e0", fontsize=11)
    ax_top.set_title(
        f"Support + Merge Events — {_truncate(data.title, 55)}",
        color="#e0e0e0", fontsize=13, fontweight="bold", pad=12,
    )

    # Cluster legend for top panel
    legend_handles_top = []
    for cid in cluster_ids:
        color = _cluster_color(cid, cluster_ids)
        patch = mpatches.Patch(color=color, label=cluster_labels.get(cid, cid))
        legend_handles_top.append(patch)
    if legend_handles_top:
        ax_top.legend(
            handles=legend_handles_top, loc="upper left", fontsize=7,
            facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
            ncol=min(4, max(1, len(cluster_ids))),
        )

    # ── Bottom panel: merge events ────────────────────────────────
    # Detect merge status transitions from action_logs
    merge_logs = [
        a for a in data.action_logs
        if a.action_type in (
            "merge_status_change", "merge_partial", "merge_accepted",
            "merge_pending", "cluster_absorption",
        )
    ]

    # If no explicit merge action_logs, infer events from solution timestamps
    # and their current merge_status (best-effort static markers)
    merge_events: list[dict[str, Any]] = []

    if merge_logs:
        for log in merge_logs:
            ts = _parse_ts(log.occurred_at)
            if ts <= 0:
                continue
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            sol = sol_by_id.get(log.target_id)
            new_status = log.metadata_json.get("new_status", "")
            old_status = log.metadata_json.get("old_status", "")
            merge_events.append({
                "dt": dt,
                "solution_id": log.target_id,
                "old_status": old_status,
                "new_status": new_status or (sol.merge_status if sol else ""),
                "title": sol.title if sol else log.target_id,
                "cluster_id": sol.cluster_id if sol else "",
            })
    else:
        # Fallback: place markers at solution occurred_at for non-none statuses
        for sol in solutions:
            if sol.merge_status == "none":
                continue
            ts = _parse_ts(sol.occurred_at or sol.created)
            if ts <= 0:
                continue
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)

            if sol.merge_status == "pending_independent":
                merge_events.append({
                    "dt": dt,
                    "solution_id": sol.id,
                    "old_status": "none",
                    "new_status": "pending_independent",
                    "title": sol.title,
                    "cluster_id": sol.cluster_id,
                })
            elif sol.merge_status == "partial":
                merge_events.append({
                    "dt": dt,
                    "solution_id": sol.id,
                    "old_status": "pending_independent",
                    "new_status": "partial",
                    "title": sol.title,
                    "cluster_id": sol.cluster_id,
                })
            elif sol.merge_status == "accepted":
                # Show both transitions for accepted merges
                merge_events.append({
                    "dt": dt,
                    "solution_id": sol.id,
                    "old_status": "pending_independent",
                    "new_status": "partial",
                    "title": sol.title,
                    "cluster_id": sol.cluster_id,
                })
                merge_events.append({
                    "dt": dt,
                    "solution_id": sol.id,
                    "old_status": "partial",
                    "new_status": "accepted",
                    "title": sol.title,
                    "cluster_id": sol.cluster_id,
                })

    if merge_events:
        merge_events.sort(key=lambda e: e["dt"])

        # Y position per unique solution (for vertical separation)
        unique_merge_sols = list(dict.fromkeys(e["solution_id"] for e in merge_events))
        sol_y = {sid: i for i, sid in enumerate(unique_merge_sols)}

        for ev in merge_events:
            y = sol_y[ev["solution_id"]]
            color = _cluster_color(ev["cluster_id"], cluster_ids)

            if ev["new_status"] == "partial":
                marker_color = _MERGE_STATUS_COLORS["partial"]
                marker = "^"
                size = 100
            elif ev["new_status"] == "accepted":
                marker_color = _MERGE_STATUS_COLORS["accepted"]
                marker = "^"
                size = 140
            elif ev["new_status"] == "pending_independent":
                marker_color = _MERGE_STATUS_COLORS["pending_independent"]
                marker = "o"
                size = 60
            else:
                marker_color = "#888888"
                marker = "o"
                size = 50

            ax_bot.scatter(
                [ev["dt"]], [y],
                marker=marker, s=size, color=marker_color,
                edgecolors="white", linewidths=0.6, zorder=10,
            )

        # Y-axis labels
        ax_bot.set_yticks(list(range(len(unique_merge_sols))))
        ylabels = [
            _truncate(sol_by_id[sid].title if sid in sol_by_id else sid, 25)
            for sid in unique_merge_sols
        ]
        ax_bot.set_yticklabels(ylabels, fontsize=7, color="#e0e0e0")
    else:
        ax_bot.text(
            0.5, 0.5, "No merge events detected",
            transform=ax_bot.transAxes, ha="center", va="center",
            color="#888888", fontsize=12, style="italic",
        )

    ax_bot.set_xlabel("Simulated Time", color="#e0e0e0", fontsize=10)
    ax_bot.set_ylabel("Merge Solution", color="#e0e0e0", fontsize=10)

    # Merge events legend
    legend_handles_bot = [
        plt.Line2D(
            [0], [0], marker="o", color=_MERGE_STATUS_COLORS["pending_independent"],
            markersize=8, markeredgecolor="white", linestyle="None",
            label="→ Pending Independent",
        ),
        plt.Line2D(
            [0], [0], marker="^", color=_MERGE_STATUS_COLORS["partial"],
            markersize=9, markeredgecolor="white", linestyle="None",
            label="▲ → Partial",
        ),
        plt.Line2D(
            [0], [0], marker="^", color=_MERGE_STATUS_COLORS["accepted"],
            markersize=10, markeredgecolor="white", linestyle="None",
            label="▲ → Accepted",
        ),
    ]
    ax_bot.legend(
        handles=legend_handles_bot, loc="upper left", fontsize=7.5,
        facecolor="#1a1a2e", edgecolor="#444466", labelcolor="#e0e0e0",
    )

    ax_bot.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    ax_bot.xaxis.set_major_locator(mdates.AutoDateLocator())
    plt.setp(ax_bot.xaxis.get_majorticklabels(), rotation=30, ha="right")

    fig.tight_layout()

    return _save_and_close(fig, output_path)


# ── 5. Convenience: generate all static merge plots ───────────────────────

def generate_all_merge_plots(
    data: QuestionData,
    output_dir: str,
    label: str,
    use_sub_dir: bool = True,
) -> list[str]:
    """Generate merge_progression, merge_acceptance, and merge_triggers
    plots and return a list of saved absolute paths.
    """
    if use_sub_dir:
        subdir = os.path.join(output_dir, data.question_id)
        os.makedirs(subdir, exist_ok=True)
        ts_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        prog_name = f"merge_progression_{label}_{ts_tag}.png"
        acc_name = f"merge_acceptance_{label}_{ts_tag}.png"
        trig_name = f"merge_triggers_{label}_{ts_tag}.png"
    else:
        subdir = output_dir
        os.makedirs(subdir, exist_ok=True)
        prog_name = "merge_progression.png"
        acc_name = "merge_acceptance.png"
        trig_name = "merge_triggers.png"

    paths: list[str] = []

    paths.append(
        plot_merge_status_progression(
            data,
            output_path=os.path.join(subdir, prog_name),
        )
    )
    paths.append(
        plot_merge_acceptance_summary(
            data,
            output_path=os.path.join(subdir, acc_name),
        )
    )
    paths.append(
        plot_merge_trigger_analysis(
            data,
            output_path=os.path.join(subdir, trig_name),
        )
    )

    return paths
