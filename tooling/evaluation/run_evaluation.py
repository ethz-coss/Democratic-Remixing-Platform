#!/usr/bin/env python3
"""CLI entry point for the simulation evaluation module.

Usage:
    # From the simulations/ directory:

    # Generate plots for all 5 experiments from live PocketBase:
    python -m evaluation.run_evaluation --batch-experiments

    # Single experiment by question ID:
    python -m evaluation.run_evaluation --question-id <ID>

    # Offline mode (from JSON result files, limited data):
    python -m evaluation.run_evaluation --json-result results/run_1.json --offline
    python -m evaluation.run_evaluation --batch --offline

    # Compute metrics and create experiment bundle:
    python -m evaluation.run_evaluation --json-result output/exp.json --offline --bundle --compute-metrics

    # Compare experiment bundles:
    python -m evaluation.run_evaluation --compare output/experiments/exp_a_*/  output/experiments/exp_b_*/
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from tooling._paths import PROJECT_ROOT, TOOLING_ROOT, OUTPUT_ROOT, EXPERIMENTS_OUTPUT, EXPORTS_OUTPUT

_PROJECT_ROOT = PROJECT_ROOT
_SIMULATIONS_ROOT = os.path.join(TOOLING_ROOT, "simulations")

from tooling.simulations.engine.config import load_env_files
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.evaluation.extract.pb_extractor import (
    QuestionData,
    build_vote_timeline,
    extract_question_data,
)
from tooling.evaluation.extract.json_extractor import extract_from_json
from tooling.evaluation.extract.csv_extractor import extract_from_csv

from tooling.evaluation.plots.plot_timeline import plot_support_timeline, print_summary


# The 5 real experiments in PocketBase
# This will be dynamically loaded if batch_experiments.json is present.
EXPERIMENTS = []


# PocketBase URL auto-discovery order
_PB_URL_CANDIDATES = [
    "http://127.0.0.1:18090",
    "http://pocketbase:8090",
    "http://localhost:8090",
]


def _load_env() -> None:
    """Load environment files in the same order as the simulation runner."""
    load_env_files("/workspace/.env", os.path.join(_SIMULATIONS_ROOT, ".env"))


def _discover_pb_url(override: str | None = None) -> str:
    """Find a reachable PocketBase URL."""
    if override:
        return override

    # Check env
    for var in ("PRIVATE_POCKETBASE_URL", "PUBLIC_POCKETBASE_URL"):
        url = os.environ.get(var)
        if url:
            _PB_URL_CANDIDATES.insert(0, url)

    import requests

    for url in _PB_URL_CANDIDATES:
        try:
            r = requests.get(f"{url}/api/health", timeout=3)
            if r.status_code == 200:
                return url
        except Exception:
            continue

    return "http://localhost:8090"


def _connect_pb(base_url: str, email: str | None = None, password: str | None = None) -> PocketBaseClient:
    """Connect and authenticate with PocketBase."""
    admin_email = (
        email
        or os.environ.get("PB_SUPERUSER_EMAIL")
        or os.environ.get("PB_ADMIN_EMAIL")
        or "admin@sim.local"
    )
    admin_password = (
        password
        or os.environ.get("PB_SUPERUSER_PASSWORD")
        or os.environ.get("PB_ADMIN_PASSWORD")
        or ""
    )

    print(f"[eval] Connecting to PocketBase at {base_url}")
    pb = PocketBaseClient(base_url)

    try:
        pb.admin_auth(admin_email, admin_password)
        print("[eval] Admin auth OK")
    except PocketBaseError as err:
        print(f"[eval] Admin auth failed: {err}", file=sys.stderr)
        raise SystemExit(2)

    return pb


def _resolve_json_path(raw: str) -> str:
    if os.path.isabs(raw):
        return raw
    return os.path.join(_SIMULATIONS_ROOT, raw)


def _generate_plot(data: QuestionData, output_dir: str, label: str) -> list[str]:
    """Shared plotting pipeline. Returns list of generated plot paths."""
    print_summary(data)

    timeline = build_vote_timeline(data.votes, data.action_logs, data.solutions)
    print(f"[eval] Vote timeline: {len(timeline)} data points")

    plot_paths: list[str] = []

    if timeline.empty:
        print(f"[eval] No vote data for {label} — skipping plot.", file=sys.stderr)
        return plot_paths
    
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "support_timeline.png")

    plot_support_timeline(data, timeline, output_path=output_path)
    print(f"[eval] Plot saved → {output_path}")
    plot_paths.append(output_path)

    # Generate merge analysis plots
    try:
        from tooling.evaluation.plots.plot_merges import generate_all_merge_plots, plot_likes_and_merges_combined
        merge_paths = generate_all_merge_plots(data, output_dir, label, use_sub_dir=False)
        for mp in merge_paths:
            print(f"[eval] Merge plot saved → {mp}")
            plot_paths.append(mp)
            
        combined_path = os.path.join(output_dir, "likes_and_merges_combined.png")
        plot_likes_and_merges_combined(data, timeline, output_path=combined_path)
        print(f"[eval] Combined plot saved → {combined_path}")
        plot_paths.append(combined_path)
    except Exception as err:
        print(f"[eval] Merge/combined plots failed: {err}", file=sys.stderr)

    return plot_paths


def _compute_and_save_metrics(data: QuestionData, output_dir: str, label: str) -> "MetricsReport | None":
    """Compute metrics and save to JSON."""
    try:
        from tooling.evaluation.metrics.metrics import compute_all_metrics
        report = compute_all_metrics(data)
        
        os.makedirs(output_dir, exist_ok=True)
        metrics_path = os.path.join(output_dir, "metrics.json")
        report.save(metrics_path)
        print(f"[eval] Metrics saved → {metrics_path}")
        
        # Print key metrics summary
        p = report.participation
        g = report.graph
        m = report.merges
        c = report.convergence
        print(f"[eval] Metrics summary:")
        print(f"  Participation: {p.get('total_actors', 0)} actors, "
              f"{p.get('voting_engagement', 0):.1f} votes/agent")
        print(f"  Graph: {g.get('node_count', 0)} nodes, "
              f"{g.get('edge_count', 0)} edges, "
              f"{g.get('cluster_count', 0)} clusters")
        print(f"  Merges: {m.get('total_merge_solutions', 0)} merges, "
              f"{m.get('acceptance_rate', 0):.0%} accepted")
        print(f"  Convergence: Gini={c.get('support_gini', 0):.3f}, "
              f"effective={c.get('effective_solution_count', 0):.1f}")
        
        return report
    except Exception as err:
        print(f"[eval] Metrics computation failed: {err}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return None


def _generate_extra_plots(data: QuestionData, output_dir: str, label: str, animate: bool = False) -> list[str]:
    """Generate the new metric-based plots (participation, graph, convergence)."""
    extra_paths: list[str] = []
    try:
        from tooling.evaluation.plots.plot_metrics import (
            plot_participation_heatmap,
            plot_remix_graph,
            plot_convergence_curve,
            plot_vote_distribution,
            plot_action_composition,
            plot_temporal_convergence,
            plot_label_distribution,
        )
        
        os.makedirs(output_dir, exist_ok=True)
        
        plot_fns = [
            ("participation_heatmap.png", plot_participation_heatmap),
            ("remix_graph.png", plot_remix_graph),
            ("convergence_curve.png", plot_convergence_curve),
            ("vote_distribution.png", plot_vote_distribution),
            ("action_composition.png", plot_action_composition),
            ("temporal_convergence.png", plot_temporal_convergence),
            ("label_distribution.png", plot_label_distribution),
        ]
        
        for fname, fn in plot_fns:
            try:
                path = os.path.join(output_dir, fname)
                fn(data, path)
                print(f"[eval] Extra plot saved → {path}")
                extra_paths.append(path)
            except Exception as err:
                print(f"[eval] Plot {fname} failed: {err}", file=sys.stderr)
                
        if animate:
            try:
                from tooling.evaluation.plots.plot_graph_animation import animate_remix_graph
                path = os.path.join(output_dir, "remix_evolution.mp4")
                print(f"[eval] Generating graph animation, this may take a moment...")
                anim_path = animate_remix_graph(data, path)
                if anim_path:
                    print(f"[eval] Animation saved → {anim_path}")
                    extra_paths.append(anim_path)
            except Exception as err:
                print(f"[eval] Graph animation failed: {err}", file=sys.stderr)
                import traceback
                traceback.print_exc()

    except ImportError:
        print("[eval] plot_metrics module not available, skipping extra plots", file=sys.stderr)
    
    return extra_paths


def _create_experiment_bundle(
    data: QuestionData,
    label: str,
    json_path: str | None,
    metrics_report: "MetricsReport | None",
    plot_paths: list[str],
    pre_existing_bundle_dir: str | None = None,
) -> str | None:
    """Create a self-contained experiment bundle."""
    try:
        from tooling.evaluation.bundle.bundle import create_bundle
        from tooling.evaluation.bundle.config_schema import config_from_legacy
        
        # Build a config from the label (best effort)
        config = config_from_legacy(
            run_id=label, label=label, seed=42, days=30, agents=50, # defaults
            # TODO: Replace with explicit config manifest reading
        )
        
        # Try to read config details from the JSON report
        if json_path and os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    report = json.load(f)
                config.simulation.agents = report.get("agent_count", 50)
                config.simulation.seed = report.get("seed", 42)
                config.run_id = report.get("run_id", label)
            except Exception:
                pass
                
        bundle_dir = create_bundle(
            run_id=label,
            config=config,
            report_json_path=json_path,
            question_data=data,
            metrics_report=metrics_report,
            plot_paths=plot_paths,
            output_root=os.path.dirname(pre_existing_bundle_dir) if pre_existing_bundle_dir else None,
            bundle_dir_override=pre_existing_bundle_dir,
        )
        
        print(f"[eval] Bundle created → {bundle_dir}")
        return bundle_dir
    except Exception as err:
        print(f"[eval] Bundle creation failed: {err}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return None


def _run_comparison(bundle_dirs: list[str], output_path: str | None) -> None:
    """Compare multiple experiment bundles."""
    try:
        from tooling.evaluation.bundle.bundle import compare_bundles
        
        if not output_path:
            output_path = os.path.join(OUTPUT_ROOT, "comparison.md")
        
        md = compare_bundles(bundle_dirs, output_path)
        print(f"[eval] Comparison report saved → {output_path}")
        print(f"\n{md}")
    except Exception as err:
        print(f"[eval] Comparison failed: {err}", file=sys.stderr)


def _run_eval(
    data: QuestionData,
    output_dir: str,
    label: str,
    compute_metrics: bool = False,
    bundle_data: bool = False,
    run_json_path: str | None = None,
    animate_graph: bool = False,
) -> str | None:
    """Run plotting, optional metrics, and optional bundling for one dataset."""
    from datetime import datetime
    safe_label = label.replace("/", "_").replace(" ", "_")[:40]
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    if bundle_data:
        session_dir = os.path.join(output_dir, f"{safe_label}_{ts}")
        plot_dir = os.path.join(session_dir, "plots")
    else:
        session_dir = os.path.join(output_dir, safe_label, f"run_{ts}")
        plot_dir = session_dir
        
    os.makedirs(plot_dir, exist_ok=True)
    
    plot_paths = _generate_plot(data, plot_dir, label)
    
    metrics_report = None
    if compute_metrics:
        # Save metrics to root of session_dir
        metrics_report = _compute_and_save_metrics(data, session_dir, label)
        extra_paths = _generate_extra_plots(data, plot_dir, label, animate_graph)
        plot_paths.extend(extra_paths)
    elif animate_graph:
        # If metrics isn't true but animate is, still generate it
        extra_paths = _generate_extra_plots(data, plot_dir, label, animate_graph)
        plot_paths.extend(extra_paths)
        
    if bundle_data:
        # Since we've already written plots directly to bundle_dir/plots, we pass an empty list of plots to copy
        return _create_experiment_bundle(
            data, label, run_json_path, metrics_report, [], session_dir
        )
    return None

def main() -> None:
    _load_env()

    parser = argparse.ArgumentParser(
        description="Evaluate a simulation run: extract data and generate plots.",
    )
    parser.add_argument(
        "--question-id", default=None,
        help="PocketBase question record ID to analyse.",
    )
    parser.add_argument(
        "--json-result", default=None,
        help="Path to a simulation result JSON.",
    )
    parser.add_argument(
        "--batch-experiments", action="store_true",
        help="Generate plots for all 5 experiments from live PocketBase.",
    )
    parser.add_argument(
        "--batch", action="store_true",
        help="Generate plots for all results/run_*.json files.",
    )
    parser.add_argument(
        "--offline", action="store_true",
        help="Offline mode: reconstruct from JSON only (no PocketBase).",
    )
    parser.add_argument(
        "--csv-dir", default=None,
        help="Offline mode: reconstruct from a directory of CSV files.",
    )
    parser.add_argument(
        "--base-url", default=None,
        help="PocketBase URL (auto-discovered if not set).",
    )
    parser.add_argument(
        "--admin-email", default=None,
        help="Admin/superuser email (default: from env).",
    )
    parser.add_argument(
        "--admin-password", default=None,
        help="Admin/superuser password (default: from env).",
    )
    parser.add_argument(
        "--output-dir", default=None,
        help="Directory to save bundles/plots (default: output/experiments/).",
    )
    # ── New flags ──
    parser.add_argument(
        "--compute-metrics", action="store_true",
        help="Compute evaluation metrics and save as metrics.json.",
    )
    parser.add_argument(
        "--export-study-data", action="store_true",
        help="Export and pseudonymize all study data (users, surveys, proposals, votes) to CSVs.",
    )
    parser.add_argument(
        "--bundle", action="store_true",
        help="Create a self-contained experiment bundle (data + metrics + plots).",
    )
    parser.add_argument(
        "--compare", nargs="+", metavar="BUNDLE_DIR",
        help="Compare experiment bundles: pass two or more bundle directories.",
    )
    parser.add_argument(
        "--compare-output", default=None,
        help="Output path for comparison report (default: output/comparison.md).",
    )
    parser.add_argument(
        "--animate-graph", action="store_true",
        help="Generate an MP4/GIF animation of the solution graph evolution.",
    )

    args = parser.parse_args()

    # ── Export Study Data ──────────────────────────────────────────────
    if args.export_study_data:
        base_url = _discover_pb_url(args.base_url)
        pb = _connect_pb(base_url, args.admin_email, args.admin_password)
        
        output_dir = args.output_dir or os.path.join(EXPORTS_OUTPUT, "study_export")
        try:
            from tooling.evaluation.export_study_data import export_study_data
            export_study_data(pb, output_dir)
            print(f"[eval] Export complete. CSVs in {output_dir}")
        except Exception as e:
            print(f"[eval] Failed to export study data: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
        return

    # ── Compare mode ───────────────────────────────────────────────────
    if args.compare:
        # Expand globs
        bundle_dirs = []
        for pattern in args.compare:
            expanded = glob.glob(pattern)
            if expanded:
                bundle_dirs.extend(expanded)
            else:
                bundle_dirs.append(pattern)
        
        if len(bundle_dirs) < 2:
            raise SystemExit("--compare requires at least 2 bundle directories")
        
        _run_comparison(bundle_dirs, args.compare_output)
        return

    output_dir = args.output_dir or EXPERIMENTS_OUTPUT

    # ── Batch experiments (online, the default workflow) ───────────────
    if args.batch_experiments:
        batch_json_path = os.path.join(OUTPUT_ROOT, "batch_experiments.json")
        if os.path.exists(batch_json_path):
            with open(batch_json_path, "r", encoding="utf-8") as f:
                batch_data = json.load(f)
            
            # Reconstruct EXPERIMENTS from batch_data
            experiments = []
            for exp_def in batch_data.get("experiments", []):
                # find the result for this exp
                res = next((r for r in batch_data.get("results", []) if r["run_id"] == exp_def["run_id"]), None)
                if res and res.get("question_id"):
                    experiments.append({
                        "id": res["question_id"],
                        "title": exp_def["label"],
                        "run_id": exp_def.get("run_id", ""),
                    })
            if experiments:
                global EXPERIMENTS
                EXPERIMENTS = experiments

        base_url = _discover_pb_url(args.base_url)
        pb = _connect_pb(base_url, args.admin_email, args.admin_password)

        bundle_dirs: list[str] = []
        print(f"[eval] Batch: {len(EXPERIMENTS)} experiments")
        for exp in EXPERIMENTS:
            print(f"\n{'─'*60}")
            try:
                print(f"[eval] Extracting {exp['title']} ({exp['id']}) ...")
                data = extract_question_data(pb, exp["id"])
                bd = _run_eval(
                    data,
                    output_dir,
                    exp["title"],
                    compute_metrics=args.compute_metrics,
                    bundle_data=args.bundle,
                    animate_graph=args.animate_graph,
                )
                if bd:
                    bundle_dirs.append(bd)
            except Exception as err:
                print(f"[eval] Error: {err}", file=sys.stderr)

        print(f"\n{'─'*60}")
        print(f"[eval] Batch complete. Plots in {output_dir}")
        if bundle_dirs:
            print(f"[eval] Bundles created: {len(bundle_dirs)}")
            for bd in bundle_dirs:
                print(f"  → {bd}")
        return

    # ── Batch offline (from JSON result files) ─────────────────────────
    if args.batch:
        pattern = os.path.join(OUTPUT_ROOT, "run_*.json")
        files = sorted(glob.glob(pattern))
        if not files:
            # Also try exp_*.json
            pattern = os.path.join(OUTPUT_ROOT, "exp_*.json")
            files = sorted(glob.glob(pattern))
        if not files:
            # Also try experiment_*.json in EXPERIMENTS_OUTPUT (v2 data)
            pattern = os.path.join(EXPERIMENTS_OUTPUT, "experiment_*.json")
            files = sorted(glob.glob(pattern))
        if not files:
            raise SystemExit(f"No JSON result files found in output/")

        print(f"[eval] Batch mode: {len(files)} result file(s)")
        bundle_dirs = []
        for json_path in files:
            print(f"\n{'─'*60}")
            try:
                label = os.path.splitext(os.path.basename(json_path))[0]
                if args.offline:
                    data = extract_from_json(json_path)
                    data.title = label.replace("_", " ").title()
                    
                    bd = _run_eval(
                        data,
                        output_dir,
                        label,
                        compute_metrics=args.compute_metrics,
                        bundle_data=args.bundle,
                        run_json_path=json_path,
                        animate_graph=args.animate_graph,
                    )
                    if bd:
                        bundle_dirs.append(bd)
                else:
                    with open(json_path, "r", encoding="utf-8") as f:
                        pid = json.load(f).get("question_id", "")
                    if not pid:
                        print(f"[eval] No question_id in {json_path}, skipping")
                        continue
                    base_url = _discover_pb_url(args.base_url)
                    pb = _connect_pb(base_url, args.admin_email, args.admin_password)
                    data = extract_question_data(pb, pid)
                    
                    bd = _run_eval(
                        data,
                        output_dir,
                        label,
                        compute_metrics=args.compute_metrics,
                        bundle_data=args.bundle,
                        run_json_path=json_path,
                        animate_graph=args.animate_graph,
                    )
                    if bd:
                        bundle_dirs.append(bd)
            except Exception as err:
                print(f"[eval] Error processing {json_path}: {err}", file=sys.stderr)

        print(f"\n{'─'*60}")
        print(f"[eval] Batch complete. Plots in {output_dir}")
        if bundle_dirs:
            print(f"[eval] Bundles created: {len(bundle_dirs)}")
        return

    # ── Single offline ─────────────────────────────────────────────────
    if args.offline:
        if not args.json_result:
            raise SystemExit("--offline requires --json-result (or use --batch)")
        abs_path = _resolve_json_path(args.json_result)
        data = extract_from_json(abs_path)
        label = os.path.splitext(os.path.basename(abs_path))[0]
        data.title = label.replace("_", " ").title()
        
        _run_eval(
            data,
            output_dir,
            label,
            compute_metrics=args.compute_metrics,
            bundle_data=args.bundle,
            run_json_path=abs_path,
            animate_graph=args.animate_graph,
        )
        return

    # ── Single online ──────────────────────────────────────────────────
    if args.json_result:
        abs_path = _resolve_json_path(args.json_result)
        with open(abs_path, "r", encoding="utf-8") as f:
            pid = json.load(f).get("question_id", "")
        if not pid:
            raise SystemExit(f"No 'question_id' found in {abs_path}")
        print(f"[eval] Resolved question_id={pid} from {abs_path}")
        json_path = abs_path
    elif args.question_id:
        pid = args.question_id
        json_path = None
    else:
        raise SystemExit("Provide --question-id, --json-result, --batch, --batch-experiments, or --compare")

    if args.csv_dir:
        print(f"[eval] Extracting data from CSV directory {args.csv_dir} for question {pid} ...")
        data = extract_from_csv(args.csv_dir, pid)
    else:
        base_url = _discover_pb_url(args.base_url)
        pb = _connect_pb(base_url, args.admin_email, args.admin_password)

        print(f"[eval] Extracting data for question {pid} ...")
        data = extract_question_data(pb, pid)
    
    _run_eval(
        data,
        output_dir,
        label=pid,
        compute_metrics=args.compute_metrics,
        bundle_data=args.bundle,
        run_json_path=json_path,
        animate_graph=args.animate_graph,
    )


if __name__ == "__main__":
    main()
