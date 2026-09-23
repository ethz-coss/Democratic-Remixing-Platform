"""Post-hoc quality scoring following Carpentras et al. 2025.

Assigns latent utility scores to proposal DAGs, then measures
whether the platform's three-mechanism system correctly identifies
high-quality proposals.

Note: This module is an experiment evaluation wrapper around the core
simulation engine's quality model located at `engine/quality_model.py`.
"""

from typing import Any
from tooling.simulations.engine.quality_model import assign_dag_quality

def compute_quality_metrics(run_data: dict[str, Any], n_quality_seeds: int = 100) -> dict[str, float]:
    """Compute average quality metrics over multiple quality assignments.
    
    Two selection efficiency metrics:
      - selection_efficiency: uses in_focus (ballot) — ablation of label-exclusivity system
      - top_k_selection_efficiency: uses top-7 by subscription_count — Carpentras-comparable
    """
    proposals = (run_data.get("evaluation_snapshot") or {}).get("proposals", [])
    if not proposals:
        return {
            "mean_quality": 0.0,
            "max_quality": 0.0,
            "ballot_mean_quality": 0.0,
            "selection_efficiency": 0.0,
            "top_k_mean_quality": 0.0,
            "top_k_selection_efficiency": 0.0,
            "champion_quality_rank": 0.0,
        }
        
    # Pre-sort proposals by subscription count
    proposals_by_sub = sorted(proposals, key=lambda x: x.get("subscription_count", 0), reverse=True)
    champion_id = proposals_by_sub[0]["id"] if proposals_by_sub else None
    
    # Ballot-based selection (in_focus — label-exclusivity ablation)
    ballot_ids = [p["id"] for p in proposals if p.get("in_focus")]
    
    # Top-K by subscription count (Carpentras-comparable, stable selection set)
    top_1 = min(1, len(proposals_by_sub))
    top_3 = min(3, len(proposals_by_sub))
    top_7 = min(7, len(proposals_by_sub))
    
    top_1_ids = [p["id"] for p in proposals_by_sub[:top_1]]
    top_3_ids = [p["id"] for p in proposals_by_sub[:top_3]]
    top_7_ids = [p["id"] for p in proposals_by_sub[:top_7]]
    
    metrics_sum = {
        "mean_quality": 0.0,
        "max_quality": 0.0,
        "ballot_mean_quality": 0.0,
        "selection_efficiency": 0.0,
        "top_1_mean_quality": 0.0,
        "top_3_mean_quality": 0.0,
        "top_7_mean_quality": 0.0,
        "top_1_selection_efficiency": 0.0,
        "top_3_selection_efficiency": 0.0,
        "top_7_selection_efficiency": 0.0,
        # Keep old one for backward compatibility in S5 scaling chart
        "top_k_mean_quality": 0.0,
        "top_k_selection_efficiency": 0.0,
        "champion_quality_rank": 0.0,
    }
    
    for seed in range(n_quality_seeds):
        q_map = assign_dag_quality(proposals, seed=seed)
        
        # Calculate metric for this seed
        mean_q = sum(q_map.values()) / len(q_map) if q_map else 0
        max_q = max(q_map.values()) if q_map else 1.0  # avoid div by zero
        if max_q == 0:
            max_q = 1.0
            
        # Ballot-based (label-exclusivity ablation)
        ballot_q = [q_map.get(pid, 0) for pid in ballot_ids]
        ballot_mean = sum(ballot_q) / len(ballot_q) if ballot_q else 0
        selection_eff = ballot_mean / max_q
        
        def calc_top_k(ids):
            q_list = [q_map.get(pid, 0) for pid in ids]
            mean_val = sum(q_list) / len(q_list) if q_list else 0
            eff = mean_val / max_q
            return mean_val, eff
            
        top_1_mean, top_1_eff = calc_top_k(top_1_ids)
        top_3_mean, top_3_eff = calc_top_k(top_3_ids)
        top_7_mean, top_7_eff = calc_top_k(top_7_ids)
        
        # Rank of the champion
        sorted_qs = sorted(q_map.items(), key=lambda x: x[1], reverse=True)
        champ_rank = 1
        if champion_id:
            for i, (pid, q) in enumerate(sorted_qs):
                if pid == champion_id:
                    champ_rank = i + 1
                    break
                    
        # Add to sum
        metrics_sum["mean_quality"] += mean_q
        metrics_sum["max_quality"] += max_q
        metrics_sum["ballot_mean_quality"] += ballot_mean
        metrics_sum["selection_efficiency"] += selection_eff
        metrics_sum["top_1_mean_quality"] += top_1_mean
        metrics_sum["top_3_mean_quality"] += top_3_mean
        metrics_sum["top_7_mean_quality"] += top_7_mean
        metrics_sum["top_1_selection_efficiency"] += top_1_eff
        metrics_sum["top_3_selection_efficiency"] += top_3_eff
        metrics_sum["top_7_selection_efficiency"] += top_7_eff
        
        # Backwards compatibility alias for old top-7 metric
        metrics_sum["top_k_mean_quality"] += top_7_mean
        metrics_sum["top_k_selection_efficiency"] += top_7_eff
        
        metrics_sum["champion_quality_rank"] += champ_rank
        
    # Average them
    return {k: round(v / n_quality_seeds, 4) for k, v in metrics_sum.items()}
