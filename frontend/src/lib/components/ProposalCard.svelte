<script lang="ts">
	/**
	 * ProposalCard — unified proposal card component.
	 *
	 * Renders one of 5 density variants from a single component:
	 *   dot      — SVG circle for DAG map nodes
	 *   mini     — single row, 44px, for trails/ballots/notifications
	 *   compact  — two-row, ~80px, for DAG expanded / ballot ranked / grouped feed
	 *   standard — full feed card, ~130px, with excerpt and action bar
	 *   full     — unbounded, for detail pages and compare sheet columns
	 *
	 * Icons from terminology.ts:
	 *   ICON_SUBSCRIBE     = ArrowUp   (support)
	 *   ICON_COMPARE  = Merge     (compare pool)
	 *   ICON_CHAMPION = Star     (cluster leader)
	 *   ICON_IMPROVE  = Wrench    (improve-type)
	 *   ICON_COMBINE  = Merge     (synthesis-type)
	 *   ICON_PROPOSAL = FileText  (new-type)
	 *
	 * Seen/unseen:  filled blue dot before title when !isSeen.
	 *               NO dimming — absence of dot is the only seen indicator.
	 * Voted:        green arrow-up overlay on dot variant; green-filled pill on others.
	 */

	import type { Snippet } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { Pencil, Trophy, Star, Sparkles, X, ChevronRight, EyeOff, BellOff } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages.js';
	import * as T from '$lib/utils/terminology';
	import { localizePath } from '$lib/utils/i18n-path';
	import { openProposalModal } from '$lib/utils/nav';
	import { stripRichText } from '$lib/markdown';
	import { editorState } from '$lib/editor.svelte';
	import { voteState } from '$lib/stores/voteState.svelte';

	import { swipeToDismiss } from '$lib/actions/swipe';

	// ── Props ────────────────────────────────────────────────────────────────

	interface Props {
		// ── Data ──
		proposal: App.ProposalRecord;

		// ── View tracking ──
		/** true = user has seen this proposal (default). No blue dot shown. */
		isSeen?: boolean;
		/** Number of children added since user's vote (pulsing badge) */
		unseenImprovementCount?: number;

		// ── Vote state ──
		/** User's current vote: 1 = supported, 0 = not voted */
		userVote?: number;
		/** Shows "✍️ By you" badge */
		isAuthored?: boolean;

		// ── Status ──
		isChampion?: boolean;
		isSynthesis?: boolean;
		poolStatus?: 'winner' | 'focus' | 'none';

		// ── Cluster ──
		clusterColor?: string;
		clusterTitle?: string;
		/** Two colors for split-colored combined dot (synthesis nodes) */
		crossClusterColors?: string[];
		/** All active labels for this proposal */
		activeLabels?: Array<{ id: string; short_name: string; color: string }>;

		// ── Support ──
		subscriptionCount?: number;
		/** 0–100 percentage for support track bar */
		barPct?: number;

		// ── Display ──
		variant: 'dot' | 'mini' | 'compact' | 'standard' | 'full';
		/** Rank number — rendered externally by parent for ballot view */
		rank?: number;
		/** reason_for_change — shown as italic differentiator in ancestry trail */
		differentiator?: string;
		/** Special styling variant for dashboard views */
		highlightVariant?: 'leader' | 'contender' | 'merge' | 'serendipity' | 'improvement';
		/** Whether card is clickable to navigate to detail page */
		interactive?: boolean;

		// ── DAG-specific ──
		/** Show "+" expand button on dot variant */
		expandable?: boolean;
		onExpand?: () => void;
		onCollapse?: () => void;

		// ── Voting ──
		/** Whether voting is allowed (false = show login prompt) */
		canVote?: boolean;
		/** Override for disabled state */
		disabled?: boolean;

		// ── Compare ──
		/** Whether compare button should be hidden */
		hideCompare?: boolean;

		// ── Display Toggles ──
		hideClusterLabel?: boolean;
		hideTitle?: boolean;
		hideSupport?: boolean;
		forceExcerpt?: boolean;
		/** Show reason for change instead of the general preview text */
		showReasonForChange?: boolean;

		// ── Context ──
		relationLabel?: string;
		relationLabelColor?: string;

		// ── Hide ──
		onHide?: (id: string) => void;
		onRestore?: (id: string) => void;
		isHidden?: boolean;

		// ── Final Results ──
		/** Numeric score for Borda count */
		bordaScore?: number;
		/** Maximum possible score for relative bar width */
		bordaMaxScore?: number;

		// ── Slots ──
		/** Extra content for full variant (compare sheet additions) */
		extra?: Snippet;
	}

	let {
		proposal,
		isSeen = true,
		unseenImprovementCount = 0,
		userVote = 0,
		isAuthored = false,
		isChampion = false,
		isSynthesis = false,
		poolStatus = 'none',
		clusterColor = undefined,
		clusterTitle = undefined,
		activeLabels = undefined,
		crossClusterColors = undefined,
		subscriptionCount = 0,
		barPct = 0,
		variant,
		highlightVariant = undefined,
		rank = undefined,
		differentiator = undefined,
		interactive = true,
		expandable = false,
		onExpand = undefined,
		onCollapse = undefined,
		canVote = true,
		disabled = false,
		hideCompare = false,
		hideClusterLabel = false,
		hideTitle = false,
		hideSupport = false,
		forceExcerpt = false,
		showReasonForChange = false,
		relationLabel = undefined,
		relationLabelColor = undefined,
		onHide = undefined,
		onRestore = undefined,
		isHidden = false,
		bordaScore = undefined,
		bordaMaxScore = undefined,
		extra = undefined
	}: Props = $props();

	// ── Derived state ────────────────────────────────────────────────────────

	const isInComparePool = $derived(editorState.comparePool.some((p) => p.id === proposal.id));

	// Live vote display (via voteState store for optimistic updates)
	const displaySubscriptionCount = $derived(
		voteState.getSubscriptionCount(proposal.id) ?? subscriptionCount
	);
	const displayUserVote = $derived(voteState.getUserVote(proposal.id) ?? userVote);
	const displayIsVoted = $derived(displayUserVote === 1);

	// Proposal type
	const isRoot = $derived(!proposal.parent_proposals || proposal.parent_proposals.length === 0);
	const effectiveIsSynthesis = $derived(
		isSynthesis ||
			(Array.isArray(proposal.parent_proposals) && proposal.parent_proposals.length > 1)
	);

	// Effective title
	const effectiveTitle = $derived(
		proposal.title ||
			proposal.reason_for_change ||
			m.idea_card_untitled({ term: T.TERM_PROPOSAL() })
	);

	// Fallback description preview if title is redundant in a grouped view
	const isRedundantTitle = $derived(
		!!clusterTitle && effectiveTitle.trim().toLowerCase() === clusterTitle.trim().toLowerCase()
	);
	const descriptionPreview = $derived.by(() => {
		if (!proposal.content) return '';
		const plainText = proposal.content
			.replace(/<[^>]*>?/gm, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return plainText.length > 120 ? plainText.substring(0, 117) + '...' : plainText;
	});

	// Detail page href
	const detailHref = $derived(
		localizePath(`/questions/${proposal.question}/proposals/${proposal.id}`)
	);

	// Dot sizing — lerped 18–36px based on support percentage
	const dotSize = $derived(Math.round(18 + (barPct / 100) * 18));
	// Dot color: champion=amber, cluster color, fallback gray
	const dotColor = $derived(
		poolStatus === 'winner' ? 'var(--ink, #111)' : (clusterColor ?? 'var(--muted, #9ca3af)')
	);

	// Vote handler
	function handleVote(e?: Event) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		if (!canVote || disabled) return;

		const isSubscribing = !displayIsVoted;
		voteState.submitVote(proposal.id, proposal.question);

		if (isSubscribing && isHidden && onRestore) {
			onRestore(proposal.id);
		}
	}

	// Compare handlers
	function addToCompare(e?: Event) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		editorState.addToComparePool(proposal);
	}

	function removeFromCompare(e?: Event) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		editorState.removeFromComparePool(proposal.id);
	}

	// ── Swipe Actions ──
	function handleHide(e?: Event) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		if (onHide) onHide(proposal.id);
		if (displayIsVoted && canVote && !disabled) {
			voteState.submitVote(proposal.id, proposal.question);
		}
	}

	function handleRestoreEvent(e?: Event) {
		if (e) {
			e.stopPropagation();
			e.preventDefault();
		}
		if (onRestore) onRestore(proposal.id);
	}

	function handleSwipeLeft() {
		if (isHidden && onRestore) {
			onRestore(proposal.id);
		} else if (onHide) {
			handleHide();
		}
	}

	function handleSwipeRight() {
		handleVote();
	}
