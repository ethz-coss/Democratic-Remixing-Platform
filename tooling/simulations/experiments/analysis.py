import pandas as pd
import matplotlib.pyplot as plt
import numpy as np
import os
import json
import statistics
import glob
import re
from datetime import datetime
from pathlib import Path
import seaborn as sns
import scipy.stats as st
from matplotlib.patches import Rectangle

try:
    from tooling._paths import EXPERIMENTS_OUTPUT, SIM_EXPERIMENTS_DATA, HUMAN_STUDIES_DATA, DATA_ROOT
except ImportError:
    _proj = Path(__file__).resolve().parent.parent.parent.parent
    EXPERIMENTS_OUTPUT = str(_proj / "tooling" / "output" / "experiments")
    SIM_EXPERIMENTS_DATA = str(_proj / "experiment_data" / "simulation_experiments")
    HUMAN_STUDIES_DATA = str(_proj / "experiment_data" / "human_studies")
    DATA_ROOT = str(_proj / "experiment_data")

OUT_DIR = EXPERIMENTS_OUTPUT
FIG_DIR = os.path.join(OUT_DIR, "figures")
os.makedirs(FIG_DIR, exist_ok=True)

# Thesis plot styling
sns.set_theme(style="whitegrid", context="paper", font_scale=1.2)
plt.rcParams.update({
    'font.family': 'serif',
    'axes.titlesize': 12,
    'axes.labelsize': 11,
    'legend.fontsize': 10,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'figure.dpi': 300,
})

def _save_fig(fig, name: str):
    fig.savefig(os.path.join(FIG_DIR, f"{name}.png"), dpi=300, bbox_inches='tight')
    fig.savefig(os.path.join(FIG_DIR, f"{name}.pdf"), bbox_inches='tight')
    print(f"Saved {name}")
    plt.close(fig)

def find_run_json_path(run_id: str) -> str | None:
    path1 = os.path.join(EXPERIMENTS_OUTPUT, f"experiment_{run_id}.json")
    if os.path.exists(path1):
        return path1
    path2 = os.path.join(SIM_EXPERIMENTS_DATA, f"experiment_{run_id}.json")
    if os.path.exists(path2):
        return path2
    return None

def find_run_files(pattern: str) -> list[str]:
    files = set(glob.glob(os.path.join(EXPERIMENTS_OUTPUT, pattern)))
    files.update(glob.glob(os.path.join(SIM_EXPERIMENTS_DATA, pattern)))
    return sorted(files)

def load_run_data(run_id):
    path = find_run_json_path(run_id)
    if not path: return None
    with open(path, "r") as f: return json.load(f)

def load_run_quality(run_id):
    data = load_run_data(run_id)
    if not data: return None, None
    return data.get("quality_registry"), data.get("evaluation_snapshot", {}).get("proposals", [])

def get_ci(data, confidence=0.95):
    a = np.array(data)
    a = a[~np.isnan(a)]
    n = len(a)
    m = np.mean(a) if n > 0 else 0
    if n < 2:
        return m, m, m
    se = st.sem(a)
    if se == 0:
        return m, m, m
    h = se * st.t.ppf((1 + confidence) / 2., n-1)
    return m, m-h, m+h

# ── Cross-cutting helpers ─────────────────────────────────────────────────
def _plot_with_errorbars(ax, positions, means, lows, highs, raw_values,
                         color, label, marker='o', linestyle='-', linewidth=1.8,
                         offset=0.0):
    """Plot mean line with individual seed dots — honest for n=3.
    
    No CI whiskers: with 3 seeds, the t-multiplier is 4.3 and CIs
    are meaninglessly wide. Individual dots show actual data.
    """
    pos = [p + offset for p in positions]
    # Mean line
    ax.plot(pos, means, marker=marker, color=color, label=label,
            linewidth=linewidth, markersize=7, linestyle=linestyle, zorder=3)
    # Individual seed dots
    for i, vals in enumerate(raw_values):
        ax.scatter([pos[i]] * len(vals), vals, color=color, alpha=0.4,
                   s=22, edgecolors='white', linewidth=0.5, zorder=2)

def _setup_categorical_x(ax, ns, xlabel="Population Size ($N$)"):
    """Set up evenly-spaced categorical x-axis for population size values."""
    positions = list(range(len(ns)))
    ax.set_xticks(positions)
    ax.set_xticklabels([str(n) for n in ns])
    ax.set_xlabel(xlabel)
    return positions

# 1. Agenda Control Proof
def plot_cross_regime_scaling(df: pd.DataFrame):
    # Main regimes from scaling_frontier study
    regimes = [
        ("scaling_frontier", "standard_pf", "Standard PF", '#2ecc71', 'o', '-', 0),
        ("scaling_frontier", "random_feed", "Random Feed", '#3498db', 's', '--', 0),
        ("scaling_frontier", "newest_feed", "Newest Feed", '#e74c3c', 'D', ':', 0),
    ]
    # Baseline regimes from separate studies
    baselines = []

    
    # Use standard PF N values as the x-axis reference
    std = df[(df["study_id"] == "scaling_frontier") & (df["config_id"].str.startswith("standard_pf"))].copy()
    if std.empty: return
    std["N"] = std["config_id"].str.extract(r'n(\d+)').astype(int)
    ns_std = sorted(std["N"].unique())
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))
    ax1.set_xscale('log')
    ax2.set_xscale('log')
    ax1.set_xticks(ns_std)
    ax2.set_xticks(ns_std)
    
    import matplotlib.ticker as ticker
    formatter = ticker.ScalarFormatter()
    formatter.set_scientific(False)
    ax1.xaxis.set_major_formatter(formatter)
    ax2.xaxis.set_major_formatter(formatter)
    
    ax1.set_xlabel("Population Size ($N$) [log scale]")
    ax2.set_xlabel("Population Size ($N$) [log scale]")
    
    all_regimes = regimes + baselines
    
    for study_id, config_prefix, label, color, marker, ls, _ in all_regimes:
        subset = df[(df["study_id"] == study_id) & 
                    (df["config_id"].str.startswith(config_prefix))].copy()
        if subset.empty: continue
        subset["N"] = subset["config_id"].str.extract(r'n(\d+)').astype(int)
        ns = sorted(subset["N"].unique())
        pos = [n for n in ns if n in ns_std]
        
        # Panel A — Selection Efficiency
        eta_means, eta_lows, eta_highs, eta_raw = [], [], [], []
        for n in ns:
            if n not in ns_std: continue
            vals = subset[subset["N"] == n]["top_1_selection_efficiency"].dropna().values
            m, low, high = get_ci(vals)
            eta_means.append(m)
            eta_lows.append(max(0, low))
            eta_highs.append(min(1, high))
            eta_raw.append(vals)
            
        _plot_with_errorbars(ax1, pos, eta_means, eta_lows, eta_highs, eta_raw,
                             color, label, marker=marker, linestyle=ls, offset=0)
        
        # Panel B — Absolute Quality (no ceiling lines)
        q_means, q_lows, q_highs, q_raw = [], [], [], []
        for n in ns:
            if n not in ns_std: continue
            runs = subset[subset["N"] == n]
            vals = runs["top_1_mean_quality"].dropna().values
            m, low, high = get_ci(vals)
            q_means.append(m); q_lows.append(max(0, low)); q_highs.append(high)
            q_raw.append(vals)
            
        _plot_with_errorbars(ax2, pos, q_means, q_lows, q_highs, q_raw,
                             color, label, marker=marker, linestyle=ls, offset=0)

    
    ax1.set_ylim(0, 1.05)
    ax1.set_ylabel(r"Selection Efficiency ($\eta_{\mathrm{top1}}$)")
    ax1.set_title("(a) Selection Efficiency vs Scale")
    ax1.legend(fontsize=8, loc='lower left')
    ax1.grid(True, alpha=0.3)
    
    ax2.set_ylim(bottom=0)
    ax2.set_ylabel(r"Absolute Quality ($q_{\mathrm{top1}}$)")
    ax2.set_title("(b) Absolute Quality vs Scale")
    ax2.legend(fontsize=8, loc='upper left')
    ax2.grid(True, alpha=0.3)
    
    fig.tight_layout()
    _save_fig(fig, "plot_1_agenda_control_scaling")

