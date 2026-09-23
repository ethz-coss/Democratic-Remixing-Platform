from __future__ import annotations
import os
from tooling.simulations.engine.time_model import TimeModel
from tooling.simulations.engine.snapshot import SnapshotCapture
from tooling.simulations.engine.bootstrap import SimulationBootstrap
from tooling.simulations.engine.utils import strip_html
"""Convergence simulation using the bounded-attention pool model.

Simulates ~50 agents collaborating on a cost-sharing question through
Proposed → AnswerSearch phases. Each agent evaluates a unified candidate
pool (~11 items from notifications, ballot, and PersonalFocus feed) and
takes exactly one action per session.

All business logic (scoring, clustering, champion election, phase
transitions) is handled server-side by PocketBase hooks. The simulation
only makes API calls that a real user would make.
"""



from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import html
import json
import math
import random
import re
import sys
from typing import Any

from tooling.simulations.engine.agents.activity_model import ActivityModel, assign_base_engagement
from tooling.simulations.engine.agents.agent_memory import AgentMemory
from tooling.simulations.engine.agents.content_generator import ContentGenerator
from tooling.simulations.engine.agents.decision_engine import ActionType, AgentDecisionEngine
from tooling.simulations.engine.config import BehaviorProfile
from tooling.simulations.engine.llm_client import LLMClient, LLMConfig
from tooling.simulations.engine.models import (
    AgentDecision,
    ContentGenEvent,
    EvaluationSnapshot,
    RoundSnapshot,
    SimQuestionPhase,
    SimSolution,
    SimUser,
    SimulationReport,
    TimeEvent,
)
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.quality_registry import QualityRegistry


