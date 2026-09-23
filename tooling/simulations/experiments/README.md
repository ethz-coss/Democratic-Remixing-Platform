# Computational Experiments — Focused Re-Run Suite

This package generates and orchestrates the focused simulation re-run suite for the Master's Thesis. It replaces the original 12-study / 192-run matrix with 4 targeted studies producing 123 runs, each directly serving one of three thesis goals: scaling validation, component ablation, and connection to Carpentras et al. (2025).

## Why Re-Run?

The simulation engine was modified in September 2026 with four changes:

1. **Vote-to-Remix fallback fix** — agents who already voted no longer spawn spurious remixes (significant at N≥100, inflated proposal counts by hundreds at N=400).
2. **Multi-action sessions** — agents evaluate up to `max_actions_per_session=3` targets per login (`randint(1,3)` → average ~2).
3. **Notification shuffle** — siphon candidates randomised before slicing (minor improvement).
4. **Persona removal** — archetype probability modifiers stripped (cosmetic, 55% matched no archetype).

Additionally, the original **Study S11** (random feed scaling) had a YAML nesting bug where `mode: random` was placed at the behavior dict level instead of inside `personal_focus_weights`, causing it to silently run with standard PersonalFocus weights.

At N=50 (the scale of the original ablation studies S1–S9), these changes have negligible effect. At N≥100, the vote-to-remix fix directly addresses the artifactual proposal inflation, warranting a full re-run of all scaling studies.

## Study Designs

### ① Scaling Frontier (54 runs)

**Question:** How far does remixing scale under realistic cognitive constraints, and does the feed algorithm matter?

**Thesis role:** Reproduces the Inverted-U Scaling Trajectory; bridges to Carpentras et al. (2025) by overlaying platform efficiency against theoretical prediction.

| Variant | Feed Mode | Purpose |
|---|---|---|
| `standard_pf` | Default PersonalFocus weights | The platform as shipped |
| `random_feed` | `mode: random` | No attention routing (lower bound). **Fixes S11 bug.** |
| `newest_feed` | `mode: newest` (chronological) | Naive baseline — default UX of most platforms |

Population sizes: N ∈ {10, 25, 50, 100, 200, 400}  
Quality-aware: Yes  
Configs: 18 × 3 seeds = 54 runs

### ② Siphon Ablation (12 runs)

**Question:** Is the Siphon Effect (vote migration) structurally necessary to prevent first-mover lock-in?

**Thesis role:** Proves that persistent subscriptions create an entrenchment problem absent from the Carpentras ABM (which assumes independent discrete votes), and that the Siphon is the structural answer.

| Variant | Siphon | N |
|---|---|---|
| `siphon_on_n50` | Enabled | 50 |
| `siphon_off_n50` | Disabled | 50 |
| `siphon_on_n100` | Enabled | 100 |
| `siphon_off_n100` | Disabled | 100 |

Quality-aware: Yes  
Configs: 4 × 3 seeds = 12 runs

### ③ Dual-Window Ablation (24 runs)

**Question:** Are PersonalFocus and Ballot diversity enforcement complementary or redundant?

**Thesis role:** Justifies the two-stage architecture that bridges the 7×–17× evaluation density gap between human trials (v=3–7) and Carpentras's v≈50 threshold.

| Variant | PersonalFocus | Ballot Diversity |
|---|---|---|
| `full_platform` | Standard PF | `full` label exclusivity |
| `no_feed_routing` | Random feed | `full` label exclusivity |
| `no_ballot_diversity` | Standard PF | `none` (pure popularity) |
| `neither` | Random feed | `none` |

Population sizes: N ∈ {50, 100}  
Quality-aware: Yes  
Configs: 8 × 3 seeds = 24 runs

### ④ Attention Baseline (15 runs)

**Question:** Does the platform distribute attention fairly even without quality signals?

**Thesis role:** Separates structural mechanism contribution from agent cognitive ability. If the null model distributes attention well, the platform works under pessimistic assumptions about user judgement.

Population sizes: N ∈ {10, 25, 50, 100, 200}  
Quality-aware: No (attention-driven null model)  
Configs: 5 × 3 seeds = 15 runs

