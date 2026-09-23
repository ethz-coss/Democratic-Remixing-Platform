"""Experiment bundle: self-contained package of simulation data.

A bundle groups everything needed to reproduce and analyse one experiment:
config, raw report, extracted data tables (CSV), computed metrics, plots,
and a human-readable summary.

Usage::

    from tooling.evaluation.bundle.bundle import create_bundle, load_bundle

    bundle_dir = create_bundle(
        run_id="exp_day30",
        config=config,
        report_json_path="output/exp_day30.json",
        question_data=data,
        metrics_report=metrics,
        plot_paths=["output/plots/support_timeline.png"],
    )

    bundle = load_bundle(bundle_dir)
"""

from __future__ import annotations

import csv
import json
import os
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from tooling.evaluation.bundle.config_schema import ExperimentConfig, save_config, load_config, diff_configs
from tooling.evaluation.metrics.metrics import MetricsReport
from tooling.evaluation.extract.pb_extractor import QuestionData, SolutionRecord, VoteRecord


# ── ExperimentBundle ───────────────────────────────────────────────────────

@dataclass
class ExperimentBundle:
    """In-memory handle to a bundle directory."""
    bundle_dir: str
    run_id: str
    config: ExperimentConfig | None = None
    metrics: MetricsReport | None = None
    question_data: QuestionData | None = None
    timestamp: str = ""


def create_bundle(
    run_id: str,
    config: "ExperimentConfig | None",
    report_json_path: str | None,
    question_data: "QuestionData | None",
    metrics_report: "MetricsReport | None",
    plot_paths: list[str] | None = None,
    output_root: str | None = None,
    bundle_dir_override: str | None = None,
) -> str:
    """Create a self-contained experiment bundle directory.

    Returns the path to the created bundle directory.
    """
    if bundle_dir_override:
        bundle_dir = bundle_dir_override
    else:
        simulations_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        root = output_root or os.path.join(simulations_root, "output", "experiments")

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_id = run_id.replace("/", "_").replace(" ", "_")[:40]
        bundle_dir = os.path.join(root, f"{safe_id}_{ts}")

    # Create directory structure
    os.makedirs(os.path.join(bundle_dir, "extracted"), exist_ok=True)
    os.makedirs(os.path.join(bundle_dir, "plots"), exist_ok=True)

    # ── 1. Save config ──
    if config:
        save_config(config, os.path.join(bundle_dir, "config.yaml"))

    # ── 2. Copy raw report ──
    if report_json_path and os.path.exists(report_json_path):
        shutil.copy2(report_json_path, os.path.join(bundle_dir, "report.json"))

    # ── 3. Export extracted data as CSV ──
    if question_data:
        _export_solutions_csv(question_data, os.path.join(bundle_dir, "extracted", "solutions.csv"))
        _export_votes_csv(question_data, os.path.join(bundle_dir, "extracted", "votes.csv"))
        _export_action_logs_csv(question_data, os.path.join(bundle_dir, "extracted", "action_logs.csv"))
        _export_graph_edges_csv(question_data, os.path.join(bundle_dir, "extracted", "graph_edges.csv"))

    # ── 4. Save metrics ──
    if metrics_report:
        metrics_report.save(os.path.join(bundle_dir, "metrics.json"))

    # ── 5. Copy plots ──
    if plot_paths:
        for p in plot_paths:
            if os.path.exists(p):
                dest = os.path.join(bundle_dir, "plots", os.path.basename(p))
                shutil.copy2(p, dest)

    # ── 6. Generate summary markdown ──
    _write_summary(bundle_dir, run_id, config, question_data, metrics_report)

    return bundle_dir


