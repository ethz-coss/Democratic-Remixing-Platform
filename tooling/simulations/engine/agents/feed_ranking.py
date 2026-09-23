"""Local feed ranking engine for simulations.

This is a Python port of the PersonalFocus algorithm from
``frontend/src/lib/services/feed-filter.ts``.  It computes proposal
ranking scores **in-process** using *simulated* time instead of real
wall-clock time (``Date.now()``), which fixes a methodological bug
where time-decay was effectively disabled during accelerated
simulation runs.

The scoring functions below are a 1:1 translation of the TypeScript
originals.  Any change to the canonical ``feed-filter.ts`` should be
mirrored here.

Reference: frontend/src/lib/services/feed-filter.ts
  - getTrendingScore        → get_trending_score       (L96-99)
  - getPersonalizedScore    → get_personalized_score   (L118-185)
  - sortProposals           → sort_proposals           (L251-338)
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

from tooling.simulations.engine.models import SimSolution


# ── Helpers ──────────────────────────────────────────────────────────


def _parse_created(created_str: str, fallback: datetime) -> datetime:
    """Parse a PocketBase ``created`` ISO-8601 timestamp."""
    if not created_str:
        return fallback
    try:
        dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return fallback


def _hours_since(created_str: str, now: datetime) -> float:
    """Hours between *created_str* and *now*.  Always ≥ 0."""
    created = _parse_created(created_str, now)
    return max(0.0, (now - created).total_seconds() / 3_600.0)


# ── Score functions (mirror feed-filter.ts) ──────────────────────────


def get_trending_score(p: SimSolution, now: datetime) -> float:
    """TS ref: getTrendingScore  (feed-filter.ts L96-99)"""
    hours = _hours_since(p.created, now)
    return p.current_vote_count / max(1.0, hours + 2.0)


def get_personalized_score(
    p: SimSolution,
    is_seen: bool,
    user_vote: int,
    label_affinities: dict[str, int],
    view_count: int,
    pf_weights: dict[str, float] | None,
    now: datetime,
) -> float:
    """TS ref: getPersonalizedScore  (feed-filter.ts L118-185)

    *getLabelAvgViews* is accepted in the TS signature but never
    actually influences the score — it's only used inside
    ``sortProposals`` for label-group ordering.  We omit it here.
    """
    views = float(view_count)
    subs = float(p.current_vote_count)
    hours_age = _hours_since(p.created, now)

    w = pf_weights or {}
    EXPLORATION_WEIGHT   = w.get("explorationBoostWeight", 1.0)
    UNSEEN_MULTIPLIER    = w.get("unseenMultiplier", 2.0)
    SUBSCRIBED_PENALTY   = w.get("subscribedPenalty", 0.1)
    DIVERSITY_WEIGHT     = w.get("diversityWeight", 2.0)
    BRIDGING_WEIGHT      = w.get("bridgingWeight", 1.5)
    AFFINITY_WEIGHT      = w.get("affinityWeight", 1.0)
    TIME_DECAY_WEIGHT    = w.get("timeDecayWeight", 1.0)
    SMOOTHING            = w.get("smoothingPseudocount", 1.0)

    # 1. Smoothed conversion rate  (L140)
    smoothed_conversion = (subs + SMOOTHING) / (views + 5.0 * SMOOTHING)

    # 2. Exploration boost  (L143)
    exploration_boost = EXPLORATION_WEIGHT * (1.0 / math.sqrt(views + 1.0))

    # Base score  (L146)
    score = smoothed_conversion + exploration_boost

    # 3. Label Affinity  (L148-162)
    personal_affinity = 1.0
    labels = p.labels or []
    if labels and label_affinities:
        max_aff = 0
        for l in labels:
            interactions = label_affinities.get(l, 0)
            if interactions > max_aff:
                max_aff = interactions
        personal_affinity = 1.0 + AFFINITY_WEIGHT * math.log(max_aff + 1.0)
    else:
        personal_affinity = 1.0 + 0.2 * AFFINITY_WEIGHT
    score *= personal_affinity

    # 4. Diversity Routing Boost  (L166-168)
    diversity_boost = (
        1.0
        + DIVERSITY_WEIGHT
        * (1.0 / math.sqrt(views + 1.0))
        * (1.0 / max(1.0, personal_affinity))
    )
    score *= diversity_boost

    # 5. Bridging Consensus Boost  (L171-172)
    bridging_boost = (
        1.0 + BRIDGING_WEIGHT * smoothed_conversion * math.log10(views + 2.0)
    )
    score *= bridging_boost

    # 6. Unseen Multiplier  (L175)
    if not is_seen:
        score *= UNSEEN_MULTIPLIER

    # 7. Subscribed Penalty  (L178)
    if user_vote > 0:
        score *= SUBSCRIBED_PENALTY

    # 8. Time decay  (L181-182)
    time_decay = 1.0 / max(
        1.0, math.pow(math.log10(hours_age + 10.0), TIME_DECAY_WEIGHT)
    )
    score *= time_decay

    return score


# ── Sort entry-point ─────────────────────────────────────────────────


def sort_proposals(
    proposals: list[SimSolution],
    mode: str,
    seen_proposal_ids: set[str],
    user_votes: dict[str, int],
    label_affinities: dict[str, int],
    proposal_view_counts: dict[str, int],
    personal_focus_weights: dict[str, float] | None,
    now: datetime,
) -> list[SimSolution]:
    """Sort *proposals* using the same logic as feed-filter.ts ``sortProposals``.

    TS ref: sortProposals  (feed-filter.ts L251-338)
    """
    if mode == "Newest":
        # TS L260-262: sort by created descending
        return sorted(proposals, key=lambda p: p.created, reverse=True)

    if mode == "PersonalFocus":
        # TS L269-311
        def _score(p: SimSolution) -> float:
            return get_personalized_score(
                p,
                is_seen=p.id in seen_proposal_ids,
                user_vote=user_votes.get(p.id, 0),
                label_affinities=label_affinities,
                view_count=proposal_view_counts.get(p.id, 0),
                pf_weights=personal_focus_weights,
                now=now,
            )

        return sorted(proposals, key=_score, reverse=True)

    # Default: Trending  (TS L327-329)
    return sorted(
        proposals, key=lambda p: get_trending_score(p, now), reverse=True
    )