</script>

<!-- ═══════════════════════════════════════════════════════ DOT VARIANT ═══ -->
{#if variant === 'dot'}
	<div
		class="pc-dot-wrapper"
		style="--dot-size: {dotSize}px; --cluster-color: {clusterColor ?? dotColor};"
	>
		<!-- Split-color for combined/synthesis proposals -->
		{#if effectiveIsSynthesis && crossClusterColors && crossClusterColors.length >= 2}
			<svg
				class="pc-dot"
				width={dotSize}
				height={dotSize}
				viewBox="0 0 {dotSize} {dotSize}"
				role="img"
				aria-label={effectiveTitle}
			>
				<defs>
					<clipPath id="clip-left-{proposal.id}">
						<rect x="0" y="0" width={dotSize / 2} height={dotSize} />
					</clipPath>
					<clipPath id="clip-right-{proposal.id}">
						<rect x={dotSize / 2} y="0" width={dotSize / 2} height={dotSize} />
					</clipPath>
				</defs>
				<circle
					cx={dotSize / 2}
					cy={dotSize / 2}
					r={dotSize / 2 - 1}
					fill={crossClusterColors[0]}
					clip-path="url(#clip-left-{proposal.id})"
				/>
				<circle
					cx={dotSize / 2}
					cy={dotSize / 2}
					r={dotSize / 2 - 1}
					fill={crossClusterColors[1]}
					clip-path="url(#clip-right-{proposal.id})"
				/>
			</svg>
		{:else}
			<!-- Standard solid dot -->
			<svg
				class="pc-dot"
				width={dotSize}
				height={dotSize}
				viewBox="0 0 {dotSize} {dotSize}"
				role="img"
				aria-label={effectiveTitle}
			>
				<circle cx={dotSize / 2} cy={dotSize / 2} r={dotSize / 2 - 1} fill={dotColor} />
			</svg>
		{/if}

		<!-- Overlays -->
		{#if isChampion}
			<span class="pc-dot-crown" aria-label={m.aria_champion()}>
				<T.ICON_CHAMPION size={12} fill="currentColor" />
			</span>
		{/if}

		{#if displayIsVoted}
			<!-- Voted: green arrow-up badge -->
			<span class="pc-dot-overlay voted" aria-label={m.aria_subscribed()}>
				<T.ICON_SUBSCRIBE size={10} />
			</span>
		{:else if !isSeen}
			<!-- Unseen: filled blue dot -->
			<span class="pc-dot-overlay unseen" aria-label={m.aria_new_idea()}></span>
		{/if}

		<!-- Expand button -->
		{#if expandable && onExpand}
			<button
				class="pc-dot-expand"
				onclick={onExpand}
				aria-label={m.aria_expand_idea()}
				type="button"
			>
				+
			</button>
		{/if}

		<!-- Title label below dot -->
		<span class="pc-dot-label">{effectiveTitle}</span>
	</div>

	<!-- ══════════════════════════════════════════════════════ MINI VARIANT ═══ -->
{:else if variant === 'mini'}
	<article
		class="pc-card pc-mini"
		style={clusterColor ? `--cluster-color: ${clusterColor};` : ''}
		id="proposal-card-mini-{proposal.id}"
	>
		{#if interactive}
			<a
				href={detailHref}
				onclick={(e) => openProposalModal(e, detailHref)}
				class="pc-mini-link"
				aria-label={effectiveTitle}
				data-sveltekit-preload-data="hover"
			>
				<div class="pc-mini-inner">
					{#if !isSeen}
						<span class="pc-unseen-dot" aria-label={m.aria_unseen_idea()}></span>
					{/if}
					{#if !hideTitle}
						<span class="pc-mini-title">{effectiveTitle}</span>
					{/if}
					{#if differentiator}
						<span class="pc-mini-diff">{differentiator}</span>
					{/if}
					<span class="pc-mini-support">
						<T.ICON_SUBSCRIBE size={11} class="pc-icon" />
						{displaySubscriptionCount}
					</span>
				</div>
			</a>
		{:else}
			<div class="pc-mini-inner">
				{#if !isSeen}
					<span class="pc-unseen-dot" aria-label={m.aria_unseen_idea()}></span>
				{/if}
				<span class="pc-mini-title">{effectiveTitle}</span>
				{#if differentiator}
					<span class="pc-mini-diff">{differentiator}</span>
				{/if}
				<span class="pc-mini-support">
					<T.ICON_SUBSCRIBE size={11} class="pc-icon" />
					{displaySubscriptionCount}
				</span>
			</div>
		{/if}
	</article>

	<!-- ═════════════════════════════════════════════════════ COMPACT VARIANT ═══ -->
{:else if variant === 'compact'}
	<article
		class="pc-card pc-compact variant-{highlightVariant}"
		style={clusterColor ? `--cluster-color: ${clusterColor};` : ''}
		id="proposal-card-compact-{proposal.id}"
	>
		<!-- Close/collapse button (DAG expanded card) -->
		{#if onCollapse}
			<Button
				variant="icon"
				class="pc-collapse-btn"
				onclick={onCollapse}
				aria-label={m.aria_collapse()}
			>
				<X size={14} />
			</Button>
		{/if}

		{#snippet compactContent()}
			<div class="pc-card-inner pc-compact-inner">
				<div class="pc-badge-row pc-compact-top">
					<div class="pc-compact-meta">
						{#if highlightVariant === 'serendipity'}
							<span class="pc-serendipity-badge">
								<Sparkles size={11} class="pc-icon" /> Trending
							</span>
						{:else}
							{#if isChampion}
								<div class="pc-champion-star" title={m.badge_leading_idea()}>
									<T.ICON_CHAMPION size={13} fill="currentColor" />
								</div>
							{/if}
							{#if relationLabel}
								{#if isChampion}
									<span class="pc-compact-sep">·</span>
								{/if}
								{#if relationLabelColor}
									<Badge
										label={relationLabel}
										shape="tag"
										theme="custom"
										color={relationLabelColor}
									/>
								{:else}
									<Badge label={relationLabel} theme="muted" shape="tag" />
								{/if}
							{/if}
							{#if proposal.author_name}
								{#if isChampion || relationLabel}
									<span class="pc-compact-sep">·</span>
								{/if}
								<span class="pc-compact-author" class:is-self={isAuthored}>
									{isAuthored ? m.discovery_authored_by_you() : proposal.author_name}
								</span>
							{/if}
						{/if}

						<!-- Label Chips -->
						{#if activeLabels && activeLabels.length > 0}
							{@const primaryLbl =
								activeLabels.find((l) => l.id === proposal.primary_label) ?? activeLabels[0]}
							{@const secondaryLbls = activeLabels.filter((l) => l !== primaryLbl).slice(0, 3)}
							<span class="pc-compact-sep">·</span>
							<div
								class="pc-label-chips"
								style="display: inline-flex; gap: 0.25rem; flex-wrap: wrap; align-items: center;"
							>
								<span class="pc-label-chip" style="--chip-color: {primaryLbl.color};"
									>{primaryLbl.short_name}</span
								>
								{#each secondaryLbls as lbl}
									<span
										class="pc-label-dot"
										style="background-color: {lbl.color}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"
										title={lbl.short_name}
									></span>
								{/each}
								{#if activeLabels.length > 4}
									<span
										class="pc-label-dot-more"
										style="font-size: 10px; color: var(--muted, #666); margin-left: 2px;"
										>+{activeLabels.length - 4}</span
									>
								{/if}
							</div>
						{:else if clusterTitle && !hideClusterLabel}
							<span class="pc-compact-sep">·</span>
							<span
								class="pc-label-chip"
								style={clusterColor ? `--chip-color: ${clusterColor};` : ''}>{clusterTitle}</span
							>
						{/if}
					</div>
				</div>

				<div class="pc-compact-title-row">
					{#if !isSeen}
						<span class="pc-unseen-dot" aria-label={m.badge_unseen()}></span>
					{/if}
					{#if isRedundantTitle || forceExcerpt}
						<p class="pc-excerpt pc-compact-preview">{descriptionPreview}</p>
					{:else if !hideTitle}
						<h3 class="pc-compact-title">{effectiveTitle}</h3>
					{/if}
				</div>

				{#if differentiator}
					<p class="pc-differentiator">{differentiator}</p>
				{/if}

				{#if canVote || (!hideCompare && !disabled) || clusterTitle}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="pc-compact-footer"
						onclick={(e) => {
							e.stopPropagation();
							e.preventDefault();
						}}
					>
						<div style="display: flex; gap: 0.5rem; margin-left: auto; align-items: center;">
							{#if bordaScore !== undefined && bordaMaxScore !== undefined && bordaMaxScore > 0}
								<div
									class="pc-borda-bar-container"
									title={`Score: ${bordaScore} / ${bordaMaxScore}`}
								>
									<div class="pc-borda-bar">
										<div
											class="pc-borda-fill"
											style={`width: ${(bordaScore / bordaMaxScore) * 100}%`}
										></div>
									</div>
									<span class="pc-borda-label">{bordaScore} pts</span>
								</div>
							{:else if canVote}
								<button
									class="pc-vote-btn"
									class:active={displayIsVoted}
									onclick={handleVote}
									type="button"
									aria-label={displayIsVoted ? 'Retract support' : 'Support this proposal'}
								>
									<T.ICON_SUBSCRIBE size={13} class="pc-icon" />
									{displaySubscriptionCount}
								</button>
							{:else if displaySubscriptionCount > 0 && !hideSupport}
								<span class="pc-static-support">
									<T.ICON_SUBSCRIBE size={13} class="pc-icon" />
									{displaySubscriptionCount}
								</span>
							{/if}

							{#if !hideCompare && !disabled}
								{#if isInComparePool}
									<button class="pc-compare-btn active" onclick={removeFromCompare} type="button">
										<T.ICON_COMPARE size={13} class="pc-icon" />
										{m.compare_button_added()}
									</button>
								{:else}
									<button class="pc-compare-btn" onclick={addToCompare} type="button">
										<T.ICON_COMPARE size={13} class="pc-icon" />
										{m.compare_button()}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{/snippet}

		{#if interactive}
			<a
				href={detailHref}
				onclick={(e) => openProposalModal(e, detailHref)}
				class="pc-card-link-wrapper"
				data-sveltekit-preload-data="hover"
				style="text-decoration: none; color: inherit; display: block; outline: none;"
			>
				{@render compactContent()}
			</a>
		{:else}
			{@render compactContent()}
		{/if}
	</article>

	<!-- ═══════════════════════════════════════════════════ STANDARD VARIANT ═══ -->
{:else if variant === 'standard'}
	<div class="pc-swipe-wrapper" data-swipe-action="none">
		<div
			class="pc-swipe-background"
			class:intent-hide={!isHidden}
			class:intent-restore={isHidden}
			class:intent-subscribe={!displayIsVoted}
			class:intent-unsubscribe={displayIsVoted}
		>
			<div class="pc-swipe-icon left">
				{#if displayIsVoted}
					<BellOff size={24} />
				{:else}
					<T.ICON_SUBSCRIBE size={24} />
				{/if}
			</div>
			<div class="pc-swipe-icon right">
				{#if isHidden}
					<Sparkles size={24} />
				{:else}
					<EyeOff size={24} />
				{/if}
			</div>
		</div>
		<article
			class="pc-card pc-standard variant-{highlightVariant}"
			style={clusterColor ? `--cluster-color: ${clusterColor};` : ''}
			id="proposal-card-{proposal.id}"
			use:swipeToDismiss={{
				onSwipeLeft: handleSwipeLeft,
				onSwipeRight: handleSwipeRight,
				threshold: 65,
				flyOutOnLeft: true,
				flyOutOnRight: false
			}}
		>
			{#snippet standardContent()}
				<div class="pc-card-inner pc-standard-inner">
					<div class="pc-badge-row pc-compact-top">
						<div class="pc-compact-meta">
							{#if highlightVariant === 'serendipity'}
								<span class="pc-serendipity-badge">
									<Sparkles size={11} class="pc-icon" /> Trending
								</span>
							{:else}
								{#if isChampion}
									<div class="pc-champion-star" title={m.badge_leading_idea()}>
										<T.ICON_CHAMPION size={14} fill="currentColor" />
									</div>
								{/if}
								{#if relationLabel}
									{#if isChampion}
										<span class="pc-compact-sep">·</span>
									{/if}
									{#if relationLabelColor}
										<Badge
											label={relationLabel}
											shape="tag"
											theme="custom"
											color={relationLabelColor}
										/>
									{:else}
										<Badge label={relationLabel} theme="muted" shape="tag" />
									{/if}
								{/if}
								{#if proposal.author_name}
									{#if isChampion || relationLabel}
										<span class="pc-compact-sep">·</span>
									{/if}
									<span class="pc-compact-author" class:is-self={isAuthored}>
										{isAuthored ? m.discovery_authored_by_you() : proposal.author_name}
									</span>
								{/if}
							{/if}

							<!-- Label Chips -->
							{#if activeLabels && activeLabels.length > 0}
								{@const primaryLbl =
									activeLabels.find((l) => l.id === proposal.primary_label) ?? activeLabels[0]}
								{@const secondaryLbls = activeLabels.filter((l) => l !== primaryLbl).slice(0, 3)}
								<span class="pc-compact-sep">·</span>
								<div
									class="pc-label-chips"
									style="display: inline-flex; gap: 0.25rem; flex-wrap: wrap; align-items: center;"
								>
									<span class="pc-label-chip" style="--chip-color: {primaryLbl.color};"
										>{primaryLbl.short_name}</span
									>
									{#each secondaryLbls as lbl}
										<span
											class="pc-label-dot"
											style="background-color: {lbl.color}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"
											title={lbl.short_name}
										></span>
									{/each}
									{#if activeLabels.length > 4}
										<span
											class="pc-label-dot-more"
											style="font-size: 10px; color: var(--muted, #666); margin-left: 2px;"
											>+{activeLabels.length - 4}</span
										>
									{/if}
								</div>
							{:else if clusterTitle && !hideClusterLabel}
								<span class="pc-compact-sep">·</span>
								<span
									class="pc-label-chip"
									style={clusterColor ? `--chip-color: ${clusterColor};` : ''}>{clusterTitle}</span
								>
							{/if}
						</div>
					</div>

					<div class="pc-title-row pc-compact-title-row">
						{#if !isSeen}
							<span class="pc-unseen-dot" aria-label={m.aria_new_idea()}></span>
						{/if}
						{#if !hideTitle}
							<h3 class="pc-standard-title">{effectiveTitle}</h3>
						{/if}
						{#if poolStatus === 'winner'}
							<span class="pc-winner-icon" title={m.badge_final_winner()}><Trophy size={14} /></span
							>
						{/if}
						{#if poolStatus === 'focus'}
							<span class="pc-focus-icon" title={m.badge_in_focus()}><Star size={14} /></span>
						{/if}
					</div>

					{#if unseenImprovementCount > 0}
						<div
							class="pc-unseen-badge"
							title={m.idea_card_new_improvements({ count: unseenImprovementCount })}
							aria-label={m.idea_card_new_improvements({ count: unseenImprovementCount })}
						>
							<span><Sparkles size={13} /></span>
							<span>{m.idea_card_new_improvements({ count: unseenImprovementCount })}</span>
						</div>
					{/if}

					<p class="pc-excerpt">
						{#if showReasonForChange}
							<span
								style="font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted, #5a5a5a); display: block; margin-bottom: 2px;"
								>Reason for change</span
							>
							{#if proposal.reason_for_change}
								{proposal.reason_for_change}
							{:else}
								<span style="font-style: italic; opacity: 0.6;">{m.no_reason_provided()}</span>
							{/if}
						{:else}
							{stripRichText(proposal.content).slice(0, 160)}{proposal.content.length > 160
								? '…'
								: ''}
						{/if}
					</p>

					{#if extra}
						{@render extra()}
					{/if}

					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="pc-standard-footer"
						onclick={(e) => {
							e.stopPropagation();
							e.preventDefault();
						}}
					>
						<div class="pc-footer-left">
							{#if bordaScore !== undefined && bordaMaxScore !== undefined && bordaMaxScore > 0}
								<div
									class="pc-borda-bar-container"
									title={`Score: ${bordaScore} / ${bordaMaxScore}`}
								>
									<div class="pc-borda-bar">
										<div
											class="pc-borda-fill"
											style={`width: ${(bordaScore / bordaMaxScore) * 100}%`}
										></div>
									</div>
									<span class="pc-borda-label">{bordaScore} pts</span>
								</div>
							{:else if isHidden && onRestore}
								<button
									class="pc-restore-btn"
									onclick={handleRestoreEvent}
									type="button"
									aria-label={m.aria_restore_idea()}
								>
									<Sparkles size={14} class="pc-icon" />
									<span>{m.action_restore()}</span>
								</button>
							{:else if onHide && !isHidden}
								<button
									class="pc-hide-btn"
									onclick={handleHide}
									type="button"
									aria-label={m.idea_card_hide_aria({ title: effectiveTitle })}
								>
									<EyeOff size={14} class="pc-icon" />
									<span>{m.idea_card_hide()}</span>
								</button>
							{/if}
						</div>

						<div class="pc-footer-right" style="display: flex; gap: 0.5rem; align-items: center;">
							{#if canVote}
								<button
									class="pc-vote-btn"
									class:active={displayIsVoted}
									onclick={handleVote}
									type="button"
									aria-label={displayIsVoted ? 'Retract support' : 'Support this proposal'}
								>
									<T.ICON_SUBSCRIBE size={14} class="pc-icon" />
									{displaySubscriptionCount}
								</button>
							{:else if displaySubscriptionCount > 0}
								<span class="pc-static-support">
									<T.ICON_SUBSCRIBE size={14} class="pc-icon" />
									{displaySubscriptionCount}
								</span>
							{/if}
							{#if !hideCompare && !disabled}
								{#if isInComparePool}
									<button class="pc-compare-btn active" onclick={removeFromCompare} type="button">
										<T.ICON_COMPARE size={14} class="pc-icon" />
										{m.compare_button_added()}
									</button>
								{:else}
									<button class="pc-compare-btn" onclick={addToCompare} type="button">
										<T.ICON_COMPARE size={14} class="pc-icon" />
										{m.compare_button()}
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			{/snippet}

			{#if interactive}
				<a
					href={detailHref}
					onclick={(e) => openProposalModal(e, detailHref)}
					class="pc-card-link-wrapper"
					data-sveltekit-preload-data="hover"
					style="text-decoration: none; color: inherit; display: block; outline: none;"
					draggable="false"
				>
					{@render standardContent()}
				</a>
			{:else}
				{@render standardContent()}
			{/if}
		</article>
	</div>

	<!-- ══════════════════════════════════════════════════════ FULL VARIANT ═══ -->
{:else if variant === 'full'}
	<article
		class="pc-card pc-full variant-{highlightVariant}"
		style={clusterColor ? `--cluster-color: ${clusterColor};` : ''}
		id="proposal-card-full-{proposal.id}"
	>
		<div class="pc-full-inner">
			<div class="pc-badge-row">
				{#if isChampion}
					<div class="pc-champion-star" title={m.badge_leading_idea()}>
						<T.ICON_CHAMPION size={16} fill="currentColor" />
					</div>
				{/if}
				{#if !isSeen}
					<Badge label={m.badge_unseen()} theme="unseen" shape="pill" />
				{/if}
				{#if isAuthored}
					<Badge label={m.discovery_authored_by_you()} icon={Pencil} theme="primary" shape="tag" />
				{/if}
				{#if poolStatus === 'focus'}
					<Badge label={m.badge_in_focus()} icon={Star} theme="warning" shape="pill" />
				{/if}
				{#if poolStatus === 'winner'}
					<Badge label={m.badge_final_winner()} icon={Trophy} theme="warning" shape="pill" />
				{/if}

				{#if activeLabels && activeLabels.length > 0}
					{@const primaryLbl = (activeLabels.find((l) => l.id === proposal.primary_label) ??
						activeLabels[0])!}
					{#if primaryLbl}
						<span class="pc-label-chip" style="--chip-color: {primaryLbl.color};"
							>{primaryLbl.short_name}</span
						>
					{/if}
				{:else if clusterTitle}
					<span class="pc-label-chip" style={clusterColor ? `--chip-color: ${clusterColor};` : ''}
						>{clusterTitle}</span
					>
				{/if}
			</div>

			<h2 class="pc-full-title">{effectiveTitle}</h2>

			{#if unseenImprovementCount > 0}
				<div
					class="pc-unseen-badge"
					title={m.idea_card_new_improvements({ count: unseenImprovementCount })}
					aria-label={m.idea_card_new_improvements({ count: unseenImprovementCount })}
				>
					<span><Sparkles size={13} /></span>
					<span>{m.idea_card_new_improvements({ count: unseenImprovementCount })}</span>
				</div>
			{/if}

			{#if proposal.author_name}
				<p class="pc-full-meta">
					{m.by_author()}<strong>{proposal.author_name}</strong>
				</p>
			{/if}

			{#if differentiator}
				<p class="pc-differentiator">{differentiator}</p>
			{/if}

			{#if extra}
				{@render extra()}
			{/if}
		</div>
	</article>
{/if}

<style>
	/* ═══════════════════════════════════════════════ SHARED CARD BASE ══ */
	.pc-card {
		position: relative;
		background: var(--paper, #fff);
		border: 1px solid var(--line, #d8d8d8);
		border-left: 4px solid var(--cluster-color, var(--line, #d8d8d8));
		border-radius: var(--card-radius, 8px);
		overflow: hidden;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease,
			border-color 0.15s ease;
		z-index: 1;
		touch-action: pan-y;
	}

	.pc-card.is-swiping {
		user-select: none;
		-webkit-user-select: none;
	}

	.pc-swipe-wrapper {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		border-radius: var(--card-radius, 8px);
		touch-action: pan-y;
	}

	.pc-swipe-background {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1.5rem;
		border-radius: var(--card-radius, 8px);
		opacity: var(--swipe-progress, 0);
		z-index: 0;
	}

	.pc-swipe-icon {
		transform: scale(calc(0.7 + var(--swipe-progress, 0) * 0.3));
	}

	.pc-swipe-wrapper:global([data-swipe-action='left']) .pc-swipe-background.intent-hide {
		background-color: var(--destructive, #ef4444);
		color: white;
	}
	.pc-swipe-wrapper:global([data-swipe-action='left']) .pc-swipe-background.intent-hide .left {
		opacity: 0;
	}

	.pc-swipe-wrapper:global([data-swipe-action='left']) .pc-swipe-background.intent-restore {
		background-color: var(--color-primary, #3b82f6);
		color: white;
	}
	.pc-swipe-wrapper:global([data-swipe-action='left']) .pc-swipe-background.intent-restore .left {
		opacity: 0;
	}

	.pc-swipe-wrapper:global([data-swipe-action='right']) .pc-swipe-background.intent-subscribe {
		background-color: var(--color-success-100, #dcfce7);
		color: var(--color-success-600, #16a34a);
	}
	.pc-swipe-wrapper:global([data-swipe-action='right'])
		.pc-swipe-background.intent-subscribe
		.right {
		opacity: 0;
	}

	.pc-swipe-wrapper:global([data-swipe-action='right']) .pc-swipe-background.intent-unsubscribe {
		background-color: color-mix(in srgb, var(--muted, #f3f4f6) 40%, transparent);
		color: var(--muted-dark, #9ca3af);
	}
	.pc-swipe-wrapper:global([data-swipe-action='right'])
		.pc-swipe-background.intent-unsubscribe
		.right {
		opacity: 0;
	}

	.pc-card:hover {
		transform: translateY(var(--card-lift, -2px));
		box-shadow: var(--card-shadow-hover, 0 4px 12px rgba(0, 0, 0, 0.08));
	}

	.pc-champion-star {
		color: var(--amber-500, #f59e0b);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.pc-unseen-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--unseen, #3b82f6);
		flex-shrink: 0;
		align-self: center;
	}

	:global(.pc-icon) {
		vertical-align: text-bottom;
	}

	/* ═══════════════════════════════════════════════════ DOT VARIANT ══ */
	.pc-dot-wrapper {
		position: relative;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.pc-dot {
		display: block;
		border-radius: 50%;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			filter 0.15s ease;
	}

	.pc-dot:hover {
		transform: scale(1.08);
		filter: brightness(1.1);
	}

	.pc-dot-crown {
		position: absolute;
		top: -14px;
		left: 50%;
		transform: translateX(-50%);
		color: var(--warning, #f59e0b);
		line-height: 1;
		pointer-events: none;
	}

	.pc-dot-overlay {
		position: absolute;
		bottom: 18px;
		right: 0;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--paper, #fff);
	}

	.pc-dot-overlay.unseen {
		background: var(--unseen, #3b82f6);
	}

	.pc-dot-overlay.voted {
		background: var(--success, #16a34a);
		color: white;
	}

	.pc-dot-expand {
		position: absolute;
		bottom: -4px;
		right: -10px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px solid var(--line, #d8d8d8);
		background: var(--paper, #fff);
		color: var(--muted, #5a5a5a);
		font-size: 0.7rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.15s;
		padding: 0;
	}

	.pc-dot-expand:hover {
		background: var(--primary, #4f7df9);
		color: white;
		border-color: var(--primary, #4f7df9);
	}

	.pc-dot-label {
		font-size: 0.6rem;
		color: var(--ink, #111);
		text-align: center;
		max-width: 60px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.2;
	}

	/* ═══════════════════════════════════════════════════ MINI VARIANT ══ */
	.pc-mini {
		min-height: var(--touch-min, 44px);
	}

	.pc-mini-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}

	.pc-mini-inner {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0.75rem;
		min-height: var(--touch-min, 44px);
	}

	.pc-mini-title {
		flex: 1;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink, #111);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pc-mini-diff {
		font-size: 0.72rem;
		color: var(--muted, #5a5a5a);
		font-style: italic;
		flex-shrink: 0;
		max-width: 80px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pc-mini-support {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.75rem;
		color: var(--muted, #5a5a5a);
		font-weight: 600;
		flex-shrink: 0;
	}

	/* ════════════════════════════════════════════════ COMPACT VARIANT ══ */
	.pc-compact-inner {
		padding: 0.55rem 0.75rem 0.55rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.pc-compact-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}

	.pc-compact-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
		color: var(--muted, #5a5a5a);
		opacity: 0.85;
		min-width: 0;
		overflow: hidden;
	}

	.pc-compact-type {
		font-weight: 600;
		white-space: nowrap;
	}

	.pc-compact-sep {
		color: var(--line, #d8d8d8);
	}

	.pc-compact-author {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pc-compact-author:not(.is-self) {
		opacity: 0.6;
	}

	.pc-compact-author.is-self {
		font-weight: 600;
		color: var(--primary-dark, #3b82f6);
	}

	.pc-compact-title-row {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
	}

	.pc-compact-preview {
		margin-top: -0.2rem;
		font-size: 0.78rem;
		line-clamp: 1;
		-webkit-line-clamp: 1;
	}

	.pc-card-link-wrapper:hover .pc-compact-title,
	.pc-card-link-wrapper:hover .pc-standard-title {
		color: var(--primary, #4f7df9);
	}

	.pc-compact-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		line-height: 1.3;
		color: var(--ink, #111);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 0.15s;
	}

	.pc-differentiator {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted, #5a5a5a);
		font-style: italic;
		line-height: 1.3;
	}

	.pc-compact-footer {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding-top: 0.3rem;
		flex-wrap: wrap;
	}

	:global(.pc-collapse-btn) {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 22px;
		height: 22px;
		border: 1px solid var(--line, #d8d8d8);
		border-radius: 50%;
		background: var(--paper, #fff);
		color: var(--muted, #5a5a5a);
		font-size: 0.65rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		z-index: 2;
		padding: 0;
		transition: all 0.15s;
	}

	:global(.pc-collapse-btn:hover) {
		background: var(--destructive, #dc2626);
		color: white;
		border-color: var(--destructive, #dc2626);
	}

	/* ══════════════════════════════════════════════ STANDARD VARIANT ══ */
	.pc-standard-inner {
		padding: 0.875rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.pc-badge-row {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}

	.pc-title-row {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}

	.pc-standard-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--ink, #111);
		transition: color 0.15s;
	}

	.pc-excerpt {
		margin: 0;
		font-size: 0.83rem;
		color: var(--muted, #5a5a5a);
		line-height: 1.5;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.pc-unseen-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 2px 8px;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--info, #0284c7) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--info, #0284c7) 25%, transparent);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--info, #0284c7);
		animation: unseenPulse 2s ease-in-out infinite;
	}

	@keyframes unseenPulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--info, #0284c7) 20%, transparent);
		}
		50% {
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--info, #0284c7) 8%, transparent);
		}
	}

	.pc-standard-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: 0.45rem;
		border-top: 1px solid var(--line, #d8d8d8);
		gap: 0.5rem;
	}

	.pc-footer-left,
	.pc-footer-right {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.pc-cluster-footer-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--muted, #5a5a5a);
	}

	.pc-cluster-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	/* ═══════════════════════════════════════════ SHARED ACTION BUTTONS ══ */

	.pc-vote-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: var(--touch-min, 44px);
		padding: 0 0.8rem;
		border: 1px solid var(--line, #d8d8d8);
		border-radius: 17px;
		background: transparent;
		color: var(--muted, #5a5a5a);
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.pc-vote-btn:hover {
		border-color: var(--success, #16a34a);
		color: var(--success, #16a34a);
	}

	.pc-vote-btn.active {
		background: var(--success, #16a34a);
		border-color: var(--success, #16a34a);
		color: white;
	}

	.pc-compare-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: var(--touch-min, 44px);
		padding: 0 0.8rem;
		border: 1px solid color-mix(in srgb, var(--info, #0ea5e9) 30%, transparent);
		border-radius: 17px;
		background: color-mix(in srgb, var(--info, #0ea5e9) 8%, transparent);
		color: var(--info, #0ea5e9);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.pc-compare-btn:hover {
		background: color-mix(in srgb, var(--info, #0ea5e9) 16%, transparent);
		border-color: color-mix(in srgb, var(--info, #0ea5e9) 50%, transparent);
	}

	.pc-compare-btn.active {
		background: var(--primary, #4f7df9);
		border-color: var(--primary, #4f7df9);
		color: white;
	}

	.pc-static-support {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: 500;
		color: var(--ink, #111);
	}

	.pc-serendipity-badge {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #eab308;
		font-weight: 600;
		background: #fef9c3;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	/* ── Variant Highlight Styles ── */
	.variant-leader {
		border: 2px solid var(--cluster-color, var(--primary));
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}

	.variant-contender {
		border: 1px solid var(--line, #d8d8d8);
		border-left: 4px solid var(--cluster-color, var(--line, #d8d8d8));
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
	}

	.variant-improvement {
		border-left: 3px solid var(--primary);
	}

	.variant-merge {
		border: 2px dashed #9333ea;
		background-color: #faf5ff;
	}

	.variant-serendipity {
		border: 1px solid #fde047;
		background-color: #fefce8;
	}

	/* ════════════════════════════════════════════════ FULL VARIANT ══ */
	.pc-full-inner {
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.pc-full-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 800;
		line-height: 1.3;
		color: var(--ink, #111);
	}

	.pc-full-meta {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted, #5a5a5a);
	}

	/* ── Label Chips & Hide ── */
	.pc-label-chip {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 12px;
		font-size: 0.65rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--chip-color, #9ca3af) 15%, transparent);
		color: var(--chip-color, #4b5563);
		border: 1px solid color-mix(in srgb, var(--chip-color, #9ca3af) 30%, transparent);
		white-space: nowrap;
	}

	.pc-hide-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: var(--touch-min, 44px);
		padding: 0 0.8rem;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted, #5a5a5a);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.pc-hide-btn:hover {
		color: var(--destructive, #dc2626);
	}

	.pc-restore-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: var(--touch-min, 44px);
		padding: 0 0.8rem;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted, #5a5a5a);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.pc-restore-btn:hover {
		color: var(--color-primary, #3b82f6);
	}
	.pc-borda-bar-container {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 100px;
	}

	.pc-borda-bar {
		flex: 1;
		height: 6px;
		background: var(--color-surface-hover);
		border-radius: var(--radius-full);
		overflow: hidden;
	}

	.pc-borda-fill {
		height: 100%;
		background: var(--color-primary);
		border-radius: var(--radius-full);
		transition: width 0.3s ease;
	}

	.pc-borda-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}
</style>