def load_bundle(bundle_dir: str) -> ExperimentBundle:
    """Load a previously saved experiment bundle."""
    run_id = os.path.basename(bundle_dir).rsplit("_", 2)[0]  # strip timestamp

    config = None
    config_path = os.path.join(bundle_dir, "config.yaml")
    if os.path.exists(config_path):
        config = load_config(config_path)

    metrics = None
    metrics_path = os.path.join(bundle_dir, "metrics.json")
    if os.path.exists(metrics_path):
        with open(metrics_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        metrics = MetricsReport(
            participation=raw.get("participation", {}),
            graph=raw.get("graph", {}),
            merges=raw.get("merges", {}),
            convergence=raw.get("convergence", {}),
            computed_at=raw.get("computed_at", ""),
        )

    return ExperimentBundle(
        bundle_dir=bundle_dir,
        run_id=run_id,
        config=config,
        metrics=metrics,
        timestamp=os.path.basename(bundle_dir).split("_")[-1] if "_" in os.path.basename(bundle_dir) else "",
    )


def compare_bundles(bundle_dirs: list[str], output_path: str | None = None) -> str:
    """Generate a markdown comparison report across experiment bundles.

    Returns the markdown text.  Optionally saves to *output_path*.
    """
    bundles = [load_bundle(d) for d in bundle_dirs]
    lines: list[str] = ["# Experiment Comparison\n"]

    # Config diffs
    if len(bundles) >= 2 and bundles[0].config and bundles[1].config:
        diffs = diff_configs(bundles[0].config, bundles[1].config)
        if diffs:
            lines.append("## Configuration Differences\n")
            lines.append("| Parameter | " + " | ".join(b.run_id for b in bundles) + " |")
            lines.append("|" + "---|" * (len(bundles) + 1))
            for key, (v1, v2) in diffs.items():
                lines.append(f"| `{key}` | {v1} | {v2} |")
            lines.append("")

    # Metrics comparison table
    lines.append("## Metrics Comparison\n")
    flat_rows: list[dict[str, Any]] = []
    for b in bundles:
        if b.metrics:
            flat = b.metrics.to_flat_dict()
            flat["run_id"] = b.run_id
            flat_rows.append(flat)

    if flat_rows:
        all_keys = sorted(set().union(*(r.keys() for r in flat_rows)) - {"run_id"})
        header = "| Metric | " + " | ".join(r.get("run_id", "?") for r in flat_rows) + " |"
        sep = "|" + "---|" * (len(flat_rows) + 1)
        lines.append(header)
        lines.append(sep)
        for key in all_keys:
            row_vals = [str(r.get(key, "—")) for r in flat_rows]
            lines.append(f"| `{key}` | " + " | ".join(row_vals) + " |")
        lines.append("")

    md = "\n".join(lines)
    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md)
    return md


# ── CSV Export Helpers ─────────────────────────────────────────────────────

