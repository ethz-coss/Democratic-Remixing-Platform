# Thesis Paper

> **Remixing for Democratic Collective Intelligence: Design and Implementation of a Scalable Platform**
>
> Yanick Bachmann · ETH Zürich · Master's Thesis, Computational Social Science

## Abstract

Scaling collective decision-making beyond small groups without concentrating authority remains an open challenge. This thesis designs, implements, and evaluates the Democratic Remixing Platform (DRP), which translates the remixing-based collective intelligence model of Carpentras et al. into a working deliberation tool. Participants iteratively build upon each other’s proposals in a directed acyclic graph, with attention managed by a Three-Window Architecture. Three field deployments (n = 7, 11, 12) combined with agent-based simulation at scales up to N = 400 generate design knowledge and knowledge about how human behavior departs from the model’s assumptions.
The platform manages to keep selection efficiency high, but the generative process is constrained by bounded cognition and social norms: social inhibition of remixing suppressed convergence entirely in one deployment. Although bottlenecked by the cognitive friction of communication via the system, the DAG architecture provides the structural foundation to scale democratic collective intelligence

## Citation

```bibtex
@mastersthesis{bachmann2026remix,
  author  = {Bachmann, Yanick},
  title   = {Remixing for Democratic Collective Intelligence: Design and Implementation of a Scalable Platform},
  school  = {ETH Z\"{u}rich},
  year    = {2026},
  type    = {Master's Thesis},
  note    = {Department of Humanities, Social and Political Sciences}
}
```

## Files

| File | Description |
|---|---|
| `thesis.pdf` | Final compiled thesis (add when ready) |

The full LaTeX source, figures, and bibliography used to build the thesis are maintained in a separate directory outside this repository.

## Relationship to this Repository

This thesis describes the design, implementation, and empirical evaluation of the Remix Platform. The repository contains:

- **`frontend/` + `backend/`** — The platform implementation (Chapters 2–3)
- **`tooling/simulations/`** — The multi-agent simulation engine (Chapter 5, simulation results)
- **`tooling/evaluation/`** — The evaluation pipeline and analysis notebooks (Chapters 4–5)
- **`experiment_data/`** — All raw data from human trials and simulations (Chapter 5)
