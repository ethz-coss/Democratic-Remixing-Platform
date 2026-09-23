"""Quality model following Carpentras et al. 2025.

Provides both standalone assignment functions (for online simulation) and DAG-based 
assignment functions (for post-hoc evaluation).
"""

import random
from typing import Any

def assign_root_quality(rng: random.Random) -> float:
    """Root proposals: q(s) = |N(0, 1)| — Carpentras Eq. 1"""
    return abs(rng.gauss(0, 1))

def assign_remix_quality(rng: random.Random, parent_q: float, sigma_remix: float = 0.5) -> float:
    """Remixes: q(s_k) = max(0, q(s_{k-1}) + Δ), Δ ~ N(0, 0.5)"""
    delta = rng.gauss(0, sigma_remix)
    return max(0, parent_q + delta)

def assign_merge_quality(rng: random.Random, parent_qs: list[float], sigma_merge: float = 0.3) -> float:
    """Merges: q(s_k) = max(parent_qualities) + |N(0, 0.3)|"""
    base = max(parent_qs) if parent_qs else 0
    return base + abs(rng.gauss(0, sigma_merge))

def topo_sort(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Topologically sort proposals so parents come before children."""
    adj = {}
    in_degree = {}
    id_to_p = {p["id"]: p for p in proposals}
    
    for p in proposals:
        pid = p["id"]
        adj.setdefault(pid, [])
        in_degree.setdefault(pid, 0)
        
        for parent_id in p.get("parent_proposals", []):
            if parent_id in id_to_p:
                adj.setdefault(parent_id, []).append(pid)
                in_degree[pid] = in_degree.get(pid, 0) + 1
                
    queue = [pid for pid in in_degree if in_degree[pid] == 0]
    sorted_ids = []
    
    while queue:
        curr = queue.pop(0)
        sorted_ids.append(curr)
        for neighbor in adj.get(curr, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)
                
    result = [id_to_p[pid] for pid in sorted_ids if pid in id_to_p]
    
    if len(result) < len(proposals):
        missing = [p for p in proposals if p["id"] not in sorted_ids]
        result.extend(missing)
        
    return result

def assign_dag_quality(proposals: list[dict[str, Any]], seed: int, sigma_remix: float = 0.5, sigma_merge: float = 0.3) -> dict[str, float]:
    """Assign latent quality scores to a DAG of proposals."""
    rng = random.Random(seed)
    quality = {}
    
    for p in topo_sort(proposals):
        parents = p.get('parent_proposals', [])
        
        if not parents:
            quality[p['id']] = assign_root_quality(rng)
        elif len(parents) == 1:
            parent_q = quality.get(parents[0], 0)
            quality[p['id']] = assign_remix_quality(rng, parent_q, sigma_remix)
        else:
            parent_qs = [quality[pid] for pid in parents if pid in quality]
            quality[p['id']] = assign_merge_quality(rng, parent_qs, sigma_merge)
            
    return quality