# 2. Overcoming Attention Entrenchment
def plot_siphon_ablation(df: pd.DataFrame):
    palette = {"Siphon ON": "#2ecc71", "Siphon OFF": "#e74c3c"}
    
    data_records = []
    for cond_label, cond_prefix in [("Siphon ON", "siphon_on"), ("Siphon OFF", "siphon_off")]:
        for n in [50, 100]:
            cid = f"{cond_prefix}_n{n}"
            subset = df[(df["study_id"] == "siphon_ablation") & (df["config_id"] == cid)]
            for _, row in subset.iterrows():
                data_records.append({
                    "Condition": cond_label,
                    "N": n,
                    "Efficiency": row["top_1_selection_efficiency"],
                    "Quality": row["top_1_mean_quality"],
                    "Gini": row["subscription_gini"],
                })
    
    df_plot = pd.DataFrame(data_records)
    if df_plot.empty:
        fig, ax = plt.subplots()
        ax.text(0.5, 0.5, 'Simulation runs pending...', ha='center', va='center')
        _save_fig(fig, "plot_2_siphon_ablation")
        return
    
    fig, axes = plt.subplots(2, 2, figsize=(11, 8))
    
    metrics = [
        ("Efficiency", r"Selection Efficiency ($\eta_{\mathrm{top1}}$)", (-0.05, 1.05)),
        ("Quality", r"Absolute Quality ($q_{\mathrm{top1}}$)", None),
    ]
    
    for row_idx, (metric, ylabel, ylim) in enumerate(metrics):
        for col_idx, n in enumerate([50, 100]):
            ax = axes[row_idx, col_idx]
            sub = df_plot[df_plot["N"] == n]
            if sub.empty: continue
            
            sns.boxplot(data=sub, x="Condition", y=metric, hue="Condition", ax=ax, palette=palette,
                       boxprops=dict(alpha=0.5), showfliers=False, width=0.5, legend=False)
            sns.stripplot(data=sub, x="Condition", y=metric, ax=ax,
                         color="black", alpha=0.6, jitter=True, size=7)
            
            ax.set_ylabel(ylabel if col_idx == 0 else "")
            if ylim: ax.set_ylim(*ylim)
            ax.set_xlabel("")
            
            # Panel labels
            panel_label = chr(ord('a') + row_idx * 2 + col_idx)
            metric_short = "η" if metric == "Efficiency" else "q"
            ax.set_title(f"({panel_label}) {metric_short} at N={n}", fontweight='bold')
            
            # Annotate delta
            on_vals = sub[sub["Condition"] == "Siphon ON"][metric].to_numpy(dtype=float)
            off_vals = sub[sub["Condition"] == "Siphon OFF"][metric].to_numpy(dtype=float)
            if len(on_vals) > 0 and len(off_vals) > 0:
                delta = float(np.mean(on_vals) - np.mean(off_vals))
                sign = "+" if delta > 0 else ""
                color = "#27ae60" if delta > 0 else "#c0392b"
                ax.annotate(f"Δ = {sign}{delta:.3f}" if metric == "Efficiency" else f"Δ = {sign}{delta:.2f}",
                           xy=(0.5, 0.03), xycoords='axes fraction', ha='center',
                           fontsize=10, fontweight='bold', color=color)
            
            # Show Gini as secondary annotation
            for i, cond in enumerate(["Siphon ON", "Siphon OFF"]):
                g = sub[sub["Condition"] == cond]["Gini"].to_numpy(dtype=float)
                if len(g) > 0:
                    ax.text(i, ax.get_ylim()[0] + 0.02 * (ax.get_ylim()[1] - ax.get_ylim()[0]),
                           f"Gini={float(np.mean(g)):.3f}", ha='center', va='bottom', fontsize=8, color='gray')
            
            ax.grid(axis='y', alpha=0.3)
    
    fig.text(0.5, -0.02,
             "Siphon ablation tested at N=50 and N=100. Scaling frontier data (Siphon ON)\n"
             "shows Standard PF maintains η > 0.7 at N=200–400, consistent with increasing benefit.",
             ha='center', fontsize=8, fontstyle='italic', color='gray')
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    _save_fig(fig, "plot_2_siphon_ablation")

# 3. Protecting Dissent
def plot_three_window_tradeoff(df: pd.DataFrame):
    configs = [
        ("Full Platform", "full_platform", "#2ecc71"),
        ("No Ballot Div", "no_ballot_diversity", "#3498db"),
        ("Random Feed", "no_feed_routing", "#f39c12"),
        ("Neither", "neither", "#e74c3c"),
    ]
    n_markers = {50: 'o', 100: 's'}
    
    data_records = []
    for lbl, prefix, color in configs:
        for n_val, mkr in n_markers.items():
            cid = f"{prefix}_n{n_val}"
            subset = df[(df["study_id"] == "three_window") & (df["config_id"] == cid)]
            for _, row in subset.iterrows():
                data_records.append({
                    "Condition": lbl, "N": n_val,
                    "Color": color, "Marker": mkr,
                    "Diversity": row["ballot_label_diversity"],
                    "Efficiency": row["top_1_selection_efficiency"],
                    "Quality": row["top_1_mean_quality"],
                    "Ballot Size": row["ballot_size"],
                })
            
    df_plot = pd.DataFrame(data_records)
    if df_plot.empty:
        fig, ax = plt.subplots()
        ax.text(0.5, 0.5, 'Simulation runs pending...', ha='center', va='center')
        _save_fig(fig, "plot_3_three_window_tradeoff")
        return
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    
    # Panel (a): Quality-Diversity scatter — both N=50 and N=100
    plotted_labels = set()
    for lbl, prefix, color in configs:
        for n_val, mkr in n_markers.items():
            sub = df_plot[(df_plot["Condition"] == lbl) & (df_plot["N"] == n_val)]
            if sub.empty: continue
            # Only add label once per condition
            label = lbl if lbl not in plotted_labels else None
            if label: plotted_labels.add(lbl)
            ax1.scatter(sub["Diversity"], sub["Efficiency"], color=color, marker=mkr,
                       s=80, label=label, edgecolors='white', linewidth=0.8, zorder=3,
                       alpha=0.9 if n_val == 50 else 0.6)
    
    # Add N legend
    import matplotlib.lines as mlines
    n50_handle = mlines.Line2D([], [], color='gray', marker='o', linestyle='None', markersize=7, label='N=50')
    n100_handle = mlines.Line2D([], [], color='gray', marker='s', linestyle='None', markersize=7, label='N=100')
    
    ax1.set_xlabel("Ballot Label Diversity")
    ax1.set_ylabel(r"Selection Efficiency ($\eta_{\mathrm{top1}}$)")
    ax1.set_title("(a) Quality–Diversity Trade-off", fontweight='bold')
    ax1.set_ylim(-0.05, 1.05)
    ax1.set_xlim(0, 8)
    handles1, labels1 = ax1.get_legend_handles_labels()
    ax1.legend(handles=handles1 + [n50_handle, n100_handle], fontsize=7, loc='lower left', ncol=2)
    ax1.grid(True, alpha=0.3)
    
    # Panel (b): Ballot size bars — averaged across N=50 seeds
    conditions = [lbl for lbl, _, _ in configs]
    bar_colors = [c for _, _, c in configs]
    x_pos = np.arange(len(conditions))
    
    ballot_means = []
    eta_means = []
    for lbl, _, _ in configs:
        sub = df_plot[(df_plot["Condition"] == lbl) & (df_plot["N"] == 50)]
        ballot_means.append(sub["Ballot Size"].mean() if not sub.empty else 0)
        eta_means.append(sub["Efficiency"].mean() if not sub.empty else 0)
    
    bars = ax2.bar(x_pos, ballot_means, color=bar_colors, alpha=0.75, width=0.6)
    
    # Annotate with η values above bars
    for i, (bm, em) in enumerate(zip(ballot_means, eta_means)):
        ax2.text(i, bm + 0.2, f"η={em:.2f}", ha='center', va='bottom', fontsize=9, fontweight='bold')
    
    ax2.set_xticks(x_pos)
    ax2.set_xticklabels(conditions, fontsize=9)
    ax2.set_ylabel("Mean Ballot Size (Proposals)")
    ax2.set_title("(b) Ballot Size (N=50, annotated: η)", fontweight='bold')
    ax2.set_ylim(0, 9)
    ax2.axhline(7, linestyle=':', color='gray', linewidth=1, alpha=0.6)
    ax2.grid(axis='y', alpha=0.3)
    
    fig.tight_layout()
    _save_fig(fig, "plot_3_three_window_tradeoff")

