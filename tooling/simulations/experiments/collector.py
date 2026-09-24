"""Collect metrics from experiment output files.

Reads JSON output files produced by the runner, computes per-run metrics
from the self-contained evaluation snapshots, and exports a CSV for the
analysis script.

Metrics computed:
  - subscription_gini: Gini coefficient of subscription distribution
  - label_entropy: Shannon entropy across primary labels
  - hhi: Herfindahl-Hirschman Index on subscription shares
  - top_proposal_share: max subscription / total subscriptions
  - proposal_count, root_count, remix_count, merge_count
  - vote_count, retract_count, unique_voters, active_agents
  - mean_actions_per_agent
  - cluster_count: distinct primary labels with ≥1 proposal
  - ballot_size: proposals with in_focus=True
  - ballot_label_diversity: distinct labels on the ballot
  - champion_count: proposals with is_champion=True
  - steps, elapsed_days
"""

import csv
import json
import math
from collections import Counter
from pathlib import Path


def gini_coefficient(values: list[float]) -> float:
    """Compute Gini coefficient. 0 = perfect equality, 1 = max inequality."""
    if not values or all(v == 0 for v in values):
        return 0.0
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    total = sum(sorted_vals)
    if total == 0:
        return 0.0
    cumulative = 0.0
    gini_sum = 0.0
    for i, val in enumerate(sorted_vals):
        cumulative += val
        gini_sum += (2 * (i + 1) - n - 1) * val
    return gini_sum / (n * total)


def shannon_entropy(counts: list[int]) -> float:
    """Shannon entropy in bits. Higher = more diverse."""
    total = sum(counts)
    if total == 0:
        return 0.0
    entropy = 0.0
    for c in counts:
        if c > 0:
            p = c / total
            entropy -= p * math.log2(p)
    return entropy


def herfindahl_hirschman(shares: list[float]) -> float:
    """HHI from share values (0-1 each). Lower = more competitive."""
    return sum(s * s for s in shares)


