#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/../.."

echo "=========================================================="
echo " Starting Pending Experiment Suite (34 Runs)"
echo "=========================================================="

echo "[1/4] Swapping to pending_configs..."
mv tooling/simulations/experiments/experiment_configs.json tooling/simulations/experiments/full_configs.bak.json
mv tooling/simulations/experiments/pending_configs.json tooling/simulations/experiments/experiment_configs.json

echo "[2/4] Cleaning up PocketBase simulation data (Database only, preserving old output JSONs)..."
python3 -m tooling.setup.cli cleanup
echo "  ✓ PocketBase data cleaned."

echo "[3/4] Running Simulations (This will take ~2 hours)..."
# Using 2 workers
python3 -m tooling.simulations.experiments.runner --workers 2

echo "[4/4] Collecting All Metrics & Restoring config..."
python3 -m tooling.simulations.experiments.collector
python3 -m tooling.simulations.experiments.analysis

mv tooling/simulations/experiments/experiment_configs.json tooling/simulations/experiments/pending_configs.json
mv tooling/simulations/experiments/full_configs.bak.json tooling/simulations/experiments/experiment_configs.json

echo "=========================================================="
echo " Pending experiments complete! Total 138 results ready."
echo "=========================================================="