# 4. Material Reality of Deliberation (Absolute volume)
def plot_action_dynamics(df: pd.DataFrame):
    # Find largest available N in standard_pf
    subset = df[(df["study_id"] == "scaling_frontier") & (df["config_id"] == "standard_pf_n50")]
    if subset.empty:
        subset = df[(df["study_id"] == "scaling_frontier") & (df["config_id"] == "standard_pf_n25")]
    if subset.empty:
        subset = df[(df["study_id"] == "scaling_frontier") & (df["config_id"] == "standard_pf_n10")]
    if subset.empty: return

    action_keys = ["create_root", "create_remix", "create_merge", "vote_support", "vote_migrate"]
    colors = {
        "create_root": "#2ecc71", "create_remix": "#3498db", "create_merge": "#9b59b6",
        "vote_support": "#f1c40f", "vote_migrate": "#e67e22"
    }
    labels = {
        "create_root": "Propose Root", "create_remix": "Remix (Edit)", "create_merge": "Remix (Merge)",
        "vote_support": "Support (Subscribe)", "vote_migrate": "Migrate Support (Siphon)"
    }

    # ── Panel (a): Simulated agents ────────────────────────────────
    bins = 30
    duration_days = 30
    bin_size = (duration_days * 86400) / bins
    run_binned_data = []

    for _, row in subset.iterrows():
        data = load_run_data(row["run_id"])
        if not data: continue
        events = data.get("decision_log", [])
        time_evs = sorted(data.get("time_events", []), key=lambda x: x["simulated_at"])
        if not events or not time_evs: continue

        def parse_time(ts): return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        start_time = parse_time(time_evs[0]["simulated_at"])

        binned = {k: np.zeros(bins) for k in action_keys}
        for ev in events:
            action = ev["action"]
            if action not in binned: continue
            if "simulated_at" not in ev: continue
            t = (parse_time(ev["simulated_at"]) - start_time).total_seconds()
            idx = int(t / bin_size)
            if idx >= bins: idx = bins - 1
            if idx < 0: idx = 0
            binned[action][idx] += 1
        run_binned_data.append(binned)

    mean_binned = {k: np.zeros(bins) for k in action_keys}
    if run_binned_data:
        for k in action_keys:
            matrix = np.vstack([r[k] for r in run_binned_data])
            mean_binned[k] = np.mean(matrix, axis=0)

    total_matrices = np.vstack([np.sum(list(r.values()), axis=0) for r in run_binned_data]) if run_binned_data else np.zeros((1, bins))
    total_mean = np.mean(total_matrices, axis=0)
    total_std = np.std(total_matrices, axis=0)

    # ── Panel (b) & (c): Real human study action logs ──────────────
    HUMAN_ACTION_MAP = {
        "create_idea":    "create_root",
        "remix_singular": "create_remix",
        "remix_combine":  "create_merge",
        "subscribe":      "vote_support",
    }

    def load_human_study(csv_path: str, study_label: str) -> dict:
        """Load action_logs.csv, bin evaluative actions by day, detect manual migrations."""
        try:
            adf = pd.read_csv(csv_path, parse_dates=["created"])
        except Exception:
            return {}
        if adf.empty: return {}
        adf = adf.sort_values("created")
        start = adf["created"].min()
        total_days = max(1, (adf["created"].max() - start).days + 1)
        n_bins = total_days
        binned = {k: np.zeros(n_bins) for k in action_keys}
        
        for _, row in adf.iterrows():
            atype = str(row.get("action_type", "")).lower()
            mapped = HUMAN_ACTION_MAP.get(atype)
            if mapped is None: continue
            day_idx = (pd.Timestamp(row["created"]) - start).days
            if day_idx < 0: day_idx = 0
            if day_idx >= n_bins: day_idx = n_bins - 1
            binned[mapped][day_idx] += 1
        
        # Detect manual migrations: unsubscribe→subscribe to DIFFERENT target
        sv = adf[adf["action_type"].isin(["subscribe", "unsubscribe"])].sort_values(["user", "created"]).copy()
        if not sv.empty:
            sv["next_action"] = sv.groupby("user")["action_type"].shift(-1)
            sv["next_target"] = sv.groupby("user")["target_id"].shift(-1)
            sv["next_time"] = sv.groupby("user")["created"].shift(-1)
            migrations = sv[
                (sv["action_type"] == "unsubscribe") & 
                (sv["next_action"] == "subscribe") &
                (sv["target_id"] != sv["next_target"])
            ]
            for _, mig in migrations.iterrows():
                day_idx = (pd.Timestamp(mig["next_time"]) - start).days
                if day_idx < 0: day_idx = 0
                if day_idx >= n_bins: day_idx = n_bins - 1
                binned["vote_migrate"][day_idx] += 1
        
        return {"binned": binned, "n_bins": n_bins, "total_days": total_days, "label": study_label}

    base = Path(HUMAN_STUDIES_DATA)

    study1 = load_human_study(str(base / "wg_studiengruppe" / "action_logs.csv"), "Study 1")
    study2 = load_human_study(str(base / "wg_netz_winterthur" / "action_logs.csv"), "Study 2")

    # ── Layout: 3 rows, 1 column — stacked vertically ─────────────
    n_panels = 1 + (1 if study1 else 0) + (1 if study2 else 0)
    fig, axes = plt.subplots(n_panels, 1, figsize=(12, 4 * n_panels))
    if n_panels == 1:
        axes = [axes]

    # Panel (a): Simulated agents — 100% proportional stacked bars
    ax1 = axes[0]
    x = np.arange(bins) + 1
    if run_binned_data:
        y = np.vstack([mean_binned[k] for k in action_keys])
        totals = y.sum(axis=0)
        totals[totals == 0] = 1
        y_pct = y / totals
        bottom = np.zeros(bins)
        for ki, k in enumerate(action_keys):
            vals_pct = y_pct[ki]
            if np.any(mean_binned[k] > 0):
                ax1.bar(x, vals_pct, bottom=bottom, color=colors[k], alpha=0.8,
                        label=labels[k], width=0.8)
                bottom += vals_pct
    ax1.set_ylabel("Action Proportion")
    ax1.set_ylim(0, 1)
    ax1.set_xlabel("Deliberation Timeline (Days)")
    ax1.set_xlim(0, 31)
    ax1.legend(loc="upper right", fontsize=8)
    n_runs = len(run_binned_data)
    ax1.set_title(f"(a) Simulated Agents — Standard PF, N=50 (n={n_runs} seeds)", fontsize=11, fontweight="bold")
    ax1.grid(True, alpha=0.3, axis="y")

    # Human panels — also proportional stacked bars, matching sim panel
    panel_labels = ["(b)", "(c)"]
    for pi, study in enumerate([s for s in [study1, study2] if s]):
        ax = axes[1 + pi]
        nb = study["n_bins"]
        xh = np.arange(nb) + 1
        y_human = np.vstack([study["binned"][k] for k in action_keys])
        totals_h = y_human.sum(axis=0)
        totals_h[totals_h == 0] = 1
        y_h_pct = y_human / totals_h
        bottom = np.zeros(nb)
        for ki, k in enumerate(action_keys):
            vals_pct = y_h_pct[ki]
            if np.any(study["binned"][k] > 0):
                ax.bar(xh, vals_pct, bottom=bottom, color=colors[k], alpha=0.8,
                       label=labels[k], width=0.8)
                bottom += vals_pct
        ax.set_ylabel("Action Proportion")
        ax.set_ylim(0, 1)
        ax.set_xlabel("Field Trial Timeline (Days)")
        ax.set_xlim(0, max(nb + 1, 30))
        ax.legend(loc="upper right", fontsize=8)
        ax.set_title(f"{panel_labels[pi]} {study['label']}", fontsize=11, fontweight="bold")
        ax.grid(True, alpha=0.3, axis="y")

    fig.tight_layout(pad=2.0)
    _save_fig(fig, "plot_4_action_dynamics")


def plot_winner_lockin(df: pd.DataFrame):
    subset = df[(df["study_id"] == "scaling_frontier") & (df["config_id"].str.startswith("standard_pf"))].copy()
    if subset.empty: return
    
    subset["N"] = subset["config_id"].str.extract(r'n(\d+)').astype(int)
    ns_std = sorted(subset["N"].unique())
    
    data_records = []
    
    for _, row in subset.iterrows():
        n = row["N"]
        data = load_run_data(row["run_id"])
        if not data: continue
        win_id = data.get("final_solution_id")
        if not win_id: continue
        
        props = data.get("evaluation_snapshot", {}).get("proposals", [])
        if not props: continue
        
        events = sorted(data.get("time_events", []), key=lambda x: x["simulated_at"])
        decision_log = data.get("decision_log", [])
        if not events or not decision_log: continue
        
        def parse_time(ts): return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        start_time = parse_time(events[0]["simulated_at"])
        
        props.sort(key=lambda p: p.get("created", ""))
        creates = [e for e in decision_log if e["action"] in ["create_root", "create_remix", "create_merge"]]
        
        try:
            win_idx = next(i for i, p in enumerate(props) if p["id"] == win_id)
        except StopIteration:
            continue
            
        initial_roots_count = len(props) - len(creates)
        if win_idx < initial_roots_count:
            logical_time = start_time
        else:
            create_ev = creates[win_idx - initial_roots_count]
            logical_time = parse_time(create_ev["simulated_at"])
            
        day = (logical_time - start_time).total_seconds() / 86400.0
        data_records.append({"N": n, "Creation Day": day})
        
    df_plot = pd.DataFrame(data_records)
    if df_plot.empty: return
    
    fig, ax = plt.subplots(figsize=(8, 5))
    
    box_data = [df_plot[df_plot["N"] == n]["Creation Day"].values for n in ns_std]
    valid_ns = [n for i, n in enumerate(ns_std) if len(box_data[i]) > 0]
    valid_data = [d for d in box_data if len(d) > 0]
    valid_positions = list(range(len(valid_ns)))
    
    if valid_data:
        ax.boxplot(valid_data, positions=valid_positions, widths=0.5, 
                   boxprops=dict(color="#e74c3c", alpha=0.7), 
                   medianprops=dict(color="black", linewidth=2),
                   whiskerprops=dict(color="#e74c3c", alpha=0.7),
                   capprops=dict(color="#e74c3c", alpha=0.7),
                   showfliers=False)
                   
    # Overlay with strip plot — map N to categorical positions
    n_to_pos = {n: i for i, n in enumerate(valid_ns)}
    scatter_x = [n_to_pos[n] for n in df_plot["N"] if n in n_to_pos]
    scatter_y = [day for n, day in zip(df_plot["N"], df_plot["Creation Day"]) if n in n_to_pos]
    ax.scatter(scatter_x, scatter_y, alpha=0.6, color="black", edgecolors='w', s=30, zorder=3, label="Individual Seeds")
        
    ax.set_xticks(valid_positions)
    ax.set_xticklabels([str(n) for n in valid_ns])
    ax.set_xlabel("Population Size ($N$)")
    ax.set_ylabel("Winning Proposal Creation Day")
    ax.set_ylim(-1, 31)
    ax.set_title("Winner Lock-In", fontsize=12, fontweight="bold")
    ax.axhspan(0, 5, color='gray', alpha=0.15, label='First 5 Days (First-Mover Zone)')
    
    import matplotlib.lines as mlines
    median_line = mlines.Line2D([], [], color='black', marker='_', markersize=15, label='Median')
    seed_dot = mlines.Line2D([], [], color='black', marker='o', linestyle='None', markersize=5, alpha=0.6, label='Individual Seeds')
    early_patch = Rectangle((0,0),1,1, fc="gray", alpha=0.15, label='First 5 Days (First-Mover Zone)')
    ax.legend(handles=[median_line, seed_dot, early_patch], fontsize=9, loc='upper right')
    ax.grid(True, alpha=0.3)
    
    _save_fig(fig, "plot_5_winner_lockin")



