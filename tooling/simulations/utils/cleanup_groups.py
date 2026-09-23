#!/usr/bin/env python
import argparse
import sys
import os
from tooling.simulations.engine.pb_client import PocketBaseClient, PocketBaseError
from tooling.simulations.engine.cleanup import cleanup_group

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("PB_BASE_URL", "http://localhost:8090"))
    parser.add_argument("--admin-email", default=os.environ.get("PB_SUPERUSER_EMAIL") or os.environ.get("PB_ADMIN_EMAIL") or "admin@remix.local")
    parser.add_argument("--admin-password", default=os.environ.get("PB_SUPERUSER_PASSWORD") or os.environ.get("PB_ADMIN_PASSWORD") or "admin123")
    parser.add_argument("--preserve-hours", type=int, default=48, help="Preserve questions newer than X hours")
    args = parser.parse_args()

    pb = PocketBaseClient(args.base_url)
    try:
        pb.admin_auth(args.admin_email, args.admin_password)
    except PocketBaseError as err:
        print(f"Error authenticating: {err}")
        sys.exit(1)

    report1 = cleanup_group(pb, "WG Study Showcase Group", delete_group=True, preserve_recent_hours=args.preserve_hours)
    report2 = cleanup_group(pb, "Global Simulation Group", delete_group=True, preserve_recent_hours=args.preserve_hours)
    report3 = cleanup_group(pb, "WG-Studiengruppe", delete_group=False, preserve_recent_hours=args.preserve_hours)
    
    print("Cleanup completed.")

if __name__ == "__main__":
    main()
