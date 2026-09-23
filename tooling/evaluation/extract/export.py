#!/usr/bin/env python3
import json
import csv
import urllib.request
import os
import sys
import hashlib
from datetime import datetime

# Ensure tooling root is in path so we can import _paths
script_dir = os.path.dirname(os.path.abspath(__file__))
tooling_dir = os.path.dirname(os.path.dirname(script_dir))
if tooling_dir not in sys.path:
    sys.path.insert(0, tooling_dir)

import _paths

from tooling.simulations.engine.pb_client import PocketBaseClient

PB_URL = os.environ.get("PB_URL", "http://127.0.0.1:8090")
ADMIN_EMAIL = os.environ.get("PB_ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("PB_ADMIN_PASSWORD")

if not ADMIN_EMAIL or not ADMIN_PASSWORD:
    print("Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD environment variables must be set.", file=sys.stderr)
    sys.exit(1)

def get_pb_client():
    pb = PocketBaseClient(base_url=PB_URL)
    try:
        pb.admin_auth(ADMIN_EMAIL, ADMIN_PASSWORD)
    except Exception as e:
        print(f"Admin auth failed: {e}")
    return pb

def fetch_all(pb, collection):
    all_items = []
    page = 1
    while True:
        try:
            params = {"page": page, "perPage": 200}
            data = pb.request("GET", f"/api/collections/{collection}/records", params=params)
            items = data.get("items", [])
            if not items:
                break
            
            # For each item, ensure JSON strings are parsed
            for r in items:
                for k, v in r.items():
                    if isinstance(v, str) and (v.startswith('{') or v.startswith('[')):
                        try:
                            r[k] = json.loads(v)
                        except:
                            pass
            all_items.extend(items)
            
            total_pages = data.get("totalPages", 1)
            if page >= total_pages:
                break
            page += 1
        except Exception as e:
            print(f"Failed to fetch {collection}: {e}")
            break
    return all_items



def write_csv(out_file, records):
    if not records:
        return
    
    keys = []
    for r in records:
        for k in r.keys():
            if k not in keys and k not in ['collectionId', 'collectionName']:
                keys.append(k)
                
    if 'id' in keys:
        keys.remove('id')
        keys = ['id'] + sorted(keys)
    else:
        keys = sorted(keys)
        
    with open(out_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(keys)
        for r in records:
            row = []
            for k in keys:
                val = r.get(k)
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                row.append(val)
            writer.writerow(row)
    print(f"Exported {len(records)} records to {out_file}")

def get_pseudo_id(user_id):
    if not user_id: return ""
    return hashlib.md5(user_id.encode('utf-8')).hexdigest()[:16]

def pseudonymize_records(records, user_fields):
    for r in records:
        for f in user_fields:
            if r.get(f):
                r[f] = get_pseudo_id(r[f])
    return records

def main():
    pb = get_pb_client()
    
    collections = [
        "groups", "group_members", "users", "questions",
        "question_phases", "question_votes", "proposals",
        "proposal_votes", "action_logs", "study_consents", "labels",
        "ballot_responses", "proposal_hides", "user_proposal_views",
        "post_study_surveys", "push_notification_log", "proposal_comments",
    ]
    
    data = {}
    for coll in collections:
        print(f"Fetching {coll}...")
        data[coll] = fetch_all(pb, coll)
        
    groups = data["groups"]
    
    date_str = datetime.now().strftime("%Y-%m-%d")
    exports_dir = _paths.EXPORTS_OUTPUT
    os.makedirs(exports_dir, exist_ok=True)
    
    for g in groups:
        g_id = g['id']
        safe_name = "".join([c if c.isalnum() else "_" for c in g['name']])
        folder_name = os.path.join(exports_dir, f"{date_str}_{safe_name}_{g_id}")
        os.makedirs(folder_name, exist_ok=True)
        
        g_group_members = [gm for gm in data["group_members"] if gm.get("group") == g_id]
        user_ids = {gm["user"] for gm in g_group_members if gm.get("user")}
        
        g_users = [u for u in data["users"] if u.get("id") in user_ids]
        # Clear PII
        for u in g_users:
            for field in ['name', 'avatar', 'username']:
                if field in u:
                    u[field] = ""
            if 'email' in u:
                u['email'] = f"{get_pseudo_id(u['id'])}@pseudo.local"
                
        g_questions = [p for p in data["questions"] if p.get("group") == g_id]
        question_ids = {p["id"] for p in g_questions}
        
        g_question_phases = [x for x in data["question_phases"] if x.get("question") in question_ids]
        g_question_votes = [x for x in data["question_votes"] if x.get("question") in question_ids]
        g_proposals = [x for x in data["proposals"] if x.get("question") in question_ids]
        proposal_ids = {p["id"] for p in g_proposals}
        g_proposal_votes = [x for x in data["proposal_votes"] if x.get("question") in question_ids]

        g_action_logs = []
        for log in data["action_logs"]:
            if log.get("question") in question_ids:
                g_action_logs.append(log)
            elif log.get("user") in user_ids and not log.get("question"):
                g_action_logs.append(log)

        g_study_consents = [x for x in data["study_consents"] if x.get("user") in user_ids]

        g_labels = [x for x in data["labels"] if x.get("question") in question_ids]
        g_ballot_responses = [x for x in data["ballot_responses"] if x.get("question") in question_ids]

        g_proposal_hides = [x for x in data["proposal_hides"] if x.get("proposal") in proposal_ids]
        g_user_proposal_views = [x for x in data["user_proposal_views"] if x.get("proposal") in proposal_ids]

        g_post_study_surveys = [x for x in data["post_study_surveys"] if x.get("user") in user_ids]
        
        import copy
        import re

        def extract_question_id(record):
            payload = record.get("payload_json", {})
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except:
                    payload = {}
            url = payload.get("data", {}).get("url", "")
            m = re.search(r"/questions/([^/]+)", url)
            return m.group(1) if m else None

        # Event types where we must verify question/proposal ownership
        siphon_event_types = {"vote_migration", "proposal_remixed"}

        g_push_notification_log_filtered = []
        for x in data["push_notification_log"]:
            if x.get("user") not in user_ids:
                continue
            q_id = extract_question_id(x)
            if q_id:
                if q_id in question_ids:
                    g_push_notification_log_filtered.append(x)
            elif x.get("event_type") in siphon_event_types:
                # No URL — check reference_id against proposal_ids
                ref_id = x.get("reference_id", "")
                if ref_id in proposal_ids:
                    g_push_notification_log_filtered.append(x)
                # else: skip — likely a cross-study leak
            else:
                # Non-siphon events without URL: keep (user-only filter)
                g_push_notification_log_filtered.append(x)

        g_push_notification_log = copy.deepcopy(g_push_notification_log_filtered)
        
        g_proposal_comments = [x for x in data["proposal_comments"] if x.get("proposal") in proposal_ids]
        
        exports = {
            "groups": [g],
            "group_members": pseudonymize_records(g_group_members, ['user']),
            "users": pseudonymize_records(g_users, ['id']),
            "questions": pseudonymize_records(g_questions, ['author']),
            "question_phases": g_question_phases,
            "question_votes": pseudonymize_records(g_question_votes, ['user']),
            "proposals": pseudonymize_records(g_proposals, ['author']),
            "proposal_votes": pseudonymize_records(g_proposal_votes, ['user']),
            "action_logs": pseudonymize_records(g_action_logs, ['user']),
            "study_consents": pseudonymize_records(g_study_consents, ['user']),
            "labels": g_labels,
            "ballot_responses": pseudonymize_records(g_ballot_responses, ['user']),
            "proposal_hides": pseudonymize_records(g_proposal_hides, ['user']),
            "user_proposal_views": pseudonymize_records(g_user_proposal_views, ['user']),
            "post_study_surveys": pseudonymize_records(g_post_study_surveys, ['user']),
            "push_notification_log": pseudonymize_records(g_push_notification_log, ['user']),
            "proposal_comments": pseudonymize_records(g_proposal_comments, ['user']),
        }
        
        print(f"\nProcessing group: {g['name']} ({g_id})")
        for coll_name, records in exports.items():
            if records:
                out_file = os.path.join(folder_name, f"{coll_name}.csv")
                write_csv(out_file, records)

if __name__ == "__main__":
    main()