### ⑤ Carpentras Ideal Baseline (18 runs)

**Question:** Does the quality model itself reproduce Carpentras et al.'s monotonic scaling when cognitive constraints are removed?

**Thesis role:** Provides the theoretical reference curve. Overlaying ⑤ against ① proves that the Inverted-U scaling breakdown is caused by bounded attention (the platform's 11-card feed), not by the quality model or agent noise.

| Parameter | Value | Rationale |
|---|---|---|
| `pool_k_foryou` | 50 | Near-complete catalog visibility |
| `pool_k_notifications` | 0 | No siphon — votes are independent |
| `pool_k_ballot` | 0 | No ballot — direct evaluation |
| `max_actions_per_session` | 10 | Evaluate many proposals per session |
| `fixed_sessions_mean` | 50 | Sufficient budget for v ≈ 50 |
| `enable_siphon` | False | Carpentras assumes frictionless updating |
| Feed mode | Random | Carpentras assumes uniform access |

Population sizes: N ∈ {10, 25, 50, 100, 200, 400}
Quality-aware: Yes
Configs: 6 × 3 seeds = 18 runs

## Shared Configuration

| Parameter | Value | Source |
|---|---|---|
| Duration | 30 simulated days | Matches original |
| Max steps | 500 | Matches original |
| Seeds | 42, 99, 137 | Confirmed sufficient |
| `max_actions_per_session` | 3 (max, avg ~2) | User calibration decision |
| `fixed_sessions_mean` | 15 (σ=20%, bounded [5, 30]) | WG calibration |
| `p_root=0.03, p_vote=0.72, p_remix=0.15, p_merge=0.05` | WG calibration | Unchanged |
| `enable_siphon` | True (except ② OFF variants) | — |
| Content generation | LLM disabled (`disable_llm: True`) | Cost savings |

## Execution Pipeline

1. **Generate configurations:**
   ```bash
   python -m tooling.simulations.experiments.config_generator
   ```
   → `experiment_configs.json` (123 runs)

2. **Run simulations:**
   ```bash
   # Full sweep with 4 parallel workers
   python -m tooling.simulations.experiments.runner --config experiment_configs.json --workers 4

   # Single test run
   python -m tooling.simulations.experiments.runner --config experiment_configs.json --test

   # Filter by study
   python -m tooling.simulations.experiments.runner --config experiment_configs.json --filter scaling_frontier
   ```

3. **Collect metrics:**
   ```bash
   python -m tooling.simulations.experiments.collector
   ```
   → `tooling/output/experiments/experiment_results.csv`

4. **Generate figures:**
   ```bash
   python -m tooling.simulations.experiments.analysis
   ```
   → `tooling/output/experiments/figures/`

## Run ID Naming Convention

Run IDs follow the pattern: `{study}_{variant}_s{seed}`

Examples:
- `scaling_frontier_standard_pf_n100_s42`
- `siphon_ablation_siphon_off_n50_s137`
- `dual_window_no_feed_routing_n100_s99`
- `attention_baseline_null_model_n200_s42`

## Mapping to Prior Studies

| Study | Prior Mapping | Changes |
|---|---|---|
| ① Scaling Frontier (standard_pf) | S12 | Corrected model, N=300 dropped |
| ① Scaling Frontier (random_feed) | S11 | **S11 nesting bug fixed** |
| ① Scaling Frontier (newest_feed) | — | New: replaces S10 (max_exploration) with more interpretable chronological baseline |
| ② Siphon Ablation | S4 + S8 | Quality-aware only; tested at N=50 and N=100 (was N=50 only) |
| ③ Dual-Window Ablation | S3 + S9 | Quality-aware only; tested at N=50 and N=100 (was N=50 only) |
| ④ Attention Baseline | S5 | N=300/400 dropped; same null model |
| — (dropped) | S1 (OAT PF) | Prior results valid at N=50 |
| — (dropped) | S2 (Ballot) | Prior results valid at N=50 |
| — (dropped) | S6 (Quality baseline) | Subsumed by ① at N=50 |
| — (dropped) | S7 (Quality PF ablation) | Subsumed by ③ |
| — (dropped) | S10 (Max exploration scaling) | Replaced by newest_feed in ① |
