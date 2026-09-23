"""Per-agent action history for contextual LLM prompt generation."""

from __future__ import annotations

from dataclasses import dataclass, field
import random


@dataclass
class AgentMemory:
    """Tracks what a simulated agent has done during a run.

    Populated incrementally as the simulation loop executes actions.
    Used to build a compact narrative for LLM prompts so the model can
    generate context-aware content.
    """

    user_id: str
    
    # Solutions this agent authored (root, remix, or merge).
    authored_solutions: list[dict[str, str]] = field(default_factory=list)
    # solution_id → vote value (1 = Support, 0 = retracted).
    voted_solutions: dict[str, int] = field(default_factory=dict)
    # Whether this agent has signalled motion-to-finalize.
    signalled_motion: bool = False
    # Per-agent engagement level (0-1), drawn from Beta(3,2) during init.
    # Drives the activity model's probability of the agent being online.
    base_engagement: float = 0.6
    # Track proposals the agent has navigated to
    seen_proposal_ids: set[str] = field(default_factory=set)
    # Track label interaction frequency
    label_affinities: dict[str, int] = field(default_factory=dict)
    # Track which tabs the agent has browsed
    feed_tab_history: list[str] = field(default_factory=list)

    # NEW: per-agent preference noise for quality perception
    noise_sigma: float = 0.5  # how noisy agent preferences are (0 = perfect quality perception)
    _noise_rng: random.Random = field(default=None)  # seeded per agent for stable noise
    _noise_cache: dict[str, float] = field(default_factory=dict)  # proposal_id → ε_i(s)

    def __post_init__(self):
        # Fallback if not initialized (though simulation runner should pass it)
        if self._noise_rng is None:
            self._noise_rng = random.Random()
            
    def perceived_utility(self, proposal_id: str, objective_quality: float) -> float:
        """u_i(s) = q(s) + ε_i(s) — Carpentras Eq. 1"""
        if proposal_id not in self._noise_cache:
            self._noise_cache[proposal_id] = self._noise_rng.gauss(0, self.noise_sigma)
        return objective_quality + self._noise_cache[proposal_id]

    # ------------------------------------------------------------------ #
    # Recording helpers
    # ------------------------------------------------------------------ #

    def record_authored(self, solution_id: str, title: str, kind: str = "root") -> None:
        """Record that this agent authored a solution.

        *kind* is one of ``root``, ``remix``, or ``merge``.
        """
        self.authored_solutions.append(
            {"id": solution_id, "title": title, "kind": kind}
        )

    def record_vote(self, solution_id: str, vote: int) -> None:
        self.voted_solutions[solution_id] = vote

    def record_motion_signal(self) -> None:
        self.signalled_motion = True

    def mark_seen(self, solution_id: str) -> None:
        self.seen_proposal_ids.add(solution_id)

    # State: Budget
    session_budget: int = 0
    sessions_used: int = 0

    @property
    def has_budget(self) -> bool:
        """True if the agent has remaining session budget (or budget is uncapped)."""
        return self.session_budget <= 0 or self.sessions_used < self.session_budget

    def increment_label_affinity(self, labels: list[str]) -> None:
        for label in labels:
            self.label_affinities[label] = self.label_affinities.get(label, 0) + 1

    # ------------------------------------------------------------------ #
    # LLM context
    # ------------------------------------------------------------------ #

    def summary_for_llm(self, solution_titles: dict[str, str] | None = None) -> str:
        """Return a compact narrative of the agent's history.

        *solution_titles* is an optional map ``{solution_id: title}`` used
        to replace opaque IDs with human-readable titles.
        """
        titles = solution_titles or {}
        parts: list[str] = []

        # Authored
        authored_descs: list[str] = []
        for entry in self.authored_solutions:
            title = entry.get("title", "untitled")
            kind = entry.get("kind", "solution")
            authored_descs.append(f"'{title}' ({kind})")
        if authored_descs:
            parts.append(f"You authored: {', '.join(authored_descs[:5])}.")
        else:
            parts.append("You have not authored any solutions yet.")

        # Votes
        supported = [
            titles.get(sid, sid[:8])
            for sid, v in self.voted_solutions.items()
            if v > 0
        ]
        retracted = [
            titles.get(sid, sid[:8])
            for sid, v in self.voted_solutions.items()
            if v == 0
        ]
        if supported:
            quoted_supported = ", ".join(f"'{t}'" for t in supported[:5])
            parts.append(f"You supported: {quoted_supported}.")
        if retracted:
            quoted_retracted = ", ".join(f"'{t}'" for t in retracted[:5])
            parts.append(f"You retracted support from: {quoted_retracted}.")
        if not supported and not retracted:
            parts.append("You have not voted on any solutions yet.")

        # Motion
        if self.signalled_motion:
            parts.append("You have signalled readiness to finalize.")

        return " ".join(parts)
