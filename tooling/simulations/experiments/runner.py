"""Run all experiment configurations.

Usage:
    python3 tooling/simulations/experiments/runner.py          # full sweep
    python3 tooling/simulations/experiments/runner.py --test   # single run
    python3 tooling/simulations/experiments/runner.py --workers 1  # sequential
    python3 tooling/simulations/experiments/runner.py --filter smoothing  # only matching runs
    python3 tooling/simulations/experiments/runner.py --base-url http://localhost:8090
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def detect_pocketbase_url() -> str:
    """Auto-detect PocketBase URL by trying common ports."""
    # Check env vars first
    for var in ("PUBLIC_POCKETBASE_URL", "PRIVATE_POCKETBASE_URL"):
        url = os.environ.get(var, "")
        if url:
            return url.rstrip("/")

    # Try common endpoints (host ports + Docker service name)
    for url in (
        "http://localhost:18090",
        "http://localhost:8090",
        "http://pocketbase:8090",
        "http://localhost:8080",
    ):
        try:
            r = urllib.request.urlopen(f"{url}/api/health", timeout=2)
            if r.status == 200:
                return url
        except Exception:
            continue

    return "http://localhost:8090"  # fallback


def health_check(base_url: str) -> bool:
    """Verify PocketBase is reachable."""
    try:
        r = urllib.request.urlopen(f"{base_url}/api/health", timeout=5)
        return r.status == 200
    except Exception:
        return False


def run_simulation(run_def, base_url: str):
    run_id = run_def["run_id"]
    seed = run_def["seed"]
    config = run_def["config"]

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(config, f)
        temp_path = f.name

    out_file = f"tooling/output/experiments/experiment_{run_id}.json"
    os.makedirs("tooling/output/experiments", exist_ok=True)
    
    if os.path.exists(out_file) and os.path.getsize(out_file) > 100:
        return run_id, True, 0.0, "Skipped (already exists)"

    cmd = [
        sys.executable, "-m", "tooling.simulations.engine.main",
        "--base-url", base_url,
        "--admin-email", os.environ.get("PB_SUPERUSER_EMAIL", ""),
        "--admin-password", os.environ.get("PB_SUPERUSER_PASSWORD", ""),
        "--run-id", run_id,
        "--seed", str(seed),
        "--config", temp_path,
        "--agents", str(config.get("agents", 50)),
        "--max-steps", str(config.get("max_steps", 500)),
        "--target-duration-days", str(config.get("target_duration_days", 30)),
        "--time-min-hours", str(config.get("time_min_hours", 4)),
        "--time-max-hours", str(config.get("time_max_hours", 12)),
        "--time-long-jump-chance", str(config.get("time_long_jump_chance", 0.15)),
        "--time-long-jump-min-days", str(config.get("time_long_jump_min_days", 1)),
        "--time-long-jump-max-days", str(config.get("time_long_jump_max_days", 4)),
        "--initial-solution-min-delay-days", str(config.get("initial_solution_min_delay_days", 0)),
        "--initial-solution-max-delay-days", str(config.get("initial_solution_max_delay_days", 0)),
        "--progress-every-steps", str(config.get("progress_every_steps", 5)),
        "--language", config.get("language", "en"),
        "--disable-llm",
        "--json-out", out_file,
    ]

    env = os.environ.copy()
    project_root = str(Path(__file__).parent.parent.parent.parent)
    env["PYTHONPATH"] = project_root + os.pathsep + env.get("PYTHONPATH", "")

    start = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=project_root)
    elapsed = time.time() - start

    os.remove(temp_path)

    if result.returncode == 0:
        return run_id, True, elapsed, result.stdout
    else:
        return run_id, False, elapsed, result.stderr


def main():
    configs_file = Path(__file__).parent / "experiment_configs.json"
    if not configs_file.exists():
        print(f"Error: {configs_file} not found. Run config_generator.py first.")
        sys.exit(1)

    with open(configs_file, "r") as f:
        all_runs = json.load(f)

    runs = []
    skipped = 0
    for r in all_runs:
        out_file = f"tooling/output/experiments/experiment_{r['run_id']}.json"
        if os.path.exists(out_file) and os.path.getsize(out_file) > 100:
            skipped += 1
        else:
            runs.append(r)

    print(f"Loaded {len(all_runs)} configurations. Skipped {skipped} existing ones. {len(runs)} missing runs to execute.")

    # Parse CLI args
    test_mode = "--test" in sys.argv
    if test_mode:
        runs = runs[:1]
        print("Running in test mode (1 run only).")

    # Filter by run_id substring (e.g. --filter smoothing, --filter max_exploration)
    if "--filter" in sys.argv:
        idx = sys.argv.index("--filter")
        if idx + 1 < len(sys.argv):
            pattern = sys.argv[idx + 1]
            runs = [r for r in runs if pattern in r["run_id"]]
            print(f"Filtered to {len(runs)} runs matching '{pattern}'.")
            if not runs:
                print("No runs matched the filter. Exiting.")
                sys.exit(0)

    max_workers = 1
    if "--workers" in sys.argv:
        idx = sys.argv.index("--workers")
        if idx + 1 < len(sys.argv):
            max_workers = int(sys.argv[idx + 1])

    # Detect or override PocketBase URL
    if "--base-url" in sys.argv:
        idx = sys.argv.index("--base-url")
        if idx + 1 < len(sys.argv):
            base_url = sys.argv[idx + 1]
        else:
            print("Error: --base-url requires a URL argument")
            sys.exit(1)
    else:
        base_url = detect_pocketbase_url()

    # Pre-flight health check
    print(f"PocketBase URL: {base_url}")
    if not health_check(base_url):
        print(f"ERROR: PocketBase is not reachable at {base_url}")
        print("Make sure your dev stack is running (dev:up) and try again.")
        print("You can also specify the URL: --base-url http://localhost:8090")
        sys.exit(1)
    print(f"PocketBase health check OK ✓")

    success_count = 0
    fail_count = 0

    try:
        from tqdm import tqdm
        has_tqdm = True
    except ImportError:
        has_tqdm = False

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(run_simulation, r, base_url): r for r in runs}

        iterator = as_completed(futures)
        if has_tqdm:
            iterator = tqdm(iterator, total=len(runs), desc="Simulations", unit="run", dynamic_ncols=True)

        for future in iterator:
            run_id, ok, elapsed, out = future.result()
            if ok:
                success_count += 1
                if not has_tqdm:
                    print(f"[{run_id}] OK ({elapsed:.1f}s)")
            else:
                fail_count += 1
                if has_tqdm:
                    iterator.write(f"[{run_id}] FAILED ({elapsed:.1f}s):\n{out[:2000]}")
                else:
                    print(f"[{run_id}] FAILED ({elapsed:.1f}s):\n{out[:2000]}")

    print(f"\nDone. Success: {success_count}, Failed: {fail_count}")


if __name__ == "__main__":
    main()