@dataclass
class ConvergenceScenario:
    pb: PocketBaseClient
    rng: random.Random
    run_id: str
    agent_count: int
    max_steps: int
    simulation_seed: int
    llm_provider: str
    llm_api_base: str
    llm_model: str
    llm_api_key: str | None
    llm_temperature: float
    llm_enabled: bool
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

    question_title_prefix: str = ""
    question_title_suffix: str = ""
    language: str = "de"
    question_id: str | None = None
    question_config: dict[str, Any] | None = None
    group_config: dict[str, Any] | None = None
    behavior_profile: BehaviorProfile = field(default_factory=BehaviorProfile)

    user_password: str = field(default_factory=lambda: os.environ.get("SIM_USER_PASSWORD", "changeme"))
    _solution_counter: int = 0
    _simulated_now: datetime | None = None
    _question_context: dict[str, Any] | None = None
    _agent_memories: dict[str, AgentMemory] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._llm = LLMClient(
            LLMConfig(
                provider=self.llm_provider,
                api_base=self.llm_api_base,
                model=self.llm_model,
                api_key=self.llm_api_key,
                temperature=self.llm_temperature,
                enabled=self.llm_enabled,
            )
        )
        self._time = TimeModel(
            target_duration_days=self.target_duration_days,
            time_min_hours=self.time_min_hours,
            time_max_hours=self.time_max_hours,
            time_long_jump_chance=self.time_long_jump_chance,
            time_long_jump_min_days=self.time_long_jump_min_days,
            time_long_jump_max_days=self.time_long_jump_max_days,
            rng=self.rng,
            start_at=self.start_at
        )
        self._snapshots = SnapshotCapture(self.pb)

    def _seed_initial_solutions(
        self,
        question_id: str,
        users: list[SimUser],
        report: SimulationReport,
        content_gen: ContentGenerator,
    ) -> None:
        delay_days = self.rng.randint(
            self.initial_solution_min_delay_days,
            self.initial_solution_max_delay_days,
        )
        if delay_days > 0:
            self._time.now += timedelta(
                days=delay_days,
                hours=self.rng.randint(2, 16),
                minutes=self.rng.randint(0, 59),
            )
            report.time_events.append(
                TimeEvent(
                    step=0,
                    actor="system",
                    action="initial_solutions_window_opened",
                    simulated_at=self._time.now_iso(),
                )
            )

        # Create 3 initial solutions from the first 3 agents
        starters = min(3, len(users))
        for i in range(starters):
            user = users[i]
            memory = self._agent_memories.get(user.id)
            if not memory:
                continue
            self._do_create_root(user, question_id, 0, report, memory, content_gen)

    # ================================================================== #
    # Main entry point
    # ================================================================== #

    def run(self) -> SimulationReport:
        """Execute the full simulation lifecycle."""
        bootstrapper = SimulationBootstrap(
            pb=self.pb,
            run_id=self.run_id,
            agent_count=self.agent_count,
            user_password=self.user_password,
            question_title_prefix=self.question_title_prefix,
            question_title_suffix=self.question_title_suffix,
            group_config=self.group_config,
        )

        # ── Bootstrap ──
        if self.question_id:
            # Load context from existing question
            question = self.pb.get_record("questions", self.question_id)
            self._sim_group_id = question.get("group")
            bootstrapper.sim_group_id = self._sim_group_id
            
            constraints_list = []
            for c in question.get("constraints", []):
                if isinstance(c, dict):
                    constraints_list.append(c.get("description", ""))
                else:
                    constraints_list.append(str(c))
                    
            self._question_context = {
                "title": question.get("title", ""),
                "description": question.get("description", ""),
                "constraints": constraints_list,
            }
            bootstrap = {"agents": []}
        else:
            bootstrap = bootstrapper.bootstrap_simulation_context(self.question_config)
            self._question_context = bootstrap.get("question", {})

        users = bootstrapper.create_users()
        self._sim_group_id = bootstrapper.sim_group_id

        # Initialise content generator and decision engine
        content_gen = ContentGenerator(
            llm=self._llm,
            question_context=self._question_context,
            rng=self.rng,
            language=self.language,
        )
        decision_engine = AgentDecisionEngine(rng=self.rng, profile=self.behavior_profile)
        self.quality_registry = QualityRegistry(rng=self.rng)

        # Initialise agent memories with per-agent engagement levels
        for user in users:
            memory = AgentMemory(
                user_id=user.id,
                base_engagement=assign_base_engagement(self.rng, self.behavior_profile),
            )
            if self.behavior_profile.fixed_sessions_mean is not None:
                mean = self.behavior_profile.fixed_sessions_mean
                std = mean * self.behavior_profile.fixed_sessions_spread
                budget = round(self.rng.gauss(mean, std))
                budget = max(self.behavior_profile.fixed_sessions_min, min(self.behavior_profile.fixed_sessions_max, budget))
                memory.session_budget = budget
            self._agent_memories[user.id] = memory

        # Activity model drives which agents are online each step
        activity_model = ActivityModel(profile=self.behavior_profile)

        # ── Create question ──
        print("[debug-sim] Entering question creation...", flush=True)
        if self.question_id:
            question_id = self.question_id
        else:
            question_id = bootstrapper.create_question(users, self._question_context, self.behavior_profile, self._time.now_pb_iso())
        print(f"[debug-sim] Question created: {question_id}", flush=True)
            
        simulation_start = self._time.now
        report = SimulationReport(
            run_id=self.run_id,
            question_id=question_id,
            seed=self.simulation_seed,
            agent_count=len(users),
            quality_registry=self.quality_registry.to_dict(),
        )

        # ── Phase 1: SKIP PROPOSED – question created directly in AnswerSearch ──

        # ── Seed initial solutions ──
        print("[debug-sim] Seeding initial solutions...", flush=True)
        self._seed_initial_solutions(question_id, users, report, content_gen)
        print("[debug-sim] Done seeding initial solutions.", flush=True)

        # ── Phase 2: ACTIVE WORKSPACE – main simulation loop ──
        step = 0
        while step < self.max_steps:
            step += 1
            report.steps = step
            self._time.advance_time(step, "system", "step_started", report)

            phase = self._current_question_phase(question_id)
            if phase not in ("AnswerSearch", "Ideation"):
                # Past Active — stop
                if phase in ("ClosingWindow", "FinalResolution", "FinalReproposal", "Voting"):
                    report.convergence_reason = f"phase_advanced_to_{phase}"
                    break

            solutions = self._list_solutions(question_id)
            proposed = [s for s in solutions if s.state == "Proposed"]

            # Shuffle agents for this step
            step_agents = list(users)
            self.rng.shuffle(step_agents)

            # Activity model: either fixed budget or stochastic roll
            if self.behavior_profile.fixed_sessions_mean is not None:
                # Budget model: agents with remaining budget
                eligible = [
                    user for user in step_agents
                    if self._agent_memories[user.id].has_budget
                ]
                if not eligible:
                    report.convergence_reason = "all_budgets_exhausted"
                    break

                # Select a realistic subset: ~24% of eligible agents per step
                # (same density as the stochastic model's Beta(2,3) mean)
                target_active = max(1, round(len(eligible) * 0.24))
                active_agents = self.rng.sample(eligible, min(target_active, len(eligible)))
            else:
                # Stochastic model based on engagement level, attention decay, and time-of-day
                active_agents = [
                    user for user in step_agents
                    if activity_model.is_active(
                        self._agent_memories[user.id],
                        self._time.now,
                        simulation_start,
                        self.rng,
                    )
                ]
                if not active_agents:
                    # At least 1 agent must participate to make progress
                    active_agents = [self.rng.choice(step_agents)]

            # Pre-compute view_counts for RecommendationEngine
            view_counts = {}
            for s in proposed:
                vc = sum(1 for mem in self._agent_memories.values() if s.id in mem.seen_proposal_ids)
                view_counts[s.id] = vc

            for user in active_agents:
                memory = self._agent_memories[user.id]
                solution_titles = {s.id: s.title for s in proposed}

                # ── Independent-vote mode (Carpentras ideal baseline) ──
                # Clear persistent subscriptions before each session so every
                # evaluation is independent — matching Carpentras et al. (2025)'s
                # discrete vote model.  The noise cache is kept so per-agent
                # preference noise stays stable across sessions (M1 variant).
                if self.behavior_profile.independent_votes:
                    memory.voted_solutions.clear()

                # ── Autonomous action ──
                actions = decision_engine.decide_session_actions(
                    memory=memory,
                    solutions=proposed,
                    remix_probability=self.remix_probability,
                    merge_probability=self.merge_probability,
                    view_counts=view_counts,
                    quality_registry=self.quality_registry,
                    simulated_now=self._time.now,
                )
                
                for action in actions:
                    if action.tab_used:
                        report.tab_usage_counts[action.tab_used] = report.tab_usage_counts.get(action.tab_used, 0) + 1
    
                    report.decision_log.append(
                        AgentDecision(
                            step=step,
                            agent=user.username,
                            action=action.action_type.value,
                            target_solution_id=action.target_solution_id,
                            details=action.reason or "",
                            simulated_at=self._time.now_iso(),
                            tab_used=action.tab_used,
                        )
                    )
    
                    self._execute_action(
                        action_type=action.action_type,
                        user=user,
                        question_id=question_id,
                        step=step,
                        report=report,
                        memory=memory,
                        content_gen=content_gen,
                        proposed=proposed,
                        target_id=action.target_solution_id,
                        second_parent_id=action.second_parent_id,
                    )
                
                # Increment the sessions used by the agent
                memory.sessions_used += 1

            # ── Snapshot & progress ──
            if self.progress_every_steps > 0 and step % self.progress_every_steps == 0:
                proposed = [s for s in self._list_solutions(question_id) if s.state == "Proposed"]
                elapsed_days = self._time.elapsed_days(simulation_start)
                self._snapshots.log_progress(step, elapsed_days, len(proposed), report)
                self._snapshots.capture_snapshot(proposed, report, self._time.now_iso())

            # ── Duration-based stop ──
            elapsed_days = self._time.elapsed_days(simulation_start)
            if elapsed_days >= self.target_duration_days:
                report.convergence_reason = f"target_duration_reached_{elapsed_days}d"
                break

        if not report.convergence_reason:
            report.convergence_reason = "max_steps_reached"

        # Capture question phases into report
        try:
            phases_recs = self.pb.list_records(
                "question_phases",
                filter_expr=f'question="{question_id}"',
                sort="created"
            )
            for p in phases_recs:
                report.question_phases.append(
                    SimQuestionPhase(
                        id=str(p.get("id", "")),
                        phase_name=str(p.get("phase_name", "")),
                        started_at=str(p.get("started_at", "")),
                        ended_at=str(p.get("ended_at", "")),
                    )
                )
        except PocketBaseError as e:
            print(f"[phases] failed to fetch question_phases: {e}", file=sys.stderr)

        # Capture LLM token usage into report
        report.llm_token_usage = self._llm.token_summary()

        # Capture evaluation snapshot for self-contained metric computation
        report.evaluation_snapshot = self._snapshots.capture_evaluation_snapshot(question_id)
        
        # Determine winning proposal (highest subscription count)
        if report.evaluation_snapshot and report.evaluation_snapshot.proposals:
            winner = max(
                report.evaluation_snapshot.proposals,
                key=lambda p: p.get("subscription_count", 0),
            )
            report.final_solution_id = winner.get("id")
            report.final_solution_title = winner.get("title")
            # Consider "converged" if winner has >= 2× the votes of runner-up
            sorted_by_votes = sorted(
                report.evaluation_snapshot.proposals,
                key=lambda p: p.get("subscription_count", 0),
                reverse=True,
            )
            if len(sorted_by_votes) >= 2:
                top_votes = sorted_by_votes[0].get("subscription_count", 0)
                runner_up = sorted_by_votes[1].get("subscription_count", 0)
                report.converged = top_votes >= 2 * max(runner_up, 1)
            else:
                report.converged = True  # only one proposal

        report.quality_registry = self.quality_registry.to_dict()

        return report

    # ================================================================== #
    # Phase management
    # ================================================================== #

    def _current_question_phase(self, question_id: str) -> str:
        """Fetch the current phase from PocketBase.

        The question record stores a `current_phase` relation pointing to a
        `question_phases` record. We read that record's `phase_name`.
        """
        try:
            question = self.pb.get_record("questions", question_id)
            # Try direct phase_name field first (may exist in some schemas)
            direct = str(question.get("current_phase_name") or "").strip()
            if direct:
                return direct
            # Read from question_phases relation
            phase_id = str(question.get("current_phase", "")).strip()
            if phase_id:
                phase_rec = self.pb.get_record("question_phases", phase_id)
                name = str(phase_rec.get("phase_name", "")).strip()
                return name or "Proposed"
            return "Proposed"
        except PocketBaseError:
            return "Proposed"

    def _promote_question_to_active(
        self, question_id: str, users: list[SimUser], report: SimulationReport
    ) -> None:
        """Vote on the question until it transitions to AnswerSearch.

        If all users vote but the threshold isn't met (e.g. 5 agents < threshold=10),
        force the transition via admin update.
        """
        phase = self._current_question_phase(question_id)
        if phase in ("AnswerSearch", "Ideation"):
            return

        for user in users:
            try:
                user.frontend_client.vote_question(
                    question_id=question_id,
                    vote_value=1,
                    simulated_at=self._time.now_iso(),
                )
                self._time.advance_time(0, user.username, "vote_question", report)
            except RuntimeError as err:
                if "validation_not_unique" not in str(err):
                    self._time.advance_time(0, user.username, "vote_question_failed", report)

            phase = self._current_question_phase(question_id)
            if phase in ("AnswerSearch", "Ideation"):
                return

        # All users voted but threshold wasn't met — force transition via admin
        phase = self._current_question_phase(question_id)
        if phase not in ("AnswerSearch", "Ideation"):
            print(
                f"[promote] all {len(users)} votes cast but phase still '{phase}', forcing transition",
                file=sys.stderr,
                flush=True,
            )
            try:
                # Close existing phase record
                question = self.pb.get_record("questions", question_id)
                old_phase_id = str(question.get("current_phase", "")).strip()
                if old_phase_id:
                    try:
                        self.pb.update_record(
                            "question_phases", old_phase_id,
                            {"ended_at": self._time.now_pb_iso()},
                        )
                    except PocketBaseError:
                        pass

                # Create new AnswerSearch phase record
                new_phase = self.pb.create_record(
                    "question_phases",
                    {
                        "question": question_id,
                        "phase_name": "AnswerSearch",
                        "started_at": self._time.now_pb_iso(),
                        "ended_at": "",
                        "previous_phase": old_phase_id or None,
                        "transition_type": "simulation_force_activate",
                    },
                )
                # Update question to point to new phase
                self.pb.update_record(
                    "questions",
                    question_id,
                    {"current_phase": new_phase["id"]},
                )
                report.time_events.append(
                    TimeEvent(
                        step=0,
                        actor="system",
                        action="force_promote_to_active",
                        simulated_at=self._time.now_iso(),
                    )
                )
            except PocketBaseError as err:
                print(f"[promote] force transition failed: {err}", file=sys.stderr, flush=True)


    # ================================================================== #
    # Action execution
    # ================================================================== #

    def _execute_action(
        self,
        action_type: ActionType,
        user: SimUser,
        question_id: str,
        step: int,
        report: SimulationReport,
        memory: AgentMemory,
        content_gen: ContentGenerator,
        proposed: list[SimSolution],
        target_id: str | None,
        second_parent_id: str | None,
    ) -> None:
        """Execute a single agent action."""
        
        # Log focus enter if we have a target (disabled by default for perf)
        skip_action_logging = not getattr(self.behavior_profile, "log_focus_events", False)
        if not skip_action_logging and target_id and target_id != "unknown":
            user.frontend_client.log_action(
                question_id, "focus_enter", target_id,
                simulated_at=self._time.now_iso()
            )
            
        if action_type == ActionType.CREATE_ROOT:
            self._do_create_root(user, question_id, step, report, memory, content_gen)
        elif action_type == ActionType.CREATE_REMIX:
            target = self._find_solution(proposed, target_id)
            if target:
                self._do_create_remix(user, question_id, step, report, memory, content_gen, target)
            else:
                self._do_create_root(user, question_id, step, report, memory, content_gen)
        elif action_type == ActionType.CREATE_MERGE:
            parent_a = self._find_solution(proposed, target_id)
            parent_b = self._find_solution(proposed, second_parent_id)
            if parent_a and parent_b:
                self._do_create_merge(user, question_id, step, report, memory, content_gen, parent_a, parent_b)
            else:
                # Fallback — treat as remix of parent_a or root
                if parent_a:
                    self._do_create_remix(user, question_id, step, report, memory, content_gen, parent_a)
                else:
                    self._do_create_root(user, question_id, step, report, memory, content_gen)
        elif action_type == ActionType.VOTE_SUPPORT:
            target = self._find_solution(proposed, target_id)
            if target:
                self._do_vote(user, target, 1, step, report, memory, question_id)
            else:
                self._time.advance_time(step, user.username, "wait", report)
        elif action_type == ActionType.VOTE_RETRACT:
            target = self._find_solution(proposed, target_id)
            if target:
                self._do_vote(user, target, 0, step, report, memory, question_id)
            else:
                self._time.advance_time(step, user.username, "wait", report)
        elif action_type == ActionType.VOTE_MIGRATE:
            # Siphon Effect: retract vote from parent, support child
            child = self._find_solution(proposed, target_id)
            parent = self._find_solution(proposed, second_parent_id)
            if child and parent:
                self._do_vote(user, parent, 0, step, report, memory, question_id)
                self._do_vote(user, child, 1, step, report, memory, question_id)
            elif child:
                # Parent not in proposed list (maybe withdrawn) — just support child
                self._do_vote(user, child, 1, step, report, memory, question_id)
            else:
                self._time.advance_time(step, user.username, "wait", report)
        else:
            self._time.advance_time(step, user.username, "wait", report)
            
        # Log focus exit
        if not skip_action_logging and target_id and target_id != "unknown":
            user.frontend_client.log_action(
                question_id, "focus_exit", target_id,
                simulated_at=self._time.now_iso()
            )

    def _do_create_root(
        self,
        user: SimUser,
        question_id: str,
        step: int,
        report: SimulationReport,
        memory: AgentMemory,
        content_gen: ContentGenerator,
    ) -> None:
        result = content_gen.generate_root_solution(memory)
        self._solution_counter += 1
        try:
            user.frontend_client.create_solution(
                question_id=question_id,
                title=result["title"],
                content=result["content"],
                simulated_at=self._time.now_iso(),
                label=result.get("label"),
            )
            # Find the created ID
            title_escaped = result["title"].replace('"', '\\"')
            records = self.pb.list_records("proposals", filter_expr=f'author="{user.id}" && title="{title_escaped}"', sort="-created", per_page=1)
            record_id = records[0]["id"] if records else "unknown"

            if record_id != "unknown":
                self.quality_registry.assign_root_quality(record_id)

            memory.record_authored(record_id, result["title"], kind="root")
            report.content_generation_log.append(
                ContentGenEvent(
                    step=step,
                    agent=user.username,
                    gen_type="root",
                    parent_ids=[],
                    output_excerpt=result["title"],
                    simulated_at=self._time.now_iso(),
                )
            )
            self._time.advance_time(step, user.username, "root_solution", report)
        except (PocketBaseError, RuntimeError) as err:
            print(f"[create_root] failed user={user.username}: {err}", file=sys.stderr, flush=True)
            self._time.advance_time(step, user.username, "create_failed", report)

    def _do_create_remix(
        self,
        user: SimUser,
        question_id: str,
        step: int,
        report: SimulationReport,
        memory: AgentMemory,
        content_gen: ContentGenerator,
        parent: SimSolution,
    ) -> None:
        comments = self._recent_solution_comments(parent.id)
        result = content_gen.generate_remix(
            parent_title=parent.title,
            parent_content=parent.content,
            agent_memory=memory,
            recent_comments=comments,
        )
        try:
            user.frontend_client.create_solution(
                question_id=question_id,
                title=parent.title,
                content=result["content"],
                reason=result.get("change_rationale", "")[:100],
                parent_ids=[parent.id],
                simulated_at=self._time.now_iso(),
                # Pass the parent's primary_label ID so the backend hook inherits it directly.
                # label-rules.js detects a 15-char PocketBase record ID and skips creation,
                # resolving it as an existing label — guaranteeing the remix keeps its cluster.
                label=parent.primary_label or "",
            )
            title_escaped = parent.title.replace('"', '\\"')
            records = self.pb.list_records("proposals", filter_expr=f'author="{user.id}" && title="{title_escaped}"', sort="-created", per_page=1)
            record_id = records[0]["id"] if records else "unknown"

            if record_id != "unknown":
                self.quality_registry.assign_remix_quality(record_id, parent.id)

            memory.record_authored(record_id, parent.title, kind="remix")
            report.content_generation_log.append(
                ContentGenEvent(
                    step=step,
                    agent=user.username,
                    gen_type="remix",
                    parent_ids=[parent.id],
                    output_excerpt=result.get("change_rationale", ""),
                    change_rationale=result.get("change_rationale", ""),
                    simulated_at=self._time.now_iso(),
                )
            )
            self._time.advance_time(step, user.username, "branch_solution", report)
        except (PocketBaseError, RuntimeError) as err:
            print(f"[create_remix] failed user={user.username}: {err}", file=sys.stderr, flush=True)
            self._time.advance_time(step, user.username, "create_failed", report)

    def _do_create_merge(
        self,
        user: SimUser,
        question_id: str,
        step: int,
        report: SimulationReport,
        memory: AgentMemory,
        content_gen: ContentGenerator,
        parent_a: SimSolution,
        parent_b: SimSolution,
    ) -> None:
        result = content_gen.generate_merge(
            parent_a_title=parent_a.title,
            parent_a_content=parent_a.content,
            parent_b_title=parent_b.title,
            parent_b_content=parent_b.content,
            agent_memory=memory,
        )
        try:
            # For merges: use LLM-generated label if present; otherwise inherit from the
            # higher-voted parent so the merged proposal stays in a known cluster.
            merge_label = result.get("label") or parent_a.primary_label or parent_b.primary_label or ""
            user.frontend_client.create_solution(
                question_id=question_id,
                title=result["title"],
                content=result["content"],
                reason=result.get("merge_rationale", "")[:100],
                parent_ids=[parent_a.id, parent_b.id],
                simulated_at=self._time.now_iso(),
                label=merge_label,
            )
            title_escaped = result["title"].replace('"', '\\"')
            records = self.pb.list_records("proposals", filter_expr=f'author="{user.id}" && title="{title_escaped}"', sort="-created", per_page=1)
            record_id = records[0]["id"] if records else "unknown"

            if record_id != "unknown":
                self.quality_registry.assign_merge_quality(record_id, [parent_a.id, parent_b.id])

            memory.record_authored(record_id, result["title"], kind="merge")
            report.content_generation_log.append(
                ContentGenEvent(
                    step=step,
                    agent=user.username,
                    gen_type="merge",
                    parent_ids=[parent_a.id, parent_b.id],
                    output_excerpt=result["title"],
                    change_rationale=result.get("merge_rationale", ""),
                    simulated_at=self._time.now_iso(),
                )
            )
            self._time.advance_time(step, user.username, "merge_solution", report)
        except (PocketBaseError, RuntimeError) as err:
            print(f"[create_merge] failed user={user.username}: {err}", file=sys.stderr, flush=True)
            self._time.advance_time(step, user.username, "create_failed", report)

    def _do_vote(
        self,
        user: SimUser,
        target: SimSolution,
        vote: int,
        step: int,
        report: SimulationReport,
        memory: AgentMemory,
        question_id: str = None,
    ) -> None:
        """Vote on a solution. vote=1 for support, vote=0 for retract."""
        try:
            # SvelteKit vote action
            if question_id is None:
                raise ValueError("question_id is required for voting")
            user.frontend_client.vote(
                question_id=question_id,
                solution_id=target.id,
                vote_value=vote,
                simulated_at=self._time.now_iso()
            )
            memory.record_vote(target.id, vote)
            action = "vote_support" if vote > 0 else "vote_retract"
            self._time.advance_time(step, user.username, action, report)
        except RuntimeError as err:
            print(f"[vote] failed user={user.username}: {err}", file=sys.stderr, flush=True)
            self._time.advance_time(step, user.username, "vote_failed", report)

    def _recent_solution_comments(self, solution_id: str, limit: int = 3) -> list[str]:
        if not self.llm_enabled:
            return []
        try:
            rows = self.pb.get_full_list(
                "proposal_comments",
                filter_expr=f'solution = "{solution_id}"',
            )
        except PocketBaseError:
            return []
        sorted_rows = sorted(rows, key=lambda row: str(row.get("created", "")))
        out: list[str] = []
        for row in sorted_rows[-limit:]:
            content = strip_html(str(row.get("content", "")).strip())
            content = re.sub(r"^[A-Za-z0-9_ .'-]{2,40}:\s*", "", content)
            content = " ".join(content.split()).strip()
            if content and len(content) > 5:
                out.append(content[:140])
        return out


    # ================================================================== #
    # Solution listing
    # ================================================================== #

    def _list_solutions(self, question_id: str, state: str | None = None) -> list[SimSolution]:
        filter_expr = f'question = "{question_id}"'
        if state:
            filter_expr += f' && state = "{state}"'
        rows = self.pb.get_full_list("proposals", filter_expr=filter_expr)
        return [
            SimSolution(
                id=row["id"],
                title=row.get("title", ""),
                state=row.get("state", "Proposed"),
                author=row.get("author", ""),
                content=row.get("content", ""),
                parent_ids=[str(pid) for pid in (row.get("parent_proposals") or [])],
                current_vote_count=int(row.get("subscription_count", 0) or row.get("current_vote_count", 0)),
                created=row.get("created", ""),
                labels=[str(lid) for lid in (row.get("labels") or [])],
                primary_label=str(row.get("primary_label") or ""),
                in_focus=bool(row.get("in_focus")),
                is_champion=bool(row.get("is_champion")),
                root_solution=str(row.get("root_proposal") or ""),
            )
            for row in rows
        ]

    def _find_solution(
        self, solutions: list[SimSolution], solution_id: str | None
    ) -> SimSolution | None:
        if not solution_id:
            return None
        for sol in solutions:
            if sol.id == solution_id:
                return sol
        return None
