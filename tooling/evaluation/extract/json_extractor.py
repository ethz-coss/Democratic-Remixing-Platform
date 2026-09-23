"""Offline data extraction from simulation result JSON files.

When PocketBase is not reachable, this module reconstructs solution data,
vote timelines, and cluster assignments entirely from the JSON report files
produced by the simulation runner.

The JSON contains:
  - decision_log: every agent action (vote, create, merge, comment, wait)
    with target_solution_id and timestamp
  - content_generation_log: root/remix/merge/comment content events with
    parent_ids and output_excerpt (title)
  - time_events: timestamped system and agent events
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from tooling.evaluation.extract.pb_extractor import (
    QuestionData,
    QuestionPhaseRecord,
    SolutionRecord,
    VoteRecord,
    _parse_ts,
)


@dataclass
class _SolBuilder:
    """Accumulates info about a solution as we parse the JSON events."""
    id: str
    title: str = ""
    gen_type: str = ""  # root, remix, merge
    parent_ids: list[str] = field(default_factory=list)
    created: str = ""
    author: str = ""
    votes: dict[str, int] = field(default_factory=dict)  # user → vote value


def extract_from_json(json_path: str) -> QuestionData:
    """Parse a simulation result JSON and reconstruct QuestionData.

    This is an offline alternative to extract_question_data() that does NOT
    require a live PocketBase instance.
    """
    with open(json_path, "r", encoding="utf-8") as f:
        report = json.load(f)

    question_id = report.get("question_id", os.path.basename(json_path))
    run_id = report.get("run_id", "")

    decision_log = report.get("decision_log", [])
    content_gen_log = report.get("content_generation_log", [])
    time_events = report.get("time_events", [])
    vote_migration_events = report.get("vote_migration_events", [])
    raw_phases = report.get("question_phases", [])

    phases: list[QuestionPhaseRecord] = []
    for p in raw_phases:
        phases.append(QuestionPhaseRecord(
            id=str(p.get("id", "")),
            phase_name=str(p.get("phase_name", "")),
            started_at=str(p.get("started_at", "")),
            ended_at=str(p.get("ended_at", "")),
        ))

    # ── Step 1: Discover solutions ─────────────────────────────────────
    # Match content_generation events (which have title/parents) with
    # decision_log events (which have the PB record ID) by correlating
    # on (step, agent, action type).

    # Build an index of content_gen events keyed by (step, agent)
    gen_by_step_agent: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for gen in content_gen_log:
        if gen["gen_type"] in ("root", "remix", "merge"):
            key = (gen["step"], gen["agent"])
            gen_by_step_agent[key].append(gen)

    # Build label map from content_gen events: (parent_ids_key, agent) -> label
    label_by_parent_agent: dict[tuple[str, str], str] = {}
    for gen in content_gen_log:
        if gen.get("label"):
            parent_key = ",".join(gen.get("parent_ids", []))
            label_by_parent_agent[(parent_key, gen.get("agent", ""))] = str(gen["label"])

    # Build an index of create/merge decisions keyed by (step, agent)
    create_decisions: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for dec in decision_log:
        if dec["action"] in ("create", "merge"):
            key = (dec["step"], dec["agent"])
            create_decisions[key].append(dec)

    sol_builders: dict[str, _SolBuilder] = {}

    # Content_gen has parent_ids but NOT the new solution's PB ID.
    # Decision_log 'create' has target_solution_id = the PARENT being remixed.
    # We need to discover solution IDs from vote targets too.

    # Collect all solution IDs mentioned anywhere
    all_sol_ids: set[str] = set()
    for dec in decision_log:
        sid = dec.get("target_solution_id")
        if sid:
            all_sol_ids.add(sid)
    for vm in vote_migration_events:
        for key in ("original_id", "remix_id"):
            sid = vm.get(key)
            if sid:
                all_sol_ids.add(sid)
    for gen in content_gen_log:
        for pid in gen.get("parent_ids", []):
            all_sol_ids.add(pid)

    # Ensure builders exist for all known IDs
    for sid in all_sol_ids:
        if sid not in sol_builders:
            sol_builders[sid] = _SolBuilder(id=sid)

    # ── Step 2: Enrich from content_generation_log ─────────────────────
    # Attempt to match gen events to actual solution IDs.
    # Heuristic: for root solutions (step=0, no parents), they're the first
    # solutions created. For remixes, the parent_ids link to known IDs.

    # First pass: tag roots (step 0, no parents)
    step0_gens = [g for g in content_gen_log if g["step"] == 0 and g["gen_type"] == "root"]
    # Roots are among the earliest solution IDs — we'll match by created time
    step0_time_events = [
        e for e in time_events
        if e["step"] == 0 and e["action"] == "root_solution"
    ]

    # Map gen events by output title so we can label solutions
    title_by_parent_and_agent: dict[tuple[str, str], str] = {}
    for gen in content_gen_log:
        if gen["gen_type"] in ("root", "remix", "merge"):
            title = gen.get("output_excerpt", "")
            agent = gen.get("agent", "")
            parent_key = ",".join(gen.get("parent_ids", []))
            title_by_parent_and_agent[(parent_key, agent)] = title

    # For each solution ID, try to find its title and parents from the logs
    # Approach: walk decision_log to see who created what, and correlate

    # Build vote timeline simultaneously
    vote_records: list[VoteRecord] = []
    vote_counter = 0

    for dec in decision_log:
        sid = dec.get("target_solution_id")
        if not sid:
            continue

        builder = sol_builders.setdefault(sid, _SolBuilder(id=sid))
        agent = dec.get("agent", "")
        step = dec.get("step", 0)
        ts = dec.get("simulated_at", "")

        action = dec.get("action", "")
        if action in ("vote", "vote_solution", "vote_support", "accept_migration"):
            # Record this as a support vote (value=1)
            builder.votes[agent] = 1
            vote_counter += 1
            vote_records.append(VoteRecord(
                id=f"v_{vote_counter}",
                solution=sid,
                user=agent,
                vote=1,
                created=ts,
                occurred_at=ts,
            ))

        elif action in ("vote_retract", "retract"):
            # Record this as a retract/repeal vote (value=0)
            builder.votes[agent] = 0
            vote_counter += 1
            vote_records.append(VoteRecord(
                id=f"v_{vote_counter}",
                solution=sid,
                user=agent,
                vote=0,
                created=ts,
                occurred_at=ts,
            ))

        elif dec["action"] == "create":
            # This is a remix creation: target = parent being remixed
            # The NEW solution ID is the one created by this event —
            # but it's not directly in the decision. We'll try to find it
            # from a subsequent vote or content_gen event.
            if not builder.created or ts < builder.created:
                builder.created = ts

    # Process vote migration events from report to add chronological like and retraction records
    for vm in vote_migration_events:
        agent = vm.get("agent", "")
        ts = vm.get("simulated_at", "")
        decision = vm.get("decision", "")
        orig_id = vm.get("original_id", "")
        rem_id = vm.get("remix_id", "")

        if decision == "move":
            if orig_id:
                builder = sol_builders.setdefault(orig_id, _SolBuilder(id=orig_id))
                builder.votes[agent] = 0
                vote_counter += 1
                vote_records.append(VoteRecord(
                    id=f"v_{vote_counter}",
                    solution=orig_id,
                    user=agent,
                    vote=0,
                    created=ts,
                    occurred_at=ts,
                ))
            if rem_id:
                builder = sol_builders.setdefault(rem_id, _SolBuilder(id=rem_id))
                builder.votes[agent] = 1
                vote_counter += 1
                vote_records.append(VoteRecord(
                    id=f"v_{vote_counter}",
                    solution=rem_id,
                    user=agent,
                    vote=1,
                    created=ts,
                    occurred_at=ts,
                ))

    # ── Step 3: Extract solution metadata from content_gen ─────────────
    # For each content_gen event, attempt to find which solution it produced
    # by matching parent_ids.

    # Separate roots (no parents) and derivatives
    root_gens = [g for g in content_gen_log if g["gen_type"] == "root"]
    derivative_gens = [g for g in content_gen_log if g["gen_type"] in ("remix", "merge")]

    # Roots: these are the very first solutions. Find sol IDs that have no
    # parents and weren't targets of create decisions (they ARE the new ones).
    # Heuristic: look at step=0 root_solution time events to match by agent
    agent_root_time: dict[str, str] = {}
    for te in time_events:
        if te["action"] == "root_solution" and te["step"] == 0:
            agent_root_time[te["actor"]] = te.get("simulated_at", "")

    # Since the JSON doesn't directly map gen events to PB IDs,
    # we assign titles to solutions by order of appearance.
    # Sort content_gen by timestamp
    sorted_gens = sorted(content_gen_log, key=lambda g: g.get("simulated_at", ""))

    # Build a list of solutions that appear as parent_ids (these are known IDs)
    parent_referenced_ids: set[str] = set()
    for gen in content_gen_log:
        for pid in gen.get("parent_ids", []):
            parent_referenced_ids.add(pid)

    # Solutions that ARE parents = they were created earlier
    # Solutions that are only vote targets = they are newer

    # For titles: assign gen output_excerpt to solutions with matching parents
    for gen in sorted_gens:
        if gen["gen_type"] not in ("root", "remix", "merge"):
            continue
        title = gen.get("output_excerpt", "")
        parents = gen.get("parent_ids", [])
        ts = gen.get("simulated_at", "")
        agent = gen.get("agent", "")

        if gen["gen_type"] == "root":
            # Find a sol builder without parents and without a title yet,
            # matching the agent if possible
            candidates = [
                b for b in sol_builders.values()
                if not b.parent_ids and not b.title and not b.gen_type
            ]
            # Prefer ones that appear as parents (root solutions get remixed)
            root_candidates = [b for b in candidates if b.id in parent_referenced_ids]
            chosen = root_candidates[0] if root_candidates else (candidates[0] if candidates else None)
            if chosen:
                chosen.title = title
                chosen.gen_type = "root"
                chosen.created = chosen.created or ts
                chosen.author = agent

        elif gen["gen_type"] in ("remix", "merge"):
            # Find a sol builder whose parents match
            for b in sol_builders.values():
                if not b.title and not b.gen_type:
                    # Check if this could be the derivative
                    if parents and all(pid in all_sol_ids for pid in parents):
                        b.title = title
                        b.gen_type = gen["gen_type"]
                        b.parent_ids = parents
                        b.created = b.created or ts
                        b.author = agent
                        break

    # ── Step 4: Build SolutionRecords ──────────────────────────────────
    solutions: list[SolutionRecord] = []
    for b in sol_builders.values():
        support = sum(1 for v in b.votes.values() if v > 0)
        # Best-effort: find a label from content_gen matching this solution's parents+author
        sol_label = label_by_parent_agent.get((",".join(b.parent_ids), b.author), "")
        solutions.append(SolutionRecord(
            id=b.id,
            title=b.title or f"Solution {b.id[:8]}",
            state="Proposed",
            support_count=support,
            current_score=float(support),
            is_champion=False,  # Will be computed
            in_focus=False,     # Will be computed
            parent_solutions=b.parent_ids,
            root_solution=b.id if not b.parent_ids else "",
            merge_status="pending_independent" if b.gen_type == "merge" else "none",
            base_parent=b.parent_ids[0] if b.gen_type == "merge" and b.parent_ids else "",
            created=b.created or "",
            occurred_at=b.created or "",
            absorbed_clusters=[],
            labels=[sol_label] if sol_label else [],
            primary_label=sol_label,
        ))

    # ── Step 4.5: Re-derive merge statuses and absorbed clusters via vote replay ──────
    from tooling.evaluation.extract.pb_extractor import ActionLogRecord
    
    sol_by_id = {s.id: s for s in solutions}
    parent_map = {s.id: s.parent_solutions for s in solutions}
    
    def _compute_anc_set(nid):
        ancestors = set()
        stack = [nid]
        while stack:
            curr = stack.pop()
            if curr in ancestors:
                continue
            ancestors.add(curr)
            for p in parent_map.get(curr, []):
                if p not in ancestors:
                    stack.append(p)
        return ancestors

    ancestor_cache = {}
    for s in solutions:
        ancestor_cache[s.id] = _compute_anc_set(s.id)

    # Sort vote records chronologically
    sorted_votes = sorted(vote_records, key=lambda v: _parse_ts(v.occurred_at or v.created))
    
    # Initialize all solutions to 0 support before replay
    for s in solutions:
        s.support_count = 0
        s.current_score = 0.0
        s.merge_status = "pending_independent" if len(s.parent_solutions) >= 2 and s.id in [x.id for x in solutions if x.merge_status == "pending_independent"] else "none"
        s.absorbed_clusters = []
        
    reconstructed_action_logs = []
    user_votes = defaultdict(dict)
    log_counter = 0

    # Pre-build action_logs from decision_log for behavioral metrics
    action_type_map = {
        "vote": "vote_like",
        "vote_solution": "vote_like",
        "vote_support": "vote_like",
        "accept_migration": "vote_like",
        "vote_retract": "vote_repeal",
        "retract": "vote_repeal",
        "create": "root_solution",       # will refine below
        "merge": "merge_solution",
    }
    for dec in decision_log:
        action = dec.get("action", "")
        if action not in action_type_map:
            continue
        sid = dec.get("target_solution_id", "")
        ts_str = dec.get("simulated_at", "")
        agent = dec.get("agent", "")

        # Distinguish root vs remix from gen_type in content_gen
        mapped = action_type_map[action]
        if action == "create":
            # If the target is a parent (i.e. someone is remixing it), map to branch
            mapped = "branch_solution"

        log_counter += 1
        reconstructed_action_logs.append(ActionLogRecord(
            id=f"log_{log_counter}",
            question=question_id,
            action_type=mapped,
            target_id=sid or "",
            occurred_at=ts_str,
            user=agent,
            metadata_json={},
        ))

    
    # Identify the merge solutions we want to track
    merge_sols = [s for s in solutions if s.merge_status == "pending_independent"]
    
    for v_idx, v in enumerate(sorted_votes):
        sid = v.solution
        user = v.user
        vote_val = v.vote
        ts_str = v.occurred_at or v.created
        
        if sid not in sol_by_id:
            continue
            
        # Update support count
        old_val = user_votes[user].get(sid, 0)
        if old_val > 0 and vote_val == 0:
            sol_by_id[sid].support_count = max(0, sol_by_id[sid].support_count - 1)
        elif old_val == 0 and vote_val > 0:
            sol_by_id[sid].support_count += 1
            
        user_votes[user][sid] = vote_val
        sol_by_id[sid].current_score = float(sol_by_id[sid].support_count)
        
        # Run recalculation loop for merge status changes at this step
        for iteration in range(5):
            changed = False
            
            # 1. Compute current clusters
            cluster_map = {}
            for s in solutions:
                s.cluster_id = cluster_map.get(s.id, "0")
                
            # Group by cluster to find stable keys
            cluster_groups = defaultdict(list)
            for s in solutions:
                if s.current_score >= 1:
                    cluster_groups[s.cluster_id].append(s)
                    
            cluster_stable_key = {}
            for cid, members in cluster_groups.items():
                best = members[0]
                best_anc_count = len(ancestor_cache.get(best.id, set()))
                for m in members[1:]:
                    anc_count = len(ancestor_cache.get(m.id, set()))
                    if anc_count < best_anc_count or (anc_count == best_anc_count and m.created < best.created):
                        best = m
                        best_anc_count = anc_count
                cluster_stable_key[cid] = best.id

            # 2. Check each merge solution
            for sol in merge_sols:
                if sol.merge_status == "accepted":
                    continue
                    
                own_cid = cluster_map.get(sol.id)
                own_stable_key = cluster_stable_key.get(own_cid, "")
                
                parent_stable_keys = set()
                for pid in sol.parent_solutions:
                    p_cid = cluster_map.get(pid)
                    p_stable_key = cluster_stable_key.get(p_cid, "")
                    if p_stable_key and p_stable_key != own_stable_key:
                        parent_stable_keys.add(p_stable_key)
                        
                if not parent_stable_keys:
                    continue
                    
                already_absorbed = set(sol.absorbed_clusters)
                newly_absorbed = []
                
                for p_stable_key in parent_stable_keys:
                    if p_stable_key in already_absorbed:
                        continue
                        
                    p_cid = None
                    for cid, sk in cluster_stable_key.items():
                        if sk == p_stable_key:
                            p_cid = cid
                            break
                    if p_cid is None:
                        continue
                        
                    members = cluster_groups[p_cid]
                    champ_score = max(m.current_score for m in members) if members else 0
                    
                    if sol.current_score > champ_score:
                        newly_absorbed.append(p_stable_key)
                        
                if newly_absorbed:
                    old_status = sol.merge_status
                    sol.absorbed_clusters.extend(newly_absorbed)
                    all_absorbed = all(sk in sol.absorbed_clusters for sk in parent_stable_keys)
                    new_status = "accepted" if all_absorbed else "partial"
                    
                    if sol.merge_status != new_status:
                        sol.merge_status = new_status
                        changed = True
                        
                        # Log the transition event!
                        reconstructed_action_logs.append(ActionLogRecord(
                            id=f"log_merge_{len(reconstructed_action_logs)}",
                            question=question_id,
                            action_type="merge_status_change",
                            target_id=sol.id,
                            occurred_at=ts_str,
                            user=user,
                            metadata_json={
                                "old_status": old_status,
                                "new_status": new_status,
                                "absorbed_clusters": list(sol.absorbed_clusters)
                            }
                        ))
            if not changed:
                break

    # Restore final support counts
    for s in solutions:
        support = sum(1 for v in sol_builders[s.id].votes.values() if v > 0)
        s.support_count = support
        s.current_score = float(support)

    # ── Step 5: Compute clusters ───────────────────────────────────────
    cluster_map = {}
    for sol in solutions:
        sol.cluster_id = cluster_map.get(sol.id, "0")

    # Elect champions (highest support per cluster)
    cluster_groups: dict[str, list[SolutionRecord]] = defaultdict(list)
    for sol in solutions:
        if sol.current_score >= 1:
            cluster_groups[sol.cluster_id].append(sol)

    for members in cluster_groups.values():
        champion = max(members, key=lambda s: (s.current_score, s.created))
        champion.is_champion = True

    # Simple focus: top solutions by score
    scored = sorted(solutions, key=lambda s: -s.current_score)
    for sol in scored[:7]:
        if sol.current_score >= 1:
            sol.in_focus = True

    # Compute merge summary
    merge_none = sum(1 for s in solutions if s.merge_status == "none")
    merge_pending = sum(1 for s in solutions if s.merge_status == "pending_independent")
    merge_partial = sum(1 for s in solutions if s.merge_status == "partial")
    merge_accepted = sum(1 for s in solutions if s.merge_status == "accepted")

    # Build label_names from unique label strings encountered in content_gen
    label_names: dict[str, str] = {}
    for sol in solutions:
        for lbl in sol.labels:
            if lbl:
                label_names.setdefault(lbl, lbl)  # name = the text itself in offline mode

    return QuestionData(
        question_id=question_id,
        title=f"Run {run_id}" if run_id else question_id,
        focus_quorum=1,
        solutions=solutions,
        votes=vote_records,
        action_logs=reconstructed_action_logs,
        phases=phases,
        merge_none_count=merge_none,
        merge_pending_count=merge_pending,
        merge_partial_count=merge_partial,
        merge_accepted_count=merge_accepted,
        label_names=label_names,
    )