def plot_ballot_comparison(df: pd.DataFrame):
    """Compare votes represented by Even Distribution ballot vs greedy Top-7-by-votes.
    Shows the diversity cost (votes displaced) and the diversity gain (label coverage).
    """
    run_files_by_n = {}
    for rf in find_run_files("experiment_scaling_frontier_standard_pf_*.json"):
        m = re.search(r'_n(\d+)_', rf)
        if m:
            n = int(m.group(1))
            run_files_by_n.setdefault(n, []).append(rf)

    ns, ed_votes_m, top7_votes_m, ed_labels_m, top7_labels_m = [], [], [], [], []
    ed_votes_err, top7_votes_err, ed_labels_err, top7_labels_err = [], [], [], []

    for n in sorted(run_files_by_n):
        run_ed_votes, run_top7_votes, run_ed_labels, run_top7_labels = [], [], [], []
        for rf in run_files_by_n[n]:
            with open(rf) as f:
                data = json.load(f)
            props = data['evaluation_snapshot']['proposals']
            prop_subs  = {p['id']: p.get('subscription_count', 0) for p in props}
            prop_label = {p['id']: p.get('primary_label', '') for p in props}

            # Even Distribution ballot: best champion per label, max 7 slots
            label_champ = {}
            for p in props:
                if p.get('is_champion', False):
                    lbl = p.get('primary_label', 'none')
                    if lbl not in label_champ or p['subscription_count'] > label_champ[lbl][1]:
                        label_champ[lbl] = (p['id'], p['subscription_count'])
            ed_slots = sorted(label_champ.values(), key=lambda x: -x[1])[:7]
            ed_total = sum(s for _, s in ed_slots)
            ed_lbls  = len(ed_slots)

            # Top-7 by subscription count (no constraint)
            top7 = sorted(prop_subs.items(), key=lambda x: -x[1])[:7]
            top7_total = sum(s for _, s in top7)
            top7_lbls  = len(set(prop_label[pid] for pid, _ in top7 if prop_label.get(pid)))

            run_ed_votes.append(ed_total)
            run_top7_votes.append(top7_total)
            run_ed_labels.append(ed_lbls)
            run_top7_labels.append(top7_lbls)

        def _ci(vals):
            m_, lo, hi = get_ci(vals)
            return m_, hi - m_

        m, e = _ci(run_ed_votes);   ed_votes_m.append(m);   ed_votes_err.append(e)
        m, e = _ci(run_top7_votes); top7_votes_m.append(m); top7_votes_err.append(e)
        m, e = _ci(run_ed_labels);  ed_labels_m.append(m);  ed_labels_err.append(e)
        m, e = _ci(run_top7_labels);top7_labels_m.append(m);top7_labels_err.append(e)
        ns.append(n)

    if not ns:
        return

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))
    positions = list(range(len(ns)))
    width = 0.35

    # Panel (a): Vote mass — fixed-width bars on categorical positions
    ax1.bar([p - width/2 for p in positions], ed_votes_m, width=width,
            label="Even Distribution Ballot", color='#2ecc71', alpha=0.85,
            yerr=ed_votes_err, capsize=4, error_kw={'linewidth': 1.2})
    ax1.bar([p + width/2 for p in positions], top7_votes_m, width=width,
            label="Top-7 by Votes (no diversity)", color='#e74c3c', alpha=0.75,
            yerr=top7_votes_err, capsize=4, error_kw={'linewidth': 1.2})

    # Annotate displacement percentages
    for i in range(len(ns)):
        diff = top7_votes_m[i] - ed_votes_m[i]
        pct  = 100 * diff / max(1, top7_votes_m[i])
        ypos = max(ed_votes_m[i], top7_votes_m[i]) + max(ed_votes_err[i], top7_votes_err[i]) + 2
        ax1.text(positions[i], ypos, f"−{pct:.0f}%", ha='center', va='bottom', fontsize=9,
                 color='#c0392b', fontweight='bold')

    ax1.set_xticks(positions)
    ax1.set_xticklabels([str(n) for n in ns])
    ax1.set_xlabel("Population Size ($N$)")
    ax1.set_ylabel("Total Subscriptions Represented on Ballot")
    ax1.set_title("(a) Vote Mass: Diversity Cost", fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(axis='y', alpha=0.4)

    # Panel (b): Label coverage — error bars + scatter on categorical x
    ed_raw = [[ed_labels_m[i]] for i in range(len(ns))]  # only have means, not per-seed
    top7_raw = [[top7_labels_m[i]] for i in range(len(ns))]
    
    _plot_with_errorbars(ax2, positions,
                         ed_labels_m,
                         [m - e for m, e in zip(ed_labels_m, ed_labels_err)],
                         [m + e for m, e in zip(ed_labels_m, ed_labels_err)],
                         ed_raw, '#2ecc71', 'Even Distribution Ballot', marker='o', linestyle='-')
    _plot_with_errorbars(ax2, positions,
                         top7_labels_m,
                         [m - e for m, e in zip(top7_labels_m, top7_labels_err)],
                         [m + e for m, e in zip(top7_labels_m, top7_labels_err)],
                         top7_raw, '#e74c3c', 'Top-7 by Votes', marker='s', linestyle='--')
    
    ax2.set_xticks(positions)
    ax2.set_xticklabels([str(n) for n in ns])
    ax2.set_xlabel("Population Size ($N$)")
    ax2.set_ylabel("Distinct Thematic Labels on Ballot")
    ax2.set_title("(b) Thematic Coverage: Diversity Gain", fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.grid(alpha=0.4)
    ax2.set_ylim(0, 8.5)
    ax2.axhline(7, linestyle=':', color='gray', linewidth=1, alpha=0.6)

    fig.tight_layout(pad=2.0)
    _save_fig(fig, "plot_6_ballot_comparison")


# ── 7. Subscription Lifecycle ──────────────────────────────────────────────
def _reconstruct_sub_curves(run_file: str, bins: int = 60):
    """Return (prop_curves, prop_meta, child_to_parents, t0) from a run JSON file.
    bins = number of half-day bins (bins=60 → 30 days at 0.5d resolution).
    """
    with open(run_file) as f:
        data = json.load(f)

    dec_log   = data.get('decision_log', [])
    props     = data['evaluation_snapshot']['proposals']
    time_evs  = sorted(data.get('time_events', []), key=lambda x: x['simulated_at'])
    if not time_evs:
        return {}, {}, {}, None

    def pt(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    t0 = pt(time_evs[0]['simulated_at'])

    child_to_parents = {p['id']: p.get('parent_proposals', []) for p in props}
    prop_meta        = {p['id']: p for p in props}

    agent_subs = {}
    prop_delta = {p['id']: np.zeros(bins) for p in props}

    for ev in sorted(dec_log, key=lambda e: e['simulated_at']):
        agent  = ev['agent']
        pid    = ev.get('target_solution_id')
        action = ev['action']
        day    = (pt(ev['simulated_at']) - t0).total_seconds() / 86400
        idx    = min(bins - 1, max(0, int(day * 2)))

        if action == 'vote_support' and pid in prop_delta:
            agent_subs.setdefault(agent, set()).add(pid)
            prop_delta[pid][idx] += 1

        elif action == 'vote_migrate' and pid in prop_delta:
            for from_pid in [p for p in child_to_parents.get(pid, [])
                             if p in agent_subs.get(agent, set())]:
                agent_subs[agent].discard(from_pid)
                if from_pid in prop_delta:
                    prop_delta[from_pid][idx] -= 1
            agent_subs.setdefault(agent, set()).add(pid)
            prop_delta[pid][idx] += 1

    prop_curves = {pid: np.cumsum(delta) for pid, delta in prop_delta.items()}
    return prop_curves, prop_meta, child_to_parents, t0


def plot_subscription_lifecycle(df: pd.DataFrame):
    """Two-panel figure:
    (a) Representative subscription trajectories for each lifecycle type (A/B/C/D).
    (b) Fraction of proposals in each lifecycle category, across N values.
    """

    BINS   = 60
    x_days = np.arange(BINS) / 2.0  # 0 → 29.5 days

    # ── collect per-N lifecycle fractions ──────────────────────────
    n_lifecycle = {}  # N -> {A:count, B:count, C:count, D:count, total:count}

    # Also pick one N=50 run for panel (a)
    example_run  = None
    example_curves = None
    example_meta   = None

    run_files_all = find_run_files("experiment_scaling_frontier_standard_pf_*.json")

    for rf in run_files_all:
        m = re.search(r'_n(\d+)_', rf)
        if not m: continue
        n = int(m.group(1))

        curves, meta, c2p, t0 = _reconstruct_sub_curves(rf, BINS)
        if t0 is None: continue

        if n == 50 and example_run is None:
            example_run    = rf
            example_curves = curves
            example_meta   = meta

        counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0}
        for pid, curve in curves.items():
            peak  = curve.max()
            final = curve[-1]
            if peak == 0:
                counts['D'] += 1
            elif peak == final:
                counts['A'] += 1
            elif peak - final <= 1:
                counts['B'] += 1
            else:
                counts['C'] += 1

        total = sum(counts.values())
        if total == 0: continue
        if n not in n_lifecycle:
            n_lifecycle[n] = {k: [] for k in 'ABCD'}
        for k in 'ABCD':
            n_lifecycle[n][k].append(counts[k] / total)

    if not example_curves:
        return
    if example_meta is None:
        example_meta = {}

    # ── draw ───────────────────────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    LC_COLORS = {
        'A': '#27ae60',   # monotone rise – green
        'B': '#f39c12',   # plateau – amber
        'C': '#e74c3c',   # siphoned away – red
        'D': '#95a5a6',   # never subscribed – grey
    }
    LC_LABELS = {
        'A': 'A: Monotone rise',
        'B': 'B: Rise → plateau',
        'C': 'C: Rise → decline (siphoned)',
        'D': 'D: Never subscribed',
    }

    # Panel (a): curated individual proposal trajectories
    # Find interesting proposals: sort by peak subscription count
    candidates = []
    for pid, curve in example_curves.items():
        peak = curve.max()
        final = curve[-1]
        p = example_meta.get(pid, {})
        candidates.append({
            'pid': pid, 'curve': curve, 'meta': p,
            'peak': peak, 'final': final,
            'is_champion': p.get('is_champion', False),
            'depth': p.get('depth', 0),
            'title': p.get('title', pid)[:28],
        })
    
    # Sort by peak (descending) to find the most interesting ones
    candidates.sort(key=lambda x: x['peak'], reverse=True)
    
    # Select interesting trajectories
    featured = []
    # 1. Champion that rises and stays (Type A)
    for c in candidates:
        if c['peak'] == c['final'] and c['peak'] >= 3 and c['is_champion']:
            featured.append(('Champion (rises, stays)', c, '#27ae60', '-', 2.5))
            break
    if not featured:  # fallback: any type A with high peak
        for c in candidates:
            if c['peak'] == c['final'] and c['peak'] >= 3:
                featured.append(('Winner (rises, stays)', c, '#27ae60', '-', 2.5))
                break
    
    # 2. Proposal siphoned by descendant (Type C)
    for c in candidates:
        if c['peak'] - c['final'] >= 2 and c['peak'] >= 4:
            featured.append(('Siphoned by remix', c, '#e74c3c', '-.', 2.5))
            break
    
    # 3. Late-arriving remix that overtakes
    for c in candidates:
        peak_idx = np.argmax(c['curve'])
        if c['depth'] > 0 and c['peak'] >= 3 and peak_idx > 15 and c not in [f[1] for f in featured]:
            featured.append(('Late remix overtakes', c, '#3498db', '--', 2.5))
            break
    
    # 4. Rise → plateau (Type B)
    for c in candidates:
        if 0 < c['peak'] - c['final'] <= 1 and c['peak'] >= 2 and c not in [f[1] for f in featured]:
            featured.append(('Plateau (marginal siphon)', c, '#f39c12', '--', 2.0))
            break
    
    # Draw all non-featured proposals as thin grey background
    featured_pids = {f[1]['pid'] for f in featured}
    for c in candidates:
        if c['pid'] not in featured_pids and c['peak'] > 0:
            ax1.plot(x_days, c['curve'], color='#d5d8dc', linewidth=0.8, alpha=0.5, zorder=1)
    
    # Draw featured proposals
    for label, c, color, ls, lw in featured:
        ax1.plot(x_days, c['curve'], color=color, linestyle=ls, linewidth=lw,
                 label=label, zorder=3)
        # Mark peak for siphoned proposals
        if 'Siphoned' in label:
            peak_idx = np.argmax(c['curve'])
            ax1.annotate(f"siphoned\nday {x_days[peak_idx]:.0f}",
                         xy=(x_days[peak_idx], c['curve'][peak_idx]),
                         xytext=(x_days[peak_idx] + 3, c['curve'][peak_idx] + 0.8),
                         arrowprops=dict(arrowstyle='->', color=color),
                         color=color, fontsize=8)

    ax1.set_xlabel("Deliberation Timeline (Days)")
    ax1.set_ylabel("Running Subscription Count")
    ax1.set_title("(a) Individual Proposal Trajectories\n(N=50, Standard PF, one representative run)",
                  fontweight='bold', fontsize=11)
    ax1.set_xlim(0, 30)
    ax1.set_ylim(bottom=0)
    ax1.legend(fontsize=8, loc='upper left')
    ax1.grid(alpha=0.35)

    # Panel (b): lifecycle fractions across N
    ns = sorted(n_lifecycle)
    lc_means = {k: [np.mean(n_lifecycle[n][k]) for n in ns] for k in 'ABCD'}
    bottom = np.zeros(len(ns))
    for lc in ['A', 'B', 'C', 'D']:
        vals = np.array(lc_means[lc])
        ax2.bar(np.arange(len(ns)), vals, bottom=bottom,
                color=LC_COLORS[lc], label=LC_LABELS[lc], alpha=0.85)
        # Label inside bar if wide enough
        for i, v in enumerate(vals):
            if v > 0.05:
                ax2.text(i, bottom[i] + v / 2, f"{v:.0%}",
                         ha='center', va='center', fontsize=8.5, color='white', fontweight='bold')
        bottom += vals

    ax2.set_xticks(np.arange(len(ns)))
    ax2.set_xticklabels([f"N={n}" for n in ns])
    ax2.set_ylabel("Fraction of Proposals")
    ax2.set_title("(b) Lifecycle Distribution Across Group Sizes\n(Standard PF, means across seeds)",
                  fontweight='bold', fontsize=11)
    ax2.set_ylim(0, 1.0)
    ax2.legend(fontsize=8, loc='upper right', ncol=1)
    ax2.grid(axis='y', alpha=0.35)

    fig.tight_layout(pad=2.0)
    _save_fig(fig, "plot_7_subscription_lifecycle")


def plot_scaling_metrics_matrix(df: pd.DataFrame):
    """2-panel comparison: subscription Gini and ballot label diversity across regimes."""
    regimes = [
        ("standard_pf", "Standard PF", '#2ecc71', 'o', '-', 0),
        ("random_feed", "Random Feed", '#3498db', 's', '--', 0),
        ("newest_feed", "Newest Feed", '#e74c3c', 'D', ':', 0),
    ]
    
    std = df[(df["study_id"] == "scaling_frontier") & (df["config_id"].str.startswith("standard_pf"))].copy()
    if std.empty: return
    std["N"] = std["config_id"].str.extract(r'n(\d+)').astype(int)
    ns_std = sorted(std["N"].unique())
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    ax1.set_xscale('log')
    ax2.set_xscale('log')
    ax1.set_xticks(ns_std)
    ax2.set_xticks(ns_std)
    ax1.set_xticklabels([str(n) for n in ns_std])
    ax2.set_xticklabels([str(n) for n in ns_std])
    ax1.set_xlabel("Population Size ($N$)")
    ax2.set_xlabel("Population Size ($N$)")
    
    for config_prefix, label, color, marker, ls, _ in regimes:
        subset = df[(df["study_id"] == "scaling_frontier") & 
                    (df["config_id"].str.startswith(config_prefix))].copy()
        if subset.empty: continue
        subset["N"] = subset["config_id"].str.extract(r'n(\d+)').astype(int)
        ns = sorted(subset["N"].unique())
        pos = [n for n in ns if n in ns_std]
        
        # Panel A: Subscription Gini
        gini_m, gini_lo, gini_hi, gini_raw = [], [], [], []
        # Panel B: Ballot label diversity
        div_m, div_lo, div_hi, div_raw = [], [], [], []
        
        for n in ns:
            runs = subset[subset["N"] == n]
            gv = runs["subscription_gini"].dropna().values
            m, lo, hi = get_ci(gv)
            gini_m.append(m); gini_lo.append(max(0, lo)); gini_hi.append(min(1, hi))
            gini_raw.append(gv)
            
            dv = runs["ballot_label_diversity"].dropna().values
            m, lo, hi = get_ci(dv)
            div_m.append(m); div_lo.append(max(0, lo)); div_hi.append(hi)
            div_raw.append(dv)
        
        _plot_with_errorbars(ax1, pos, gini_m, gini_lo, gini_hi, gini_raw,
                             color, label, marker=marker, linestyle=ls, offset=0)
        _plot_with_errorbars(ax2, pos, div_m, div_lo, div_hi, div_raw,
                             color, label, marker=marker, linestyle=ls, offset=0)
    
    ax1.set_ylim(0, 1)
    ax1.set_ylabel("Subscription Gini Coefficient")
    ax1.set_title("(a) Attention Concentration vs Scale", fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)
    
    ax2.set_ylim(0, 8)
    ax2.axhline(7, linestyle=':', color='gray', linewidth=1, alpha=0.5)
    ax2.set_ylabel("Ballot Label Diversity")
    ax2.set_title("(b) Thematic Diversity vs Scale", fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.grid(True, alpha=0.3)
    
    fig.tight_layout()
    _save_fig(fig, "plot_8_scaling_matrix")

def plot_scaling_quality_over_time(df: pd.DataFrame):
    regimes = [
        ("standard_pf", "Standard PF"),
        ("random_feed", "Random Feed"),
        ("newest_feed", "Newest Feed"),
    ]
    
    # Only show 3 key scales: small, medium, large
    selected_ns = [25, 100, 400]
    std = df[(df["study_id"] == "scaling_frontier") & (df["config_id"].str.startswith("standard_pf"))].copy()
    if std.empty: return
    std["N"] = std["config_id"].str.extract(r'n(\d+)').astype(int)
    ns = [n for n in sorted(std["N"].unique()) if n in selected_ns]
    if not ns: return
    
    fig, axes = plt.subplots(3, len(ns), figsize=(5 * len(ns), 12), sharex=True, sharey=True)
    bins = 60
    common_times = np.arange(bins) / 2.0  # 0 to 29.5 days
    
    plotted_anything = False
    
    for row_idx, (prefix, title) in enumerate(regimes):
        for col_idx, n in enumerate(ns):
            ax = axes[row_idx, col_idx]
            subset = df[(df["study_id"] == "scaling_frontier") & 
                        (df["config_id"] == f"{prefix}_n{n}")]
            if subset.empty: continue
            
            all_max_q, all_topk_q, all_ballot_q = [], [], []
            
            for _, row in subset.iterrows():
                run_file = find_run_json_path(row['run_id'])
                if not run_file: continue
                
                with open(run_file) as f:
                    data = json.load(f)
                    
                dec_log = data.get('decision_log', [])
                props = data.get('evaluation_snapshot', {}).get('proposals', [])
                time_evs = sorted(data.get('time_events', []), key=lambda x: x['simulated_at'])
                if not time_evs or not props: continue
                
                def pt(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))
                t0 = pt(time_evs[0]['simulated_at'])
                qr = data.get('quality_registry', {})
                prop_meta = {p['id']: p for p in props}
                
                prop_create_bin = {}
                agent_subs = {}
                prop_delta = {p['id']: np.zeros(bins) for p in props}
                
                for ev in sorted(dec_log, key=lambda e: e['simulated_at']):
                    action = ev['action']
                    pid = ev.get('target_solution_id')
                    if not pid: continue
                    
                    day = (pt(ev['simulated_at']) - t0).total_seconds() / 86400
                    idx = min(bins - 1, max(0, int(day * 2)))
                    
                    if action in ('create_root', 'create_remix', 'create_merge'):
                        if pid not in prop_create_bin:
                            prop_create_bin[pid] = idx
                    elif action == 'vote_support' and pid in prop_delta:
                        agent_subs.setdefault(ev['agent'], set()).add(pid)
                        prop_delta[pid][idx] += 1
                    elif action == 'vote_retract' and pid in prop_delta:
                        agent_subs.setdefault(ev['agent'], set()).discard(pid)
                        prop_delta[pid][idx] -= 1
                    elif action == 'vote_migrate' and pid in prop_delta:
                        parents = prop_meta.get(pid, {}).get('parent_proposals', [])
                        for from_pid in [p for p in parents if p in agent_subs.get(ev['agent'], set())]:
                            agent_subs[ev['agent']].discard(from_pid)
                            if from_pid in prop_delta:
                                prop_delta[from_pid][idx] -= 1
                        agent_subs.setdefault(ev['agent'], set()).add(pid)
                        prop_delta[pid][idx] += 1
                        
                prop_subs = {pid: np.cumsum(delta) for pid, delta in prop_delta.items()}
                
                max_q_over_time = np.zeros(bins)
                top7_q_over_time = np.zeros(bins)
                ballot_q_over_time = np.zeros(bins)
                
                for b in range(bins):
                    active = [pid for pid, create_b in prop_create_bin.items() if create_b <= b]
                    if not active: continue
                    
                    active_q = [qr.get(pid, 0) for pid in active]
                    max_q_over_time[b] = np.max(active_q) if active_q else 0
                    
                    active_with_subs = [(pid, prop_subs[pid][b]) for pid in active]
                    active_with_subs.sort(key=lambda x: x[1], reverse=True)
                    
                    top7 = active_with_subs[:7]
                    if top7:
                        top7_q_over_time[b] = np.mean([qr.get(p[0], 0) for p in top7])
                        
                    eligible = [p for p in active_with_subs if p[1] >= 2]
                    ballot = []
                    seen_labels = set()
                    for p in eligible:
                        if len(ballot) >= 7: break
                        labels = prop_meta.get(p[0], {}).get('labels', [])
                        if any(l in seen_labels for l in labels): continue
                        ballot.append(p[0])
                        seen_labels.update(labels)
                        
                    if ballot:
                        ballot_q_over_time[b] = np.mean([qr.get(pid, 0) for pid in ballot])
                    else:
                        ballot_q_over_time[b] = ballot_q_over_time[b-1] if b > 0 else 0
                        
                all_max_q.append(max_q_over_time)
                all_topk_q.append(top7_q_over_time)
                all_ballot_q.append(ballot_q_over_time)
                
            if not all_max_q: continue
            
            plotted_anything = True
            
            # Normalise to η(t) = q(t) / q_max(t) for each seed, then average
            all_topk_eta = []
            all_ballot_eta = []
            for s_idx in range(len(all_max_q)):
                ceiling = all_max_q[s_idx]
                t7 = all_topk_q[s_idx]
                bl = all_ballot_q[s_idx]
                topk_eta = np.divide(t7, ceiling, out=np.zeros_like(t7), where=ceiling > 0)
                ballot_eta = np.divide(bl, ceiling, out=np.zeros_like(bl), where=ceiling > 0)
                all_topk_eta.append(topk_eta)
                all_ballot_eta.append(ballot_eta)
            
            def plot_band(ax, data, color, label):
                if not data: return
                means = np.mean(data, axis=0)
                stds = np.std(data, axis=0)
                z = 1.96 / np.sqrt(len(data)) if len(data) > 0 else 0
                ax.plot(common_times, means, label=label, color=color, linewidth=2.0)
                if len(data) > 1:
                    ax.fill_between(common_times, 
                                    np.clip(means - z*stds, 0, None), 
                                    np.clip(means + z*stds, None, 1.2), 
                                    color=color, alpha=0.15)
                    
            # Ceiling at η=1 is a reference line
            ax.axhline(1.0, color='gray', linestyle=':', linewidth=0.8, alpha=0.5)
            plot_band(ax, all_topk_eta, "#3498db", "Top 7 by Subscriptions")
            plot_band(ax, all_ballot_eta, "#2ecc71", "Ballot (diversity-filtered)")
            
            ax.set_title(f"{title} (N={n})", fontsize=12, fontweight="bold")
            ax.set_ylim(0, 1.15)
            ax.grid(True, alpha=0.3)
            
    if not plotted_anything: return
    
    for col_idx in range(len(ns)):
        axes[-1, col_idx].set_xlabel("Days Elapsed", fontsize=11)
    for row_idx in range(3):
        axes[row_idx, 0].set_ylabel(r"Selection Efficiency $\eta(t)$", fontsize=11)
        
    handles, labels = axes[0,0].get_legend_handles_labels()
    fig.legend(handles, labels, loc='upper center', bbox_to_anchor=(0.5, 0.98), ncol=3, fontsize=12)
    
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    _save_fig(fig, "plot_9_quality_over_time")

# ── 9b. Ballot Diversity Cost ──────────────────────────────────────────────
def plot_ballot_diversity_cost(df: pd.DataFrame):
    """Combined plot: top row = η(t) for top-7-by-subs vs ballot per regime,
    bottom row = Δη(t) diversity cost over time.  All regimes on same axes."""
    regimes = [
        ("standard_pf", "Standard PF", '#2ecc71'),
        ("random_feed", "Random Feed", '#3498db'),
        ("newest_feed", "Newest Feed", '#e74c3c'),
    ]
    
    selected_ns = [25, 100, 400]
    std = df[(df["study_id"] == "scaling_frontier") & (df["config_id"].str.startswith("standard_pf"))].copy()
    if std.empty: return
    std["N"] = std["config_id"].str.extract(r'n(\d+)').astype(int)
    ns = [n for n in sorted(std["N"].unique()) if n in selected_ns]
    if not ns: return
    
    bins = 60
    common_times = np.arange(bins) / 2.0
    
    fig, axes = plt.subplots(2, len(ns), figsize=(5 * len(ns), 8), sharex=True)
    
    plotted_anything = False
    
    for col_idx, n in enumerate(ns):
        ax_top = axes[0, col_idx]
        ax_bot = axes[1, col_idx]
        
        for prefix, title, color in regimes:
            subset = df[(df["study_id"] == "scaling_frontier") & 
                        (df["config_id"] == f"{prefix}_n{n}")]
            if subset.empty: continue
            
            all_topk_eta, all_ballot_eta = [], []
            
            for _, row in subset.iterrows():
                run_file = find_run_json_path(row['run_id'])
                if not run_file: continue
                
                with open(run_file) as f:
                    data = json.load(f)
                    
                dec_log = data.get('decision_log', [])
                props = data.get('evaluation_snapshot', {}).get('proposals', [])
                time_evs = sorted(data.get('time_events', []), key=lambda x: x['simulated_at'])
                if not time_evs or not props: continue
                
                def pt(ts): return datetime.fromisoformat(ts.replace('Z', '+00:00'))
                t0 = pt(time_evs[0]['simulated_at'])
                qr = data.get('quality_registry', {})
                prop_meta = {p['id']: p for p in props}
                
                prop_create_bin = {}
                agent_subs = {}
                prop_delta = {p['id']: np.zeros(bins) for p in props}
                
                for ev in sorted(dec_log, key=lambda e: e['simulated_at']):
                    action = ev['action']
                    pid = ev.get('target_solution_id')
                    if not pid: continue
                    
                    day = (pt(ev['simulated_at']) - t0).total_seconds() / 86400
                    idx = min(bins - 1, max(0, int(day * 2)))
                    
                    if action in ('create_root', 'create_remix', 'create_merge'):
                        if pid not in prop_create_bin:
                            prop_create_bin[pid] = idx
                    elif action == 'vote_support' and pid in prop_delta:
                        agent_subs.setdefault(ev['agent'], set()).add(pid)
                        prop_delta[pid][idx] += 1
                    elif action == 'vote_retract' and pid in prop_delta:
                        agent_subs.setdefault(ev['agent'], set()).discard(pid)
                        prop_delta[pid][idx] -= 1
                    elif action == 'vote_migrate' and pid in prop_delta:
                        parents = prop_meta.get(pid, {}).get('parent_proposals', [])
                        for from_pid in [p for p in parents if p in agent_subs.get(ev['agent'], set())]:
                            agent_subs[ev['agent']].discard(from_pid)
                            if from_pid in prop_delta:
                                prop_delta[from_pid][idx] -= 1
                        agent_subs.setdefault(ev['agent'], set()).add(pid)
                        prop_delta[pid][idx] += 1
                        
                prop_subs = {pid: np.cumsum(delta) for pid, delta in prop_delta.items()}
                
                max_q_t = np.zeros(bins)
                top7_q_t = np.zeros(bins)
                ballot_q_t = np.zeros(bins)
                
                for b in range(bins):
                    active = [pid for pid, cb in prop_create_bin.items() if cb <= b]
                    if not active: continue
                    
                    active_q = [qr.get(pid, 0) for pid in active]
                    max_q_t[b] = np.max(active_q) if active_q else 0
                    
                    active_with_subs = [(pid, prop_subs[pid][b]) for pid in active]
                    active_with_subs.sort(key=lambda x: x[1], reverse=True)
                    
                    top7 = active_with_subs[:7]
                    if top7:
                        top7_q_t[b] = np.mean([qr.get(p[0], 0) for p in top7])
                        
                    eligible = [p for p in active_with_subs if p[1] >= 2]
                    ballot = []
                    seen_labels = set()
                    for p in eligible:
                        if len(ballot) >= 7: break
                        labels = prop_meta.get(p[0], {}).get('labels', [])
                        if any(l in seen_labels for l in labels): continue
                        ballot.append(p[0])
                        seen_labels.update(labels)
                        
                    if ballot:
                        ballot_q_t[b] = np.mean([qr.get(pid, 0) for pid in ballot])
                    else:
                        ballot_q_t[b] = ballot_q_t[b-1] if b > 0 else 0
                
                # Normalise to η per seed
                ceil = max_q_t.copy()
                topk_eta = np.divide(top7_q_t, ceil, out=np.zeros_like(top7_q_t), where=ceil > 0)
                ballot_eta = np.divide(ballot_q_t, ceil, out=np.zeros_like(ballot_q_t), where=ceil > 0)
                all_topk_eta.append(topk_eta)
                all_ballot_eta.append(ballot_eta)
                
            if not all_topk_eta: continue
            plotted_anything = True
            
            mean_topk = np.mean(all_topk_eta, axis=0)
            mean_ballot = np.mean(all_ballot_eta, axis=0)
            gap = mean_topk - mean_ballot
            
            # Top row: η(t) — solid = top-7, dashed = ballot
            ax_top.plot(common_times, mean_topk, color=color, linewidth=2.0,
                       linestyle='-', label=f"{title} — Top 7 by Subs")
            ax_top.plot(common_times, mean_ballot, color=color, linewidth=1.5,
                       linestyle='--', alpha=0.7, label=f"{title} — Ballot")
            
            # Bottom row: Δη(t) gap with shading
            ax_bot.plot(common_times, gap, color=color, linewidth=2.0, label=title)
            ax_bot.fill_between(common_times, 0, gap, color=color, alpha=0.12)
        
        ax_top.axhline(1.0, color='gray', linestyle=':', linewidth=0.8, alpha=0.5)
        ax_top.set_ylim(0, 1.15)
        ax_top.set_title(f"N = {n}", fontsize=13, fontweight="bold")
        ax_top.grid(True, alpha=0.3)
        
        ax_bot.axhline(0, color='gray', linestyle='-', linewidth=0.5)
        ax_bot.set_ylim(-0.05, 0.8)
        ax_bot.set_xlabel("Days Elapsed", fontsize=11)
        ax_bot.grid(True, alpha=0.3)
    
    axes[0, 0].set_ylabel(r"Selection Efficiency $\eta(t)$", fontsize=11)
    axes[1, 0].set_ylabel(r"Diversity Cost $\Delta\eta(t)$", fontsize=11)
    
    # Compact legend for top row
    handles_top, labels_top = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles_top, labels_top, loc='upper center', bbox_to_anchor=(0.5, 1.0),
               ncol=3, fontsize=8, framealpha=0.9)
    
    # Compact legend for bottom row
    handles_bot, labels_bot = axes[1, 0].get_legend_handles_labels()
    axes[1, -1].legend(handles_bot, labels_bot, fontsize=9, loc='upper right')
    
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    _save_fig(fig, "plot_9b_ballot_diversity_cost")


