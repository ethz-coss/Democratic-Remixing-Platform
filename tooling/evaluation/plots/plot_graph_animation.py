"""Graph animation visualization.

Generates an animated MP4 (or GIF fallback) showing the evolution of the 
solution DAG over time. Nodes appear sequentially, grow as they receive votes, 
and edges draw as remixes/merges occur. A timeline track runs at the bottom.
"""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone
import math

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.animation import FuncAnimation, FFMpegWriter, PillowWriter
import matplotlib.gridspec as gridspec
import networkx as nx
import numpy as np

from tooling.evaluation.extract.pb_extractor import QuestionData, _parse_ts
from tooling.evaluation.plots.plot_metrics import _apply_dark_style, _cluster_color, _truncate, _BG_DARK, _BG_AX, _TEXT_COLOR

_DPI = 150

def animate_remix_graph(data: QuestionData, output_path: str, fps: int = 10, duration_seconds: int = 15) -> str:
    """Animate the solution DAG evolution over time and save as MP4."""
    
    # ── 1. Event Collection & Timeline Bounds ────────────────────────────
    # Collect all events (solution creation, votes)
    events = []
    
    # Solution creation events
    for sol in data.solutions:
        ts = _parse_ts(sol.occurred_at or sol.created)
        if ts > 0:
            events.append((ts, "create", sol.id, None))
            
    # Vote events
    for v in data.votes:
        ts = _parse_ts(v.occurred_at or v.created)
        if ts > 0:
            events.append((ts, "vote", v.solution, v.vote))
            
    events.sort(key=lambda x: x[0])
    
    if len(events) < 2:
        print("Not enough events to animate.")
        return ""
        
    t_start = events[0][0]
    t_end = events[-1][0]
    
    # ── 2. Build Global Graph & Static Layout ────────────────────────────
    # Use full graph to ensure layout is static and stable across frames
    G = nx.DiGraph()
    sol_by_id = {s.id: s for s in data.solutions}
    cluster_ids = sorted(set(s.cluster_id for s in data.solutions))
    
    for sol in data.solutions:
        G.add_node(sol.id)
    for sol in data.solutions:
        for pid in sol.parent_solutions:
            if pid in G:
                G.add_edge(pid, sol.id)
                
    try:
        # Custom Left-to-Right layout, grouped by clusters.
        # To handle potential cycles gracefully, we compute topological depth 
        # by building a strict DAG where edges only go forward in time.
        H_dag = nx.DiGraph()
        H_dag.add_nodes_from(G.nodes())
        for u, v in G.edges():
            t_u = _parse_ts(sol_by_id[u].occurred_at or sol_by_id[u].created) if u in sol_by_id else 0
            t_v = _parse_ts(sol_by_id[v].occurred_at or sol_by_id[v].created) if v in sol_by_id else 0
            if t_u < t_v or (t_u == t_v and u < v):
                H_dag.add_edge(u, v)

        # OVERRIDE G to only contain strictly forward edges! This eliminates all circle-backs
        G = H_dag

        # Calculate topological depth for each node (longest path from any root)
        depths = {}
        for node in nx.topological_sort(G):
            preds = list(G.predecessors(node))
            if not preds:
                depths[node] = 0
            else:
                depths[node] = max(depths[p] for p in preds) + 1

        # Group nodes by track (lineage) to visualize merges properly
        # Roots and Merge nodes start new tracks. Remixes inherit tracks.
        track_ids = {}
        for node in nx.topological_sort(G):
            preds = list(G.predecessors(node))
            if not preds:
                track_ids[node] = node
            elif len(preds) == 1:
                track_ids[node] = track_ids[preds[0]]
            else:
                track_ids[node] = node

        tracks = defaultdict(list)
        for node in G.nodes():
            tracks[track_ids[node]].append(node)
            
        def track_sort_key(tid):
            sol = sol_by_id.get(tid)
            cid = sol.cluster_id if sol else "unknown"
            
            members = [s for s in data.solutions if s.cluster_id == cid]
            champ = next((s for s in members if s.is_champion), None)
            c_title = champ.title if champ else (members[0].title if members else str(cid))
            
            return (c_title, cid, tid)
            
        sorted_tids = sorted(tracks.keys(), key=track_sort_key)
        unique_tids = list(dict.fromkeys(sorted_tids))
        
        pos = {}
        y_spacing = 80
        x_spacing = 150
        
        for i, tid in enumerate(sorted_tids):
            base_y = -i * y_spacing
            nodes_in_track = tracks[tid]
            
            # Group nodes by depth within track
            nodes_by_depth = defaultdict(list)
            for n in nodes_in_track:
                nodes_by_depth[depths[n]].append(n)
                
            for d, nodes_at_depth in nodes_by_depth.items():
                # Sort by creation time or ID for deterministic layout
                nodes_at_depth.sort(key=lambda n: (_parse_ts(sol_by_id[n].occurred_at or sol_by_id[n].created) if n in sol_by_id else 0, n))
                count = len(nodes_at_depth)
                for j, n in enumerate(nodes_at_depth):
                    # Stagger vertically if multiple nodes at same depth in SAME track
                    y_offset = (j - (count - 1) / 2.0) * 40
                    pos[n] = (d * x_spacing, base_y - y_offset)
                    
    except Exception as e:
        print(f"Custom layout failed: {e}")
        pos = nx.spring_layout(G, k=2.0, iterations=100, seed=42)

    # ── 3. Frame Generation (Time Bucketing) ─────────────────────────────
    # Target frame count
    total_frames = int(duration_seconds * fps)
    
    # To avoid empty early frames, we bucket time linearly from start to end
    time_steps = np.linspace(t_start, t_end, total_frames)
    
    # Pre-compute state at each frame
    frame_states = []
    
    active_nodes = set()
    support = defaultdict(int)
    
    event_idx = 0
    total_support_history = []
    
    for t_now in time_steps:
        # Process events up to t_now
        while event_idx < len(events) and events[event_idx][0] <= t_now:
            ts, ev_type, target_id, vote_val = events[event_idx]
            if ev_type == "create":
                active_nodes.add(target_id)
            elif ev_type == "vote":
                if vote_val > 0:
                    support[target_id] += 1
                else:
                    support[target_id] = max(0, support[target_id] - 1)
            event_idx += 1
            
        frame_states.append({
            "time": t_now,
            "nodes": set(active_nodes),
            "support": dict(support)
        })
        total_support_history.append(sum(support.values()))

    # ── 4. Set up Figure and Subplots ────────────────────────────────────
    fig = plt.figure(figsize=(16, 12), facecolor=_BG_DARK)
    gs = gridspec.GridSpec(5, 1, figure=fig, hspace=0.3)
    
    # Top Panel: Graph
    ax_graph = fig.add_subplot(gs[0:4, 0])
    _apply_dark_style(fig, ax_graph)
    ax_graph.set_axis_off()
    
    # Bottom Panel: Timeline
    ax_time = fig.add_subplot(gs[4, 0])
    _apply_dark_style(fig, ax_time)
    
    # Pre-draw static timeline curve
    time_dates = [datetime.fromtimestamp(t, tz=timezone.utc) for t in time_steps]
    ax_time.plot(time_dates, total_support_history, color="#2196f3", linewidth=2, alpha=0.8)
    ax_time.fill_between(time_dates, total_support_history, color="#2196f3", alpha=0.2)
    ax_time.set_ylabel("Total Support", color=_TEXT_COLOR, fontsize=10)
    ax_time.tick_params(axis='x', colors=_TEXT_COLOR, labelsize=9)
    ax_time.tick_params(axis='y', colors=_TEXT_COLOR, labelsize=9)
    
    # Add timeline playhead (vertical line)
    playhead = ax_time.axvline(time_dates[0], color="#ff9800", linewidth=2, linestyle="--")
    
    # Fixed bounds for graph axes to prevent jitter
    if pos:
        xs, ys = zip(*pos.values())
        pad_x = (max(xs) - min(xs)) * 0.1 if max(xs) > min(xs) else 10
        pad_y = (max(ys) - min(ys)) * 0.1 if max(ys) > min(ys) else 10
        ax_graph.set_xlim(min(xs) - pad_x, max(xs) + pad_x)
        ax_graph.set_ylim(min(ys) - pad_y, max(ys) + pad_y)

    # Date text label
    date_text = ax_graph.text(0.02, 0.95, "", transform=ax_graph.transAxes, 
                              color="white", fontsize=14, fontweight="bold",
                              bbox=dict(facecolor=_BG_AX, alpha=0.7, edgecolor='none'))

    # Build Legend
    legend_handles = []
    for tid in unique_tids[:10]:
        color = _cluster_color(tid, unique_tids)
        sol = sol_by_id.get(tid)
        label = _truncate(sol.title, 20) if sol else f"Track {tid[:8]}"
        legend_handles.append(mpatches.Patch(color=color, label=label))
    
    ax_graph.legend(handles=legend_handles, loc="upper right", fontsize=8,
                    facecolor=_BG_DARK, edgecolor="#444466", labelcolor=_TEXT_COLOR)

    ax_graph.set_title("Solution Space Evolution", color=_TEXT_COLOR, fontsize=16, fontweight="bold", pad=15)

    # ── 5. Animation Update Function ─────────────────────────────────────
    
    def update(frame_idx):
        ax_graph.clear()
        
        # Restore basic graph axes settings after clear
        ax_graph.set_axis_off()
        if pos:
            ax_graph.set_xlim(min(xs) - pad_x, max(xs) + pad_x)
            ax_graph.set_ylim(min(ys) - pad_y, max(ys) + pad_y)
        ax_graph.set_title("Solution Space Evolution", color=_TEXT_COLOR, fontsize=16, fontweight="bold", pad=15)
        ax_graph.legend(handles=legend_handles, loc="upper right", fontsize=8, facecolor=_BG_DARK, edgecolor="#444466", labelcolor=_TEXT_COLOR)

        state = frame_states[frame_idx]
        current_nodes = state["nodes"]
        current_support = state["support"]
        
        # Subgraph of currently active nodes
        H = G.subgraph(current_nodes)
        
        if len(H.nodes()) > 0:
            node_colors = []
            node_sizes = []
            node_edgecolors = []
            node_linewidths = []
            labels = {}
            
            for nid in H.nodes():
                sol = sol_by_id.get(nid)
                if sol:
                    # Color by track_id
                    tid = track_ids[nid]
                    color = _cluster_color(tid, unique_tids)
                    node_colors.append(color)
                    # Size based on current support at this frame
                    sup = current_support.get(nid, 0)
                    size = max(80, 80 + sup * 30)
                    node_sizes.append(min(size, 1200))
                    
                    # Highlight if champion in final data
                    node_edgecolors.append("gold" if sol.is_champion else "white")
                    node_linewidths.append(1.5 if sol.is_champion else 0.5)
                    labels[nid] = _truncate(sol.title, 15)
                else:
                    node_colors.append((0.5, 0.5, 0.5, 1.0))
                    node_sizes.append(80)
                    node_edgecolors.append("white")
                    node_linewidths.append(0.5)
                    labels[nid] = nid[:8]
                    
            # Edges
            remix_edges = []
            merge_edges = []
            for u, v in H.edges():
                if len(sol_by_id[v].parent_solutions) >= 2:
                    merge_edges.append((u, v))
                else:
                    remix_edges.append((u, v))
                    
            nx.draw_networkx_edges(H, pos, edgelist=remix_edges, ax=ax_graph,
                                   edge_color="#7788aa", alpha=0.6, width=1.0,
                                   arrows=True, arrowsize=8, arrowstyle="-|>", connectionstyle="arc3,rad=0.08")
                                   
            nx.draw_networkx_edges(H, pos, edgelist=merge_edges, ax=ax_graph,
                                   edge_color="#ff9800", alpha=0.7, width=1.5, style="dashed",
                                   arrows=True, arrowsize=10, arrowstyle="-|>", connectionstyle="arc3,rad=0.3")
                                   
            nx.draw_networkx_nodes(H, pos, ax=ax_graph,
                                   node_color=node_colors, node_size=node_sizes,
                                   edgecolors=node_edgecolors, linewidths=node_linewidths,
                                   alpha=0.9)
                                   
            nx.draw_networkx_labels(H, pos, labels=labels, ax=ax_graph,
                                    font_size=6, font_color=_TEXT_COLOR)

        # Update text date
        current_dt = datetime.fromtimestamp(state["time"], tz=timezone.utc)
        date_str = current_dt.strftime("%Y-%m-%d %H:%M")
        
        # We re-add text because we cleared ax_graph
        ax_graph.text(0.02, 0.95, f"Time: {date_str}", transform=ax_graph.transAxes, 
                      color="white", fontsize=14, fontweight="bold",
                      bbox=dict(facecolor=_BG_AX, alpha=0.7, edgecolor='none'))
                      
        # Update playhead
        playhead.set_xdata([time_dates[frame_idx]])

    # ── 6. Save Animation ────────────────────────────────────────────────
    anim = FuncAnimation(fig, update, frames=total_frames, interval=1000/fps, repeat=False)
    
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    # Check if FFMpeg is available
    if FFMpegWriter.isAvailable():
        final_path = output_path
        if not final_path.endswith('.mp4'):
            final_path = os.path.splitext(final_path)[0] + '.mp4'
        writer = FFMpegWriter(fps=fps, metadata=dict(artist='Remix Platform Simulation'), bitrate=1800)
        anim.save(final_path, writer=writer, dpi=_DPI, savefig_kwargs={'facecolor': _BG_DARK})
    else:
        # Fallback to GIF
        final_path = output_path
        if not final_path.endswith('.gif'):
            final_path = os.path.splitext(final_path)[0] + '.gif'
        writer = PillowWriter(fps=fps)
        anim.save(final_path, writer=writer, dpi=_DPI, savefig_kwargs={'facecolor': _BG_DARK})
        
    plt.close(fig)
    return os.path.abspath(final_path)
