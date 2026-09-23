from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import os


@dataclass
class BehaviorProfile:
    """Calibratable agent behavior parameters.

    Every field corresponds to a measurable evaluation metric so that
    simulations can be calibrated against real study data.
    Default values are calibrated from the WG-Studiengruppe study (2026-08-05).

    Metric → Parameter mapping:
      participation.power_user_ratio  → engagement_alpha / engagement_beta
      participation.proposals_per_actor → p_create_root
      participation.remix_fraction    → remix_probability (passed separately)
      participation.votes_per_actor   → p_vote
      behavioral.retraction_rate      → retract_fraction
      behavioral.cross_cluster_engagement → tab_weights
    """

    # ── Activity (maps to: power_user_ratio, actions_per_agent) ───────────────
    # WG study: ~10% power users → Beta(2,3) more right-skewed than Beta(3,2)
    attention_half_life_days: float = 7.0
    engagement_alpha: float = 2.0
    engagement_beta: float = 3.0
    nighttime_baseline: float = 0.05

    # Fixed session budget (Carpentras-inspired)
    # When set, each agent gets a bounded number of sessions instead of
    # the stochastic is_active() roll. None = use stochastic model.
    fixed_sessions_mean: int | None = None
    fixed_sessions_spread: float = 0.2
    fixed_sessions_min: int = 5
    fixed_sessions_max: int = 30

    # ── Action probabilities ──────────────────
    # Maps to: behavioral.action_composition, participation.proposals_per_actor
    # WG: 1.3 proposals/user → higher early creation rate than generic default
    p_create_root: float = 0.03
    p_vote: float = 0.72

    # ── Guardrails ────────────────────────────────────────────────────
    # Maps to: participation.proposals_per_actor
    # WG: 13 proposals for 10 users → raise ceiling from 8 to 12
    root_ceiling: int = 12
    root_ceiling_damping: float = 0.02
    # WG: most users created exactly 1 proposal
    authored_root_damping: float = 0.08

    # ── Bounded-Attention Pool ─────────────────────────────────────────
    # Pool composition capacities (mirroring Carpentras M3 v=10 model)
    pool_k_notifications: int = 3
    pool_k_ballot: int = 3
    pool_k_foryou: int = 5
    max_actions_per_session: int = 3

    # Migration probability for non-quality-aware agents encountering a notification.
    # Quality-aware agents use deterministic utility comparison instead.
    # Calibrated from WG combined retraction rate: 50/178 = 28.1%.
    p_migrate: float = 0.50

    # Attention weights for selection (based on CSS position bias & scent)
    attention_weight_notification: float = 3.0  # High-scent interrupt (Pirolli & Card 1999)
    attention_weight_ballot: float = 1.5        # Social signal boost (Salganik et al. 2006)
    # ForYou items use inverse rank (1/rank) for position bias (Joachims et al. 2005)


    # ── Sensitivity Overrides ───────────────────────────────────────
    personal_focus_weights: dict[str, float] | None = None
    ballot_config: dict[str, Any] | None = None
    # When True, _pick_target() always selects ranked_list[0] instead of
    # stochastic top-k sampling.  This isolates the feed-ranking algorithm's
    # effect on attention distribution — used for OAT sensitivity analysis.
    deterministic_target: bool = False
    
    # Action logging (focus_enter/exit) is extremely slow (2 HTTP calls per action).
    # It is disabled by default for simulations.
    log_focus_events: bool = False

    # When False, skip Phase 1 (migration prompts) entirely — used for Siphon ablation study.
    enable_siphon: bool = True

    # ── Quality-Aware Voting (Carpentras 2025 Model) ───────────────────
    # When True, agents vote for the highest-utility proposal among those seen,
    # rather than stochastic/deterministic ranking selection.
    quality_aware: bool = False
    agent_noise_sigma: float = 0.5  # per-agent preference noise σ

    # When True, voted_solutions is cleared at the start of every session so
    # each evaluation is independent — implementing Carpentras et al. (2025)'s
    # discrete independent-vote assumption.  The _noise_cache is intentionally
    # NOT cleared: per-agent preference noise stays stable across sessions
    # (M1 "stable preferences" variant).  Leave False for the platform's
    # persistent-subscription model.
    independent_votes: bool = False

    # ── Calibration metadata (informational) ───────────────────────────
    source_study: str = "WG_Studiengruppe_2026"
    calibration_date: str = "2026-08-05"

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "BehaviorProfile":
        """Load from a plain dict (e.g. parsed from JSON config)."""
        kwargs: dict[str, Any] = {}
        for key, val in d.items():
            if key in ["p_create_root", "p_vote", "p_migrate"]:
                kwargs[key] = float(val)
            elif key in ["personal_focus_weights", "ballot_config"] and val is not None:
                kwargs[key] = {str(k): v for k, v in val.items()}
            else:
                # Pass through; let dataclass handle type coercion
                kwargs[key] = val
        return cls(**{k: v for k, v in kwargs.items() if hasattr(cls, k)})




@dataclass(frozen=True)
class SimulationConfig:
    base_url: str
    admin_email: str
    admin_password: str
    agents: int
    seed: int
    max_steps: int
    json_out: str | None
    llm_provider: str
    llm_api_base: str
    llm_model: str
    llm_api_key: str | None
    llm_temperature: float
    disable_llm: bool
    time_min_hours: int
    time_max_hours: int
    time_long_jump_chance: float
    time_long_jump_min_days: int
    time_long_jump_max_days: int
    target_duration_days: int
    progress_every_steps: int
    start_at: str | None
    initial_solution_min_delay_days: int
    initial_solution_max_delay_days: int
    remix_probability: float
    merge_probability: float

    question_title_prefix: str
    language: str  # "de" or "en"

    # Calibratable agent behavior profile (loaded from config JSON "behavior" key)
    behavior: BehaviorProfile = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        # Set default BehaviorProfile if not provided (frozen dataclass workaround)
        if self.behavior is None:
            object.__setattr__(self, "behavior", BehaviorProfile())


DEFAULT_BASE_URL = "http://localhost:8090"
DEFAULT_ADMIN_EMAIL = "admin@sim.local"
DEFAULT_ADMIN_PASSWORD = "AdminPass123!"
DEFAULT_LLM_API_BASE = "https://models.github.ai/inference"


def load_env_files(*file_paths: str) -> None:
    for path in file_paths:
        if not path or not os.path.isfile(path):
            continue

        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue

                key, value = line.split("=", 1)
                key = key.strip()
                if not key or key in os.environ:
                    continue

                cleaned = value.strip().strip('"').strip("'")
                os.environ[key] = cleaned


def env_default_base_url() -> str:
    return (
        os.environ.get("PRIVATE_POCKETBASE_URL")
        or os.environ.get("PUBLIC_POCKETBASE_URL")
        or DEFAULT_BASE_URL
    )
