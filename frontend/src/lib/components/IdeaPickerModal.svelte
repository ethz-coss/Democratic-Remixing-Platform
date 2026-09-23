<script lang="ts">
	import { X } from '@lucide/svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FilterBar from './FilterBar.svelte';
	import ProposalCard from './ProposalCard.svelte';
	import { feedViewState } from '$lib/feedView.svelte';
	import { filterProposals, sortProposals, type SortMode } from '$lib/services/feed-filter';

	interface Props {
		isOpen: boolean;
		proposals: App.ProposalRecord[];
		userVotes: Record<string, number>;
		labels?: App.LabelRecord[];
		onSelect: (proposal: App.ProposalRecord) => void;
		onClose: () => void;
	}

	let { isOpen, proposals, userVotes, labels = [], onSelect, onClose }: Props = $props();

	// Use local state for sort so we don't mess up the global feed's sorting
	let localSortMode = $state<SortMode>('Newest');
	let localSortDir = $state<'asc' | 'desc'>('desc');

	let localOnlySupported = $state(false);
	let localOnlyAuthored = $state(false);
	let localOnlyInFocus = $state(false);
	let localOnlyChampions = $state(false);
	let localOnlyCombinations = $state(false);
	let localOnlyImprovements = $state(false);
	let localOnlyUnseen = $state(false);
	let localSearchQuery = $state('');
	let localSelectedLabelId = $state<string | null>(null);

	// Create available labels
	const availableLabels = $derived.by(() => {
		if (!labels) return [];
		const present = new Set<string>();
		for (const p of proposals) {
			if (p.primary_label) present.add(p.primary_label);
			if (p.labels) {
				for (const lId of p.labels) present.add(lId);
			}
		}
		return labels.filter((l) => present.has(l.id));
	});

	// Filter and sort
	const displayedProposals = $derived.by(() => {
		const opts = {
			userVotes,
			searchQuery: localSearchQuery,
			selectedLabelId: localSelectedLabelId,
			onlySupported: localOnlySupported,
			onlyAuthored: localOnlyAuthored,
			onlyInFocus: localOnlyInFocus,
			onlyChampions: localOnlyChampions,
			onlyCombinations: localOnlyCombinations,
			onlyImprovements: localOnlyImprovements,
			onlyUnseen: localOnlyUnseen,
			comparePoolIds: new Set<string>(),
			seenProposalIds: new Set<string>(),
			userHiddenProposalIds: new Set<string>(),
			hideSubscribed: false,
			labelAffinities: new Map<string, number>(),
			onlyHidden: false,
			userId: '',
			championIds: new Set<string>()
		};

		let filtered = filterProposals(proposals, new Set(), opts);
		filtered = sortProposals(filtered, localSortMode, opts, localSortDir);
		return filtered;
	});
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={onClose}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<h3>Select an idea to combine</h3>
				<Button variant="icon" onclick={onClose}><X size={18} /></Button>
			</div>

			<div class="filter-section">
				<FilterBar
					bind:sortMode={localSortMode}
					bind:sortDirection={localSortDir}
					bind:onlySupported={localOnlySupported}
					bind:onlyAuthored={localOnlyAuthored}
					bind:onlyInFocus={localOnlyInFocus}
					bind:onlyChampions={localOnlyChampions}
					bind:onlyCombinations={localOnlyCombinations}
					bind:onlyImprovements={localOnlyImprovements}
					bind:onlyUnseen={localOnlyUnseen}
					bind:searchQuery={localSearchQuery}
					bind:selectedLabelId={localSelectedLabelId}
					labels={availableLabels}
					showHiddenFilter={false}
					context="related"
				/>
			</div>

			<div class="proposals-list">
				{#each displayedProposals as proposal (proposal.id)}
					{@const labelRecord = labels.find((l) => l.id === proposal.primary_label)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="card-wrapper" onclick={() => onSelect(proposal)}>
						<ProposalCard
							variant="compact"
							{proposal}
							isSeen={true}
							userVote={userVotes[proposal.id] ?? 0}
							canVote={false}
							unseenImprovementCount={0}
							clusterColor={labelRecord?.color}
							clusterTitle={labelRecord?.short_name}
							activeLabels={(proposal.labels || [])
								.map((id) => labels.find((l) => l.id === id))
								.filter((l): l is App.LabelRecord => Boolean(l))
								.map((l) => ({ id: l.id, short_name: l.short_name, color: l.color }))}
							isChampion={false}
							isAuthored={false}
							subscriptionCount={proposal.subscription_count ?? 0}
							isHidden={false}
							onHide={() => {}}
							onRestore={() => {}}
						/>
					</div>
				{/each}
				{#if displayedProposals.length === 0}
					<div class="empty-state">No ideas match your filters.</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.modal-content {
		background: var(--color-surface, #fff);
		width: 90%;
		max-width: 700px;
		max-height: 85vh;
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
	}
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-bottom: 1px solid var(--color-surface-200);
	}
	.modal-header h3 {
		margin: 0;
		font-size: 1.1rem;
	}
	.filter-section {
		border-bottom: 1px solid var(--color-surface-200);
		/* Reset z-index if needed so dropdowns work */
	}
	.proposals-list {
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background: var(--color-bg-secondary, #f9f9f9);
		border-bottom-left-radius: 12px;
		border-bottom-right-radius: 12px;
	}
	.card-wrapper {
		cursor: pointer;
		transition: transform 0.1s;
	}
	.card-wrapper:hover {
		transform: scale(1.01);
	}
	/* Prevent clicks on card internals from interfering with selection, while allowing the card to render normally */
	.card-wrapper :global(.proposal-card-inner) {
		pointer-events: none;
	}
	.card-wrapper :global(button),
	.card-wrapper :global(a) {
		pointer-events: none;
	}
	.empty-state {
		text-align: center;
		padding: 2rem;
		color: var(--color-text-muted);
	}
</style>
