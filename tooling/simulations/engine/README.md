# Core Simulation Engine (`simulations/simulations`)

This package contains the core logic for the simulation runner. It is designed to emulate realistic deliberation and voting behavior over time to stress test the Remix Platform's convergence mechanics.

## Architecture

* `main.py`: The entry point for parsing arguments and instantiating a specific scenario.
* `config.py`: Data structure `SimulationConfig` validating global configurations.
* `models.py`: Internal representation of users, proposals, and logs (`SimUser`, `SimSolution`, `Report`).
* `pb_client.py` / `frontend_client.py`: Handles low-level communication to the PocketBase backend and SvelteKit frontend server actions.
* `llm_client.py`: Interfaces with OpenAI-compatible inference APIs (defaulting to GitHub Models) to generate diverse and contextual content.
* `time_model.py`: Handles the simulated clock, converting discrete steps into realistic hour/day intervals.
* `snapshot.py`: Captures progress metrics and end-of-run state evaluations.
* `bootstrap.py`: Shared logic for provisioning users, groups, and question environments.
* `cleanup.py`: Utilities for selectively wiping records tied to a specific simulation run ID.

### `agents/` Directory
Contains the autonomous agent components.
* `decision_engine.py`: Defines the probabilities that decide what an agent does at any given time step (e.g., propose, merge, remix, vote).
* `content_generator.py`: Generates the actual semantic content using an LLM based on the action chosen by the decision engine. Translates intent into coherent German or English language.
* `agent_memory.py`: Tracks historical actions for context shaping.
* `activity_model.py`: Time-of-day model simulating human sleep cycles and attention decay over the course of a simulated day.

### `scenarios/` Directory
* `convergence.py`: The primary simulation loop (`ConvergenceScenario`). 
  - Takes configuration inputs.
  - Can either generate a completely new question and group from scratch OR hook into an already existing `question_id` (limiting its actions purely to `SimUser` agents so as not to pollute organic participant data).
  - Drives time forward, querying the agent engines for actions at each discrete time step until the configured duration runs out or the phase hits "Decided".

### `graph_engine/` Directory
* Utilities used downstream for analyzing the convergence shape (clustering of ideas, network topologies, merge metrics).

## Usage

You rarely execute code from within this subdirectory directly. Instead, you drive it using the scripts one level up:

```bash
cd ..
# Normal run using default convergence scenario
python run.py --agents 50 --max-steps 100

# Run into a pre-existing question (only acts as sim users)
python run.py --question-id "n8fj2nxs91kd" --agents 20
```

## Parameter and Reproducibility Notes

* **Carpentras-Ideal Parameter Set:** We include a special "Carpentras Ideal" configuration study in the experimental suite (`pool_k_foryou=50`, `fixed_sessions_mean=50`, `enable_siphon=False`, `mode="random"`). This gives simulated agents near-complete catalog visibility and independent evaluation power, stripping away the platform's bounded-attention constraints to reproduce the monotonic scaling prediction from Carpentras et al. (2025). This provides a baseline curve to contrast against the platform's real Inverted-U scaling trajectory.
* **Relative Action Probabilities:** The `p_vote`, `p_remix`, `p_merge`, and `p_create_root` parameters in the configuration are **relative weights** that are normalized at runtime into a discrete probability distribution. They are not absolute probabilities of those actions occurring independently.
* **Seed Reproducibility:** While the random number generator respects the provided seeds, reproducibility is **code-version-locked**. Any changes to the simulation engine logic (e.g. adding a new random call, rearranging the order of checks) will shift the pseudo-random sequence and change the outcome for the same seed.