def plot_attention_coverage(df: pd.DataFrame):
    """Zero-eval fraction and eval-per-proposal distribution across regimes and scales."""
    from collections import Counter
    
    regimes = [
        ("standard_pf", "Standard PF", '#2ecc71', 'o', '-'),
        ("random_feed", "Random Feed", '#3498db', 's', '--'),
        ("newest_feed", "Newest Feed", '#e74c3c', 'D', ':'),
    ]
    
    sf = df[df["study_id"] == "scaling_frontier"].copy()
    if sf.empty: return
    sf["N"] = sf["config_id"].str.extract(r'n(\d+)').astype(int)
    sf["regime"] = sf["config_id"].str.replace(r'_n\d+$', '', regex=True)
    ns_all = sorted(sf["N"].unique())
    
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))
    positions = _setup_categorical_x(ax1, ns_all)
    
    # Panel (a): Zero-evaluation fraction vs N
    for prefix, label, color, marker, ls in regimes:
        zero_means, zero_lows, zero_highs, zero_raw = [], [], [], []
        pos = []
        for n in ns_all:
            runs = sf[(sf["regime"] == prefix) & (sf["N"] == n)]
            if runs.empty: continue
            pos.append(ns_all.index(n))
            
            seed_zeros = []
            for _, row in runs.iterrows():
                path = find_run_json_path(row['run_id'])
                if not path: continue
                with open(path) as f:
                    data = json.load(f)
                props = data['evaluation_snapshot']['proposals']
                dec = data['decision_log']
                
                eval_counts = Counter()
                for e in dec:
                    if e['action'] in ('vote_support', 'vote_migrate'):
                        pid = e.get('target_solution_id')
                        if pid: eval_counts[pid] += 1
                
                n_props = len(props)
                zero_frac = sum(1 for p in props if eval_counts.get(p['id'], 0) == 0) / n_props if n_props > 0 else 0
                seed_zeros.append(zero_frac)
            
            m, lo, hi = get_ci(seed_zeros)
            zero_means.append(m); zero_lows.append(max(0, lo)); zero_highs.append(min(1, hi))
            zero_raw.append(seed_zeros)
        
        if pos:
            _plot_with_errorbars(ax1, pos, zero_means, zero_lows, zero_highs, zero_raw,
                                 color, label, marker=marker, linestyle=ls)
    
    ax1.set_ylim(0, 1.0)
    ax1.set_ylabel("Fraction Never Voted On")
    ax1.set_title("(a) Proposals Never Voted On vs Group Size", fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)
    
    # Panel (b): Eval distribution at N=100 and N=400
    box_data = []
    box_labels = []
    box_colors = []
    for n_target in [100, 400]:
        for prefix, label, color, _, _ in regimes:
            runs = sf[(sf["regime"] == prefix) & (sf["N"] == n_target)]
            all_evals = []
            for _, row in runs.iterrows():
                path = find_run_json_path(row['run_id'])
                if not path: continue
                with open(path) as f:
                    data = json.load(f)
                props = data['evaluation_snapshot']['proposals']
                dec = data['decision_log']
                eval_counts = Counter()
                for e in dec:
                    if e['action'] in ('vote_support', 'vote_migrate'):
                        pid = e.get('target_solution_id')
                        if pid: eval_counts[pid] += 1
                all_evals.extend([eval_counts.get(p['id'], 0) for p in props])
            
            if all_evals:
                box_data.append(all_evals)
                short = label.split()[0]  # "Standard", "Random", "Newest"
                box_labels.append(f"{short}\nN={n_target}")
                box_colors.append(color)
    
    if box_data:
        bp = ax2.boxplot(box_data, tick_labels=box_labels, showfliers=False, patch_artist=True,
                        widths=0.6, medianprops=dict(color='black', linewidth=1.5))
        for patch, color in zip(bp['boxes'], box_colors):
            patch.set_facecolor(color)
            patch.set_alpha(0.5)
        
        ax2.set_ylabel("Evaluations Per Proposal")
        ax2.set_title("(b) Evaluation Distribution (N=100, N=400)", fontweight='bold')
        ax2.grid(axis='y', alpha=0.3)
        # Add separator line between N=100 and N=400 groups
        ax2.axvline(3.5, color='gray', linestyle=':', alpha=0.5)
    
    fig.tight_layout(pad=2.0)
    _save_fig(fig, "plot_10_attention_coverage")


