from __future__ import annotations

import math
import random
from datetime import datetime

from tooling.simulations.engine.agents.agent_memory import AgentMemory
from tooling.simulations.engine.config import BehaviorProfile


def _beta_pdf_unnorm(x: float, a: float, b: float) -> float:
    """Unnormalized Beta PDF: x^(a-1) * (1-x)^(b-1), no scipy needed."""
    if x <= 0.0 or x >= 1.0:
        return 0.0
    return (x ** (a - 1.0)) * ((1.0 - x) ** (b - 1.0))


def assign_base_engagement(rng: random.Random, profile: BehaviorProfile | None = None) -> float:
    """Draw a base engagement level from Beta(alpha, beta) from profile.

    Default Beta(2, 3) is WG-calibrated: more right-skewed than Beta(3,2),
    producing ~10% power users matching the real study.
    """
    p = profile or BehaviorProfile()
    return rng.betavariate(p.engagement_alpha, p.engagement_beta)


class ActivityModel:
    """Determines whether an agent is active at a given simulated moment.

    All tunable parameters are driven by BehaviorProfile so simulations
    can be calibrated against real study data.
    """

    def __init__(self, profile: BehaviorProfile | None = None) -> None:
        self.profile = profile or BehaviorProfile()
        # Pre-compute normalisation constant for time-of-day beta
        self._tod_max = max(
            _beta_pdf_unnorm(x / 100.0, 2.0, 3.0) for x in range(1, 100)
        )

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    def is_active(
        self,
        agent: AgentMemory,
        simulated_now: datetime,
        simulation_start: datetime,
        rng: random.Random,
    ) -> bool:
        """Roll the dice: is this agent online right now?"""
        elapsed_days = max(0, (simulated_now - simulation_start).total_seconds() / 86400)
        hour = simulated_now.hour

        p = (
            agent.base_engagement
            * self.attention_decay(elapsed_days)
            * self.time_of_day_factor(hour)
        )
        return rng.random() < p

    # ------------------------------------------------------------------ #
    # Component functions
    # ------------------------------------------------------------------ #

    def attention_decay(self, day: float) -> float:
        """Logistic decay: 1.0 at day 0, ~0.5 at half_life, floor ~0.15.

        This models the natural tapering of attention after an initial burst.
        Half-life is driven by BehaviorProfile.attention_half_life_days.
        """
        hl = max(1.0, self.profile.attention_half_life_days)
        return 0.15 + 0.85 / (1.0 + (day / hl) ** 1.5)

    def time_of_day_factor(self, hour: int) -> float:
        """Activity factor by hour of day (0-23).

        Beta(2, 3) shape over waking hours 6:00-24:00.
        Peak around 10:00-14:00, tails off by evening.
        Night (0:00-6:00) uses BehaviorProfile.nighttime_baseline.
        """
        if hour < 6:
            return self.profile.nighttime_baseline

        # Map 6:00-24:00 → 0.0-1.0
        x = (hour - 6) / 18.0
        if x < 0.0 or x > 1.0:
            return self.profile.nighttime_baseline

        raw = _beta_pdf_unnorm(x, 2.0, 3.0)
        if self._tod_max > 0:
            return max(self.profile.nighttime_baseline, raw / self._tod_max)
        return self.profile.nighttime_baseline
