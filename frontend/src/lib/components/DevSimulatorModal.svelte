<script lang="ts">
	import { onMount } from 'svelte';

	interface QuestionItem {
		id: string;
		title: string;
		current_phase_name: string;
		updated: string;
	}

	interface Summary {
		id: string;
		title: string;
		status: string;
		selectionTriggerThresholdPercent: number;
		proposedProposals: number;
		archivedProposals: number;
		commentCount: number;
		activeRoundCount: number;
		readySignalCount: number;
	}

	interface SimulationRun {
		id: string;
		label: string;
		status: string;
		questionId: string;
		startedAt: string;
		lastActionAt: string;
		userCount: number;
		actionCount: number;
	}

	interface SelectedRunUser {
		runUserId: string;
		id: string;
		username: string;
		email: string;
		name: string;
		simulation: boolean;
	}

	let {
		open = false,
		onClose = () => {},
		preferredQuestionId = '',
		canStartOnRoute = false
	}: {
		open?: boolean;
		onClose?: () => void;
		preferredQuestionId?: string;
		canStartOnRoute?: boolean;
	} = $props();

	let loading = $state(false);
	let message = $state('');
	let messageOk = $state(true);
	let questions = $state<QuestionItem[]>([]);
	let selectedQuestionId = $state('');
	let selectedSummary = $state<Summary | null>(null);
	let currentRun = $state<SimulationRun | null>(null);
	let selectedRunId = $state('');
	let activePhaseKey = $state('');
	let simulationCollectionsReady = $state(true);
	let simulationCollectionsMessage = $state('');
	let simUserCount = $state(0);
	let selectedRunUserCount = $state(0);
	let selectedRunUsers = $state<SelectedRunUser[]>([]);

	let createCount = $state('4');
	let scheduleStart = $state('');
	let spreadDays = $state('7');
	let initialCount = $state('5');
	let remixCount = $state('5');
	let remixMode = $state('merge');
	let votesCount = $state('20');
	let ballotsCount = $state('20');
	let mergesCount = $state('5');
	let proceedCount = $state('10');
	let batchInitial = $state(true);
	let batchRemix = $state(true);
	let batchVotes = $state(true);
	let batchMerges = $state(true);
	let batchProceed = $state(false);
	let agentPoolCollapsed = $state(true);

	// Derive the effective agent count from run users
	const availableAgents = $derived(selectedRunUsers.length || selectedRunUserCount || 0);

	// Auto-fill action counts with the available agent pool size
	$effect(() => {
		const n = availableAgents;
		if (n <= 0) return;
		const s = String(n);
		initialCount = s;
		remixCount = s;
		votesCount = String(n * 3);
		ballotsCount = s;
		mergesCount = s;
		proceedCount = s;
	});

	function setNotice(text: string, ok = true) {
		message = text;
		messageOk = ok;
	}

	function resolveQuestionLabel() {
		if (!selectedQuestionId) {
			return 'No question selected';
		}
		const found = questions.find((question) => question.id === selectedQuestionId);
		if (!found) {
			return `Question ${selectedQuestionId}`;
		}
		return `${found.title} (${found.current_phase_name})`;
	}

	async function loadData(questionId?: string) {
		loading = true;
		try {
			const query = questionId ? `?question=${encodeURIComponent(questionId)}` : '';
			const res = await fetch(`/api/dev-simulator${query}`);
			if (!res.ok) {
				setNotice('Failed to load simulator data.', false);
				return;
			}
			const data = (await res.json()) as {
				questions: QuestionItem[];
				selectedQuestionId: string;
				selectedQuestionSummary: Summary | null;
				activePhaseKey?: string;
				run: SimulationRun | null;
				selectedRunId: string;
				selectedRunUserCount?: number;
				selectedRunUsers?: SelectedRunUser[];
				simulationCollectionsReady?: boolean;
				simulationCollectionsMessage?: string;
				simUsers: Array<{ id: string }>;
			};
			questions = data.questions ?? [];
			selectedQuestionId = data.selectedQuestionId ?? '';
			selectedSummary = data.selectedQuestionSummary ?? null;
			activePhaseKey = String(data.activePhaseKey ?? '').trim();
			currentRun = data.run ?? null;
			selectedRunId = data.selectedRunId ?? '';
			selectedRunUserCount = data.selectedRunUserCount ?? 0;
			selectedRunUsers = data.selectedRunUsers ?? [];
			simulationCollectionsReady = data.simulationCollectionsReady ?? true;
			simulationCollectionsMessage = data.simulationCollectionsMessage ?? '';
			simUserCount = data.simUsers?.length ?? 0;
		} catch {
			setNotice('Simulator API unavailable.', false);
		} finally {
			loading = false;
		}
	}

	function toLocalDateTimeValue(input?: string): string {
		const date = input ? new Date(input) : new Date();
		if (Number.isNaN(date.getTime())) {
			return '';
		}
		const offsetMs = date.getTimezoneOffset() * 60000;
		return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
	}

	function buildSharedTimingParams() {
		return {
			startDate: scheduleStart ? new Date(scheduleStart).toISOString() : '',
			spreadDays
		};
	}

	async function runAction(action: string, extra: Record<string, unknown> = {}) {
		if (action !== 'resetAllSimulationData' && !selectedQuestionId) {
			setNotice('Choose a question first.', false);
			return;
		}

		const questionTitle =
			questions.find((question) => question.id === selectedQuestionId)?.title ??
			'Untitled question';
		const body: Record<string, unknown> = {
			action,
			questionId: selectedQuestionId,
			questionTitle,
			runId: selectedRunId,
			...extra
		};

		loading = true;
		try {
			const res = await fetch('/api/dev-simulator', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const payload = (await res.json()) as {
				ok?: boolean;
				message?: string;
				runId?: string;
				questionId?: string;
				selectedQuestionSummary?: Summary | null;
				activePhaseKey?: string;
				deletionSummary?: { deletedByCollection?: Record<string, number>; warnings?: string[] };
			};
			setNotice(payload.message ?? (res.ok ? 'Action finished.' : 'Action failed.'), !!payload.ok);

			if (payload.deletionSummary && payload.ok) {
				const deletedByCollection = payload.deletionSummary.deletedByCollection ?? {};
				const warningCount = payload.deletionSummary.warnings?.length ?? 0;
				const compactSummary = Object.entries(deletedByCollection)
					.filter(([, value]) => Number(value) > 0)
					.map(([name, value]) => `${name}: ${value}`)
					.join(', ');
				if (compactSummary) {
					setNotice(
						`${payload.message ?? 'Action finished.'} Deleted: ${compactSummary}${warningCount > 0 ? ` (warnings: ${warningCount})` : ''}`,
						warningCount === 0
					);
				}
			}

			if (action === 'resetAllSimulationData') {
				const nextQuestionId = String(payload.questionId ?? '').trim();
				selectedQuestionId = nextQuestionId;
				selectedRunId = '';
				currentRun = null;
				await loadData(nextQuestionId || undefined);
				return;
			}

			const nextRunId = String(payload.runId ?? selectedRunId).trim();
			selectedRunId = nextRunId;
			if ('selectedQuestionSummary' in payload) {
				selectedSummary = payload.selectedQuestionSummary ?? null;
			}
			if ('activePhaseKey' in payload) {
				activePhaseKey = String(payload.activePhaseKey ?? '').trim();
			}
			await loadData(selectedQuestionId || undefined);
		} catch {
			setNotice('Action failed due to network/server error.', false);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		scheduleStart = toLocalDateTimeValue();
		await loadData(preferredQuestionId || undefined);
	});

	$effect(() => {
		if (!open) {
			return;
		}
		void loadData(preferredQuestionId || undefined);
	});

	const hasQuestion = $derived(Boolean(selectedQuestionId));
	const hasRun = $derived(Boolean(selectedRunId));
	const activePhaseLabel = $derived.by(() => {
		if (activePhaseKey === 'Proposed') return 'Proposed';
		if (activePhaseKey === 'AnswerSearch') return 'Active Workspace';
		if (activePhaseKey === 'Closing') return 'Closing Window';
		if (activePhaseKey === 'Voting') return 'Final Vote';
		return activePhaseKey || selectedSummary?.status || 'Unknown';
	});
	const hasRunUsers = $derived(
		selectedRunUsers.length > 0 || (currentRun?.userCount ?? selectedRunUserCount) > 0
	);

	$effect(() => {
		if (open && !hasRunUsers) {
			agentPoolCollapsed = false;
		}
	});

	async function runIdeationAction(
		action: string,
		count: string,
		extra: Record<string, unknown> = {}
	) {
		await runAction(action, {
			...buildSharedTimingParams(),
			count,
			...extra
		});
	}

	async function runBatchActions() {
		const batchActions: string[] = [];
		if (batchInitial) batchActions.push('initialProposals');
		if (batchRemix) batchActions.push('remixProposals');
		if (batchVotes) batchActions.push('voteProgress');
		if (batchMerges) batchActions.push('proposeMerges');

		if (batchActions.length === 0) {
			setNotice('Select at least one batch action.', false);
			return;
		}

		await runAction('runIdeationBatch', {
			...buildSharedTimingParams(),
			batchActions,
			remixMode,
			initialCount,
			remixCount,
			votesCount,
			mergesCount,
			proceedCount
		});
	}
</script>

<div class="dev-sim-modal" class:open>
	<div class="dev-sim-head">
		<strong>Debug Simulator</strong>
		<div class="dev-sim-head-actions">
			<button
				type="button"
				class="btn btn-secondary"
				onclick={() => loadData(selectedQuestionId || preferredQuestionId || undefined)}
				disabled={loading}>Refresh</button
			>
			<button type="button" class="dev-sim-close" onclick={onClose}>Close</button>
		</div>
	</div>
	<div class="dev-sim-content">
		{#if message}
			<p class="dev-sim-notice" class:ok={messageOk} class:error={!messageOk}>{message}</p>
		{/if}

		<div class="dev-sim-summary card stack">
			<h3>Context</h3>
			<p>Question: <strong>{resolveQuestionLabel()}</strong></p>
			<p>ID: {selectedQuestionId || 'none'}</p>
			<p>Run: <strong>{selectedRunId || 'none'}</strong></p>
			{#if activePhaseKey || selectedSummary?.status}
				<p>Phase: <strong>{activePhaseLabel}</strong></p>
			{/if}
		</div>

		<section class="section-card stack dev-sim-step">
			<h3>Question</h3>
			{#if questions.length > 0}
				<div class="dev-sim-run-picker">
					<label for="sim-question">Selected question</label>
					<select
						id="sim-question"
						bind:value={selectedQuestionId}
						onchange={(event) => {
							const target = event.currentTarget as HTMLSelectElement;
							const questionId = String(target.value ?? '').trim();
							selectedQuestionId = questionId;
							selectedRunId = '';
							void loadData(questionId || undefined);
						}}
					>
						{#each questions as question (question.id)}
							<option value={question.id}>{question.title} ({question.current_phase_name})</option>
						{/each}
					</select>
				</div>
			{:else}
				<p class="muted">No questions found.</p>
			{/if}
			<div class="dev-sim-inline-actions">
				<button
					type="button"
					class="btn btn-secondary"
					disabled={loading}
					onclick={() => {
						const confirmed =
							typeof window !== 'undefined' &&
							window.confirm(
								'Reset all simulation runs and all questions, then create one new Ideation question? This is destructive.'
							);
						if (!confirmed) {
							return;
						}
						void runAction('resetAllSimulationData', {
							confirmText: 'DELETE_ALL_SIMULATION_DATA'
						});
					}}
				>
					Reset all simulation data + questions
				</button>
			</div>
		</section>

		{#if selectedSummary}
			<div class="dev-sim-summary card stack">
				<h3>Question Snapshot</h3>
				<p>Status: <strong>{selectedSummary.status}</strong></p>
				<p>Current phase: <strong>{activePhaseLabel}</strong></p>
				<p>Proposed: {selectedSummary.proposedProposals}</p>
				<p>Archived: {selectedSummary.archivedProposals}</p>
				<p>Readiness: {selectedSummary.readySignalCount}</p>
			</div>
		{/if}

		{#if currentRun}
			<div class="dev-sim-summary card stack">
				<h3>Simulation Run</h3>
				<p>Run: <strong>{currentRun.label || currentRun.id}</strong></p>
				<p>{currentRun.userCount} users, {currentRun.actionCount} actions</p>
			</div>
		{/if}

		{#if hasQuestion}
			<section class="section-card stack dev-sim-step">
				<div class="dev-sim-collapsible-head">
					<h3>1. Manage simulated agent pool ({simUserCount} total)</h3>
					<button
						type="button"
						class="btn btn-secondary"
						onclick={() => {
							agentPoolCollapsed = !agentPoolCollapsed;
						}}
					>
						{agentPoolCollapsed ? 'Expand' : 'Collapse'}
					</button>
				</div>
				{#if !agentPoolCollapsed}
					<div class="dev-sim-pool-controls">
						<input type="number" min="1" max="20" bind:value={createCount} />
						<button
							type="button"
							class="btn btn-primary"
							disabled={loading}
							onclick={() => runAction('createSimUsers', { count: createCount })}
						>
							+ Add batch
						</button>
					</div>
					{#if selectedRunUsers.length > 0}
						<div
							class="dev-sim-user-tags pill-list"
							role="list"
							aria-label="Selected run simulated users"
						>
							{#each selectedRunUsers as user (user.runUserId)}
								<div class="pill dev-sim-user-pill" role="listitem">
									<span>{user.name || user.username || user.id}</span>
									{#if user.simulation}
										<span class="dev-sim-badge">simulation</span>
									{/if}
									<button
										type="button"
										class="dev-sim-user-delete"
										aria-label={`Delete ${user.name || user.username || user.id}`}
										disabled={loading}
										onclick={() => runAction('deleteSimUser', { userId: user.id })}
									>
										x
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="muted">No simulated users in this run yet. Add a batch to continue.</p>
					{/if}
					<p class="muted">Selected run users: {selectedRunUsers.length || selectedRunUserCount}</p>
				{/if}
			</section>
		{:else}
			<p class="muted">Choose a question to start simulation.</p>
		{/if}

		<p class="muted">
			Current phase detected: <strong>{activePhaseLabel}</strong> (Internal Key:
			<code>{activePhaseKey}</code>)
		</p>

		{#if hasRunUsers}
			<section class="section-card stack dev-sim-step">
				<h3>2. Simulation tasks</h3>

				<div class="dev-sim-grid-2">
					<div class="dev-sim-run-picker">
						<label for="sim-start-date">Start date</label>
						<input id="sim-start-date" type="datetime-local" bind:value={scheduleStart} />
					</div>
					<div class="dev-sim-run-picker">
						<label for="sim-spread-days">Spread days</label>
						<input id="sim-spread-days" type="number" min="0" max="365" bind:value={spreadDays} />
					</div>
				</div>

				{#if activePhaseKey === 'Proposed'}
					<div class="dev-sim-subsection stack">
						<h4>2.1 Proposed phase actions</h4>
						<div class="dev-sim-action-grid">
							<div class="dev-sim-action-row">
								<div>
									<strong>Vote on question</strong>
									<p class="muted">
										Simulate users supporting the question to reach activation threshold.
									</p>
								</div>
								<input type="number" min="1" max="20" bind:value={votesCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('simulateQuestionActivationVotes', votesCount)}
								>
									Run
								</button>
							</div>
						</div>
					</div>
				{:else if activePhaseKey === 'AnswerSearch'}
					<div class="dev-sim-subsection stack">
						<h4>2.2 Active Workspace actions</h4>
						<div class="dev-sim-action-grid">
							<div class="dev-sim-action-row">
								<div>
									<strong>Add initial proposals</strong>
									<p class="muted">Creates root proposals (LLM-generated content).</p>
								</div>
								<input type="number" min="1" max="20" bind:value={initialCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('initialProposals', initialCount)}
								>
									Run
								</button>
							</div>

							<div class="dev-sim-action-row">
								<div>
									<strong>Add remix proposals</strong>
									<p class="muted">Branch/merge existing proposed proposals.</p>
								</div>
								<div class="dev-sim-inline-pair">
									<input type="number" min="1" max="20" bind:value={remixCount} />
									<select bind:value={remixMode}>
										<option value="merge">Merge</option>
										<option value="branch">Branch</option>
									</select>
								</div>
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('remixProposals', remixCount, { remixMode })}
								>
									Run
								</button>
							</div>

							<div class="dev-sim-action-row">
								<div>
									<strong>Vote on proposals</strong>
									<p class="muted">Apply positive/negative votes across proposed proposals.</p>
								</div>
								<input type="number" min="1" max="200" bind:value={votesCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('voteProgress', votesCount)}
								>
									Run
								</button>
							</div>

							<div class="dev-sim-action-row">
								<div>
									<strong>Propose merges</strong>
									<p class="muted">
										Creates merge proposals (LLM-generated) between proposal trees.
									</p>
								</div>
								<input type="number" min="1" max="50" bind:value={mergesCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('proposeMerges', mergesCount)}
								>
									Run
								</button>
							</div>
						</div>

						<div class="section-card stack">
							<h4>Batch run</h4>
							<div class="dev-sim-checkbox-row">
								<label><input type="checkbox" bind:checked={batchInitial} /> Initial</label>
								<label><input type="checkbox" bind:checked={batchRemix} /> Remix</label>
								<label><input type="checkbox" bind:checked={batchVotes} /> Votes</label>
								<label><input type="checkbox" bind:checked={batchMerges} /> Merges</label>
								<label><input type="checkbox" bind:checked={batchProceed} /> Finalize Signals</label
								>
							</div>
							<button
								type="button"
								class="btn btn-secondary"
								disabled={loading}
								onclick={runBatchActions}
							>
								Run selected batch actions
							</button>
						</div>
					</div>
				{:else if activePhaseKey === 'Voting'}
					<div class="dev-sim-subsection stack">
						<h4>2.3 Final Vote actions</h4>
						<div class="dev-sim-action-grid">
							<div class="dev-sim-action-row">
								<div>
									<strong>Simulate final votes</strong>
									<p class="muted">Simulate agents submitting final ranked ballots.</p>
								</div>
								<input type="number" min="1" max="50" bind:value={ballotsCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('selectionRankBallots', ballotsCount)}
								>
									Run
								</button>
							</div>

							<div class="dev-sim-action-row">
								<div>
									<strong>Simulate abstentions</strong>
									<p class="muted">Simulate agents explicitly abstaining.</p>
								</div>
								<input type="number" min="1" max="50" bind:value={ballotsCount} />
								<button
									type="button"
									class="btn btn-primary"
									disabled={loading}
									onclick={() => runIdeationAction('selectionAbstainBallots', ballotsCount)}
								>
									Run
								</button>
							</div>
						</div>
					</div>
				{:else}
					<div class="dev-sim-subsection stack">
						<p class="muted">
							Simulation actions are only supported during the <strong>Proposed</strong>,
							<strong>Active Workspace</strong>, and <strong>Final Vote</strong>
							phases. Current phase key: <code>{activePhaseKey}</code>
						</p>
					</div>
				{/if}

				{#if activePhaseKey === 'AnswerSearch' || activePhaseKey === 'Closing' || activePhaseKey === 'Voting'}
					<div
						class="dev-sim-subsection stack"
						style="margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 1rem;"
					>
						<div class="dev-sim-action-row">
							<div>
								<strong>Fast-forward Phase</strong>
								<p class="muted">
									Force transition to the next phase by setting the deadline to the past.
								</p>
							</div>
							<button
								type="button"
								class="btn btn-secondary"
								disabled={loading}
								onclick={() => runIdeationAction('fastForwardPhase', '1')}
							>
								Run Fast-forward
							</button>
						</div>
					</div>
				{/if}
			</section>
		{:else if hasRun}
			<p class="muted">
				Add users to this run. Simulation behavior actions are intentionally deferred.
			</p>
		{/if}

		{#if !canStartOnRoute}
			<p class="muted">Open a specific question page to start a new run.</p>
		{/if}

		{#if !simulationCollectionsReady && simulationCollectionsMessage}
			<p class="muted">{simulationCollectionsMessage}</p>
		{/if}

		<p class="muted">Total simulation users: {simUserCount}</p>
	</div>
</div>

<style>
	.dev-sim-content {
		padding: 0.65rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		overflow-y: auto;
		overflow-x: hidden;
		min-height: 0;
	}
	.dev-sim-content > * {
		min-width: 0;
		flex-shrink: 0;
	}
	.dev-sim-content select,
	.dev-sim-content input:not([type='checkbox']) {
		width: 100%;
	}
	.dev-sim-content input:not([type='checkbox']),
	.dev-sim-content button {
		font: inherit;
		padding: 0.45rem;
		border: 1px solid var(--line);
		border-radius: 0;
	}
	.dev-sim-content input[type='checkbox'] {
		appearance: auto;
		-webkit-appearance: checkbox;
		display: inline-block;
		inline-size: 1rem;
		block-size: 1rem;
		flex: 0 0 auto;
		width: auto;
		padding: 0;
		margin: 0;
	}
	.dev-sim-content button {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
		cursor: pointer;
	}
	.dev-sim-content button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.dev-sim-step h3 {
		margin: 0;
	}
	.dev-sim-grid-2 {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	.dev-sim-action-grid {
		display: grid;
		gap: 0.65rem;
	}
	.dev-sim-action-row {
		display: grid;
		gap: 0.4rem;
		padding: 0.55rem;
		border: 1px solid var(--line);
	}
	.dev-sim-action-row p {
		margin: 0.2rem 0 0;
	}
	.dev-sim-inline-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}
	.dev-sim-checkbox-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}
	.dev-sim-checkbox-row label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.82rem;
	}
	.dev-sim-pool-controls {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
		align-items: center;
		justify-content: stretch;
	}
	.dev-sim-collapsible-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.dev-sim-collapsible-head h3 {
		margin: 0;
	}
	.dev-sim-user-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.dev-sim-user-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding-right: 0.2rem;
		max-width: 100%;
	}
	.dev-sim-user-pill > span:first-child {
		overflow-wrap: anywhere;
	}
	.dev-sim-badge {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border: 1px solid var(--line);
		padding: 0.05rem 0.3rem;
		color: var(--muted);
		background: var(--bg);
	}
	.dev-sim-user-delete {
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1;
		padding: 0 0.25rem;
	}
	.dev-sim-user-delete:hover:not(:disabled) {
		color: var(--ink);
	}
	.dev-sim-inline-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: stretch;
	}
	.dev-sim-inline-actions .btn {
		width: 100%;
	}
	.dev-sim-run-picker {
		display: grid;
		gap: 0.25rem;
	}
	.dev-sim-run-picker label {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.dev-sim-summary {
		display: grid;
		gap: 0.3rem;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: 0;
	}
	.dev-sim-summary p {
		margin: 0;
		font-size: 0.82rem;
	}
	.dev-sim-notice {
		margin: 0;
		padding: 0.45rem;
		border-radius: 0;
		font-size: 0.82rem;
	}
	.dev-sim-notice.ok {
		background: #ebfff0;
		border: 1px solid #8fda9f;
	}
	.dev-sim-notice.error {
		background: #fff2f2;
		border: 1px solid #ef9a9a;
	}

	@media (min-width: 780px) {
		.dev-sim-grid-2 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.dev-sim-action-row {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
			align-items: center;
		}
	}
</style>
