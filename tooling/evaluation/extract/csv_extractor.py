import os
import json
import pandas as pd
from typing import Any
from tooling.evaluation.extract.pb_extractor import (
    QuestionData,
    SolutionRecord,
    VoteRecord,
    ActionLogRecord,
    QuestionPhaseRecord,
    _parse_absorbed
)

def _parse_json_field(val: Any) -> Any:
    if pd.isna(val) or val == "":
        return []
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return val

def _parse_dict_field(val: Any) -> dict:
    if pd.isna(val) or val == "":
        return {}
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return {}
    return val

def extract_from_csv(csv_dir: str, question_id: str) -> QuestionData:
    """Read CSV files from a directory and construct a QuestionData object."""
    
    questions_df = pd.read_csv(os.path.join(csv_dir, "questions.csv"))
    proposals_df = pd.read_csv(os.path.join(csv_dir, "proposals.csv"))
    
    # Try reading proposal_votes.csv (some exports use question_votes.csv, fallback if needed)
    votes_path = os.path.join(csv_dir, "proposal_votes.csv")
    if os.path.exists(votes_path):
        votes_df = pd.read_csv(votes_path)
    else:
        votes_df = pd.read_csv(os.path.join(csv_dir, "question_votes.csv"))
        
    action_logs_df = pd.read_csv(os.path.join(csv_dir, "action_logs.csv"))
    
    # Optional phases
    phases_path = os.path.join(csv_dir, "question_phases.csv")
    if os.path.exists(phases_path):
        phases_df = pd.read_csv(phases_path)
    else:
        phases_df = pd.DataFrame()

    # Filter for the question
    q_row = questions_df[questions_df["id"] == question_id].iloc[0]
    title = q_row.get("title", "")
    focus_quorum = int(q_row.get("focus_quorum", 0) if not pd.isna(q_row.get("focus_quorum")) else 0)

    # Filter proposals
    p_df = proposals_df[proposals_df["question"] == question_id]
    solutions = []
    merge_none_count = 0
    merge_pending_count = 0
    merge_partial_count = 0
    merge_accepted_count = 0

    for _, row in p_df.iterrows():
        parent_sols = _parse_json_field(row.get("parent_solutions"))
        abs_clusters = _parse_absorbed(row.get("absorbed_clusters"))
        
        m_status = str(row.get("merge_status", "none")).strip()
        if m_status == "none" or not m_status or m_status == "nan":
            m_status = "none"
            merge_none_count += 1
        elif m_status == "pending_independent":
            merge_pending_count += 1
        elif m_status == "partial":
            merge_partial_count += 1
        elif m_status == "accepted":
            merge_accepted_count += 1

        sol = SolutionRecord(
            id=str(row["id"]),
            title=str(row.get("title", "")),
            state=str(row.get("state", "")),
            support_count=int(row.get("support_count", 0) if not pd.isna(row.get("support_count")) else 0),
            current_score=float(row.get("current_score", 0.0) if not pd.isna(row.get("current_score")) else 0.0),
            is_champion=bool(row.get("is_champion", False)),
            in_focus=bool(row.get("in_focus", False)),
            parent_solutions=parent_sols,
            root_solution=str(row.get("root_solution", "")),
            merge_status=m_status,
            base_parent=str(row.get("base_parent", "")),
            created=str(row.get("created", "")),
            occurred_at=str(row.get("created", "")),  # default to created
            cluster_key=str(row.get("cluster_key", "")),
            cluster_id=str(row.get("cluster_key", "")),
            absorbed_clusters=abs_clusters
        )
        solutions.append(sol)

    # Filter votes
    v_df = votes_df[votes_df["question"] == question_id]
    votes = []
    for _, row in v_df.iterrows():
        votes.append(VoteRecord(
            id=str(row["id"]),
            solution=str(row.get("solution", "")),
            user=str(row.get("user", "")),
            vote=int(row.get("vote", 0) if not pd.isna(row.get("vote")) else 0),
            created=str(row.get("created", "")),
            occurred_at=str(row.get("created", ""))
        ))

    # Filter action logs
    al_df = action_logs_df[action_logs_df["question"] == question_id]
    action_logs = []
    for _, row in al_df.iterrows():
        action_logs.append(ActionLogRecord(
            id=str(row["id"]),
            question=str(row.get("question", "")),
            action_type=str(row.get("action_type", "")),
            target_id=str(row.get("target_id", "")),
            occurred_at=str(row.get("occurred_at", "")),
            user=str(row.get("user", "")),
            metadata_json=_parse_dict_field(row.get("metadata_json"))
        ))

    # Filter phases
    phases = []
    if not phases_df.empty:
        ph_df = phases_df[phases_df["question"] == question_id]
        for _, row in ph_df.iterrows():
            phases.append(QuestionPhaseRecord(
                id=str(row["id"]),
                phase_name=str(row.get("phase_name", "")),
                started_at=str(row.get("started_at", "")),
                ended_at=str(row.get("ended_at", ""))
            ))

    data = QuestionData(
        question_id=question_id,
        title=title,
        focus_quorum=focus_quorum,
        solutions=solutions,
        votes=votes,
        action_logs=action_logs,
        phases=phases,
        merge_none_count=merge_none_count,
        merge_pending_count=merge_pending_count,
        merge_partial_count=merge_partial_count,
        merge_accepted_count=merge_accepted_count
    )

    return data
