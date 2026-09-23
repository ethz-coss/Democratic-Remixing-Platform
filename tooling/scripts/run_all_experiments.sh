#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/../.."

echo "=========================================================="
echo " Starting Full Experiment Suite (123 Runs)"
echo "=========================================================="

echo "[1/5] Cleaning up old output files (preventing contamination)..."
rm -f tooling/output/experiments/experiment_*.json
echo "  ✓ Output files deleted."

echo "[2/5] Cleaning up PocketBase simulation data..."
python3 -m tooling.setup.cli cleanup
echo "  ✓ PocketBase data cleaned."

echo "[3/5] Generating Experiment Configurations..."
python3 -m tooling.simulations.experiments.config_generator
echo "  ✓ Configurations regenerated (Study 1 is scheduled last)."

# Run the simulations
# Note: 200 agent scaling runs can take 30+ minutes. 
# We use 2 workers to balance speed vs PocketBase SQLite lock contention.
echo "[4/5] Running Simulations (This will take ~8.3 hours)..."
python3 -m tooling.simulations.experiments.runner --workers 2

# Collect Metrics
echo "[5/5] Collecting Simulation Metrics & Generating Figures..."
python3 -m tooling.simulations.experiments.collector
python3 -m tooling.simulations.experiments.analysis

echo "=========================================================="
echo " All experiments complete! Figures saved to:"
echo " tooling/output/experiments/figures/"
echo "=========================================================="

