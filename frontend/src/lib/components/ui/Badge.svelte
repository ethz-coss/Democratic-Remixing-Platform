<script lang="ts">
	import type { Component } from 'svelte';

	/**
	 * ProposalBadge — shared small pill/badge for type labels, status, authorship.
	 * Replaces the 3 incompatible badge systems across the app.
	 */
	interface Props {
		/** Badge text */
		label: string;
		/** Optional Lucide icon component */
		icon?: Component;
		/**
		 * Color theme.
		 * 'primary' = blue, 'accent' = purple, 'success' = green,
		 * 'warning' = amber, 'muted' = gray, 'unseen' = blue (filled), 'custom'
		 */
		theme?: 'primary' | 'accent' | 'success' | 'warning' | 'muted' | 'unseen' | 'custom';
		/** Arbitrary CSS color for custom theme */
		color?: string;
		/** 'pill' = rounded, 'tag' = square-ish */
		shape?: 'pill' | 'tag';
		/** Animate with a pulse (for unseen-improvements indicator) */
		pulse?: boolean;
	}

	let {
		label,
		icon: Icon = undefined,
		theme = 'muted',
		color = undefined,
		shape = 'pill',
		pulse = false
	}: Props = $props();

	const t = $derived.by(() => {
		if (theme === 'custom') {
			return {
				bg: color ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
				fg: color ?? 'inherit',
				border: color ? `color-mix(in srgb, ${color} 28%, transparent)` : 'transparent'
			};
		}

		const vars: Record<string, { bg: string; fg: string; border: string }> = {
			primary: {
				bg: 'color-mix(in srgb, var(--primary, #4f7df9) 12%, transparent)',
				fg: 'var(--primary, #4f7df9)',
				border: 'color-mix(in srgb, var(--primary, #4f7df9) 28%, transparent)'
			},
			accent: {
				bg: 'color-mix(in srgb, var(--accent, #7c3aed) 12%, transparent)',
				fg: 'var(--accent, #7c3aed)',
				border: 'color-mix(in srgb, var(--accent, #7c3aed) 28%, transparent)'
			},
			success: {
				bg: 'color-mix(in srgb, var(--success, #16a34a) 12%, transparent)',
				fg: 'var(--success, #16a34a)',
				border: 'color-mix(in srgb, var(--success, #16a34a) 28%, transparent)'
			},
			warning: {
				bg: 'color-mix(in srgb, var(--warning, #f59e0b) 15%, transparent)',
				fg: '#b45309',
				border: 'color-mix(in srgb, var(--warning, #f59e0b) 32%, transparent)'
			},
			muted: {
				bg: 'var(--surface-tertiary, #f3f4f6)',
				fg: 'var(--muted, #5a5a5a)',
				border: 'var(--line, #d8d8d8)'
			},
			unseen: {
				bg: 'color-mix(in srgb, var(--unseen, #3b82f6) 12%, transparent)',
				fg: 'var(--unseen, #3b82f6)',
				border: 'color-mix(in srgb, var(--unseen, #3b82f6) 28%, transparent)'
			}
		};
		return vars[theme] ?? vars.muted;
	});
</script>

<span
	class="badge"
	class:pill={shape === 'pill'}
	class:tag={shape === 'tag'}
	class:pulse
	style="
		background: {t.bg};
		color: {t.fg};
		border-color: {t.border};
	"
>
	{#if Icon}<span class="badge-icon"><Icon size={12} strokeWidth={2.5} /></span>{/if}
	<span class="badge-label">{label}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid transparent;
		font-size: 0.7rem;
		font-weight: 700;
		white-space: nowrap;
		letter-spacing: 0.01em;
	}

	.badge.pill {
		padding: 2px 7px;
		border-radius: 1rem;
	}

	.badge.tag {
		padding: 2px 6px;
		border-radius: 4px;
	}

	.badge-icon {
		display: flex;
		align-items: center;
		color: currentColor;
	}

	.badge-label {
		display: inline-block;
	}

	@keyframes badgePulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 currentColor;
			opacity: 1;
		}
		50% {
			box-shadow: 0 0 0 3px transparent;
			opacity: 0.85;
		}
	}

	.badge.pulse {
		animation: badgePulse 2s ease-in-out infinite;
	}
</style>
