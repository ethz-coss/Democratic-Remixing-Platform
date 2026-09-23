import argparse
import os
import sys

from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.setup.scenarios import setup_office_study, setup_showcase_group, setup_from_json

def main() -> None:
    parser = argparse.ArgumentParser(description="Platform Setup Data Generation")
    parser.add_argument("scenario", choices=["office_study", "showcase_group", "fresh_ideation", "cleanup", "custom"], help="The scenario to setup.")
    parser.add_argument("--json-path", type=str, default="", help="Path to the JSON setup file when using custom scenario.")
    parser.add_argument("--group-name", type=str, default=None, help="Specific group name to clean up.")
    parser.add_argument("--base-url", default=os.environ.get("PRIVATE_POCKETBASE_URL", "http://localhost:18090"))
    parser.add_argument("--admin-email", default=os.environ.get("PB_SUPERUSER_EMAIL", "email@example.com"))
    parser.add_argument("--admin-password", default=os.environ.get("PB_SUPERUSER_PASSWORD", "test_pw"))
    
    args = parser.parse_args()
    
    pb = PocketBaseClient(args.base_url)
    try:
        pb.admin_auth(args.admin_email, args.admin_password)
    except PocketBaseError as e:
        print(f"Failed to authenticate as admin: {e}")
        sys.exit(1)
        
    if args.scenario == "office_study":
        setup_office_study(pb)
    elif args.scenario == "showcase_group":
        setup_showcase_group(pb)
    elif args.scenario == "fresh_ideation":
        from tooling.setup.scenarios import setup_fresh_ideation
        setup_fresh_ideation(pb)
    elif args.scenario == "cleanup":
        from tooling.setup.scenarios import wipe_seed_data
        wipe_seed_data(pb, group_name=args.group_name)
    elif args.scenario == "custom":
        if not args.json_path:
            print("Error: --json-path is required for custom scenario.")
            sys.exit(1)
        setup_from_json(pb, args.json_path)
        
if __name__ == "__main__":
    main()