def compute_metrics(data: dict) -> dict:
    """Compute all experiment metrics from a single run's output."""
    run_id = data.get("run_id", "")
    
    STUDY_PREFIXES = ["scaling_frontier", "siphon_ablation", "three_window", "attention_baseline", "carpentras_ideal_baseline"]
    study_id = ""
    config_id = ""
    
    matched_prefix = False
    for prefix in STUDY_PREFIXES:
        if run_id.startswith(prefix + "_"):
            study_id = prefix
            rest = run_id[len(prefix) + 1:]
            # Strip seed suffix: "standard_pf_n100_s42" -> "standard_pf_n100"
            if "_s" in rest:
                config_id = rest.rsplit("_s", 1)[0]
            else:
                config_id = rest
            matched_prefix = True
            break
            
    if not matched_prefix:
        parts = run_id.split("_")
        study_id = parts[0] if len(parts) > 0 else ""
        if len(parts) >= 3:
            config_id = "_".join(parts[1:-1])
        else:
            config_id = parts[1] if len(parts) > 1 else ""

    metrics = {
        "run_id": run_id,
        "study_id": study_id,
        "config_id": config_id,
        "seed": data.get("seed"),
        "quality_model": data.get("config", {}).get("behavior", {}).get("quality_model", "attention"),
        "agent_count": data.get("agent_count", 50),
        "steps": data.get("steps", 0),
        "converged": data.get("converged", False),
        "convergence_reason": data.get("convergence_reason", ""),
    }

    # ── Decision log metrics ──
    decision_log = data.get("decision_log", [])
    action_counts = Counter(d["action"] for d in decision_log)
    non_nothing = [d for d in decision_log if d["action"] != "do_nothing"]
    unique_agents_acting = set(d["agent"] for d in non_nothing)
    unique_voters = set(
        d["agent"] for d in decision_log if d["action"] in ("vote_support", "vote_retract")
    )

    metrics["vote_count"] = action_counts.get("vote_support", 0)
    metrics["retract_count"] = action_counts.get("vote_retract", 0)
    metrics["unique_voters"] = len(unique_voters)
    metrics["active_agents"] = len(unique_agents_acting)
    metrics["total_actions"] = len(non_nothing)
    metrics["mean_actions_per_agent"] = (
        round(len(non_nothing) / max(1, data.get("agent_count", 50)), 2)
    )

    # Tab usage
    tab_counts = data.get("tab_usage_counts", {})
    total_tabs = sum(tab_counts.values()) or 1
    metrics["tab_foryou_pct"] = round(tab_counts.get("foryou", 0) / total_tabs * 100, 1)
    metrics["tab_notification_pct"] = round(tab_counts.get("notification", 0) / total_tabs * 100, 1)
    metrics["tab_ballot_pct"] = round(tab_counts.get("ballot", 0) / total_tabs * 100, 1)

    # ── Content generation metrics ──
    content_log = data.get("content_generation_log", [])
    gen_types = Counter(e["gen_type"] for e in content_log)
    metrics["root_count"] = gen_types.get("root", 0)
    metrics["remix_count"] = gen_types.get("remix", 0)
    metrics["merge_count"] = gen_types.get("merge", 0)

    # ── Evaluation snapshot metrics ──
    snapshot = data.get("evaluation_snapshot")
    if snapshot and isinstance(snapshot, dict):
        proposals = snapshot.get("proposals", [])
        votes = snapshot.get("votes", [])

        metrics["proposal_count"] = len(proposals)

        # Subscription distribution
        sub_counts = [p.get("subscription_count", 0) for p in proposals]
        total_subs = sum(sub_counts)
        metrics["total_subscriptions"] = total_subs
        metrics["subscription_gini"] = round(gini_coefficient(sub_counts), 4)
        metrics["top_proposal_share"] = (
            round(max(sub_counts) / total_subs, 4) if total_subs > 0 else 0.0
        )

        # HHI
        shares = [s / total_subs for s in sub_counts] if total_subs > 0 else []
        metrics["hhi"] = round(herfindahl_hirschman(shares), 4)

        # Label distribution and entropy
        label_counter = Counter()
        for p in proposals:
            pl = p.get("primary_label", "")
            if pl:
                label_counter[pl] += 1
            else:
                label_counter["__none__"] += 1
        metrics["cluster_count"] = len([k for k in label_counter if k != "__none__"])
        metrics["label_entropy"] = round(
            shannon_entropy(list(label_counter.values())), 4
        )

        # Ballot metrics
        ballot_proposals = [p for p in proposals if p.get("in_focus")]
        metrics["ballot_size"] = len(ballot_proposals)
        ballot_labels = set()
        for p in ballot_proposals:
            pl = p.get("primary_label", "")
            if pl:
                ballot_labels.add(pl)
        metrics["ballot_label_diversity"] = len(ballot_labels)

        # Champion count
        metrics["champion_count"] = sum(1 for p in proposals if p.get("is_champion"))

        # Root vs remix in final state
        metrics["final_root_count"] = sum(
            1 for p in proposals if not p.get("parent_proposals")
        )
        metrics["final_remix_count"] = sum(
            1 for p in proposals if len(p.get("parent_proposals", [])) == 1
        )
        metrics["final_merge_count"] = sum(
            1 for p in proposals if len(p.get("parent_proposals", [])) >= 2
        )

        # Unique authors
        metrics["unique_authors"] = len(set(p.get("author", "") for p in proposals))
    else:
        # No snapshot — fill with NaN-like values
        for key in [
            "proposal_count", "total_subscriptions", "subscription_gini",
            "top_proposal_share", "hhi", "cluster_count", "label_entropy",
            "ballot_size", "ballot_label_diversity", "champion_count",
            "final_root_count", "final_remix_count", "final_merge_count",
            "unique_authors",
        ]:
            metrics[key] = None

    # ── Time metrics ──
    time_events = data.get("time_events", [])
    if time_events:
        from datetime import datetime

        first_t = time_events[0].get("simulated_at", "")
        last_t = time_events[-1].get("simulated_at", "")
        try:
            dt_first = datetime.fromisoformat(first_t)
            dt_last = datetime.fromisoformat(last_t)
            metrics["elapsed_days"] = round(
                (dt_last - dt_first).total_seconds() / 86400, 1
            )
        except (ValueError, TypeError):
            metrics["elapsed_days"] = None
    else:
        metrics["elapsed_days"] = None

    # ── Quality metrics (post-hoc Carpentras 2025 model or known quality) ──
    quality_registry = data.get("quality_registry")
    if quality_registry:
        # Quality-aware voting runs store the exact quality map used for decisions
        proposals = (data.get("evaluation_snapshot") or {}).get("proposals", [])
        max_q = max(quality_registry.values()) if quality_registry else 1.0
        if max_q == 0: max_q = 1.0
        
        # Ballot-based selection efficiency (ablation)
        ballot_ids = [p["id"] for p in proposals if p.get("in_focus")]
        ballot_q = [quality_registry.get(pid, 0) for pid in ballot_ids]
        metrics["selection_efficiency"] = round((sum(ballot_q) / max(1, len(ballot_q))) / max_q, 4) if ballot_q else 0.0
        
        # Top-K by subscription count
        proposals_by_sub = sorted(proposals, key=lambda x: x.get("subscription_count", 0), reverse=True)
        
        def calc_top_k(k):
            ids = [p["id"] for p in proposals_by_sub[:k]]
            qs = [quality_registry.get(pid, 0) for pid in ids]
            mean_q = sum(qs) / max(1, len(qs)) if qs else 0.0
            eff = (mean_q / max_q) if max_q > 0 else 0.0
            return round(mean_q, 4), round(eff, 4)
            
        top_1_mean, top_1_eff = calc_top_k(1)
        top_3_mean, top_3_eff = calc_top_k(3)
        top_7_mean, top_7_eff = calc_top_k(7)
        
        metrics["top_1_mean_quality"] = top_1_mean
        metrics["top_1_selection_efficiency"] = top_1_eff
        metrics["suboptimality_gap_top1"] = round(max_q - top_1_mean, 4)
        metrics["top_3_mean_quality"] = top_3_mean
        metrics["top_3_selection_efficiency"] = top_3_eff
        metrics["top_7_mean_quality"] = top_7_mean
        metrics["top_7_selection_efficiency"] = top_7_eff
        
        # Alias for backward compatibility
        metrics["top_k_mean_quality"] = top_7_mean
        metrics["top_k_selection_efficiency"] = top_7_eff
    
    # ── DAG structure metrics ──
    proposals_list = (data.get("evaluation_snapshot") or {}).get("proposals", [])
    def _dag_depth(pid, id_map, cache):
        if pid in cache: return cache[pid]
        p = id_map.get(pid)
        if not p or not p.get("parent_proposals"):
            cache[pid] = 0
            return 0
        d = 1 + max(_dag_depth(pp, id_map, cache) for pp in p["parent_proposals"])
        cache[pid] = d
        return d
        
    id_map = {p["id"]: p for p in proposals_list}
    depths = [_dag_depth(p["id"], id_map, {}) for p in proposals_list]
    metrics["dag_mean_depth"] = round(sum(depths)/max(1,len(depths)), 2) if depths else 0
    metrics["dag_max_depth"] = max(depths) if depths else 0
    
    # ── Siphon migration count ──
    # Count actual vote_migrate decisions (accepted migrations)
    metrics["siphon_migration_count"] = sum(
        1 for d in data.get("decision_log", [])
        if d.get("action") == "vote_migrate"
    )
    # Also count notification evaluations (accepted + rejected) for context
    metrics["siphon_notification_evaluations"] = sum(
        1 for d in data.get("decision_log", [])
        if d.get("tab_used") == "notification"
    )
    

    # ── Late entrant success ──
    if proposals_list:
        from datetime import datetime
        created_times = []
        for p in proposals_list:
            try: created_times.append(datetime.fromisoformat(p["created"].replace("Z","+00:00")))
            except: pass
        if created_times:
            created_times.sort()
            median_time = created_times[len(created_times)//2]
            late_ids = {p["id"] for p in proposals_list
                        if p.get("created") and
                        datetime.fromisoformat(p["created"].replace("Z","+00:00")) > median_time}
            top5_ids = {p["id"] for p in sorted(proposals_list, key=lambda x: x.get("subscription_count",0), reverse=True)[:5]}
            metrics["late_entrant_in_top5"] = len(late_ids & top5_ids)
        else:
            metrics["late_entrant_in_top5"] = None
    else:
        metrics["late_entrant_in_top5"] = None

    return metrics


def main():
    import zipfile
    from tooling._paths import SIM_EXPERIMENTS_DATA, EXPERIMENTS_OUTPUT, DATA_ROOT

    source_dir = None
    sim_data_path = Path(SIM_EXPERIMENTS_DATA)
    output_path = Path(EXPERIMENTS_OUTPUT)
    zip_path = Path(DATA_ROOT) / "simulation_experiments.zip"

    if list(sim_data_path.glob("experiment_*.json")):
        source_dir = sim_data_path
    elif list(output_path.glob("experiment_*.json")):
        source_dir = output_path
    elif zip_path.exists():
        print(f"Extracting {zip_path.name} to {DATA_ROOT}...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(DATA_ROOT)
        if list(sim_data_path.glob("experiment_*.json")):
            source_dir = sim_data_path

    if not source_dir:
        print(f"No experiment output files found in {sim_data_path} or {output_path}")
        return

    files = sorted(source_dir.glob("experiment_*.json"))
    print(f"Reading {len(files)} experiment JSON files from {source_dir}...")

    results = []
    for f in files:
        with open(f, "r") as handle:
            try:
                data = json.load(handle)
            except json.JSONDecodeError:
                print(f"  Skipping {f.name}: invalid JSON")
                continue

        metrics = compute_metrics(data)
        results.append(metrics)

    if not results:
        print("No valid results found.")
        return

    csv_path = source_dir / "experiment_results.csv"
    keys = list(results[0].keys())
    with open(csv_path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys)
        writer.writeheader()
        writer.writerows(results)

    print(f"Exported {len(results)} results to {csv_path}")

    # Mirror to alternate directory if different
    alt_dir = output_path if source_dir == sim_data_path else sim_data_path
    try:
        alt_dir.mkdir(parents=True, exist_ok=True)
        alt_csv_path = alt_dir / "experiment_results.csv"
        with open(alt_csv_path, "w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=keys)
            writer.writeheader()
            writer.writerows(results)
        print(f"Mirrored {len(results)} results to {alt_csv_path}")
    except Exception as e:
        print(f"Notice: Could not mirror CSV to {alt_dir}: {e}")

    # Print summary
    from collections import Counter as C

    studies = C(r["study_id"] for r in results)
    for sid, cnt in sorted(studies.items()):
        configs = set(r["config_id"] for r in results if r["study_id"] == sid)
        print(f"  {sid}: {cnt} runs across {len(configs)} configs")

    # Quick sanity: show baseline means
    baselines = [r for r in results if r["config_id"] == "baseline"]
    if baselines:
        print("\nBaseline means:")
        numeric_keys = [
            "steps", "vote_count", "proposal_count", "subscription_gini",
            "label_entropy", "ballot_size", "ballot_label_diversity",
        ]
        for k in numeric_keys:
            vals = [r[k] for r in baselines if r.get(k) is not None]
            if vals:
                mean_v = sum(vals) / len(vals)
                print(f"  {k}: {mean_v:.3f}")


if __name__ == "__main__":
    main()
