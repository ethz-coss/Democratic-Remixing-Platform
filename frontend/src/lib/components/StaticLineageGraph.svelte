<script lang="ts">
	import { computeDagLayout } from '$lib/services/dag-layout-engine';
	import { navigateToProposal } from '$lib/utils/nav';
	import { feedViewState } from '$lib/feedView.svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages.js';
	import { Bell, EyeOff } from '@lucide/svelte';

	import type { NodeRelationType } from '$lib/services/local-neighborhood';

	interface Props {
		focusedNodeId: string;
		neighborhoodProposals: App.ProposalRecord[];
		allProposals: App.ProposalRecord[];
		labels: App.LabelRecord[];
		question: App.QuestionRecord;
		questionId: string;
		disableFullscreen?: boolean;
		nodeTypes?: Map<string, NodeRelationType>;
		hiddenSiblingCount?: number;
		/** IDs of proposals hidden by the current user */
		hiddenProposalIds?: Set<string>;
		/** Current user's votes: proposalId → vote value (1 = subscribed) */
		userVotes?: Record<string, number>;
	}

	let {
		focusedNodeId,
		neighborhoodProposals,
		allProposals,
		labels,
		question,
		questionId,
		disableFullscreen = false,
		nodeTypes = new Map(),
		hiddenSiblingCount = 0,
		hiddenProposalIds = new Set(),
		userVotes = {}
	}: Props = $props();

	let isDesktop = $state(browser ? window.matchMedia('(min-width: 769px)').matches : false);
	let isLegendExpanded = $derived(isDesktop);

	$effect(() => {
		const mql = window.matchMedia('(min-width: 769px)');
		const onChange = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

	// ── DAG Layout ────────────────────────────────────────────────────
	// Pass all proposals to dagre so it can resolve any structural edges (even for siblings)
	const layout = $derived(
		computeDagLayout(
			neighborhoodProposals,
			neighborhoodProposals, // constrained pool — prevents foreign nodes entering layout
			{},
			'proposal',
			new Set(),
			new Set(),
			undefined,
			question,
			true // dotMode
		)
	);

	// ── Panning ───────────────────────────────────────────────────────
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let panX = $state(0);
	let panY = $state(0);
	let isDragging = $state(false);
	let isFullscreen = $state(false);

	let dragStartX = 0;
	let dragStartY = 0;
	let panStartX = 0;
	let panStartY = 0;
	let rafId: number | null = null;

	const viewBox = $derived(
		containerWidth > 0 && containerHeight > 0
			? `${panX} ${panY} ${containerWidth} ${containerHeight}`
			: '0 0 200 100'
	);

	let lastCenteredNodeId = $state<string | null>(null);
	let lastCenteredLayoutNodesLength = $state<number>(0);
	let prevContainerWidth = $state(0);
	let prevContainerHeight = $state(0);

	$effect(() => {
		if (containerWidth > 0 && containerHeight > 0) {
			if (prevContainerWidth > 0 && prevContainerHeight > 0) {
				const dw = containerWidth - prevContainerWidth;
				const dh = containerHeight - prevContainerHeight;
				panX -= dw / 2;
				panY -= dh / 2;
			}
			prevContainerWidth = containerWidth;
			prevContainerHeight = containerHeight;
		}
	});

	$effect(() => {
		if (containerWidth > 0 && containerHeight > 0 && layout.nodes.length > 0) {
			if (
				lastCenteredNodeId !== focusedNodeId ||
				lastCenteredLayoutNodesLength !== layout.nodes.length
			) {
				const minX = layout.nodes.reduce((min, n) => Math.min(min, n.x - n.width / 2), Infinity);
				const maxX = layout.nodes.reduce((max, n) => Math.max(max, n.x + n.width / 2), -Infinity);
				const minY = layout.nodes.reduce((min, n) => Math.min(min, n.y - n.height / 2), Infinity);
				const maxY = layout.nodes.reduce((max, n) => Math.max(max, n.y + n.height / 2), -Infinity);

				const graphWidth = maxX - minX + 160;
				const graphHeight = maxY - minY + 160;

				if (graphWidth <= containerWidth && graphHeight <= containerHeight) {
					const centerX = (minX + maxX) / 2;
					const centerY = (minY + maxY) / 2;
					panX = centerX - containerWidth / 2;
					panY = centerY - containerHeight / 2;
				} else {
					const targetNode = layout.nodes.find((n) => n.id === focusedNodeId);
					if (targetNode) {
						panX = targetNode.x - containerWidth / 2;
						panY = targetNode.y - containerHeight / 2;
					} else {
						const centerX = (minX + maxX) / 2;
						const centerY = (minY + maxY) / 2;
						panX = centerX - containerWidth / 2;
						panY = centerY - containerHeight / 2;
					}
				}
				lastCenteredNodeId = focusedNodeId ?? null;
				lastCenteredLayoutNodesLength = layout.nodes.length;
			}
		}
	});

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const target = e.target as Element;
		if (target.closest('button') || target.closest('.node-group')) {
			return;
		}

		isDragging = true;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		panStartX = panX;
		panStartY = panY;

		const onPointerMove = (me: PointerEvent) => {
			const dx = me.clientX - dragStartX;
			const dy = me.clientY - dragStartY;
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				panX = panStartX - dx;
				panY = panStartY - dy;
				rafId = null;
			});
		};

		const onPointerUp = () => {
			isDragging = false;
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
	}

	// ── Multi-label arc ring ──────────────────────────────────────────
	interface SvgArcSpec {
		d: string;
		color: string;
		labelId: string;
	}

	function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
		const rad = ((angleDeg - 90) * Math.PI) / 180;
		return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
	}

	function describeArc(x: number, y: number, r: number, startAngle: number, endAngle: number) {
		const start = polarToCartesian(x, y, r, endAngle);
		const end = polarToCartesian(x, y, r, startAngle);
		const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
		return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
	}

	function buildLabelArcs(
		cx: number,
		cy: number,
		additionalLabels: string[],
		maxShown = 3
	): SvgArcSpec[] {
		if (additionalLabels.length === 0) return [];
		const showCount = Math.min(additionalLabels.length, maxShown);
		const hasMore = additionalLabels.length > maxShown;
		const segments = hasMore ? showCount + 1 : showCount;
		const arcs: SvgArcSpec[] = [];
		const r = 19;
		const gap = 4;
		const anglePerSegment = 360 / segments;
		let startAngle = -90;

		for (let i = 0; i < showCount; i++) {
			const labelId = additionalLabels[i];
			arcs.push({
				d: describeArc(cx, cy, r, startAngle, startAngle + anglePerSegment - gap),
				color: getLabelColor(labelId),
				labelId
			});
			startAngle += anglePerSegment;
		}
		if (hasMore) {
			arcs.push({
				d: describeArc(cx, cy, r, startAngle, startAngle + anglePerSegment - gap),
				color: '#cbd5e1',
				labelId: 'more'
			});
		}
		return arcs;
	}

	// ── Stub highlight interaction ────────────────────────────────────
	let highlightedNodeId = $state<string | null>(null);
	let highlightClearTimer: ReturnType<typeof setTimeout> | null = null;

	function highlightNode(nodeId: string) {
		highlightedNodeId = nodeId;
		if (highlightClearTimer) clearTimeout(highlightClearTimer);
		highlightClearTimer = setTimeout(() => {
			highlightedNodeId = null;
		}, 1800);
	}

	// ── Combined nodes: lineage (from dagre) + siblings (manual) ─────
	// Stubs are computed AFTER the full combinedNodes set is built.
	const combinedNodes = $derived.by(() => {
		const nodes = [...layout.nodes];
		const egoNode = nodes.find((n) => n.id === focusedNodeId);

		// Sibling overflow stub (if any siblings were capped by capacity in computeLocalNeighborhood)
		if (egoNode && hiddenSiblingCount > 0) {
			const maxY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y)) : egoNode.y;
			const siblingSpacing = 120;
			nodes.push({
				id: 'stub-siblings',
				x: egoNode.x,
				y: maxY + siblingSpacing,
				width: 80,
				height: 80,
				proposal: { id: 'stub-siblings', title: `+${hiddenSiblingCount}` } as any,
				kind: 'stub' as any,
				inArena: false as any
			} as any);
		}

		// Build a Set of all real node IDs in this view for fast lookup
		const visibleIds = new Set(nodes.filter((n) => (n as any).kind !== 'stub').map((n) => n.id));

		// For each real visible node, find missing parents and children
		for (const node of [...nodes]) {
			if ((node as any).kind === 'stub') continue;
			if (!node.proposal) continue;

			const hasIncoming = (layout.structuralEdges || []).some((e) => e.target === node.id);
			const hasOutgoing = (layout.structuralEdges || []).some((e) => e.source === node.id);

			// Missing parents: parent_proposals entries not in visible set
			const missingParentIds = (node.proposal.parent_proposals || []).filter(
				(pid: string) => !visibleIds.has(pid)
			);
			if (missingParentIds.length > 0) {
				nodes.push({
					id: `stub-parent-${node.id}`,
					x: node.x - 70,
					y: node.y + (hasIncoming ? -28 : 0), // Angle up to avoid overlapping real incoming edge
					width: 60,
					height: 60,
					proposal: { id: `stub-parent-${node.id}`, title: `+${missingParentIds.length}` } as any,
					kind: 'stub' as any,
					stubAttachedTo: node.id,
					stubType: 'parents',
					inArena: false as any
				} as any);
			}

			// Missing children: proposals in allProposals that list this node as parent but are not visible
			const missingChildCount = allProposals.filter(
				(p) => (p.parent_proposals || []).includes(node.id) && !visibleIds.has(p.id)
			).length;
			if (missingChildCount > 0) {
				nodes.push({
					id: `stub-child-${node.id}`,
					x: node.x + 70,
					y: node.y + (hasOutgoing ? 28 : 0), // Angle down to avoid overlapping real outgoing edge
					width: 60,
					height: 60,
					proposal: { id: `stub-child-${node.id}`, title: `+${missingChildCount}` } as any,
					kind: 'stub' as any,
					stubAttachedTo: node.id,
					stubType: 'children',
					inArena: false as any
				} as any);
			}
		}

		return nodes;
	});

	// ── Combined edges ────────────────────────────────────────────────
	const combinedEdges = $derived.by(() => {
		const edges = [...(layout.structuralEdges || [])];

		// Stub edges — dashed from each stub to its attached node
		for (const node of combinedNodes) {
			const attachedTo = (node as any).stubAttachedTo;
			if (!attachedTo) continue;
			const attachedNode = combinedNodes.find((n) => n.id === attachedTo);
			if (!attachedNode) continue;

			const isParentStub = (node as any).stubType === 'parents';

			// If it's a parent stub, edge goes FROM stub TO real node
			// If it's a child stub, edge goes FROM real node TO stub
			// If it's a sibling stub, edge goes FROM real node TO stub
			const sourceNode = isParentStub ? node : attachedNode;
			const targetNode = isParentStub ? attachedNode : node;

			const rSrc = (sourceNode as any).kind === 'stub' ? 16 : 18;
			const rTgt = ((targetNode as any).kind === 'stub' ? 16 : 18) + 6; // +6 for arrow head

			const angle = Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x);

			const pStart = {
				x: sourceNode.x + Math.cos(angle) * rSrc,
				y: sourceNode.y + Math.sin(angle) * rSrc
			};
			const pEnd = {
				x: targetNode.x - Math.cos(angle) * rTgt,
				y: targetNode.y - Math.sin(angle) * rTgt
			};

			edges.push({
				id: `stub-edge-${node.id}`,
				source: sourceNode.id,
				target: targetNode.id,
				points: [pStart, pEnd],
				type: 'lineage-stub',
				weight: 1
			} as any);
		}

		return edges;
	});

	// ── Helpers ───────────────────────────────────────────────────────
	function getLabelColor(labelId: string | undefined): string {
		if (!labelId) return '#cbd5e1';
		return labels.find((l) => l.id === labelId)?.color || '#cbd5e1';
	}

	function isUnseen(nodeId: string): boolean {
		const seenIds = page.data.seenProposalIds ?? [];
		return !seenIds.includes(nodeId) && !feedViewState.optimisticSeen.includes(nodeId);
	}

	function isHidden(nodeId: string): boolean {
		return hiddenProposalIds.has(nodeId);
	}

	function isSubscribed(nodeId: string): boolean {
		return (userVotes[nodeId] ?? 0) > 0;
	}

	function handleNodeClick(node: any) {
		if ((node.kind as any) === 'stub') {
			// Highlight the attached real node, don't navigate
			if (node.stubAttachedTo) {
				highlightNode(node.stubAttachedTo);
			}
			return;
		}
		if (isFullscreen) isFullscreen = false;
		navigateToProposal(`/questions/${questionId}/proposals/${node.id}`);
	}

	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
		lastCenteredNodeId = null;
		lastCenteredLayoutNodesLength = 0;
	}

	function portal(node: HTMLElement, portaled: boolean) {
		let originalParent = node.parentNode;
		let placeholder = document.createComment('portal-placeholder');

		function update(isPortaled: boolean) {
			if (isPortaled) {
				if (node.parentNode !== document.body) {
					originalParent?.insertBefore(placeholder, node);
					document.body.appendChild(node);
				}
			} else {
				if (node.parentNode === document.body) {
					placeholder.parentNode?.insertBefore(node, placeholder);
					placeholder.parentNode?.removeChild(placeholder);
				}
			}
		}

		update(portaled);
		return {
			update,
			destroy() {
				if (node.parentNode === document.body) {
					placeholder.parentNode?.insertBefore(node, placeholder);
					placeholder.parentNode?.removeChild(placeholder);
				}
			}
		};
	}

	function createPath(points: { x: number; y: number }[] | undefined): string {
		if (!points || points.length === 0) return '';
		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length; i++) {
			d += ` L ${points[i].x} ${points[i].y}`;
		}
		return d;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="static-lineage-graph"
	use:portal={isFullscreen}
	bind:clientWidth={containerWidth}
	bind:clientHeight={containerHeight}
	class:is-dragging={isDragging}
	class:is-fullscreen={isFullscreen}
	class:disable-fullscreen={disableFullscreen}
	onpointerdown={handlePointerDown}
	role="application"
	aria-label="Idea graph — drag to pan"
