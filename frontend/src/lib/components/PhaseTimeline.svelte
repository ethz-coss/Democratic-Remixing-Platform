<script lang="ts">
	import { untrack } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import * as T from '$lib/utils/terminology';
	import PhaseTimerProgress from './PhaseTimerProgress.svelte';

	interface Props {
		currentPhase: string;
		interactive?: boolean;
		detailed?: boolean;
		question?: App.QuestionRecord;
		variant?: 'default' | 'dashboard';
		selectedPhase?: string | null;
		onSelectPhase?: (phase: string) => void;
		phaseDates?: Record<string, { started?: string; deadline?: string }>;
		currentPhaseProgress?: number; // 0 to 100
		now?: number;
	}

	let {
		currentPhase = 'AnswerSearch',
		interactive = true,
		detailed = false,
		question,
		variant = 'default',
		selectedPhase = $bindable(null),
		onSelectPhase,
		phaseDates = {},
		currentPhaseProgress = 0,
		now = Date.now()
	}: Props = $props();

	const PHASE_COLORS: Record<string, string> = {
		AnswerSearch: 'var(--primary, #4f7df9)',
		Closing: '#eab308',
		Voting: '#0ea5e9',
		Decided: '#22c55e',
		Proposed: 'var(--muted, #999)'
	};

	const readyThreshold = 50;
	const closingHours = $derived(
		question?.closing_window_deadline
			? Math.max(
					0,
					Math.round(
						(new Date(question.closing_window_deadline.replace(' ', 'T')).getTime() - Date.now()) /
							(1000 * 60 * 60)
					)
				)
			: 24
	);
	const votingHours = $derived(
		question?.vote_deadline
			? Math.max(
					0,
					Math.round(
						(new Date(question.vote_deadline.replace(' ', 'T')).getTime() - Date.now()) /
							(1000 * 60 * 60)
					)
				)
			: question?.discussion_deadline
				? Math.max(
						0,
						Math.round(
							(new Date(question.discussion_deadline.replace(' ', 'T')).getTime() - Date.now()) /
								(1000 * 60 * 60)
						)
					)
				: 72
	);

	// We skip "Proposed" as requested in the plan
	const phases = $derived([
		{
			id: 'AnswerSearch',
			key: 'answer_search',
			desc: () => m.how_it_works_process_discussion({ readyThreshold }),
			detailedDesc: () => m.how_it_works_process_discussion_detailed({ readyThreshold })
		},
		{
			id: 'Closing',
			key: 'closing',
			desc: () => m.how_it_works_process_closing({ closingHours }),
			detailedDesc: () => m.how_it_works_process_closing_detailed({ closingHours })
		},
		{
			id: 'Voting',
			key: 'voting',
			desc: () => m.how_it_works_process_voting({ votingHours }),
			detailedDesc: () => m.how_it_works_process_voting_detailed({ votingHours })
		},
		{
			id: 'Decided',
			key: 'decided',
			desc: () => m.how_it_works_process_decided(),
			detailedDesc: () => m.how_it_works_process_decided_detailed()
		}
	]);

	const currentIndex = $derived(
		phases.findIndex((p) => p.id === currentPhase) >= 0
			? phases.findIndex((p) => p.id === currentPhase)
			: 0
	);

	// Initialize selectedPhase
	$effect(() => {
		if (interactive && selectedPhase === null) {
			untrack(() => {
				selectedPhase = currentPhase;
			});
		}
	});

	function togglePhase(id: string) {
		if (!interactive) return;
		if (variant === 'dashboard') {
			selectedPhase = id;
			onSelectPhase?.(id);
			return;
		}

		if (detailed) {
			selectedPhase = id;
		} else {
			if (selectedPhase === id) {
				selectedPhase = null;
			} else {
				selectedPhase = id;
			}
		}
	}
</script>

