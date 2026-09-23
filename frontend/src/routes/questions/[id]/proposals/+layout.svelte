<script lang="ts">
	import { browser } from '$app/environment';
	import { isRemixingEnabled } from '$lib/utils/phase';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { headerState } from '$lib/stores/headerState.svelte';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		beforeNavigate,
		afterNavigate,
		pushState,
		replaceState,
		preloadData
	} from '$app/navigation';
	import ProposalPage from './[proposalId]/+page.svelte';
	import { startQuestionRealtimeSync } from '$lib/realtime/question-phase';
	import StaticLineageGraph from '$lib/components/StaticLineageGraph.svelte';
	import { editorState } from '$lib/editor.svelte';
	import { feedViewState, getFilterState } from '$lib/feedView.svelte';
	import { localizePath } from '$lib/utils/i18n-path';
	import { voteState } from '$lib/stores/voteState.svelte';
	import ComparePoolHeaderButton from '$lib/components/ComparePoolHeaderButton.svelte';
	import CompareCombiSheet from '$lib/components/CompareCombiSheet.svelte';
	import SideDrawer from '$lib/components/SideDrawer.svelte';
	import VoteControls from '$lib/components/VoteControls.svelte';
	import {
		computeLocalNeighborhood,
		type NeighborhoodResult
	} from '$lib/services/local-neighborhood';
	import BottomTabBar from '$lib/components/BottomTabBar.svelte';
	import NotificationPanel from '$lib/components/NotificationPanel.svelte';
	import QuestionContextPanel from '$lib/components/QuestionContextPanel.svelte';
	import { Bell, BookOpen, Target } from '@lucide/svelte';
	import {
		type TabRoute,
		filterDagProposals,
		handleNodeTap as nodeTap
	} from '$lib/dag/dag-interaction.svelte';

	// ── Shallow routing interceptor removed in favor of link-level onclick handlers ──

	let { data, children } = $props();

	let questionId = $derived(data.question.id);

	// ── Sync vote store with server data ─────────────────────────────
	// Re-initializes whenever layout data changes (incl. realtime invalidation).
	// untrack prevents init()'s internal $state reads from subscribing
	// this effect to store mutations (which would cause a feedback loop
	// that overwrites optimistic updates with stale server data).
	$effect(() => {
		const votes = data.userProposalVotes;
		const proposals = data.proposals;
		untrack(() => voteState.init(votes, proposals));
	});

	// ── Drawer state ─────────────────────────────────────────────────
	let drawerOpen = $state(false);
	let notificationPanelOpen = $state(false);
	let questionPanelOpen = $state(false);

	// Is the user on a main tab page (burger) vs. a detail/editor page (back button)?
	const TAB_ROUTES = new Set([
		'ballot',
		'results',
		'all',
		'map',
		'question',
		'ideas',
		'subscriptions'
	]);
	const isTabPage = $derived.by(() => {
		if (proposalModalData && activeProposalId) return false;
		const segments = page.url.pathname.split('/').filter(Boolean);
		const last = segments[segments.length - 1];
		return TAB_ROUTES.has(last ?? '');
	});

	// ── Route-derived state ──────────────────────────────────────────
	const KNOWN_ROUTES = new Set([
		'ballot',
		'editor',
		'proposals',
		'all',
		'map',
		'question',
		'compare',
		'ideas',
		'subscriptions',
		'new',
		'results'
	]);

	// In SvelteKit 2, invalidate() clears page.state on shallow routes.
	// We cache the modal data in local state to prevent the modal from flashing closed.
	let cachedModalData = $state<any>(null);
	let cachedFromTab = $state<string | null>(null);

	$effect(() => {
		const st = page.state as any;
		if (st.proposalModalData) {
			cachedModalData = st.proposalModalData;
			cachedFromTab = st.fromTab;
		}
	});

	let activeProposalId = $derived.by(() => {
		const st = page.state as any;
		if (st.proposalModalData?.proposal?.id) {
			return st.proposalModalData.proposal.id;
		}

		const segments = page.url.pathname.split('/').filter(Boolean);
		const last = segments[segments.length - 1];
		const secondToLast = segments[segments.length - 2];
		if (last && !KNOWN_ROUTES.has(last) && secondToLast !== 'subscriptions') return last;
		return null;
	});

	function requestFreshData() {
		if (proposalModalData) {
			pendingInvalidate = true;
		} else {
			void invalidate('app:proposals');
		}
	}

	beforeNavigate((navigation) => {
		if (
			navigation.from?.url.pathname.endsWith('/compare') &&
			!navigation.to?.url?.pathname?.endsWith('/compare')
		) {
			if (editorState.phase === 'compare') {
				editorState.close();
			}
		}
	});

	// Clear cached modal data when the user navigates away from the modal
	// to prevent stale proposal data from flashing on next modal open
	afterNavigate((navigation) => {
		if (!activeProposalId && cachedModalData) {
			cachedModalData = null;
			cachedFromTab = null;
		}
		// When navigating to subscriptions or ballot tab, request fresh layout data
		if (currentTab === 'subscriptions' || currentTab === 'ballot') {
			requestFreshData();
		}
	});

	let proposalModalData = $derived.by(() => {
		if (activeProposalId) {
			if (cachedModalData?.proposal?.id === activeProposalId) return cachedModalData;
			const st = page.state as any;
			if (st.proposalModalData?.proposal?.id === activeProposalId) {
				return st.proposalModalData;
			}
			const pageData = page.data as any;
			if (pageData.proposal?.id === activeProposalId) return pageData;
			return null;
		}
		return null;
	});

	// Auto-fetch missing modal data (e.g. if SvelteKit history state is lost during popstate)
	$effect(() => {
		if (activeProposalId && !proposalModalData) {
			const detailPath = localizePath(`/questions/${questionId}/proposals/${activeProposalId}`);
			preloadData(detailPath).then((result) => {
				if (result.type === 'loaded') {
					cachedModalData = result.data;
				}
			});
		}
	});

	let fromTabState = $derived.by(() => {
		if (activeProposalId) {
			if (cachedModalData?.proposal?.id === activeProposalId) return cachedFromTab;
			const st = page.state as any;
			if (st.proposalModalData?.proposal?.id === activeProposalId) return st.fromTab;
			return null;
		}
		return null;
	});

	let currentTab = $derived.by(() => {
		if (proposalModalData && activeProposalId && fromTabState) return fromTabState;
		const segments = page.url.pathname.split('/').filter(Boolean);
		const last = segments[segments.length - 1];
		const secondToLast = segments[segments.length - 2];
		if (last === 'ballot') return 'ballot' as const;
		if (last === 'results') return 'results' as const;
		if (last === 'all') return 'all' as const;
		if (last === 'map') return 'map' as const;
		if (last === 'ideas') return 'discover' as const;
		if (last === 'subscriptions' || secondToLast === 'subscriptions')
			return 'subscriptions' as const;
		if (last === 'question') return 'question' as const;
		if (last === 'editor') return 'editor' as const;
		if (last === 'compare') return 'compare' as const;
		if (last === 'new') return 'new' as const;
		// If the last segment is not a known route, it's a proposal ID
		if (last && !KNOWN_ROUTES.has(last) && secondToLast !== 'subscriptions')
			return 'proposal' as const;
		return 'ballot' as const;
	});

	// ── Desktop detection ────────────────────────────────────────────
	let isDesktop = $state(browser ? window.matchMedia('(min-width: 769px)').matches : false);

	const canCreateRootProposal = $derived(
		Boolean(data.user) && data.question.current_phase_name === 'AnswerSearch'
	);

	// Whether the current user already authored at least one root idea for this question
	const userHasIdea = $derived(
		Boolean(data.user) &&
			data.proposals.some(
				(p: App.ProposalRecord) =>
					p.author === data.user!.id && (!p.parent_proposals || p.parent_proposals.length === 0)
			)
	);

	// Clear compare pool across routes? No, we keep it.

	// ── Graph data for desktop map pane ───────────────────────────────
	let explicitlyFocusedIdeaId = $state<string | null>(null);
	let softlyHoveredIdeaId = $state<string | null>(null);

	type GraphViewMode = 'auto' | 'full' | 'clusters' | 'lineage';
	type GraphCardMode = 'auto' | 'dots' | 'cards';

	let graphViewMode = $state<GraphViewMode>('auto');
	let graphCardMode = $state<GraphCardMode>('auto');

	// Auto-focus the map on the active proposal detail page
	$effect(() => {
		if (activeProposalId) {
			explicitlyFocusedIdeaId = activeProposalId;
		} else {
			explicitlyFocusedIdeaId = null;
		}
	});

	// Neighborhood computation for the right-side StaticLineageGraph
	const activeNeighborhood = $derived.by<NeighborhoodResult | null>(() => {
		if (!explicitlyFocusedIdeaId) {
			return null;
		}
		const allProposals = data.proposals;
		return computeLocalNeighborhood(explicitlyFocusedIdeaId, allProposals);
	});

	const activeThemeKey = $derived((page.params as any).stableKey || null);
	const clusterExpandable = $derived(
		graphViewMode === 'clusters' ? false : !(currentTab === 'discover' && !activeThemeKey)
	);

	const dagProposals = $derived(
		filterDagProposals(
			data.proposals,
			currentTab as TabRoute,
			activeProposalId,
			data.userProposalVotes,
			data.user?.id,
			new Set(data.seenProposalIds || []),
			data.labels,
			activeThemeKey,
			graphViewMode
		)
	);

	function handleNodeTap(ideaId: string) {
		const proposal = data.proposals.find((s: App.ProposalRecord) => s.id === ideaId);
		if (!proposal) return;
		explicitlyFocusedIdeaId = ideaId;
		goto(localizePath(`/questions/${data.question.id}/proposals/${ideaId}`));
	}

	function handleShowDetails(ideaId: string) {
		goto(localizePath(`/questions/${data.question.id}/proposals/${ideaId}`));
	}

	function handleClusterClick(clusterIdx: number) {
		feedViewState.subView = 'all';
		feedViewState.selectedClusterIdx = clusterIdx;
		getFilterState('discover').selectedLabelId = data.labels?.[clusterIdx]?.id || null;
		goto(localizePath(`/questions/${data.question.id}/proposals/ideas`));
	}

	const showBottomTabs = $derived(
		currentTab !== 'editor' && currentTab !== 'compare' && !editorState.isOpen
	);

	// Phase-based Redirects
	$effect(() => {
		if (proposalModalData) return;
		const phase = data.question.current_phase_name;

		if (phase === 'Proposed') {
			// In Proposed, only 'question' (Overview) is active.
			if (currentTab !== 'question') {
				goto(localizePath(`/questions/${data.question.id}/proposals/question`), {
					replaceState: true
				});
			}
		} else if (phase === 'Voting') {
			// In Voting, allow 'question', 'ballot', 'compare', and 'proposal'.
			if (
				currentTab !== 'question' &&
				currentTab !== 'ballot' &&
				currentTab !== 'compare' &&
				currentTab !== 'proposal'
			) {
				goto(localizePath(`/questions/${data.question.id}/proposals/question`), {
					replaceState: true
				});
			}
		} else if (phase === 'Closing') {
			// In Closing, allow discover, subscriptions, ballot, compare, proposal, and question.
			if (
				currentTab !== 'question' &&
				currentTab !== 'discover' &&
				currentTab !== 'subscriptions' &&
				currentTab !== 'ballot' &&
				currentTab !== 'compare' &&
				currentTab !== 'proposal'
			) {
				goto(localizePath(`/questions/${data.question.id}/proposals/question`), {
					replaceState: true
				});
			}
		} else if (phase === 'AnswerSearch') {
			// During discussion, ballot is now visible as a focus list.
			if (currentTab === 'results') {
				goto(localizePath(`/questions/${data.question.id}/proposals/ideas`), {
					replaceState: true
				});
			}
		} else if (phase === 'Decided') {
			// In Decided, allow 'question', 'results', and 'proposal'.
			if (currentTab !== 'question' && currentTab !== 'results' && currentTab !== 'proposal') {
				goto(localizePath(`/questions/${data.question.id}/proposals/results`), {
					replaceState: true
				});
			}
		}
	});

	// The $effect for auto-redirecting to /compare was removed.
	// We now rely on imperative goto() calls from the UI to navigate to compare,
	// which prevents accidental auto-redirects when phase is not closed correctly.

	$effect(() => {
		if (page.url.searchParams.get('openNotifications') === 'true') {
			notificationPanelOpen = true;
			const newUrl = new URL(page.url);
			newUrl.searchParams.delete('openNotifications');
			replaceState(newUrl, page.state);
		}
	});

	// ── Lifecycle ────────────────────────────────────────────────────
	onMount(() => {
		if (!browser) return;
		// Listen for locate events from child pages
		const handleLocate = (e: Event) => {
			const detail = (e as CustomEvent<{ id: string }>).detail;
			if (detail?.id) {
				explicitlyFocusedIdeaId = detail.id;
			}
		};
		// Listen for question panel open requests from child pages
		const handleOpenPanel = () => {
			questionPanelOpen = true;
		};
		// Listen for window focus & visibility changes to refresh stale data when returning
		const handleFocusOrVisibility = () => {
			if (document.visibilityState === 'visible') {
				requestFreshData();
			}
		};

		window.addEventListener('dag:locate', handleLocate);
		window.addEventListener('question-panel:open', handleOpenPanel);
		window.addEventListener('focus', handleFocusOrVisibility);
		document.addEventListener('visibilitychange', handleFocusOrVisibility);

		return () => {
			window.removeEventListener('dag:locate', handleLocate);
			window.removeEventListener('question-panel:open', handleOpenPanel);
			window.removeEventListener('focus', handleFocusOrVisibility);
			document.removeEventListener('visibilitychange', handleFocusOrVisibility);
		};
	});

	let pendingInvalidate = $state(false);

	// In SvelteKit 2, invalidate() clears page.state on shallow routes.
	// We defer realtime invalidations while the modal is open to prevent flashing closed.
	$effect(() => {
		const isModalOpen = !!proposalModalData;
		if (!isModalOpen && pendingInvalidate) {
			pendingInvalidate = false;
			invalidate('app:proposals');
		}
	});

	onMount(() => {
		if (!browser) return;
		let dispose = () => {};
		let cancelled = false;

		void startQuestionRealtimeSync({
			questionIds: [data.question.id],
			collections: ['questions', 'proposals', 'proposal_votes', 'labels', 'proposal_hides'],
			onRefresh: () => {
				requestFreshData();
			}
		}).then((nextDispose) => {
			if (cancelled) {
				nextDispose();
				return;
			}
			dispose = nextDispose;
		});

		return () => {
			cancelled = true;
			dispose();
		};
	});

	onMount(() => {
		if (!browser) return;
		const mql = window.matchMedia('(min-width: 769px)');
		isDesktop = mql.matches;
		const handler = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	// ── Sync headerState with reactive proposals layout state ─────────
	$effect(() => {
		headerState.mode = 'question';
		headerState.questionTitle = data.question.title;
		headerState.isTabPage = isTabPage;
		headerState.showQuestionPanel = true;
		headerState.showComparePool = true;
		headerState.onToggleDrawer = () => (drawerOpen = !drawerOpen);
		headerState.onToggleNotificationPanel = () => (notificationPanelOpen = !notificationPanelOpen);
		headerState.onToggleQuestionPanel = () => (questionPanelOpen = !questionPanelOpen);
		headerState.onBack = () => {
			if (currentTab === 'proposal' && proposalModalData) {
				// We are in a shallow modal. If we have a cached tab, go back to it, else history.back
				history.back();
			} else if (currentTab === 'editor' || currentTab === 'compare') {
				editorState.close();
				if (fromTabState) {
					goto(localizePath(`/questions/${questionId}/proposals/${fromTabState}`));
				} else {
					history.back();
				}
			} else {
				// Otherwise, just try to go back
				history.back();
			}
		};
	});

	onDestroy(() => {
		headerState.mode = 'default';
		headerState.questionTitle = '';
		headerState.showQuestionPanel = false;
		headerState.showComparePool = false;
		headerState.notificationCount = 0;
		headerState.onToggleDrawer = null;
		headerState.onToggleNotificationPanel = null;
		headerState.onToggleQuestionPanel = null;
		headerState.onBack = null;
	});
</script>

<div class="proposals-layout" style="--banner-h: 0px;">
	<!-- Side drawer -->
	<SideDrawer
		open={drawerOpen}
		onClose={() => (drawerOpen = false)}
		user={data.user}
		questionTitle={data.question.title}
		questionId={data.question.id}
		surveyUnlocked={data.surveyUnlocked}
		surveyCompleted={data.surveyCompleted}
	/>

	<!-- Notification panel drawer — uses global root layout data + workspace migration prompts -->
	<NotificationPanel
		open={notificationPanelOpen}
		onClose={() => (notificationPanelOpen = false)}
		pushLogs={data.notifications?.pushLogs ?? []}
	/>

	<!-- Question context guidelines panel -->
	<QuestionContextPanel
		open={questionPanelOpen}
		onClose={() => (questionPanelOpen = false)}
		question={data.question}
	/>

	<!-- ══ Workspace body ══ -->
	<div class="workspace-body" class:is-detail-view={!!activeProposalId}>
		<!-- Content pane -->
		<div class="content-pane">
			<div class="content-wrapper">
				<!-- Main content scroll area -->
				<div class="content-scroll" class:no-scroll={currentTab === 'all' || currentTab === 'map'}>
					{@render children()}
				</div>

				{#if proposalModalData && activeProposalId}
					<div class="proposal-modal-overlay">
						<div class="proposal-modal-content">
							{#key activeProposalId}
								<ProposalPage data={proposalModalData} form={null} />
							{/key}
						</div>
					</div>
				{/if}
			</div>

			<!-- Bottom tab bar -->
			<BottomTabBar
				{questionId}
				hidden={!showBottomTabs}
				mode="bottom"
				currentPhase={data.question.current_phase_name}
				canCreateRootProposal={isRemixingEnabled(data.question.current_phase_name) &&
					currentTab !== 'compare'}
				{userHasIdea}
			/>
		</div>

		<!-- Map pane for detail view (desktop only) -->
		{#if activeProposalId && isDesktop}
			<div class="map-pane">
				<StaticLineageGraph
					focusedNodeId={explicitlyFocusedIdeaId ?? ''}
					allProposals={data.proposals}
					neighborhoodProposals={activeNeighborhood?.nodes ?? dagProposals}
					nodeTypes={activeNeighborhood?.nodeTypes}
					hiddenSiblingCount={activeNeighborhood?.hiddenSiblingCount ?? 0}
					labels={data.labels ?? []}
					question={data.question}
					questionId={data.question.id}
					disableFullscreen={true}
					hiddenProposalIds={new Set([
						...(data.userHiddenProposalIds ?? []),
						...feedViewState.optimisticHidden
					])}
					userVotes={voteState.userVotes}
				/>
			</div>
		{/if}
	</div>

	<!-- Unified Combine Sheet Overlay -->
	{#if editorState.phase === 'combine' || editorState.phase === 'improve'}
		<CompareCombiSheet
			{questionId}
			user={data.user}
			allProposals={data.proposals}
			userVotes={data.userProposalVotes}
			creationDisabled={!isRemixingEnabled(data.question.current_phase_name)}
		/>
	{/if}
</div>

<style>
	/* ── CSS custom property for top bar height ─────────────────────── */
	:global(:root) {
		--top-bar-h: 44px;
		--bottom-tab-h: 56px;
	}

	/* ── Root layout ─────────────────────────────────────────────────── */
	.proposals-layout {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	/* ── Workspace body ──────────────────────────────────────────────── */
	.workspace-body {
		flex: 1;
		display: flex;
		min-height: 0; /* allow flex children to shrink */
	}

	/* ── Map pane (desktop only) ─────────────────────────────────────── */
	.map-pane {
		display: none;
	}

	/* ── Content pane ────────────────────────────────────────────────── */
	.content-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		min-width: 0;
		/* background: var(--bg-primary, #fff); */
	}

	.content-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
	}

	.content-scroll {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: var(--safe-b, 0px);
	}

	.content-scroll.no-scroll {
		overflow-y: hidden;
		padding-bottom: 0;
	}

	/* ── Desktop layout ──────────────────────────────────────────────── */
	@media (min-width: 769px) {
		.workspace-body.is-detail-view {
			flex-direction: row;
		}

		.workspace-body.is-detail-view .content-pane {
			width: 100%;
			max-width: 800px;
			margin: 0;
			flex: none;
			border-right: 1px solid var(--line, #ddd);
		}

		.workspace-body.is-detail-view .map-pane {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-width: 0;
			position: relative;
			background: var(--bg-primary, #fff);
			overflow: hidden;
		}

		.workspace-body:not(.is-detail-view) .content-pane {
			width: 100%;
			max-width: 800px;
			margin: 0 auto;
			flex: none;
			border-right: none;
		}
	}

	/* ── Proposal details modal overlay ──────────────────────────────── */
	.proposal-modal-overlay {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		width: 100%;
		background: var(--paper, #fff);
		z-index: var(--z-sticky);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.proposal-modal-content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}
</style>
