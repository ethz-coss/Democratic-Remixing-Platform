<script lang="ts">
	import { untrack, flushSync } from 'svelte';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import * as T from '$lib/utils/terminology';
	import { enhance } from '$app/forms';
	import { localizePath } from '$lib/utils/i18n-path';
	import { editorState } from '$lib/editor.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { CheckCircle2, Info, GripVertical } from '@lucide/svelte';

	let {
		proposals,
		action,
		questionId,
		labels = [],
		previousRanks = [],
		previousAbstention = false,
		form = null
	} = $props<{
		proposals: App.ProposalRecord[];
		action: string;
		questionId: string;
		labels?: App.LabelRecord[];
		previousRanks?: Array<{ proposalId: string; rank: number }>;
		previousAbstention?: boolean;
		form?: any;
	}>();

	/**
	 * Fisher-Yates shuffle for unbiased randomization.
	 */
	function shuffleArray<T>(arr: T[]): T[] {
		const shuffled = [...arr];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	/**
	 * localStorage key for persisting the ballot order for a given question.
	 */
	function ballotOrderKey(): string {
		return `ballot_order:${questionId}`;
	}

	/**
	 * Load the persisted ballot order from localStorage.
	 * Returns an ordered array of proposal IDs, or null if nothing is stored.
	 * Must only be called in the browser (inside onMount).
	 */
	function loadStoredOrder(): string[] | null {
		try {
			const raw = localStorage.getItem(ballotOrderKey());
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
		} catch {
			// Ignore corrupt data or storage errors
		}
		return null;
	}

	/**
	 * Save the current order (array of proposal IDs) to localStorage.
	 * Must only be called in the browser.
	 */
	function saveOrder(ids: string[]): void {
		try {
			localStorage.setItem(ballotOrderKey(), JSON.stringify(ids));
		} catch {
			// Ignore storage errors (e.g. private browsing quota)
		}
	}

	/**
	 * Apply a stored ID order to the current proposals list.
	 * Any proposals not in the stored list are appended at the end.
	 */
	function applyStoredOrder(ids: string[]): App.ProposalRecord[] {
		const ordered: App.ProposalRecord[] = [];
		for (const id of ids) {
			const found = proposals.find((p: App.ProposalRecord) => p.id === id);
			if (found) ordered.push(found);
		}
		// Append any proposals new since the order was saved
		for (const p of proposals) {
			if (!ordered.find((o: App.ProposalRecord) => o.id === p.id)) ordered.push(p);
		}
		return ordered;
	}

	// ── Server-safe initial state ──────────────────────────────────────────────
	// If the user already voted, restore their submitted ranking immediately
	// (server-authoritative, no localStorage needed).
	// Otherwise use the server-provided order as a placeholder — onMount will
	// replace this with the stable localStorage order or a fresh shuffle.
	// We MUST NOT shuffle here because $state() initializers run during SSR
	// where localStorage is unavailable, so every server render would produce a
	// different order that overwrites the client's persisted state on hydration.
	let rankedProposals = $state(
		untrack(() => {
			// Only handle previousRanks here — this runs during SSR where localStorage
			// is unavailable. The shuffle/restore logic runs in onMount (browser only).
			if (previousRanks && previousRanks.length > 0) {
				const ordered: App.ProposalRecord[] = [];
				for (const rank of previousRanks.sort(
					(a: { rank: number }, b: { rank: number }) => a.rank - b.rank
				)) {
					const found = proposals.find((p: App.ProposalRecord) => p.id === rank.proposalId);
					if (found) ordered.push(found);
				}
				for (const p of proposals) {
					if (!ordered.find((o: App.ProposalRecord) => o.id === p.id)) ordered.push(p);
				}
				return ordered;
			}
			// Stable server-side placeholder — replaced in onMount with localStorage/shuffled order
			return [...proposals];
		})
	);

	// True once the correct ballot order has been determined client-side.
	// For users who already voted, their order comes from previousRanks (server-known),
	// so we can set this true immediately — no client correction needed, no blank period.
	let orderReady = $state(untrack(() => !!(previousRanks && previousRanks.length > 0)));

	// ── Client-side order initialization (runs after hydration, browser only) ──
	// This is the ONLY place we access localStorage or shuffle, ensuring SSR
	// never generates a random order that overwrites the persisted client state.
	onMount(() => {
		if (previousRanks && previousRanks.length > 0) return; // server ranking wins

		const stored = loadStoredOrder();
		if (stored && stored.length > 0) {
			rankedProposals = applyStoredOrder(stored);
		} else {
			// First visit: shuffle once and persist so subsequent visits are stable
			const shuffled = shuffleArray([...proposals]);
			saveOrder(shuffled.map((p) => p.id));
			rankedProposals = shuffled;
		}
		// Reveal the card list now that the correct order is in place
		orderReady = true;
	});
	let isAbstention = $state(untrack(() => previousAbstention));
	let userModifiedSinceLastSubmit = $state(false);

	$effect(() => {
		if (previousAbstention !== untrack(() => isAbstention)) {
			isAbstention = previousAbstention;
		}
	});

	// On touch/coarse devices (mobile) disable drag initially so page scroll works;
	// on desktop (fine pointer) enable immediately so first mousedown starts dragging.
	let dragDisabled = $state(
		untrack(() =>
			typeof window === 'undefined' ? false : window.matchMedia('(pointer: coarse)').matches
		)
	);

	const isUpdate = $derived((previousRanks && previousRanks.length > 0) || previousAbstention);

	let ranksJson = $derived(
		JSON.stringify(
			rankedProposals.map((p, idx) => ({
				proposalId: p.id,
				rank: idx + 1
			}))
		)
	);

	function handleDndConsider(e: CustomEvent<DndEvent<App.ProposalRecord>>) {
		rankedProposals = e.detail.items;
		userModifiedSinceLastSubmit = true;
	}

	function handleDndFinalize(e: CustomEvent<DndEvent<App.ProposalRecord>>) {
		rankedProposals = e.detail.items;
		if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
			dragDisabled = true; // Reset drag lock on mobile after drop
		}
		userModifiedSinceLastSubmit = true;
		// Persist the updated order so navigating away and back keeps this arrangement
		saveOrder(rankedProposals.map((p) => p.id));
	}

	let formElement: HTMLFormElement;

	// Element refs for the two parallel columns
	let rankListEl: HTMLElement | undefined = $state(undefined);
	let slotNumbersEl: HTMLElement | undefined = $state(undefined);

	/**
	 * Sync .slot-number heights to match their corresponding .rank-item heights.
	 * Called after every reorder and on resize — keeps the two columns aligned
	 * even though they live in separate DOM subtrees.
	 */
	function syncSlotHeights() {
		if (!rankListEl || !slotNumbersEl) return;
		const items = Array.from(rankListEl.children).filter((el) =>
			el.classList.contains('rank-item')
		) as HTMLElement[];
		const slots = Array.from(slotNumbersEl.children).filter((el) =>
			el.classList.contains('slot-number')
		) as HTMLElement[];
		const n = Math.min(items.length, slots.length);
		for (let i = 0; i < n; i++) {
			slots[i].style.height = items[i].offsetHeight + 'px';
		}
	}

	// Re-sync after every drag reorder (tracks rankedProposals + element mounts)
	$effect(() => {
		void rankedProposals;
		void rankListEl;
		void slotNumbersEl;
		requestAnimationFrame(syncSlotHeights);
	});

	// ResizeObserver handles window / font-size changes
	$effect(() => {
		if (!rankListEl) return;
		const ro = new ResizeObserver(syncSlotHeights);
		ro.observe(rankListEl);
		return () => ro.disconnect();
	});
