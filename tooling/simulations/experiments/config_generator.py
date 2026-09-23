"""Generate focused re-run experiment configurations (v2).

Five studies targeting three thesis goals:
  ① Scaling Frontier  — Quality-aware scaling across 3 feed regimes (54 runs)
  ② Siphon Ablation   — Vote migration ON vs OFF at N=50 and N=100 (12 runs)
  ③ Dual-Window Ablation — 2×2 factorial (PF × Ballot diversity) at N=50, N=100 (24 runs)
  ④ Attention Baseline — Null-model (quality-blind) scaling (15 runs)
  ⑤ Carpentras Ideal Baseline — Theoretical monotonic scaling (18 runs)

Total: 123 runs (41 configs × 3 seeds).

Model changes from original implementation:
  - Vote-to-remix fallback fixed (spurious proposals eliminated)
  - max_actions_per_session = 3 (max), averaging ~2 per session via randint(1,3)
  - Notification shuffle for fair siphon distribution
  - Persona modifiers removed (simplified agent model)

Seeds: 42, 99, 137 (unchanged from v1).
Duration: 30 simulated days, 500 max steps.
"""

import json
from collections import Counter
from pathlib import Path


SEEDS = [42, 99, 137]

# ──────────────────────────────────────────────────────────────────────────────
# Shared base configuration — identical across all studies
# ──────────────────────────────────────────────────────────────────────────────
BASE_CONFIG = {
    "scenario": "convergence",
    "agents": 50,  # overridden per-config where needed
    "target_duration_days": 30,
    "max_steps": 500,
    "time_min_hours": 4,
    "time_max_hours": 12,
    "time_long_jump_chance": 0.15,
    "initial_solution_min_delay_days": 0,
    "initial_solution_max_delay_days": 0,
    "progress_every_steps": 0,
    "language": "en",
    "disable_llm": True,
    "question": {
        "title": "Simulation Study",
        "description": "Evaluating collective intelligence dynamics under controlled conditions.",
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# Shared behavior defaults — calibrated from WG-Studiengruppe (Aug 2026)
# ──────────────────────────────────────────────────────────────────────────────
BASE_BEHAVIOR = {
    "deterministic_target": False,
    "enable_siphon": True,
    "quality_aware": False,
    "fixed_sessions_mean": 15,
    "fixed_sessions_spread": 0.2,
    "max_actions_per_session": 3,  # max=3, engine uses randint(1,3) → avg ~2
}


def make_run(study_id: str, config_id: str, seed: int, *,
             agents: int = 50,
             pf_weights: dict | None = None,
             ballot_config: dict | None = None,
             enable_siphon: bool = True,
             quality_aware: bool = False,
             behavior_overrides: dict | None = None) -> dict:
    """Build a single run definition.
    
    Args:
        behavior_overrides: Dictionary of profile overrides for the scenario.
    """
    behavior = {
        **BASE_BEHAVIOR,
        "enable_siphon": enable_siphon,
        "quality_aware": quality_aware,
    }
    if pf_weights is not None:
        behavior["personal_focus_weights"] = pf_weights
    if ballot_config is not None:
        behavior["ballot_config"] = ballot_config
    if behavior_overrides:
        behavior.update(behavior_overrides)

    return {
        "run_id": f"{study_id}_{config_id}_s{seed}",
        "seed": seed,
        "config": {
            **BASE_CONFIG,
            "agents": agents,
            "behavior": behavior,
        },
    }


def add_study(runs: list[dict], study_id: str, config_id: str, **kwargs):
    """Add one config × 3 seeds to the run list."""
    for seed in SEEDS:
        runs.append(make_run(study_id, config_id, seed, **kwargs))


def generate_configs():
    runs: list[dict] = []

    # ══════════════════════════════════════════════════════════════════════
    # ① SCALING FRONTIER
    #
    # Goal: Bridge the scaling claim between Carpentras et al. (2025) and
    #   the implemented platform. Reproduce the Inverted-U Scaling Trajectory
    #   and show how feed algorithm choice shifts the efficiency curve.
    #
    # Design: Quality-aware agents × 6 population sizes × 3 feed regimes.
    #   - Standard PersonalFocus: the platform as shipped
    #   - Random feed:           lower bound (no attention routing) — FIXES S11 BUG
    #   - Newest feed:           naive chronological baseline (most common in real platforms)
    #
    # 18 configs × 3 seeds = 54 runs
    # ══════════════════════════════════════════════════════════════════════

    SCALING_SIZES = [10, 25, 50, 100, 200, 400]

    for n in SCALING_SIZES:
        # Standard PersonalFocus (default weights — no override needed)
        add_study(runs, "scaling_frontier", f"standard_pf_n{n}",
                  agents=n, quality_aware=True)

        # Random feed — NOTE: personal_focus_weights dict with mode key
        # This is the corrected S11 config: mode MUST be inside personal_focus_weights,
        # NOT at the top-level behavior dict.
        add_study(runs, "scaling_frontier", f"random_feed_n{n}",
                  agents=n, quality_aware=True,
                  pf_weights={"mode": "random"})

        # Newest feed (chronological) — the default UX of most platforms
        add_study(runs, "scaling_frontier", f"newest_feed_n{n}",
                  agents=n, quality_aware=True,
                  pf_weights={"mode": "newest"})

    # ══════════════════════════════════════════════════════════════════════
    # ② SIPHON ABLATION
    #
    # Goal: Prove that vote migration (the Siphon Effect) is structurally
    #   necessary to prevent first-mover idea entrenchment. This mechanism
    #   has no analogue in Carpentras's ABM (which assumes independent
    #   discrete votes, not persistent subscriptions).
    #
    # Design: Quality-aware agents with Siphon ON vs OFF at N=50 and N=100.
    #   N=50 is adjacent to human trial scale; N=100 is the scaling peak
    #   where more late-stage remixes compete with incumbents.
    #
    # 4 configs × 3 seeds = 12 runs
    # ══════════════════════════════════════════════════════════════════════

    for n in [50, 100]:
        add_study(runs, "siphon_ablation", f"siphon_on_n{n}",
                  agents=n, quality_aware=True, enable_siphon=True)

        add_study(runs, "siphon_ablation", f"siphon_off_n{n}",
                  agents=n, quality_aware=True, enable_siphon=False)

    # ══════════════════════════════════════════════════════════════════════
    # ③ DUAL-WINDOW ABLATION
    #
    # Goal: Show that PersonalFocus (individual attention routing) and
    #   Ballot diversity enforcement (collective label-exclusive curation)
    #   are complementary — each contributes independently to selection
    #   efficiency. Together they bridge the 7×–17× evaluation density gap
    #   between human trials (v=3–7) and Carpentras's v≈50 threshold.
    #
    # Design: 2×2 factorial at N=50 and N=100.
    #   - Full Platform:       Standard PF + full label exclusivity
    #   - No Feed Routing:     Random feed + full label exclusivity
    #   - No Ballot Diversity: Standard PF + no exclusivity (pure popularity)
    #   - Neither:             Random feed + no exclusivity
    #
    # 8 configs × 3 seeds = 24 runs
    # ══════════════════════════════════════════════════════════════════════

    for n in [50, 100]:
        # Full platform (both mechanisms active)
        add_study(runs, "three_window", f"full_platform_n{n}",
                  agents=n, quality_aware=True)

        # No feed routing (random feed, but ballot diversity preserved)
        add_study(runs, "three_window", f"no_feed_routing_n{n}",
                  agents=n, quality_aware=True,
                  pf_weights={"mode": "random"})

        # No ballot diversity (standard PF, but popularity-only ballot)
        add_study(runs, "three_window", f"no_ballot_diversity_n{n}",
                  agents=n, quality_aware=True,
                  ballot_config={"exclusivityMode": "none"})

        # Neither mechanism (random feed + popularity-only ballot)
        add_study(runs, "three_window", f"neither_n{n}",
                  agents=n, quality_aware=True,
                  pf_weights={"mode": "random"},
                  ballot_config={"exclusivityMode": "none"})

    # ══════════════════════════════════════════════════════════════════════
    # ④ ATTENTION BASELINE
    #
    # Goal: Demonstrate that the platform's structural mechanisms (PersonalFocus
    #   routing, label-exclusive ballot) distribute attention fairly even
    #   when users cannot reliably assess proposal quality. This separates
    #   architectural contribution from agent cognitive ability.
    #
    # Design: Attention-driven (quality-blind) agents under standard
    #   PersonalFocus across 5 population sizes.
    #   N=300/400 dropped — attention starvation is clear by N=200.
    #
    # 5 configs × 3 seeds = 15 runs
    # ══════════════════════════════════════════════════════════════════════

    for n in [10, 25, 50, 100, 200]:
        add_study(runs, "attention_baseline", f"null_model_n{n}",
                  agents=n, quality_aware=False)

    # ══════════════════════════════════════════════════════════════════════
    # ⑤ CARPENTRAS IDEAL BASELINE
    #
    # Goal: Reproduce the theoretical monotonic scaling prediction from
    #   Carpentras et al. (2025) by giving agents near-complete catalog
    #   visibility and sufficient evaluation budget (v ≈ 50). This
    #   provides a reference curve to overlay against the platform's
    #   Inverted-U trajectory, demonstrating that the scaling breakdown
    #   is caused by bounded attention, not by the quality model itself.
    #
    # Model alignment (Carpentras et al. 2025):
    #   - Quality equations: exact match (root |N(0,1)|, remix Δ~N(0,0.5),
    #     merge max+|N(0,0.3)|)
    #   - Agent utility: u_i(s) = q(s) + ε_i(s), ε ~ N(0, 0.5), M1 variant
    #     (stable preferences: noise_cache preserved across sessions)
    #   - Independent evaluations: independent_votes=True clears voted_solutions
    #     at session start — each session is a fresh discrete vote
    #   - No vote migration: enable_siphon=False (Carpentras assumes frictionless
    #     updating, not persistent subscriptions)
    #   - Uniform access: mode=random (no PersonalFocus attention routing)
    #   - Sufficient evaluation budget: 50 sessions × 10 actions → v >> 50
    #
    # Known divergences from paper (unavoidable in live-platform simulation):
    #   - Proposal set grows during the run (paper uses a fixed set); early
    #     proposals accumulate more evaluations than late ones
    #   - v is distributed over time, not fixed upfront
    #
    # 6 configs × 3 seeds = 18 runs
    # ══════════════════════════════════════════════════════════════════════

    CARPENTRAS_BEHAVIOR = {
        "pool_k_foryou": 50,
        "pool_k_notifications": 0,
        "pool_k_ballot": 0,
        "max_actions_per_session": 10,
        "fixed_sessions_mean": 50,
        "fixed_sessions_max": 80,
        "p_vote": 0.80,
        "p_create_root": 0.05,
        "independent_votes": True,   # Carpentras independent-evaluation model (M1)
    }

    for n in [10, 25, 50, 100, 200, 400]:
        add_study(runs, "carpentras_ideal", f"theoretical_n{n}",
                  agents=n, quality_aware=True, enable_siphon=False,
                  pf_weights={"mode": "random"},
                  behavior_overrides=CARPENTRAS_BEHAVIOR)


    # ══════════════════════════════════════════════════════════════════════
    # Output
    # ══════════════════════════════════════════════════════════════════════
    out_dir = Path(__file__).parent
    out_file = out_dir / "experiment_configs.json"

    with open(out_file, "w") as f:
        json.dump(runs, f, indent=2)

    # Summary
    study_counts = Counter(r["run_id"].split("_s")[0].rsplit("_", 1)[0]
                           if "_n" in r["run_id"]
                           else r["run_id"].rsplit("_s")[0]
                           for r in runs)

    # Better: count by study prefix
    study_prefix_counts: dict[str, int] = {}
    for r in runs:
        prefix = r["run_id"].split("_")[0] + "_" + r["run_id"].split("_")[1]
        study_prefix_counts.setdefault(
            "_".join(r["run_id"].split("_")[:2]),
            0
        )

    # Simpler: just split on study ID
    study_id_counts: dict[str, int] = {}
    for r in runs:
        # Study ID is everything before the first config variant
        sid = r["run_id"].split("_")[0]  # e.g. "scaling" from "scaling_frontier_..."
        # Actually use the full study name
        parts = r["run_id"].split("_")
        if parts[0] == "scaling":
            sid = "scaling_frontier"
        elif parts[0] == "siphon":
            sid = "siphon_ablation"
        elif parts[0] == "dual":
            sid = "three_window"
        elif parts[0] == "attention":
            sid = "attention_baseline"
        else:
            sid = parts[0]
        study_id_counts[sid] = study_id_counts.get(sid, 0) + 1

    print(f"\n{'='*60}")
    print(f"Generated {len(runs)} runs → {out_file}")
    print(f"{'='*60}")
    for sid, cnt in study_id_counts.items():
        print(f"  {sid:25s}: {cnt:3d} runs")
    print(f"  {'─'*35}")
    print(f"  {'TOTAL':25s}: {len(runs):3d} runs")
    print()


if __name__ == "__main__":
    generate_configs()
