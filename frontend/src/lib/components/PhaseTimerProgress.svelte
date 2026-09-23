<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import SupportTrack from '$lib/components/ui/SupportTrack.svelte';
	import { getRemainingPercentage, formatTimeRemaining } from '$lib/utils/time';

	interface Props {
		phase: 'AnswerSearch' | 'Closing' | 'Voting';
		startsAt: string | undefined;
		endsAt: string | undefined;
		now: number;
		variant?: 'full' | 'compact';
	}

	let { phase, startsAt, endsAt, now, variant = 'full' }: Props = $props();

	const remainingPct = $derived(getRemainingPercentage(startsAt, endsAt, now));
	const timeString = $derived(formatTimeRemaining(endsAt, now));

	const isClosing = $derived(phase === 'Closing');
	const isDiscussion = $derived(phase === 'AnswerSearch');
	const colorTheme = $derived(isClosing ? 'warning' : isDiscussion ? 'brand' : 'info');
</script>

{#if variant === 'full'}
	<section class="readiness-banner {colorTheme}">
		<div class="readiness-banner-content">
			<div class="readiness-header">
				<span class="readiness-label">
					{#if phase === 'Closing'}
						{m.timer_closing_frozen()}
					{:else if phase === 'AnswerSearch'}
						{m.timer_discussion_active()}
					{:else}
						{m.timer_voting_open()}
					{/if}
				</span>
				<span class="readiness-pct">{timeString}</span>
			</div>
			<SupportTrack value={remainingPct} theme={colorTheme} size="lg" />
			<p class="readiness-desc">
				{#if phase === 'Closing'}
					{m.timer_closing_desc()}
				{:else if phase === 'AnswerSearch'}
					{m.timer_discussion_desc()}
				{:else}
					{m.timer_voting_desc()}
				{/if}
			</p>
		</div>
	</section>
{:else}
	<div class="compact-timer {colorTheme}">
		<SupportTrack value={remainingPct} theme={colorTheme} size="sm" />
		<div class="compact-header" style="justify-content: center; margin-top: 4px;">
			<div class="compact-badge">
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10"></circle>
					<polyline points="12 6 12 12 16 14"></polyline>
				</svg>
				{timeString}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Full Banner */
	.readiness-banner {
		padding: 1rem;
		border: 1px solid var(--line, #ddd);
		border-left-width: 4px;
		border-radius: 8px;
		margin-bottom: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.readiness-banner.warning {
		border-left-color: #eab308;
		background: color-mix(in srgb, #eab308 8%, var(--paper, #fff));
	}
	.readiness-banner.brand {
		border-left-color: var(--primary, #4f7df9);
		background: color-mix(in srgb, var(--primary, #4f7df9) 8%, var(--paper, #fff));
	}
	.readiness-banner.info {
		border-left-color: #0ea5e9;
		background: color-mix(in srgb, #0ea5e9 8%, var(--paper, #fff));
	}

	.readiness-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.readiness-label {
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.warning .readiness-label,
	.warning .readiness-pct {
		color: #ca8a04;
	}
	.brand .readiness-label,
	.brand .readiness-pct {
		color: #3b5bdb;
	}
	.info .readiness-label,
	.info .readiness-pct {
		color: #0284c7;
	}

	.readiness-pct {
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.readiness-pct {
		font-size: 0.85rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.readiness-desc {
		font-size: 0.82rem;
		margin: 0;
		line-height: 1.4;
	}
	.warning .readiness-desc {
		color: #854d0e;
	}
	.brand .readiness-desc {
		color: #2c42a5;
	}
	.info .readiness-desc {
		color: #075985;
	}

	/* Compact Component */
	.compact-timer {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
	}

	.compact-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.compact-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.4rem;
		border-radius: 9999px;
		font-size: 0.7rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.warning .compact-badge {
		background: #fef9c3;
		color: #a16207;
	}
	.brand .compact-badge {
		background: #eef2ff;
		color: #3b5bdb;
	}
	.info .compact-badge {
		background: #e0f2fe;
		color: #0369a1;
	}
</style>
