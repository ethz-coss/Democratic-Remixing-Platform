<script lang="ts">
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { localizePath } from '$lib/utils/i18n-path';
	import { startQuestionRealtimeSync } from '$lib/realtime/question-phase';
	import VoteControls from '$lib/components/VoteControls.svelte';
	import WysiwygMarkdownEditor from '$lib/components/WysiwygMarkdownEditor.svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { headerState } from '$lib/stores/headerState.svelte';
	import NotificationPanel from '$lib/components/NotificationPanel.svelte';
	import SideDrawer from '$lib/components/SideDrawer.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import * as T from '$lib/utils/terminology';
	import PhaseTimeline from '$lib/components/PhaseTimeline.svelte';

	let { data } = $props();
	const remixKey = 'remix-question-draft';

	// ── Local panel state (managed here, surfaced via headerState) ────
	let notificationPanelOpen = $state(false);
	let drawerOpen = $state(false);

	let isTutorial = $state(false);

	$effect(() => {
		isTutorial = page.url.searchParams.get('tutorial') === 'phase';
	});

	function dismissTutorial() {
		isTutorial = false;
		if (browser) {
			const url = new URL(window.location.href);
			url.searchParams.delete('tutorial');
			goto(url.pathname + url.search, { replaceState: true, keepFocus: true });
		}
	}

	let currentScore = $state(0);
	let currentStatus = $state<App.QuestionRecord['current_phase_name']>('Proposed');
	let subscriptionCount = $state(0);
	let hydratedQuestionId = $state('');

	$effect(() => {
		if (hydratedQuestionId === data.question.id) {
			return;
		}

		currentScore = data.question.score;
		currentStatus = data.question.current_phase_name;
		subscriptionCount = Math.max(0, currentScore);
		hydratedQuestionId = data.question.id;
	});

	function remixQuestion() {
		localStorage.setItem(
			remixKey,
			JSON.stringify({
				title: `${data.question.title} (Remix)`,
				description: data.question.description,
				constraints: data.question.constraints
			})
		);
		goto(localizePath('/questions/new'));
	}

	function statusLabel(status: App.QuestionRecord['current_phase_name']) {
		switch (status) {
			case 'Proposed':
				return m.question_status_proposed();
			case 'AnswerSearch':
				return m.question_status_active_workspace();
			case 'Closing':
				return m.question_status_closing_window();
			case 'Voting':
				return m.question_status_final_vote();
			default:
				return status;
		}
	}

	onMount(() => {
		// Register question-mode header
		headerState.mode = 'question';
		headerState.questionTitle = data.question.title;
		headerState.isTabPage = false; // always show back arrow on question detail
		headerState.showQuestionPanel = false;
		headerState.showComparePool = false;
		headerState.onToggleDrawer = () => (drawerOpen = !drawerOpen);
		headerState.onToggleNotificationPanel = () => (notificationPanelOpen = !notificationPanelOpen);
		headerState.onToggleQuestionPanel = null;

		if (!browser) {
			return;
		}

		let dispose = () => {};
		let cancelled = false;

		void startQuestionRealtimeSync({
			questionIds: [data.question.id],
			onRefresh: () => {
				void invalidateAll();
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

	onDestroy(() => {
		// Reset header back to default when navigating away
		headerState.mode = 'default';
		headerState.questionTitle = '';
		headerState.onToggleDrawer = null;
		headerState.onToggleNotificationPanel = null;
	});
</script>

<section class="stack" style="gap:1rem;">
	<header class="section-card stack" style="gap:1rem; position: relative;">
		{#if isTutorial}
			<div class="tutorial-overlay" transition:fade></div>
			<div class="tutorial-content" transition:fade>
				<div class="tutorial-header">
					<h3 class="text-lg font-bold">Phase Tutorial</h3>
					<p class="text-sm">Explore the timeline below to see how this question evolves.</p>
				</div>
				<PhaseTimeline currentPhase={currentStatus} interactive={true} detailed={true} />
				<div class="tutorial-actions">
					<Button variant="primary" onclick={dismissTutorial}>Got it!</Button>
				</div>
			</div>
		{:else}
			<!-- Visual breadcrumb instead of raw debug text -->
			<PhaseTimeline currentPhase={currentStatus} interactive={false} detailed={false} />
		{/if}

		<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem;">
			<h1 class="title" style="margin:0;">{data.question.title}</h1>
			<div class="flex items-center gap-2" style="flex-shrink:0;">
				{#if data.question.visibility && data.question.visibility !== 'Public'}
					<Badge label={data.question.visibility} theme="muted" shape="pill" />
				{/if}
			</div>
		</div>

		<!-- Semantic metadata row -->
		<div
			style="display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; font-size:0.9rem; color:var(--muted);"
		>
			<span>
				{#if data.author}
					{@html m.question_by_author({
						name: `<span style="color:var(--ink); font-weight:500;">${data.author.name || data.author.username || data.author.id}</span>`
					})}
				{:else}
					{m.question_by_unknown()}
				{/if}
			</span>
			<span aria-hidden="true">·</span>
			<span style="display:flex; align-items:center; gap:0.25rem;">
				<T.ICON_BALLOT size={14} class="btn-icon" />
				{m.question_score({ score: subscriptionCount })}
			</span>
			<span aria-hidden="true">·</span>
			<span>{m.question_status_label({ status: statusLabel(currentStatus) })}</span>
		</div>

		<div style="margin-top: 0.5rem;">
			{#if currentStatus === 'Proposed'}
				<VoteControls
					questionId={data.question.id}
					action="?/vote"
					subscriptionCount={Math.max(0, data.question.score)}
					userVote={data.userVote}
					canVote={Boolean(data.user)}
					onVoteSuccess={(sc) => (subscriptionCount = sc)}
				/>
			{:else}
				<Button
					variant="primary"
					href={localizePath(`/questions/${data.question.id}/proposals`)}
					class="w-full"
					style="justify-content: center;"
				>
					{m.question_enter_space()}
				</Button>
			{/if}
		</div>

		{#if data.question.visibility === 'Private' && data.user?.id === data.question.author}
			<div class="alert alert-info mt-4">
				<div class="flex w-full flex-col gap-2">
					<span class="font-bold">{m.question_private_invite_title()}</span>
					<span class="text-sm">{m.question_invite_share()}</span>
					<div class="join w-full">
						<input
							type="text"
							class="input input-sm input-bordered join-item w-full"
							value={typeof window !== 'undefined'
								? window.location.origin +
									localizePath(`/register?invite_token=${data.question.invite_token}`)
								: ''}
							readonly
						/>
						<Button
							variant="secondary"
							size="sm"
							class="join-item"
							onclick={() => {
								navigator.clipboard.writeText(
									window.location.origin +
										localizePath(`/register?invite_token=${data.question.invite_token}`)
								);
								alert(m.question_copied());
							}}
						>
							Copy
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</header>

	<article class="section-card stack">
		<h2 style="margin:0;">{m.question_description()}</h2>
		<WysiwygMarkdownEditor
			html={data.question.description}
			editable={false}
			emptyText={m.question_no_description()}
		/>
	</article>

	{#if currentStatus === 'Proposed'}
		<div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
			<Button variant="secondary" type="button" onclick={remixQuestion}>{m.question_remix()}</Button
			>
		</div>
	{/if}

	<!-- Panels wired to the topbar (question mode) -->
	<SideDrawer
		open={drawerOpen}
		onClose={() => (drawerOpen = false)}
		user={data.user}
		questionTitle={data.question.title}
		questionId={data.question.id}
		surveyUnlocked={data.surveyUnlocked ?? false}
		surveyCompleted={data.surveyCompleted ?? false}
	/>
	<NotificationPanel
		open={notificationPanelOpen}
		onClose={() => (notificationPanelOpen = false)}
		pushLogs={data.notifications?.pushLogs ?? []}
	/>
</section>

<style>
	.tutorial-overlay {
		position: absolute;
		top: -1rem;
		left: -1rem;
		right: -1rem;
		bottom: -1rem;
		background: rgba(0, 0, 0, 0.05);
		border-radius: 12px;
		z-index: 10;
		pointer-events: none;
	}

	.tutorial-content {
		position: relative;
		z-index: 11;
		background: var(--paper, #fff);
		padding: 1.5rem;
		border-radius: 12px;
		border: 2px solid var(--primary, #4f7df9);
		box-shadow: 0 8px 32px rgba(79, 125, 249, 0.15);
		margin: -0.5rem;
	}

	.tutorial-header {
		margin-bottom: 1.5rem;
		text-align: center;
	}

	.tutorial-header h3 {
		color: var(--primary, #4f7df9);
		margin-bottom: 0.25rem;
	}

	.tutorial-header p {
		color: var(--muted, #666);
	}

	.tutorial-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
</style>