# ── 11. Human vs Simulated Attention Gap ───────────────────────────────────
def plot_human_vs_sim_attention(df: pd.DataFrame):
    """Horizontal grouped bar chart comparing human and simulated engagement metrics."""
    from collections import Counter
    
    base = Path(HUMAN_STUDIES_DATA)
    
    HUMAN_ACTION_MAP = {
        "create_idea": "create_root", "remix_singular": "create_remix",
        "remix_combine": "create_merge", "subscribe": "vote_support",
    }
    
    def count_human_actions(study_dir: str) -> dict:
        """Count generative actions per user, including manual migrations."""
        csv_path = os.path.join(study_dir, "action_logs.csv")
        try:
            adf = pd.read_csv(csv_path, parse_dates=["created"])
        except Exception:
            return {}
        
        users = adf['user'].nunique() if 'user' in adf.columns else 1
        counts = {"total": 0, "subscribe": 0, "remix": 0, "merge": 0, "manual_migrate": 0}
        for _, row in adf.iterrows():
            atype = str(row.get("action_type", "")).lower()
            mapped = HUMAN_ACTION_MAP.get(atype)
            if mapped == "vote_support": counts["subscribe"] += 1; counts["total"] += 1
            elif mapped == "create_remix": counts["remix"] += 1; counts["total"] += 1
            elif mapped == "create_merge": counts["merge"] += 1; counts["total"] += 1
            elif mapped == "create_root": counts["total"] += 1
        
        # Detect manual migrations: unsub→sub to DIFFERENT target
        sv = adf[adf["action_type"].isin(["subscribe", "unsubscribe"])].sort_values(["user", "created"]).copy()
        if not sv.empty:
            sv["next_action"] = sv.groupby("user")["action_type"].shift(-1)
            sv["next_target"] = sv.groupby("user")["target_id"].shift(-1)
            migrations = sv[
                (sv["action_type"] == "unsubscribe") & 
                (sv["next_action"] == "subscribe") &
                (sv["target_id"] != sv["next_target"])
            ]
            counts["manual_migrate"] = len(migrations)
        
        return {k: v / users for k, v in counts.items()}
    
    study1 = count_human_actions(str(base / "wg_studiengruppe"))
    study2 = count_human_actions(str(base / "wg_netz_winterthur"))
    
    # Simulated N=10 averages
    sim_runs = df[(df["study_id"] == "scaling_frontier") & (df["config_id"] == "standard_pf_n10")]
    sim_total = sim_runs["mean_actions_per_agent"].mean() if not sim_runs.empty else 0
    
    sim_subs, sim_remix, sim_merge, sim_migrate = 0, 0, 0, 0
    sim_count = 0
    for _, row in sim_runs.iterrows():
        path = find_run_json_path(row['run_id'])
        if not path: continue
        with open(path) as f:
            data = json.load(f)
        dec = data.get("decision_log", [])
        n_agents = data.get("config", {}).get("agent_count", 10)
        ac = Counter(e["action"] for e in dec)
        sim_subs += ac.get("vote_support", 0) / n_agents
        sim_remix += ac.get("create_remix", 0) / n_agents
        sim_merge += ac.get("create_merge", 0) / n_agents
        sim_migrate += ac.get("vote_migrate", 0) / n_agents
        sim_count += 1
    
    if sim_count > 0:
        sim_subs /= sim_count
        sim_remix /= sim_count
        sim_merge /= sim_count
        sim_migrate /= sim_count
    
    if not study1 and not study2:
        return
    
    # Build bar data — split migration into manual (human) vs automated (sim)
    metrics = ["Total\nActions", "Subscribes", "Remixes", "Merges", "Vote\nMigrations"]
    s1_vals = [study1.get("total", 0), study1.get("subscribe", 0), study1.get("remix", 0),
               study1.get("merge", 0), study1.get("manual_migrate", 0)]
    s2_vals = [study2.get("total", 0), study2.get("subscribe", 0), study2.get("remix", 0),
               study2.get("merge", 0), study2.get("manual_migrate", 0)]
    sim_vals = [sim_total, sim_subs, sim_remix, sim_merge, sim_migrate]
    
    fig, ax = plt.subplots(figsize=(10, 5))
    
    y = np.arange(len(metrics))
    height = 0.25
    
    ax.barh(y - height, s1_vals, height, label="Study 1",
            color='#3498db', alpha=0.8)
    ax.barh(y, s2_vals, height, label="Study 2",
            color='#2ecc71', alpha=0.8)
    ax.barh(y + height, sim_vals, height, label="Simulation",
            color='#95a5a6', alpha=0.8, hatch='///')
    
    # Annotate sim multiplier
    for i, (sv, s1v, s2v) in enumerate(zip(sim_vals, s1_vals, s2_vals)):
        human_avg = np.mean([v for v in [s1v, s2v] if v > 0]) if (s1v > 0 or s2v > 0) else 0
        if human_avg > 0 and sv > 0:
            ratio = sv / human_avg
            ax.text(sv + 0.3, y[i] + height, f"{ratio:.1f}×", va='center', fontsize=9,
                   fontweight='bold', color='#7f8c8d')
    
    # Annotate migration type
    mig_idx = 4  # "Vote Migrations" row
    ax.annotate("manual\n(unsub→sub)", xy=(max(s1_vals[mig_idx], s2_vals[mig_idx]) + 0.1, y[mig_idx] - height/2),
                fontsize=7, color='#3498db', va='center')
    ax.annotate("automated\n(Siphon)", xy=(sim_vals[mig_idx] + 0.1, y[mig_idx] + height),
                fontsize=7, color='#7f8c8d', va='center')
    
    ax.set_yticks(y)
    ax.set_yticklabels(metrics)
    ax.set_xlabel("Actions Per User (Mean)")
    ax.set_title("Human vs. Simulated Engagement", fontweight='bold')
    ax.legend(fontsize=9, loc='lower right')
    ax.grid(axis='x', alpha=0.3)
    ax.set_xlim(0, max(max(sim_vals), max(s1_vals), max(s2_vals)) * 1.3)
    
    fig.tight_layout()
    _save_fig(fig, "plot_11_human_vs_sim")


def main():
    csv_path = os.path.join(EXPERIMENTS_OUTPUT, "experiment_results.csv")
    if not os.path.exists(csv_path):
        csv_path = os.path.join(SIM_EXPERIMENTS_DATA, "experiment_results.csv")
    if not os.path.exists(csv_path):
        print("No experiment_results.csv found in tooling/output/experiments or experiment_data/simulation_experiments.")
        return
    df = pd.read_csv(csv_path)

    print("Generating Thesis Plots...")
    plot_cross_regime_scaling(df)
    plot_siphon_ablation(df)
    plot_three_window_tradeoff(df)
    plot_action_dynamics(df)
    plot_winner_lockin(df)
    plot_ballot_comparison(df)
    plot_subscription_lifecycle(df)
    plot_scaling_metrics_matrix(df)
    plot_scaling_quality_over_time(df)
    plot_ballot_diversity_cost(df)
    plot_attention_coverage(df)
    plot_human_vs_sim_attention(df)
    print("Done!")

if __name__ == "__main__":
    main()
