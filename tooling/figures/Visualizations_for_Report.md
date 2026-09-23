# Thesis Visualization Specifications

Detailed specs for generating thesis figures as JS-rendered visualizations (matching the platform's existing graph style). Each figure includes exact data, layout, and styling requirements for an agent working in the codebase.

> [!IMPORTANT]
> **For the generating agent:** These figures should be rendered as standalone HTML/JS files that can be exported as high-res PNGs/SVGs for LaTeX inclusion. Use the same rendering approach as the platform's `StaticLineageGraph` component (Canvas or SVG node-link diagrams). Output directory: `Report/Master Thesis - Draft/figures/`.

---

## Figure Inventory

| # | Title | Thesis Section | Source |
|---|-------|---------------|--------|
| 1 | Proposal DAG Example | §2.2.1 | Styled like app graph view |
| 2 | Convergence Pipeline + Dual Window | §2.4 | New conceptual diagram |
| 3 | Siphon Effect (Before/After) | §2.4.4 / §3.6 | Styled like app graph view |
| 4 | Design Contract: R1–R9 → Components | §2.6 | New diagram |
| 5 | Phase State Machine | §3.1 | Styled like app overview |
| 6 | Label Inheritance + Ballot Composition | §2.3 / §3.4 | Styled like app graph view |
| 7 | Bipartite Attention Graph + Projections | §2.6 | New network diagram |
| 8 | Anti-Preferential Attachment Curves | §3.5 | Line plot |
| 9 | Interaction Funnel (Schematic) | §4.4 | Funnel diagram |
| 10 | CI Traditions 2×2 Matrix | §1.3.5 | Conceptual quadrant |

---

## TIER 1: Essential Figures

### Figure 1: The Proposal DAG — Structure and Operations

**Purpose:** Show the three proposal types (root, remix, combination) and their parentage relationships in a small example DAG. This is the thesis's core architectural concept.

**Use the platform's existing graph rendering style.** The platform already renders exactly this kind of diagram on the detail page of each proposal (the `StaticLineageGraph` component). Generate a figure using the same node shapes, colours, and edge styles.

**Exact data — 8 nodes:**

| Node ID | Type | Title (short) | Parents | Label(s) | Subscriptions |
|---------|------|--------------|---------|----------|---------------|
| A | Root | "Flat monthly fee" | — | α ("Flat fee") | 4 |
| B | Root | "Usage-based billing" | — | β ("Usage-based") | 3 |
| C | Remix | "Flat fee + cap" | [A] | α | 5 |
| D | Remix | "Tiered usage" | [B] | β | 2 |
| E | Combination | "Flat base + usage top-up" | [C, D] | α, β | 6 |
| F | Root | "Rotating responsibility" | — | γ ("Rotating") | 1 |
| G | Remix | "Quarterly rotation" | [F] | γ | 3 |
| H | Remix | "Fair flat + cap v2" | [C] | α | 7 ★ Champion |

**Layout:** Top-down DAG (roots at top, derivatives below). Directed edges point parent → child (downward). Three visible "columns" corresponding to the three labels (α, β, γ), with the combination node E bridging α and β.

**Visual encoding:**
- **Roots:** Circle with solid fill (e.g., the app's root proposal colour)
- **Remixes:** Circle with a different shade or a small fork icon
- **Combinations:** Circle with a merge icon or dual-tone fill showing both parent labels
- **Edges:** Directed arrows, slightly curved for combinations (two edges converging into one node)
- **Labels:** Coloured halos or background bands behind node groups (α = blue family, β = green family, γ = amber family)
- **Champion indicator:** Node H gets a star badge or highlighted border (the app uses a "Leading Idea" indicator)
- **Subscription counts:** Small number badge on each node

**Annotations (text callouts):**
- Arrow pointing to A,B,F: "Root Proposals (new ideas)"
- Arrow pointing to C,D,G,H: "Remixes (single-parent forks)"
- Arrow pointing to E: "Combination (multi-parent merge)"
- Arrow pointing to label halos: "Labels (thematic schools of thought)"

**Size:** Landscape, approximately 16cm × 10cm at 300dpi.

---

### Figure 2: The Convergence Pipeline and Dual-Window Architecture

**Purpose:** Show the two-stage filtering process AND the dual-window concept in a single unified figure. The personal window (Stage 1) generates distributed evaluations; the public window (Stage 2) aggregates them into Champions and the Ballot.

> [!NOTE]
> This combines the originally separate "Convergence Pipeline" and "Dual Window" figures. The user noted these are closely related. A single figure shows both the conceptual architecture (two windows looking at the same knowledge base) and the data flow between them.

**Layout:** Horizontal left-to-right pipeline with three major blocks:

```
┌─────────────────────┐     ┌──────────────────────────────┐     ┌─────────────────────────┐
│  SHARED KNOWLEDGE   │     │  STAGE 1: PERSONAL FOCUS     │     │  STAGE 2: PUBLIC FOCUS   │
│  BASE (DAG)         │────▶│  (Per-user attention routing) │────▶│  (Community aggregation) │
│                     │     │                              │     │                         │
│  All proposals,     │     │  ┌──────┐ ┌──────┐ ┌──────┐ │     │  Aggregate signals      │
│  labels, edges      │     │  │User A│ │User B│ │User C│ │     │  ────────────────        │
│                     │     │  │feed  │ │feed  │ │feed  │ │     │  Champion selection     │
│                     │     │  └──┬───┘ └──┬───┘ └──┬───┘ │     │  (per label)            │
│                     │     │     │view    │sub     │dismiss│    │  ────────────────        │
│                     │     │     ▼        ▼        ▼      │     │  Ballot composition     │
│                     │     │  Individual evaluations       │     │  (label-exclusive)      │
│                     │     │                              │     │                         │
│                     │     │  Computed CLIENT-SIDE         │     │  Computed SERVER-SIDE    │
└─────────────────────┘     └──────────────────────────────┘     └─────────────────────────┘
```

**Visual encoding:**
- Three distinct blocks with clear borders
- The DAG block shows a small abstract graph (5–6 nodes with edges, no labels needed — just to indicate "graph of proposals")
- The Personal Focus block shows 3 user silhouettes, each with a differently-ordered feed (stacked cards), producing evaluation arrows (view, subscribe, dismiss) flowing rightward
- The Public Focus block shows the aggregation funnel: signals → Champion badges per label → Ballot (a short ranked list of 3–4 items)
- Annotation below Stage 1: "Computed client-side · Per-user · Privacy-preserving"
- Annotation below Stage 2: "Computed server-side · Community-wide · On every vote change"

**Colours:** Use a consistent palette — DAG in neutral grey, Personal Focus in a warm tone (the "For You" concept), Public Focus in a cooler tone (the "Ballot" concept).

**Size:** Landscape, approximately 16cm × 8cm.

---

### Figure 3: The Siphon Effect — Vote Migration Along DAG Edges

**Purpose:** Show how support transfers from parent to child proposals when a remix is created. Two-panel before/after using the app's graph rendering style.

**Layout:** Two panels side by side, labelled **(a) Before remix** and **(b) After Siphon Effect**.

**Panel (a) — Before:**
- Parent node P labelled "Flat fee + cap" with subscription badge showing **5**
- P has its existing children (if any), but the key is that P has 5 subscribers
- A dashed outline shows a new child node P' ("Fair flat + cap v2") about to appear, with **0** subscriptions
- No notification arrows yet

**Panel (b) — After:**
- Same layout, but now:
  - P has **2** subscriptions (lost 3)
  - P' has **3** subscriptions (gained 3)
  - Three small notification icons (bell symbols) along the P → P' edge, indicating the push notifications sent
  - A curved arrow labelled "compare → migrate" shows the flow
  - P' now has a Champion badge (it overtook P)

**Visual encoding:**
- Use the app's node style for both panels
- Subscription counts as prominent badges on each node
- The "flow" of votes shown as animated-style arrows (dashed, with arrowheads) from P to P' along the DAG edge
- Notification bell icon near the edge
- Colour shift: P fades slightly in panel (b); P' gains emphasis

**Annotations:**
- Below panel (a): "Parent has 5 subscribers; new remix created"
- Below panel (b): "3 subscribers notified, compared, and migrated → child becomes Champion"
- Formula: `siphon_ratio = Σ child_support / Σ all_support`

**Size:** Landscape, approximately 14cm × 7cm (two panels).

---

### Figure 4: Design Contract — R1–R9 Requirements Mapped to Components

**Purpose:** Visualize the mapping from the 9 structural requirements (Section 2.6) to the PersonalFocus algorithm components that implement them. This replaces the originally proposed "component decomposition" figure, because the thesis now has a dedicated section (§2.6) that explicitly maps requirements to components, and the most valuable visualization is this mapping — not the formula structure (which is already well-presented in the aligned equations in §3.5).

**Layout:** Two-column mapping diagram (Sankey-style or alluvial-style).

**Left column — Requirements (9 items, grouped):**

Group "Attention Distribution" (R1–R4):
- R1: Coverage (≥k evaluations per proposal)
- R2: Anti-preferential attachment
- R3: Cross-label diversity
- R4: Distributed specialisation

Group "Network Structure" (R5–R9):
- R5: Overlapping evaluation sets
- R6: User–user distributed specialisation
- R7: Connectivity (no isolated users)
- R8: Cross-label co-attention
- R9: Within-label competitive evaluation

**Right column — Algorithm Components (8 items):**
- Smoothed Conversion
- Exploration Boost
- Personal Affinity
- Diversity Boost
- Bridging Boost
- Unseen Multiplier
- Subscribed Penalty
- Time Decay

**Connections (edges from requirement → component):**

| Requirement | Implementing Component(s) | Strength |
|------------|--------------------------|----------|
| R1 Coverage | Exploration Boost, Unseen Multiplier | Strong (direct) |
| R2 Anti-preferential | Exploration Boost, Subscribed Penalty | Strong (direct) |
| R3 Cross-label diversity | Diversity Boost | Strong (direct) |
| R4 Distributed specialisation | Personal Affinity + Diversity Boost | Moderate (approximate) |
| R5 Overlapping evals | Smoothed Conversion (indirect) | Weak (indirect) |
| R6 User–user specialisation | Personal Affinity + Diversity Boost | Weak (indirect) |
| R7 Connectivity | Diversity Boost, Unseen Multiplier | Weak (indirect) |
| R8 Cross-label co-attention | Diversity Boost | Moderate |
| R9 Within-label competition | Personal Affinity | Moderate |

**Visual encoding:**
- Requirements as rounded rectangles on the left, colour-coded by group (blue for R1–R4, orange for R5–R9)
- Components as rounded rectangles on the right
- Edges: solid thick lines for "strong/direct" implementation, dashed lines for "weak/indirect"
- This visually communicates the asymmetry described in §2.6: R1–R4 have thick solid connections; R5–R9 have mostly dashed ones

**Annotation at bottom:** "Strong support for R1–R4 (attention distribution); indirect, unverified support for R5–R9 (network structure)"

**Size:** Portrait or square, approximately 12cm × 14cm.

---

### Figure 5: Phase State Machine (Question Lifecycle)

**Purpose:** Show the 5 phases and transitions of a question's lifecycle. Use the platform's own phase diagram style from the overview page.

**Layout:** Horizontal state-transition diagram. Five states as rounded rectangles connected by arrows.

**States and annotations:**

```
[Proposed] ──activation threshold──▶ [Answer Search] ──deadline──▶ [Closing] ──deadline──▶ [Voting] ──deadline──▶ [Decided]
```

**Per-state annotations (below each box):**

| State | Duration | Permitted Operations |
|-------|----------|---------------------|
| Proposed | Until activation threshold + waiting period | Vote on question activation |
| Answer Search | Default 7 days (configurable) | Create roots, remix, combine, subscribe, dismiss |
| Closing | 48 hours | Subscribe, retract, remix existing (NO new roots) |
| Voting | 72 hours | Rank ballot entries (Borda count); update ballot |
| Decided | Terminal | Read-only archive |

**Visual encoding:**
- Each state as a rounded rectangle with the state name in bold
- Transition arrows labelled with triggers ("activation threshold met", "deadline elapsed", "deadline elapsed", "deadline elapsed")
- Colour gradient from light (Proposed) to dark (Decided) to show progression
- The "Answer Search" box should be largest (it's the main working phase)
- A small clock icon on each transition arrow to indicate time-driven

**Size:** Landscape, approximately 16cm × 5cm.

---

## TIER 2: High-Value Figures

### Figure 6: Label Inheritance and Ballot Composition

**Purpose:** Two-panel figure showing (a) how labels propagate through the DAG and (b) how the Even Distribution algorithm selects label-exclusive Ballot entries.

**Panel (a) — Label Inheritance:**

Use the same DAG from Figure 1 but emphasise the label dimension. Show:
- Root A creates label α (auto-generated from title)
- Root B creates label β
- Remix C of A inherits label α
- Remix D of B inherits label β
- Combination E of C+D inherits α ∪ β (shown as dual-colour node)
- Each label as a distinct coloured background band or halo

**Panel (b) — Ballot Composition (Even Distribution):**

Show a worked example:

Champions (sorted by subscription count):
1. H (α) — 7 subs ✓ → added to Ballot, α marked "seen"
2. E (α, β) — 6 subs ✗ → rejected (α overlaps with H)
3. G (γ) — 3 subs ✓ → added to Ballot, γ marked "seen"
4. D (β) — 2 subs ✓ → added to Ballot, β marked "seen"

Final Ballot: [H, G, D] — three thematically distinct entries.

**Visual encoding for Panel (b):**
- Champions as a vertical sorted list with their label colour badges
- A filter/funnel graphic: candidates enter from the left; rejected ones are greyed out with a "label overlap" annotation; accepted ones pass through to the right into the "Ballot" box
- The Ballot box shows the final 3 entries, each with a distinct label colour

**Size:** Landscape, approximately 16cm × 10cm (two panels stacked or side by side).

---

### Figure 7: Bipartite Attention Graph and Projections

**Purpose:** Show the User × Proposal bipartite graph that the PersonalFocus algorithm creates, and its two projections — the user–user network and the proposal–proposal network. This communicates the structural requirements R5–R9 visually.

**Three panels:**

**Panel (a) — Bipartite Graph:**
- Left column: 5 user nodes (U1–U5), shown as person icons or circles
- Right column: 8 proposal nodes (P1–P8), shown as document icons or squares, colour-coded by label
- Edges: lines connecting users to proposals they evaluated
- Key property to show: each user connects to 4–6 proposals (not all); each proposal connects to 2–4 users (coverage)

**Example edge set:**

| User | Evaluated Proposals |
|------|-------------------|
| U1 | P1, P2, P3, P5 |
| U2 | P1, P3, P4, P6 |
| U3 | P2, P4, P5, P7 |
| U4 | P3, P5, P6, P8 |
| U5 | P4, P6, P7, P8 |

**Panel (b) — User–User Projection:**
- 5 user nodes in a circle layout
- Edges between users who share evaluated proposals (weighted by count of shared proposals)
- U1–U2 connected (share P1, P3); U1–U3 (share P2, P5); etc.
- Annotate: "R5: overlapping evaluation sets", "R6: distributed specialisation", "R7: connectivity (no isolates)"

**Panel (c) — Proposal–Proposal Projection:**
- 8 proposal nodes, colour-coded by label
- Edges between proposals evaluated by the same user
- Cross-label edges highlighted (dashed or different colour) — these are the R8 "bridging" edges
- Within-label edges shown as solid — these are the R9 "competitive evaluation" edges
- Annotate: "R8: cross-label co-attention", "R9: within-label competition"

**Visual encoding:**
- Clean, academic network diagram style
- Users as circles, proposals as squares (or vice versa)
- Label colours consistent with Figure 1 (α = blue, β = green, γ = amber)
- Edge thickness proportional to number of shared connections in the projected networks

**Size:** Landscape, approximately 16cm × 12cm (three panels in a row or 2+1 layout).

---

### Figure 8: Anti-Preferential Attachment — Exploration Boost Curve

**Purpose:** Contrast the PersonalFocus algorithm's anti-preferential attachment dynamic with standard platform dynamics (rich-get-richer). A simple line plot.

**Data — two curves:**

Curve 1: "Standard platform (preferential attachment)"
- As views increase, future visibility increases (rich-get-richer)
- Formula: `visibility ∝ views` (linear) or `visibility ∝ √views` (sublinear but still increasing)
- Plot as: `y = 0.1 * sqrt(x + 1)` for x in [0, 50]

Curve 2: "PersonalFocus (anti-preferential attachment)"
- As views increase, future visibility *decreases*
- Formula: `Exploration Boost = 1 / √(views + 1)`
- Plot as: `y = 1 / sqrt(x + 1)` for x in [0, 50]

**Layout:** Standard XY line plot.
- X-axis: "Unique view count" (0 to 50)
- Y-axis: "Relative feed visibility" (0 to 1.2)
- Two curves with distinct colours and line styles
- Legend in top-right corner
- Annotation arrow pointing to the crossing region: "PersonalFocus inverts the standard dynamic"

**Visual encoding:**
- Standard platform curve: solid line, warm colour (red/orange), trending upward
- PersonalFocus curve: solid line, cool colour (blue/teal), trending downward
- Grid lines, axis labels, clean academic chart style
- No background colour (white background for LaTeX)

**Size:** Approximately 10cm × 7cm.

---

### Figure 9: The Interaction Funnel (Schematic)

**Purpose:** Show the cascade of user actions from feed impression → view → subscribe → author, with each step representing increased cognitive commitment and a drop-off. This sets up the reader for the results chapter.

**Layout:** Horizontal funnel (or vertical, tapering downward).

**Four stages:**

| Stage | Action | Cognitive Cost | Expected Drop-off |
|-------|--------|---------------|-------------------|
| 1 | Feed impression (see card) | Minimal (scrolling) | — |
| 2 | Detail view (open proposal) | Low (click to read) | ~50–70% drop |
| 3 | Subscribe (endorse) | Moderate (evaluative judgment) | ~60–80% drop |
| 4 | Author remix (constructive response) | High (write new content) | ~80–95% drop |

**Visual encoding:**
- Four bars/sections decreasing in width from top to bottom (or left to right)
- Each section labelled with the action name and a one-line description
- Between sections: a small annotation showing the cognitive cost increase ("read → evaluate → compose")
- The narrowing funnel visually communicates that authoring is the most demanding action
- Colour gradient: light at the top (easy), dark at the bottom (hard)

**Annotation at bottom:** "The positive-only constraint places disagreement at Stage 4 (highest cognitive cost)"

**Size:** Approximately 8cm × 12cm (portrait) or 14cm × 6cm (landscape).

---

### Figure 10: CI Traditions — Conceptual Positioning Map

**Purpose:** Map the four CI traditions (now including self-organisation) and locate remixing's position. Section 1.3.5 explicitly describes this 2-axis space.

**Layout:** 2×2 quadrant diagram.

**Axes:**
- X-axis: "Independent agents" ←→ "Interactive agents"
- Y-axis: "Synchronic (bounded task)" ←→ "Diachronic (cumulative)"

**Quadrant contents:**

| Quadrant | Tradition | Key citation |
|----------|-----------|-------------|
| Independent + Synchronic | Aggregation CI (Wisdom of Crowds) | Surowiecki 2004 |
| Interactive + Synchronic | c-factor (Collaboration CI) | Woolley et al. 2010 |
| Interactive + Diachronic | Collective Brain (Cumulative Culture) | Muthukrishna & Henrich 2016 |
| Independent + Diachronic | (empty — or note "Swarm Intelligence" as excluded: real-time, not diachronic) |

**Remixing's position:** An overlay shape (e.g., a rounded rectangle or star) spanning from the Interactive+Synchronic quadrant into the Interactive+Diachronic quadrant, with annotation: "Remixing: compresses diachronic logic into synchronic interaction"

**Self-organisation:** Shown as a band or annotation spanning the full interactive column: "Self-organisation: design methodology for interaction rules (cuts across time scales)" — per the new §1.3.4.

**Visual encoding:**
- Light grid background with quadrant labels
- Each tradition as a labelled circle/oval positioned in its quadrant
- Remixing as a distinct colour (e.g., the platform's primary accent) spanning across the boundary
- Clean, minimal — academic diagram style

**Size:** Square, approximately 12cm × 12cm.

---

## Implementation Notes for the Generating Agent

1. **Rendering technology:** Use HTML Canvas or SVG. The platform's graph views use JS-based rendering — match that style where possible. For charts (Figure 8), use a simple charting library or raw SVG.

2. **Export format:** Each figure should be exportable as both SVG (for scalable LaTeX inclusion) and PNG (300dpi fallback). Use a consistent export mechanism.

3. **Colour palette:** Derive from the platform's existing theme. Key colours to extract from the codebase:
   - Root proposal node colour
   - Remix node colour
   - Combination node colour
   - Label colours (α, β, γ)
   - Champion/Leading Idea highlight colour
   - Subscription badge colour

4. **Typography:** Use the same font family as the platform's graph labels, or a clean sans-serif (Inter, system-ui) for the generated figures.

5. **Output directory:** `Report/Master Thesis - Draft/figures/`

6. **File naming convention:**
   - `fig_proposal_dag.svg`
   - `fig_convergence_pipeline.svg`
   - `fig_siphon_effect.svg`
   - `fig_design_contract.svg`
   - `fig_phase_state_machine.svg`
   - `fig_label_ballot.svg`
   - `fig_bipartite_graph.svg`
   - `fig_anti_preferential.svg`
   - `fig_interaction_funnel.svg`
   - `fig_ci_traditions.svg`

7. **LaTeX integration:** Each figure will be included via `\includegraphics` in the thesis. Ensure SVGs are compatible with LaTeX's SVG handling, or provide PDF conversions.
