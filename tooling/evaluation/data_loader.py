import os
import pandas as pd
from typing import Dict, Optional
import datetime

class ExperimentDataLoader:
    def __init__(self, export_dir: str):
        self.export_dir = export_dir
        
    def load_collection(self, collection_name: str) -> pd.DataFrame:
        """Load a CSV collection into a pandas DataFrame."""
        file_path = os.path.join(self.export_dir, f"{collection_name}.csv")
        if not os.path.exists(file_path):
            print(f"Warning: File {file_path} not found.")
            return pd.DataFrame()
            
        try:
            return pd.read_csv(file_path)
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            return pd.DataFrame()

    def load_all(self) -> Dict[str, pd.DataFrame]:
        """Load all core collections."""
        collections = [
            "groups", "group_members", "users", "questions", 
            "question_phases", "question_votes", "proposals", 
            "question_timeline_events", "proposal_votes", "contradiction_edges", 
            "action_logs", "study_consents", "labels", "ballot_responses",
            "proposal_hides", "user_proposal_views", "post_study_surveys"
        ]
        
        data = {}
        for c in collections:
            data[c] = self.load_collection(c)
            
        # Convert timestamp columns
        self._parse_dates(data)
        return data

    def _parse_dates(self, data: Dict[str, pd.DataFrame]):
        """Convert standard PocketBase created/updated fields to datetime."""
        for name, df in data.items():
            if df.empty: continue
            for col in ['created', 'updated', 'occurred_at']:
                if col in df.columns:
                    df[col] = pd.to_datetime(df[col], errors='coerce')

    def get_time_on_page(self, action_logs_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate time spent active based on action_logs occurred_at differences.
        Groups by user and assumes a session timeout of 30 minutes.
        """
        if action_logs_df.empty: return pd.DataFrame()
        
        df = action_logs_df.copy()
        df = df.sort_values(by=['user', 'occurred_at'])
        
        df['time_diff'] = df.groupby('user')['occurred_at'].diff().dt.total_seconds()
        
        # Cap time difference to 30 mins (1800s) to account for sessions
        df['time_diff'] = df['time_diff'].apply(lambda x: x if x < 1800 else 0)
        
        # Calculate total active time per user
        active_time = df.groupby('user')['time_diff'].sum().reset_index()
        active_time.rename(columns={'time_diff': 'total_active_seconds'}, inplace=True)
        return active_time
