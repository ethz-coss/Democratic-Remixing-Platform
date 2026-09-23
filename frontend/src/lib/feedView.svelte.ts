import type { SortMode } from '$lib/services/feed-filter';

export interface FilterState {
	feedTab: 'foryou' | 'all' | 'mine' | 'hidden';
	onlySupported: boolean;
	onlyAuthored: boolean;
	onlyInFocus: boolean;
	onlyChampions: boolean;
	onlyCombinations: boolean;
	onlyImprovements: boolean;
	onlyUnseen: boolean;
	searchQuery: string;
	selectedLabelId: string | null;
}

const defaultFilterState = (): FilterState => ({
	feedTab: 'all',
	onlySupported: false,
	onlyAuthored: false,
	onlyInFocus: false,
	onlyChampions: false,
	onlyCombinations: false,
	onlyImprovements: false,
	onlyUnseen: false,
	searchQuery: '',
	selectedLabelId: null
});

/**
 * Shared reactive state for the Proposals feed sub-view toggle.
 * Used by DiscoveryFeed (writer) and +layout.svelte (reader for DagMap filtering).
 */
export const feedViewState = $state<{
	subView: 'focus' | 'all' | 'actions';
	mobileView: 'list' | 'map';

	/** When non-null, the feed switches to All Ideas grouped/sorted by this cluster index */
	selectedClusterIdx: number | null;
	/** Client-side computed champion IDs from axiom clusters */
	championIds: Set<string>;
	/** Optimistically tracked viewed proposals to avoid waiting for server cache invalidation */
	optimisticSeen: string[];
	/** Optimistically tracked hidden proposals */
	optimisticHidden: string[];
	/** Selected sort mode per context */
	sortModeByContext: Record<string, SortMode>;
	/** Selected sort direction per context */
	sortDirectionByContext: Record<string, 'asc' | 'desc'>;
	/** Filter states per context (e.g. discover, subscriptions) */
	filterByContext: Record<string, FilterState>;
}>({
	subView: 'focus',
	mobileView: 'list',

	selectedClusterIdx: null,
	championIds: new Set(),
	optimisticSeen: [],
	optimisticHidden: [],
	sortModeByContext: {
		discover: 'PersonalFocus',
		subscriptions: 'Newest',
		related: 'Newest'
	},
	sortDirectionByContext: {
		discover: 'desc',
		subscriptions: 'desc',
		related: 'desc'
	},
	filterByContext: {
		discover: defaultFilterState(),
		subscriptions: { ...defaultFilterState(), feedTab: 'all', onlySupported: true },
		related: defaultFilterState()
	}
});

/** Helper to get or initialize filter state for a context */
export function getFilterState(context: string = 'discover'): FilterState {
	if (!feedViewState.filterByContext[context]) {
		const state = defaultFilterState();
		// Subscriptions doesn't have tabs, so we don't start with 'foryou' which might trigger weird behavior
		if (context === 'subscriptions') {
			state.feedTab = 'all'; // Even though UI doesn't show it, it's safer
			state.onlySupported = true; // Subscriptions defaults to only showing supported
		}
		feedViewState.filterByContext[context] = state;
	}
	return feedViewState.filterByContext[context];
}