def _export_solutions_csv(data: QuestionData, path: str) -> None:
    fields = [
        "id", "title", "state", "support_count", "current_score",
        "is_champion", "in_focus", "parent_solutions", "root_solution",
        "merge_status", "base_parent", "cluster_key", "cluster_id",
        "created", "occurred_at",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for sol in data.solutions:
            writer.writerow({
                "id": sol.id,
                "title": sol.title,
                "state": sol.state,
                "support_count": sol.support_count,
                "current_score": sol.current_score,
                "is_champion": sol.is_champion,
                "in_focus": sol.in_focus,
                "parent_solutions": json.dumps(sol.parent_solutions),
                "root_solution": sol.root_solution,
                "merge_status": sol.merge_status,
                "base_parent": sol.base_parent,
                "cluster_key": getattr(sol, "cluster_key", ""),
                "cluster_id": getattr(sol, "cluster_id", ""),
                "created": sol.created,
                "occurred_at": sol.occurred_at,
            })


def _export_votes_csv(data: QuestionData, path: str) -> None:
    fields = ["id", "solution", "user", "vote", "created", "occurred_at"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for v in data.votes:
            writer.writerow({
                "id": v.id,
                "solution": v.solution,
                "user": v.user,
                "vote": v.vote,
                "created": v.created,
                "occurred_at": v.occurred_at,
            })


def _export_action_logs_csv(data: QuestionData, path: str) -> None:
    fields = ["id", "question", "action_type", "target_id", "occurred_at", "user", "metadata_json"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for log in data.action_logs:
            writer.writerow({
                "id": log.id,
                "question": log.question,
                "action_type": log.action_type,
                "target_id": log.target_id,
                "occurred_at": log.occurred_at,
                "user": log.user,
                "metadata_json": json.dumps(log.metadata_json) if isinstance(log.metadata_json, dict) else log.metadata_json,
            })


def _export_graph_edges_csv(data: QuestionData, path: str) -> None:
    """Export parent→child edges for the solution DAG."""
    fields = ["parent_id", "child_id", "edge_type"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for sol in data.solutions:
            edge_type = "merge" if len(sol.parent_solutions) >= 2 else "remix"
            for pid in sol.parent_solutions:
                writer.writerow({
                    "parent_id": pid,
                    "child_id": sol.id,
                    "edge_type": edge_type,
                })


def _write_summary(
    bundle_dir: str,
    run_id: str,
    config: ExperimentConfig | None,
    data: QuestionData | None,
    metrics: MetricsReport | None,
) -> None:
    """Write a human-readable summary.md into the bundle."""
    lines: list[str] = [
        f"# Experiment: {run_id}\n",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n",
    ]

    if config:
        lines.append("## Configuration\n")
        lines.append(f"- **Agents:** {config.simulation.agents}")
        lines.append(f"- **Seed:** {config.simulation.seed}")
        lines.append(f"- **Duration:** {config.simulation.target_duration_days} days")
        lines.append(f"- **LLM enabled:** {config.llm.enabled}")
        lines.append(f"- **LLM model:** {config.llm.model}")
        lines.append("")

    if data:
        lines.append("## Data Summary\n")
        lines.append(f"- **Question:** {data.title} (`{data.question_id}`)")
        lines.append(f"- **Solutions:** {len(data.solutions)}")
        lines.append(f"- **Votes:** {len(data.votes)}")
        lines.append(f"- **Action logs:** {len(data.action_logs)}")
        champions = [s for s in data.solutions if s.is_champion]
        if champions:
            lines.append(f"- **Champions:** {', '.join(s.title[:40] for s in champions)}")
        lines.append("")

    if metrics:
        lines.append("## Key Metrics\n")
        lines.append("### Participation")
        p = metrics.participation
        lines.append(f"- Active participants: {p.get('total_actors', 0)}")
        lines.append(f"- Content creation rate: {p.get('content_creation_rate', 0):.1%}")
        lines.append(f"- Voting engagement: {p.get('voting_engagement', 0):.1f} votes/agent")
        lines.append("")

        lines.append("### Graph Structure")
        g = metrics.graph
        lines.append(f"- Nodes (solutions): {g.get('node_count', 0)}")
        lines.append(f"- Edges (remix/merge links): {g.get('edge_count', 0)}")
        lines.append(f"- Max remix depth: {g.get('max_depth', 0)}")
        lines.append(f"- Clusters: {g.get('cluster_count', 0)}")
        lines.append(f"- Giant component: {g.get('giant_component_fraction', 0):.0%} of solutions")
        lines.append("")

        lines.append("### Merge Dynamics")
        m = metrics.merges
        lines.append(f"- Merge solutions: {m.get('total_merge_solutions', 0)}")
        lines.append(f"- Acceptance rate: {m.get('acceptance_rate', 0):.0%}")
        lines.append(f"- Siphon ratio: {m.get('siphon_ratio', 0):.1%}")
        lines.append("")

        lines.append("### Convergence")
        c = metrics.convergence
        lines.append(f"- Support Gini: {c.get('support_gini', 0):.3f}")
        lines.append(f"- Effective solutions: {c.get('effective_solution_count', 0):.1f}")
        lines.append(f"- Focus concentration: {c.get('focus_concentration', 0):.0%}")
        lines.append("")

    # List bundle contents
    lines.append("## Bundle Contents\n")
    lines.append("```")
    for root, dirs, files in os.walk(bundle_dir):
        rel = os.path.relpath(root, bundle_dir)
        level = rel.count(os.sep)
        indent = "  " * level
        basename = os.path.basename(root)
        if rel == ".":
            lines.append(f"{os.path.basename(bundle_dir)}/")
        else:
            lines.append(f"{indent}{basename}/")
        for fname in sorted(files):
            lines.append(f"{indent}  {fname}")
    lines.append("```\n")

    summary_path = os.path.join(bundle_dir, "summary.md")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