>
	<div class="graph-legend">
		<button
			class="legend-toggle"
			onclick={() => (isLegendExpanded = !isLegendExpanded)}
			aria-expanded={isLegendExpanded}
		>
			<span>{m.dag_legend_title()}</span>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				style="transform: rotate({isLegendExpanded
					? '180deg'
					: '0deg'}); transition: transform 0.2s;"
			>
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</button>

		{#if isLegendExpanded}
			<div class="legend-items">
				<div class="legend-item">
					<svg width="24" height="24"
						><circle
							cx="12"
							cy="12"
							r="10"
							fill="none"
							stroke="#334155"
							stroke-width="2"
							stroke-dasharray="4 2"
						/></svg
					>
					<span>{m.dag_legend_static_focused_idea()}</span>
				</div>
				<div class="legend-item">
					<svg width="24" height="24"><circle cx="12" cy="12" r="7" fill="#94a3b8" /></svg>
					<span>{m.dag_legend_static_label()}</span>
				</div>
				<div class="legend-item">
					<svg width="24" height="24"
						><path
							d="M 12 2 A 10 10 0 0 1 22 12"
							fill="none"
							stroke="#cbd5e1"
							stroke-width="3"
						/></svg
					>
					<span>{m.dag_legend_static_additional_labels()}</span>
				</div>
				<div class="legend-item">
					<svg width="24" height="24"
						><circle
							cx="12"
							cy="12"
							r="8"
							fill="#f8fafc"
							stroke="#94a3b8"
							stroke-width="1.5"
							stroke-dasharray="2 2"
						/><text
							x="12"
							y="15"
							text-anchor="middle"
							fill="#64748b"
							font-size="9"
							font-weight="bold"
							pointer-events="none">+</text
						></svg
					>
					<span>{m.dag_legend_static_more_ideas()}</span>
				</div>
				<div class="legend-item">
					<svg width="24" height="24">
						<circle cx="12" cy="12" r="7" fill="#94a3b8" opacity="0.35" />
						<g transform="translate(6, 6)">
							<circle cx="12" cy="12" r="6" fill="#f8fafc" stroke="#64748b" stroke-width="1" />
							<EyeOff size={8} color="#64748b" x="8" y="8" strokeWidth={2.5} />
						</g>
					</svg>
					<span>{m.dag_legend_static_hidden()}</span>
				</div>
				<div class="legend-item">
					<svg width="24" height="24">
						<circle cx="12" cy="12" r="7" fill="#94a3b8" />
						<g transform="translate(6, 6)">
							<circle cx="12" cy="12" r="6" fill="#22c55e" stroke="#ffffff" stroke-width="1.5" />
							<Bell size={8} color="white" x="8" y="8" strokeWidth={2.5} />
						</g>
					</svg>
					<span>{m.dag_legend_static_subscribed()}</span>
				</div>
			</div>
		{/if}
	</div>

	{#if !disableFullscreen}
		<button class="fullscreen-btn" onclick={toggleFullscreen} aria-label="Toggle Fullscreen">
			{#if isFullscreen}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
					/></svg
				>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
					/></svg
				>
			{/if}
		</button>
	{/if}

	{#if combinedNodes.length >= 0}
		<svg {viewBox} width="100%" height="100%">
			<defs>
				<marker
					id="arrowhead"
					viewBox="0 -5 10 10"
					refX="8"
					refY="0"
					markerWidth="6"
					markerHeight="6"
					orient="auto"
				>
					<path d="M 0,-5 L 10,0 L 0,5" fill="#94a3b8" />
				</marker>
			</defs>

			<!-- Edges -->
			{#each combinedEdges as edge}
				{@const edgeType = (edge as any).type}
				<path
					d={createPath(edge.points)}
					fill="none"
					stroke="#94a3b8"
					stroke-width={edgeType === 'lineage-stub' ? 1.5 : 2}
					stroke-dasharray="none"
					opacity={edgeType === 'lineage-stub' ? 0.5 : edgeType === 'topic-peer' ? 0.6 : 1}
					marker-end={edgeType === 'structural' || !edgeType ? 'url(#arrowhead)' : ''}
				/>
			{/each}

			<!-- Nodes -->
			{#each combinedNodes as node}
				<g
					class="node-group"
					class:is-stub={(node as any).kind === 'stub'}
					class:focused={node.id === focusedNodeId}
					class:highlighted={node.id === highlightedNodeId}
					transform={`translate(${node.x}, ${node.y})`}
					onclick={() => handleNodeClick(node)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							handleNodeClick(node);
						}
					}}
					role="button"
					tabindex={(node as any).kind === 'stub' ? -1 : 0}
				>
					<g class="node-content">
						{#if (node as any).kind === 'stub'}
							<!-- Stub node: dashed circle with count label -->
							<circle
								cx="0"
								cy="0"
								r="12"
								fill="#f8fafc"
								stroke="#94a3b8"
								stroke-width="1.5"
								stroke-dasharray="3 2"
							/>
							<text
								x="0"
								y="4"
								text-anchor="middle"
								fill="#64748b"
								font-size="9"
								font-weight="600"
								pointer-events="none">{node.proposal?.title}</text
							>
						{:else}
							<!-- Outer wrapper: fade hidden nodes -->
							<g opacity={isHidden(node.id) ? 0.35 : 1}>
								<!-- Highlight ring (animated when highlighted) -->
								{#if node.id === highlightedNodeId}
									<circle
										cx="0"
										cy="0"
										r="22"
										fill="none"
										stroke="#f59e0b"
										stroke-width="2.5"
										class="highlight-ring"
									/>
								{/if}

								<!-- Focus ring -->
								{#if node.id === focusedNodeId}
									<circle
										cx="0"
										cy="0"
										r="20"
										fill="none"
										stroke="#334155"
										stroke-width="2"
										stroke-dasharray="4 2"
									/>
								{/if}

								<!-- Primary label fill -->
								<circle cx="0" cy="0" r="14" fill={getLabelColor(node.proposal?.primary_label)} />

								<!-- Multi-label outer arc rings -->
								{#if (node.proposal?.labels?.length ?? 0) > 1}
									{#each buildLabelArcs( 0, 0, (node.proposal.labels ?? []).filter((id: string) => id !== node.proposal.primary_label) ) as arc}
										<path d={arc.d} stroke={arc.color} stroke-width="4" fill="none" />
									{/each}
								{/if}

								<!-- White border ring -->
								<circle
									cx="0"
									cy="0"
									r="14"
									fill="none"
									stroke={node.id === focusedNodeId ? '#334155' : '#ffffff'}
									stroke-width="2"
								/>
							</g>

							<!-- Status icon overlay (bottom right badge) -->
							{#if isHidden(node.id)}
								<!-- Eye-off icon -->
								<g>
									<circle cx="10" cy="10" r="7" fill="#f8fafc" stroke="#64748b" stroke-width="1" />
									<EyeOff size={10} color="#64748b" x="5" y="5" strokeWidth={2.5} />
								</g>
							{:else if isSubscribed(node.id)}
								<!-- Green bell circle -->
								<g>
									<circle
										cx="10"
										cy="10"
										r="7"
										fill="#22c55e"
										stroke="#ffffff"
										stroke-width="1.5"
									/>
									<Bell size={9} color="white" x="5.5" y="5.5" strokeWidth={2.5} />
								</g>
							{/if}

							<!-- Unseen indicator dot -->
							{#if isUnseen(node.id) && !isHidden(node.id)}
								<circle cx="10" cy="-10" r="4" fill="#3b82f6" stroke="#ffffff" stroke-width="1.5" />
							{/if}
						{/if}

						<title>{node.proposal?.title}</title>

						<!-- Title label below node -->
						{#if node.proposal?.title && (node as any).kind !== 'stub'}
							<foreignObject
								x="-55"
								y="18"
								width="110"
								height="70"
								style="overflow: visible; pointer-events: none;"
							>
								<div xmlns="http://www.w3.org/1999/xhtml" class="node-title-container">
									{node.proposal.title}
								</div>
							</foreignObject>
						{/if}
					</g>
				</g>
			{/each}
		</svg>
	{/if}
</div>

<style>
	.static-lineage-graph {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		max-height: 80vh;
		min-height: 150px;
		display: flex;
		justify-content: center;
		align-items: center;
		background: #f8fafc;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		overflow: hidden;
		cursor: grab;
		touch-action: none;
	}

	.static-lineage-graph.disable-fullscreen {
		aspect-ratio: auto;
		max-height: none;
		height: 100%;
		border-radius: 0;
		border: none;
	}

	.static-lineage-graph.is-fullscreen {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100dvh;
		max-height: none;
		aspect-ratio: auto;
		z-index: 99999;
		border-radius: 0;
		border: none;
	}

	.static-lineage-graph.is-dragging {
		cursor: grabbing;
		user-select: none;
		-webkit-user-select: none;
	}

	/* Canvas vignette — signals off-screen content */
	.static-lineage-graph::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(ellipse at center, transparent 60%, #f8fafc 97%);
		pointer-events: none;
		border-radius: 8px;
		z-index: 1;
	}

	.fullscreen-btn {
		position: absolute;
		top: max(1rem, env(safe-area-inset-top, 1rem));
		right: max(1rem, env(safe-area-inset-right, 1rem));
		width: 36px;
		height: 36px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid #e2e8f0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #475569;
		cursor: pointer;
		z-index: 10;
		transition: all 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.fullscreen-btn:hover {
		background: white;
		color: #0f172a;
		transform: scale(1.05);
	}

	.node-group {
		cursor: pointer;
	}

	.node-group.is-stub {
		cursor: help;
	}

	.node-content {
		transition: transform 0.15s ease-out;
	}

	.node-group:hover .node-content {
		transform: scale(1.12);
	}

	.node-group.is-stub:hover .node-content {
		transform: scale(1.05);
	}

	/* Highlight pulse animation for stub-click feedback */
	@keyframes highlight-pulse {
		0% {
			opacity: 1;
			r: 22;
		}
		50% {
			opacity: 0.4;
			r: 26;
		}
		100% {
			opacity: 1;
			r: 22;
		}
	}

	.highlight-ring {
		animation: highlight-pulse 0.6s ease-in-out 3;
	}

	.node-title-container {
		display: flex;
		justify-content: center;
		text-align: center;
		font-size: 10px;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: #334155;
		line-height: 1.2;
		word-wrap: break-word;
	}

	.graph-legend {
		position: absolute;
		bottom: max(1rem, env(safe-area-inset-bottom, 1rem));
		left: max(1rem, env(safe-area-inset-left, 1rem));
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		font-size: 0.75rem;
		color: #475569;
		z-index: 10;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		pointer-events: auto;
	}

	.legend-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		color: inherit;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
	}

	.legend-items {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0 0.75rem 0.5rem 0.75rem;
		border-top: 1px solid #e2e8f0;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
