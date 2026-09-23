"""Bounded-Attention Pool decision engine.

Each agent session evaluates a unified candidate pool (~11 items) drawn
from three sources: Siphon notifications, Ballot, and PersonalFocus feed.
Target selection uses CSS-grounded attention weights (Joachims 2005,
Pirolli & Card 1999, Salganik et al. 2006). Up to max_actions_per_session
actions per session.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from tooling.simulations.engine.agents.agent_memory import AgentMemory
from tooling.simulations.engine.models import SimSolution
from tooling.simulations.engine.config import BehaviorProfile
from tooling.simulations.engine.quality_registry import QualityRegistry
from tooling.simulations.engine.agents.feed_ranking import sort_proposals


class ActionType(Enum):
    CREATE_ROOT = "create_root"
    CREATE_REMIX = "create_remix"
    CREATE_MERGE = "create_merge"
    VOTE_SUPPORT = "vote_support"
    VOTE_RETRACT = "vote_retract"       # Keep for logging migration retracts
    VOTE_MIGRATE = "vote_migrate"       # NEW: atomic retract parent + support child
    DO_NOTHING = "do_nothing"           # Keep for empty pool / budget exhaustion


@dataclass
class AgentAction:
    action_type: ActionType
    target_solution_id: str | None = None
    second_parent_id: str | None = None
    migration_prompt_id: str | None = None
    reason: str | None = None
    tab_used: str | None = None

@dataclass
class PoolItem:
    solution: SimSolution
    source: str
    foryou_rank: int | None = None
    parent_id: str | None = None   # NEW: the voted parent that triggered a notification


class AgentDecisionEngine:
    """Unified bounded-attention pool decision model."""

    def __init__(self, rng: random.Random, profile: BehaviorProfile | None = None) -> None:
        self.rng = rng
        self.profile = profile or BehaviorProfile()

    def decide_session_actions(
        self,
        memory: AgentMemory,
        solutions: list[SimSolution],
        remix_probability: float = 0.15,
        merge_probability: float = 0.05,
        view_counts: dict[str, int] | None = None,
        quality_registry: QualityRegistry | None = None,
        simulated_now: datetime | None = None,
    ) -> list[AgentAction]:
        """Model a single user session evaluating a bounded pool of candidates."""
        if view_counts is None:
            view_counts = {}

        if not solutions:
            return [AgentAction(
                action_type=ActionType.CREATE_ROOT,
                reason="no_solutions_exist",
            )]

        actions = []

        # ── 1. Root Creation Check ──
        p_root = self.profile.p_create_root
        
        existing_roots = sum(1 for s in solutions if not s.parent_ids)
        if existing_roots >= self.profile.root_ceiling:
            p_root *= self.profile.root_ceiling_damping
            
        authored_roots = sum(1 for e in memory.authored_solutions if e.get("kind") == "root")
        if authored_roots >= 1:
            p_root *= self.profile.authored_root_damping

        if self.rng.random() < p_root:
            actions.append(AgentAction(action_type=ActionType.CREATE_ROOT, reason="autonomous"))
            return actions

        # ── 2. Compile Bounded-Attention Pool ──
        pool: list[PoolItem] = []
        seen_pool_ids: set[str] = set()

        # Source A: Notifications (Siphon Effect)
        if self.profile.enable_siphon:
            supported_ids = [sid for sid, v in memory.voted_solutions.items() if v > 0]
            unseen_children_with_parent: list[tuple[SimSolution, str]] = []
            for sid in supported_ids:
                children = [s for s in solutions if sid in (s.parent_ids or [])]
                for child in children:
                    if child.id not in memory.seen_proposal_ids:
                        unseen_children_with_parent.append((child, sid))
            
            # Shuffle so we don't deterministically pick the oldest unseen children
            self.rng.shuffle(unseen_children_with_parent)
            notif_items = unseen_children_with_parent[:self.profile.pool_k_notifications]
            for child, parent_id in notif_items:
                pool.append(PoolItem(solution=child, source="notification", parent_id=parent_id))
                seen_pool_ids.add(child.id)

        # Source B: Ballot (Social Signal)
        ballot_proposals = [s for s in solutions if getattr(s, "in_focus", False) and s.id not in seen_pool_ids]
        b_sample_size = min(self.profile.pool_k_ballot, len(ballot_proposals))
        if b_sample_size > 0:
            b_sample = self.rng.sample(ballot_proposals, b_sample_size)
            for item in b_sample:
                pool.append(PoolItem(solution=item, source="ballot"))
                seen_pool_ids.add(item.id)

        # Source C: For You (PersonalFocus Ranked Feed)
        ranked_feed = self._get_ranked_feed(solutions, memory, view_counts, simulated_now)
        foryou_count = 0
        for i, item in enumerate(ranked_feed):
            if foryou_count >= self.profile.pool_k_foryou:
                break
            if item.id not in seen_pool_ids:
                pool.append(PoolItem(solution=item, source="foryou", foryou_rank=i + 1))
                seen_pool_ids.add(item.id)
                foryou_count += 1

        if not pool:
            return [AgentAction(action_type=ActionType.DO_NOTHING, reason="empty_pool")]

        # ── 3. Select Targets from Pool ──
        max_actions = getattr(self.profile, "max_actions_per_session", 3)
        num_targets = min(len(pool), self.rng.randint(1, max(1, max_actions)))

        selected_targets = []
        if self.profile.quality_aware and quality_registry is not None:
            # Quality-aware: pick highest perceived utility sequentially
            pool_copy = list(pool)
            for _ in range(num_targets):
                if not pool_copy:
                    break
                best_item = max(
                    pool_copy,
                    key=lambda pi: memory.perceived_utility(pi.solution.id, quality_registry.get_quality(pi.solution.id))
                )
                selected_targets.append(best_item)
                pool_copy.remove(best_item)
        else:
            # Attention weighted
            pool_copy = list(pool)
            for _ in range(num_targets):
                if not pool_copy:
                    break
                weights = []
                for item in pool_copy:
                    if item.source == "notification":
                        w = self.profile.attention_weight_notification
                    elif item.source == "ballot":
                        w = self.profile.attention_weight_ballot
                    elif item.source == "foryou" and item.foryou_rank is not None:
                        w = 1.0 / item.foryou_rank
                    else:
                        w = 1.0
                    weights.append(w)
                
                # Sample 1
                if self.profile.deterministic_target:
                    max_idx = weights.index(max(weights))
                    chosen = pool_copy[max_idx]
                else:
                    chosen = self.rng.choices(pool_copy, weights=weights, k=1)[0]
                selected_targets.append(chosen)
                pool_copy.remove(chosen)

        # ── 4. Determine Action per Target ──
        roots = set(s.parent_ids[0] if s.parent_ids else s.id for s in solutions)
        can_merge = len(roots) >= 2

        for target_item in selected_targets:
            target_sol = target_item.solution
            tab_used = target_item.source

            # Update memory state
            memory.mark_seen(target_sol.id)
            if getattr(target_sol, "labels", None):
                memory.increment_label_affinity(target_sol.labels)
            memory.feed_tab_history.append(tab_used)
            if len(memory.feed_tab_history) > 20:
                memory.feed_tab_history.pop(0)

            # ── PATH A: Notification target → Migration decision ──
            if target_item.source == "notification" and target_item.parent_id:
                should_migrate = False

                if self.profile.quality_aware and quality_registry is not None:
                    # Deterministic: migrate if child has higher perceived utility
                    child_util = memory.perceived_utility(
                        target_sol.id,
                        quality_registry.get_quality(target_sol.id),
                    )
                    parent_util = memory.perceived_utility(
                        target_item.parent_id,
                        quality_registry.get_quality(target_item.parent_id),
                    )
                    should_migrate = child_util > parent_util
                else:
                    # Stochastic: migrate with p_migrate
                    should_migrate = self.rng.random() < getattr(self.profile, "p_migrate", 0.50)

                if should_migrate:
                    actions.append(AgentAction(
                        action_type=ActionType.VOTE_MIGRATE,
                        target_solution_id=target_sol.id,
                        second_parent_id=target_item.parent_id,
                        reason="siphon_migration",
                        tab_used=tab_used,
                    ))
                else:
                    # Saw notification but chose not to migrate — mark as seen, move on
                    actions.append(AgentAction(
                        action_type=ActionType.DO_NOTHING,
                        target_solution_id=target_sol.id,
                        reason="siphon_rejected",
                        tab_used=tab_used,
                    ))
                continue

            # ── PATH B: Non-notification target → Standard action roll ──
            # Probabilities: vote_support, create_remix, create_merge (no do_nothing, no retract)
            p_vote = self.profile.p_vote
            p_remix = remix_probability
            p_merge = merge_probability if can_merge else 0.0

            total_prob = p_vote + p_remix + p_merge
            if total_prob <= 0:
                actions.append(AgentAction(
                    action_type=ActionType.DO_NOTHING,
                    reason="zero_probability",
                ))
                continue

            roll = self.rng.random() * total_prob
            cumulative = 0.0
            selected_action_type = ActionType.VOTE_SUPPORT  # default

            for action_type, prob in [
                (ActionType.VOTE_SUPPORT, p_vote),
                (ActionType.CREATE_REMIX, p_remix),
                (ActionType.CREATE_MERGE, p_merge),
            ]:
                cumulative += prob
                if roll <= cumulative:
                    selected_action_type = action_type
                    break

            second_parent_id = None
            target_voted = memory.voted_solutions.get(target_sol.id, 0) > 0

            # Fallback: already voted → just mark seen, move on
            if selected_action_type == ActionType.VOTE_SUPPORT and target_voted:
                actions.append(AgentAction(
                    action_type=ActionType.DO_NOTHING,
                    target_solution_id=target_sol.id,
                    reason="already_voted",
                    tab_used=tab_used,
                ))
                continue

            # Merge needs second parent from different root family
            if selected_action_type == ActionType.CREATE_MERGE:
                target_root = target_sol.root_solution or (
                    target_sol.parent_ids[0] if target_sol.parent_ids else target_sol.id
                )
                valid_second_parents = [
                    pi.solution for pi in pool 
                    if pi.solution.id != target_sol.id 
                    and (pi.solution.root_solution or (
                        pi.solution.parent_ids[0] if pi.solution.parent_ids else pi.solution.id
                    )) != target_root
                ]
                if valid_second_parents:
                    second_parent = self.rng.choice(valid_second_parents)
                    second_parent_id = second_parent.id
                else:
                    selected_action_type = ActionType.CREATE_REMIX

            actions.append(AgentAction(
                action_type=selected_action_type,
                target_solution_id=target_sol.id,
                second_parent_id=second_parent_id,
                reason="pool_selection",
                tab_used=tab_used,
            ))
            
        return actions

    def _get_ranked_feed(
        self, solutions: list[SimSolution], memory: AgentMemory, view_counts: dict[str, int], simulated_now: datetime | None = None
    ) -> list[SimSolution]:
        """Rank solutions for the ForYou feed using the PersonalFocus engine."""
        now = simulated_now or datetime.now(timezone.utc)
        mode = "PersonalFocus"
        pf_weights = getattr(self.profile, "personal_focus_weights", None)
        
        if pf_weights and isinstance(pf_weights, dict):
            pf_mode = pf_weights.get("mode", "")
            if pf_mode == "newest":
                mode = "Newest"
            elif pf_mode == "random":
                shuffled = list(solutions)
                self.rng.shuffle(shuffled)
                return shuffled

        feed_weights = None
        if mode == "PersonalFocus" and pf_weights and isinstance(pf_weights, dict):
            feed_weights = {k: v for k, v in pf_weights.items() if k != "mode"}
            if not feed_weights:
                feed_weights = None

        ranked_list = sort_proposals(
            proposals=solutions,
            mode=mode,
            seen_proposal_ids=memory.seen_proposal_ids,
            user_votes=memory.voted_solutions,
            label_affinities=dict(memory.label_affinities),
            proposal_view_counts=view_counts,
            personal_focus_weights=feed_weights,
            now=now,
        )

        return ranked_list or solutions
