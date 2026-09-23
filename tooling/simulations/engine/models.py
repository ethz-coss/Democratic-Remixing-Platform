from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class SimUser:
    id: str
    username: str
    display_name: str
    email: str
    password: str
    token: str
    frontend_client: Any = None


@dataclass
class SimSolution:
    id: str
    title: str
    state: str
    author: str
    content: str = ""
    parent_ids: list[str] = field(default_factory=list)
    root_solution: str = ""
    current_vote_count: int = 0
    created: str = ""
    labels: list[str] = field(default_factory=list)
    primary_label: str = ""
    in_focus: bool = False
    is_champion: bool = False


@dataclass
class SimQuestionPhase:
    id: str
    phase_name: str
    started_at: str
    ended_at: str = ""


@dataclass
class RoundSnapshot:
    round_index: int
    proposed_count: int
    pending_merge_count: int = 0
    partial_merge_count: int = 0
    accepted_merge_count: int = 0
    total_vote_count: int = 0
    cluster_count: int = 0
    simulated_at: str = ""


@dataclass
class TimeEvent:
    step: int
    actor: str
    action: str
    simulated_at: str


@dataclass
class AgentDecision:
    step: int
    agent: str
    action: str
    target_solution_id: str | None
    details: str
    simulated_at: str
    tab_used: str | None = None


@dataclass
class ContentGenEvent:
    """Records one LLM content-generation call for thesis analysis."""
    step: int
    agent: str
    gen_type: str  # root, remix, merge, comment
    parent_ids: list[str]
    output_excerpt: str
    change_rationale: str = ""
    simulated_at: str = ""


@dataclass
class EvaluationSnapshot:
    """Captured at simulation end for self-contained metric computation.

    Contains all proposal states, votes, and labels so the collector can
    compute Gini, entropy, ballot composition, etc. without querying PB.
    """
    proposals: list[dict[str, Any]] = field(default_factory=list)
    votes: list[dict[str, Any]] = field(default_factory=list)
    labels: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class SimulationReport:
    run_id: str
    question_id: str
    seed: int
    agent_count: int
    steps: int = 0
    converged: bool = False
    convergence_reason: str = ""
    final_solution_id: str | None = None
    final_solution_title: str | None = None
    snapshots: list[RoundSnapshot] = field(default_factory=list)
    time_events: list[TimeEvent] = field(default_factory=list)
    decision_log: list[AgentDecision] = field(default_factory=list)
    content_generation_log: list[ContentGenEvent] = field(default_factory=list)
    question_phases: list[SimQuestionPhase] = field(default_factory=list)
    llm_token_usage: dict[str, int] = field(default_factory=dict)
    tab_usage_counts: dict[str, int] = field(default_factory=dict)
    evaluation_snapshot: EvaluationSnapshot | None = None
    quality_registry: dict[str, float] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "question_id": self.question_id,
            "seed": self.seed,
            "agent_count": self.agent_count,
            "steps": self.steps,
            "converged": self.converged,
            "convergence_reason": self.convergence_reason,
            "final_solution_id": self.final_solution_id,
            "final_solution_title": self.final_solution_title,
            "snapshots": [asdict(s) for s in self.snapshots],
            "time_events": [asdict(e) for e in self.time_events],
            "decision_log": [asdict(d) for d in self.decision_log],
            "content_generation_log": [asdict(e) for e in self.content_generation_log],
            "question_phases": [asdict(p) for p in self.question_phases],
            "llm_token_usage": self.llm_token_usage,
            "tab_usage_counts": self.tab_usage_counts,
            "evaluation_snapshot": {
                "proposals": self.evaluation_snapshot.proposals,
                "votes": self.evaluation_snapshot.votes,
                "labels": self.evaluation_snapshot.labels,
            } if self.evaluation_snapshot else None,
            "quality_registry": self.quality_registry,
        }