</script>

<div class="voting-ballot">
	<div class="ballot-header">
		<h2 class="title" style="font-size: 1.75rem; margin-bottom: 0.25rem;">
			{m.question_status_final_vote()}
		</h2>

		{#if !isAbstention}
			<p class="ballot-rank-instruction">
				{m.ballot_rank_instruction()}
			</p>
		{/if}
	</div>

	{#if isAbstention}
		<div class="abstention-state">
			<h3>{m.ballot_abstention_title()}</h3>
			<p class="muted">
				{m.ballot_abstention_desc()}
			</p>
		</div>
	{/if}

	<form
		method="POST"
		{action}
		use:enhance={({ formData, submitter, action: url }) => {
			// Optimistically update UI based on which button was clicked
			if (submitter && submitter.getAttribute('formaction') === '?/cancelAbstention') {
				isAbstention = false;
			} else if (
				submitter &&
				submitter.getAttribute('name') === 'isAbstention' &&
				submitter.getAttribute('value') === 'true'
			) {
				isAbstention = true;
			}

			// Explicitly ensure the current isAbstention state is sent to the server.
			formData.set('isAbstention', isAbstention ? 'true' : 'false');
			return async ({ update }) => {
				await update();
				userModifiedSinceLastSubmit = false;
			};
		}}
		class="ballot-form stack"
		bind:this={formElement}
	>
		<!-- Hidden submit button to ensure requestSubmit() works even when the main submit button is hidden -->
		<button type="submit" style="display: none;" aria-hidden="true"></button>

		<input type="hidden" name="ranks" value={ranksJson} />

		{#if !isAbstention}
			<!-- Two-column layout: slot numbers are OUTSIDE the dndzone so they never drag -->
			<!-- order-hidden keeps the list invisible until onMount applies the correct order -->
			<div class="ballot-slots-wrapper" class:order-hidden={!orderReady}>
				<!-- Left column: fixed slot numbers, heights synced to cards via JS -->
				<div class="ballot-slot-numbers" bind:this={slotNumbersEl} aria-hidden="true">
					{#each rankedProposals as _, index}
						<div class="slot-number" class:slot-top={index === 0}>
							<span class="slot-num-text">{index + 1}</span>
							{#if index === 0}
								<span class="slot-best-label">best</span>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Right column: draggable cards -->
				<section
					class="rank-list"
					bind:this={rankListEl}
					use:dndzone={{
						items: rankedProposals,
						flipDurationMs: 200,
						dragDisabled,
						dropTargetStyle: { outline: '2px solid var(--primary, #4f7df9)', borderRadius: '10px' }
					}}
					onconsider={handleDndConsider}
					onfinalize={handleDndFinalize}
				>
					{#each rankedProposals as proposal, index (proposal.id)}
						{@const allLabels = (proposal.labels || [])
							.map((id: string) => labels.find((l: App.LabelRecord) => l.id === id))
							.filter(
								(l: App.LabelRecord | undefined): l is App.LabelRecord =>
									l !== undefined && !!l.color
							)}
						{@const excerpt = proposal.content
							? proposal.content
									.replace(/<[^>]*>?/gm, ' ')
									.replace(/\s+/g, ' ')
									.trim()
									.slice(0, 120) +
								(proposal.content.replace(/<[^>]*>?/gm, ' ').trim().length > 120 ? '…' : '')
							: ''}
						{@const detailHref = localizePath(
							`/questions/${proposal.question}/proposals/${proposal.id}`
						)}
						{@const isInComparePool = editorState.comparePool.some((p) => p.id === proposal.id)}
						<div
							class="rank-item"
							class:rank-top={index === 0}
							aria-label={m.ballot_rank_slot_label({ rank: String(index + 1) })}
						>
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="drag-handle"
								aria-label={m.ballot_drag_reorder()}
								title={m.ballot_drag_reorder()}
								onmousedown={() => flushSync(() => (dragDisabled = false))}
								ontouchstart={() => flushSync(() => (dragDisabled = false))}
							>
								<GripVertical size={20} />
							</div>

							<div class="card-wrapper">
								<a
									href={detailHref}
									class="ballot-card"
									draggable="false"
									onclick={(e) => {
										if (!dragDisabled) e.preventDefault();
									}}
								>
									<div class="ballot-card-title-row">
										{#each allLabels as lbl}
											<span
												class="ballot-label-dot"
												style="background: {lbl.color};"
												title={lbl.short_name}
												aria-label={lbl.short_name}
											></span>
										{/each}
										<h3 class="ballot-card-title">{proposal.title}</h3>
									</div>
									{#if excerpt}
										<p class="ballot-card-excerpt">{excerpt}</p>
									{/if}
								</a>

								<!-- Compare footer — outside the <a> so it doesn't navigate -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<div
									class="ballot-card-footer"
									onclick={(e) => {
										e.stopPropagation();
										e.preventDefault();
									}}
								>
									{#if isInComparePool}
										<button
											class="bc-compare-btn active"
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												editorState.removeFromComparePool(proposal.id);
											}}
										>
											<T.ICON_COMPARE size={13} />
											{m.compare_button_added()}
										</button>
									{:else}
										<button
											class="bc-compare-btn"
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												editorState.addToComparePool(proposal);
											}}
										>
											<T.ICON_COMPARE size={13} />
											{m.compare_button()}
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</section>
			</div>
		{/if}

		<div class="ballot-actions">
			{#if form?.success && !form?.canceledAbstention && !userModifiedSinceLastSubmit}
				<div class="confirmation-banner">
					<CheckCircle2 size={18} />
					<span>
						{form.isUpdate ? m.ballot_success_update() : m.ballot_success_submit()}
					</span>
				</div>
			{:else if isUpdate && !isAbstention && !userModifiedSinceLastSubmit}
				<div class="info-banner">
					<Info size={18} />
					<span>{m.ballot_info_recorded()}</span>
				</div>
			{/if}

			{#if !isAbstention}
				<Button type="submit" variant="primary" style="width: 100%; justify-content: center;"
					>{isUpdate ? m.ballot_btn_update() : m.ballot_btn_submit()}</Button
				>
			{/if}

			{#if isAbstention}
				<button type="submit" formaction="?/cancelAbstention" class="abstain-btn active">
					{m.ballot_btn_cancel_abstain()}
				</button>
			{:else}
				<button type="submit" name="isAbstention" value="true" class="abstain-btn">
					{m.ballot_btn_abstain()}
				</button>
			{/if}
		</div>
	</form>
</div>

<style>
	.voting-ballot {
		background: var(--paper, #fff);
		padding: 1.5rem;
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
		width: 100%;
		max-width: 800px;
		margin: 0 auto;
		box-sizing: border-box;
		overflow: hidden;
	}

	.ballot-header {
		margin-bottom: 1.25rem;
	}

	h2 {
		margin-top: 0;
		color: var(--ink, #111);
	}

	.ballot-rank-instruction {
		margin: 0.4rem 0 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--muted, #5a5a5a);
	}

	.ballot-form {
		min-width: 0;
	}

	/* ── Two-column slot layout ── */
	.ballot-slots-wrapper {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		min-width: 0;
		margin: 0.25rem 0;
	}

	/*
	 * Hidden until onMount resolves the correct ballot order from localStorage.
	 * Uses visibility (not display:none) so layout space is reserved and there
	 * is no Cumulative Layout Shift when the list is revealed.
	 */
	.ballot-slots-wrapper.order-hidden {
		visibility: hidden;
	}

	/* Left column: fixed numbers, heights set by JS to match cards */
	.ballot-slot-numbers {
		display: flex;
		flex-direction: column;
		gap: 0.5rem; /* must match .rank-list gap */
		flex-shrink: 0;
		width: 2.5rem;
	}

	.slot-number {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		min-height: 72px; /* fallback before JS measures */
		gap: 2px;
		transition: height 0.15s ease; /* smooth when cards resize */
	}

	.slot-num-text {
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--muted, #bbb);
		line-height: 1;
		transition: color 0.2s;
	}

	.slot-number.slot-top .slot-num-text {
		color: var(--primary, #4f7df9);
	}

	.slot-best-label {
		font-size: 0.5rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--primary, #4f7df9);
		opacity: 0.75;
	}

	/* Progressive fading for ranks 2, 3, 4+ */
	.ballot-slot-numbers > .slot-number:nth-child(2) .slot-num-text {
		opacity: 0.65;
		font-size: 1.1rem;
	}
	.ballot-slot-numbers > .slot-number:nth-child(3) .slot-num-text {
		opacity: 0.45;
		font-size: 1rem;
	}
	.ballot-slot-numbers > .slot-number:nth-child(n + 4) .slot-num-text {
		opacity: 0.3;
		font-size: 0.9rem;
	}

	/* Right column: the dndzone */
	.rank-list {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 50px;
		touch-action: pan-y !important;
	}

	/* Each draggable row */
	.rank-item {
		display: flex;
		align-items: stretch;
		background: var(--paper, #fff);
		border-radius: 10px;
		border: 1.5px solid var(--line, #e2e8f0);
		box-sizing: border-box;
		min-width: 0;
		overflow: hidden;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.rank-item.rank-top {
		border-color: color-mix(in srgb, var(--primary, #4f7df9) 35%, var(--line, #e2e8f0));
		box-shadow: 0 2px 8px rgba(79, 125, 249, 0.1);
	}

	/* Drag handle — left strip of each card */
	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 36px;
		min-height: 44px;
		color: var(--line-dark, #c0c8d4);
		background: var(--surface-tertiary, #f8fafc);
		border-right: 1.5px solid var(--line, #e2e8f0);
		cursor: grab;
		touch-action: none !important;
		transition:
			background 0.15s,
			color 0.15s;
		user-select: none;
		-webkit-user-select: none;
	}

	.drag-handle:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 8%, var(--surface-tertiary, #f8fafc));
		color: var(--primary, #4f7df9);
		border-right-color: color-mix(in srgb, var(--primary, #4f7df9) 20%, var(--line, #e2e8f0));
	}

	.drag-handle:active {
		cursor: grabbing;
		background: color-mix(in srgb, var(--primary, #4f7df9) 14%, var(--surface-tertiary, #f8fafc));
		color: var(--primary, #4f7df9);
	}

	/* Card container — takes remaining width */
	.card-wrapper {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/* Self-contained ballot card — title + excerpt, no dependency on ProposalCard */
	.ballot-card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.6rem 0.75rem;
		min-width: 0;
		text-decoration: none;
		color: inherit;
		/* subtle hover cue that it's clickable */
		transition: background 0.15s;
	}
	.ballot-card:hover {
		background: color-mix(in srgb, var(--primary, #4f7df9) 4%, transparent);
	}

	.ballot-card-footer {
		display: flex;
		padding: 0.25rem 0.75rem 0.5rem;
		align-items: center;
	}

	.bc-compare-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 0.7rem;
		border: 1px solid color-mix(in srgb, var(--info, #0ea5e9) 30%, transparent);
		border-radius: 17px;
		background: color-mix(in srgb, var(--info, #0ea5e9) 8%, transparent);
		color: var(--info, #0ea5e9);
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}
	.bc-compare-btn:hover {
		background: color-mix(in srgb, var(--info, #0ea5e9) 16%, transparent);
		border-color: color-mix(in srgb, var(--info, #0ea5e9) 50%, transparent);
	}
	.bc-compare-btn.active {
		background: var(--primary, #4f7df9);
		border-color: var(--primary, #4f7df9);
		color: white;
	}

	.ballot-card-title-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.ballot-label-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		opacity: 0.85;
	}

	.ballot-card-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--ink, #111);
		word-break: break-word;
		min-width: 0;
	}

	.ballot-card-excerpt {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--muted, #777);
		word-break: break-word;
	}

	.ballot-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 1.5rem;
		border-top: 1px solid var(--line, #ddd);
		gap: 1rem;
	}

	.abstain-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.6rem 1.5rem;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--muted, #666);
		background: transparent;
		border: 1.5px solid var(--line, #ddd);
		border-radius: 8px;
		cursor: pointer;
		transition:
			background 0.2s,
			border-color 0.2s,
			color 0.2s;
	}

	.abstain-btn:hover {
		border-color: var(--ink, #111);
		color: var(--ink, #111);
	}

	.abstain-btn.active {
		background: var(--ink, #111);
		border-color: var(--ink, #111);
		color: #fff;
	}

	/* ── Mobile ── */
	@media (max-width: 600px) {
		.voting-ballot {
			padding: 1rem;
		}

		.ballot-slots-wrapper {
			gap: 0.35rem;
		}

		.ballot-slot-numbers {
			width: 2rem;
			gap: 0.4rem; /* match rank-list gap on mobile */
		}

		.slot-number {
			width: 2rem;
			min-height: 64px;
		}

		.slot-num-text {
			font-size: 1rem;
		}
		.ballot-slot-numbers > .slot-number:nth-child(2) .slot-num-text {
			font-size: 0.9rem;
		}
		.ballot-slot-numbers > .slot-number:nth-child(3) .slot-num-text {
			font-size: 0.85rem;
		}
		.ballot-slot-numbers > .slot-number:nth-child(n + 4) .slot-num-text {
			font-size: 0.8rem;
		}

		.drag-handle {
			width: 28px;
		}

		.rank-list {
			gap: 0.4rem;
		}
	}

	.abstention-state {
		text-align: center;
		padding: 3rem 1rem;
		background: var(--color-bg-secondary, #fafafa);
		border: 1px dashed var(--line, #ddd);
		border-radius: 12px;
		margin: 1rem 0;
	}
	.abstention-state h3 {
		margin-top: 0;
		color: var(--muted, #666);
		margin-bottom: 0.5rem;
	}
	.abstention-state p {
		margin: 0 auto;
		max-width: 500px;
	}

	.confirmation-banner {
		width: 100%;
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, #22c55e 10%, var(--paper, #fff));
		border: 1px solid color-mix(in srgb, #22c55e 30%, var(--line, #ddd));
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--ink, #111);
		text-align: left;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.info-banner {
		width: 100%;
		padding: 0.75rem 1rem;
		background: color-mix(in srgb, #3b82f6 8%, var(--paper, #fff));
		border: 1px solid color-mix(in srgb, #3b82f6 20%, var(--line, #ddd));
		border-radius: 8px;
		font-size: 0.9rem;
		color: var(--muted, #666);
		text-align: left;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
