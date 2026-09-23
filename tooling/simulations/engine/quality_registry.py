"""Proposal quality registry following Carpentras 2025.

Quality is assigned at creation time and tracked throughout the simulation.
Agents perceive quality with per-agent noise (modelling diverse preferences).
"""

import random
from dataclasses import dataclass, field
from tooling.simulations.engine.quality_model import assign_root_quality, assign_remix_quality, assign_merge_quality

@dataclass 
class QualityRegistry:
    """Tracks objective quality of all proposals in a simulation."""
    rng: random.Random
    qualities: dict[str, float] = field(default_factory=dict)  # proposal_id → q(s)
    
    def assign_root_quality(self, proposal_id: str) -> float:
        q = assign_root_quality(self.rng)
        self.qualities[proposal_id] = q
        return q
    
    def assign_remix_quality(self, proposal_id: str, parent_id: str) -> float:
        parent_q = self.qualities.get(parent_id, 0)
        q = assign_remix_quality(self.rng, parent_q)
        self.qualities[proposal_id] = q
        return q
    
    def assign_merge_quality(self, proposal_id: str, parent_ids: list[str]) -> float:
        parent_qs = [self.qualities.get(pid, 0) for pid in parent_ids]
        q = assign_merge_quality(self.rng, parent_qs)
        self.qualities[proposal_id] = q
        return q
    
    def get_quality(self, proposal_id: str) -> float:
        return self.qualities.get(proposal_id, 0.0)
    
    def max_quality(self) -> float:
        return max(self.qualities.values()) if self.qualities else 0.0
    
    def to_dict(self) -> dict[str, float]:
        return dict(self.qualities)
