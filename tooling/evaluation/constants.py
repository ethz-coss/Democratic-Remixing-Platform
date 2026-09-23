# Constants and mapping logic for the analysis notebook

# Phase Names
PHASES = {
    'ideation': 'ideation',
    'voting': 'voting',
    'curation': 'curation',
    'results': 'results'
}

# Action Log Event Types
LOG_TYPES = {
    'VOTE': 'vote',
    'CREATE_PROPOSAL': 'create_proposal',
    'COMMENT': 'comment',
    'REMIX_SINGULAR': 'remix_singular',
    'REMIX_COMBINE': 'remix_combine',
    'HIDE': 'hide_proposal',
    'RESTORE': 'restore_proposal',
    'BALLOT_SUBMIT': 'ballot_submit',
    'SUBSCRIBE': 'subscribe',
    'UNSUBSCRIBE': 'unsubscribe',
    'READINESS_SIGNAL': 'readiness_signal',
    'CREATE_LABEL': 'create_label',
    'PROPOSAL_VIEW': 'proposal_view'
}

# Metric Column Names
METRICS = {
    'PROPOSAL_COUNT': 'proposal_count',
    'VOTE_COUNT': 'vote_count',
    'COMMENT_COUNT': 'comment_count',
    'ACTIVE_TIME': 'active_time_seconds',
    'HIDE_COUNT': 'hide_count',
    'REMIX_COUNT': 'remix_count',
    'BALLOT_RANKS': 'ballot_ranks_count'
}

def get_action_category(action_type):
    """Categorize action types into high-level interaction buckets."""
    if action_type in ['subscribe', 'unsubscribe', 'vote_like', 'vote_repeal']:
        return 'interaction_vote'
    elif action_type in ['create_idea', 'remix_singular', 'remix_combine']:
        return 'creation'
    elif action_type in ['hide_proposal', 'restore_proposal']:
        return 'curation'
    elif action_type in ['ballot_submit']:
        return 'final_vote'
    return 'other'