<div class="phase-timeline-container {variant}" class:interactive>
	<div class="timeline-steps">
		{#each phases as phase, i}
			{@const status = i < currentIndex ? 'completed' : i === currentIndex ? 'current' : 'future'}
			{@const PhaseIcon = T.PHASE_ICON[phase.id] || T.PHASE_ICON['Proposed']}
			{@const iconColor = PHASE_COLORS[phase.id] || PHASE_COLORS.Proposed}
			{@const nextPhaseColor = phases[i + 1]
				? PHASE_COLORS[phases[i + 1].id] || PHASE_COLORS.Proposed
				: iconColor}
			{@const isFilled = status === 'completed' || status === 'current'}
			{@const isSelected = selectedPhase === phase.id}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="step-wrapper"
				class:is-active-dashboard={status === 'current' &&
					variant === 'dashboard' &&
					i < phases.length - 1}
				onclick={() => togglePhase(phase.id)}
			>
				<div class="step {status}" class:selected={isSelected}>
					<div
						class="step-icon"
						style="{isFilled
							? `background-color: ${iconColor}; border-color: ${iconColor}; color: var(--paper, #fff);`
							: ''} {isSelected
							? `box-shadow: 0 0 0 3px color-mix(in srgb, ${iconColor} 20%, transparent);`
							: ''}"
					>
						<PhaseIcon size={14} strokeWidth={2.5} />
					</div>
					<span class="step-label">{T.PHASE_LABEL(phase.id)}</span>

					{#if variant === 'dashboard'}
						<div class="step-annotation">
							{#if phaseDates[phase.id]?.started}
								<span class="text-muted">{phaseDates[phase.id].started}</span>
							{/if}
						</div>
					{/if}
				</div>
				{#if i < phases.length - 1}
					{#if status === 'current' && variant === 'dashboard'}
						<div class="active-step-timer">
							<PhaseTimerProgress
								phase={phase.id as 'AnswerSearch' | 'Closing' | 'Voting'}
								startsAt={phase.id === 'AnswerSearch'
									? question?.created
									: phase.id === 'Closing'
										? question?.discussion_deadline
										: phase.id === 'Voting'
											? question?.closing_window_deadline
											: undefined}
								endsAt={phase.id === 'AnswerSearch'
									? question?.discussion_deadline
									: phase.id === 'Closing'
										? question?.closing_window_deadline
										: phase.id === 'Voting'
											? question?.vote_deadline
											: undefined}
								{now}
								variant="compact"
							/>
						</div>
					{:else}
						{@const isConnectorCompleted = status === 'completed'}
						{@const isConnectorCurrent = status === 'current' && variant !== 'dashboard'}
						<div
							class="step-connector {isConnectorCompleted ? 'completed' : ''}"
							style="{isConnectorCompleted
								? `background: linear-gradient(to right, ${iconColor}, ${nextPhaseColor});`
								: ''} {isConnectorCurrent
								? `background: linear-gradient(to right, ${iconColor} ${currentPhaseProgress}%, var(--line, #ddd) ${currentPhaseProgress}%);`
								: ''}"
						></div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>

	{#if interactive && selectedPhase && variant !== 'dashboard'}
		{@const activePhaseObj = phases.find((p) => p.id === selectedPhase)}
		{@const activeColor = PHASE_COLORS[selectedPhase] || PHASE_COLORS.Proposed}
		{#if detailed}
			<div
				class="phase-description detailed card bg-base-100 mt-6 p-5"
				role="region"
				aria-live="polite"
				style="border-left-color: {activeColor};"
			>
				<h4 class="mb-2 text-lg font-bold" style="color: {activeColor};">
					{T.PHASE_LABEL(activePhaseObj?.id || '')}
				</h4>
				<p class="text-base-content/80 text-sm leading-relaxed">
					{activePhaseObj?.detailedDesc()}
				</p>
			</div>
		{:else}
			<div
				class="phase-description"
				role="region"
				aria-live="polite"
				style="border-left-color: {activeColor};"
			>
				{activePhaseObj?.desc()}
			</div>
		{/if}
	{/if}
</div>

<style>
	.phase-timeline-container {
		display: flex;
		flex-direction: column;
		width: 100%;
		font-family: inherit;
		margin-bottom: 1rem;
	}

	.phase-timeline-container.dashboard {
		margin-bottom: 2rem;
		padding: 1.5rem 1rem 0.5rem;
		background: var(--paper, #fff);
		border-radius: 12px;
		border: 1px solid var(--line, #ddd);
	}

	.timeline-steps {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		width: 100%;
		position: relative;
	}

	.step-wrapper {
		display: flex;
		align-items: flex-start;
		flex: 1;
	}

	.step-wrapper:last-child {
		flex: 0;
	}

	.step-wrapper.is-active-dashboard {
		flex: 4;
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		position: relative;
		z-index: 2;
		transition: transform 0.15s;
		min-width: 60px;
	}

	.interactive .step {
		cursor: pointer;
	}

	.interactive .step:hover .step-label {
		color: var(--ink, #111);
	}

	.step-icon {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--paper, #fff);
		border: 2px solid var(--line, #ddd);
		color: var(--muted, #999);
		transition: all 0.2s;
	}

	.step-label {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--muted, #666);
		text-align: center;
		white-space: nowrap;
		transition: color 0.2s;
	}

	.step.current .step-label {
		color: var(--ink, #111);
		font-weight: 700;
	}

	.step.completed .step-label {
		color: var(--ink, #111);
	}

	.dashboard .step.selected .step-label {
		color: var(--ink, #111);
		font-weight: 700;
	}

	.step-annotation {
		font-size: 0.65rem;
		text-align: center;
		margin-top: 0.1rem;
		white-space: nowrap;
	}

	.text-muted {
		color: var(--muted, #999);
	}

	.text-primary {
		color: var(--primary, #4f7df9);
	}

	.font-medium {
		font-weight: 500;
	}

	.step-connector {
		flex: 1;
		min-width: 20px;
		height: 2px;
		background: var(--line, #ddd);
		margin: 0 8px;
		margin-top: 11px; /* 24px icon height / 2 - 1px connector half-height */
		transition: background 0.2s;
	}

	.dashboard .step-connector {
		margin-top: 11px; /* Uniform across variants now */
	}

	.phase-description {
		margin-top: 0.75rem;
		padding: 0.6rem 0.8rem;
		background: color-mix(in srgb, var(--ink, #111) 3%, var(--paper, #fff));
		border-radius: 6px;
		font-size: 0.8rem;
		color: var(--ink, #111);
		line-height: 1.4;
		border-left: 3px solid var(--line, #ddd);
		animation: fade-in 0.2s ease-out;
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.active-step-timer {
		flex: 1;
		padding: 0 12px;
		margin-top: 9px; /* Align 6px track center with 12px icon center */
		min-width: 80px;
	}

	@media (max-width: 640px) {
		.phase-timeline-container.dashboard {
			padding: 1rem 0.5rem 0.5rem;
		}
		.step {
			min-width: 32px;
		}
		.step-label {
			display: none;
		}
		.step-annotation {
			display: none;
		}
		.step-connector {
			margin: 0 4px;
		}
		.dashboard .step-connector {
			margin-top: 11px;
		}
		.active-step-timer {
			padding: 0 4px;
			min-width: 60px;
			margin-top: 9px;
		}
	}
</style>
