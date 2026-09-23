<script lang="ts">
	interface Props {
		value: number; // 0-100
		theme?: 'info' | 'warning' | 'success' | 'brand' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		threshold?: number; // 0-100, optional tick mark
	}

	let { value, theme = 'brand', size = 'md', threshold }: Props = $props();

	const trackHeight = $derived(size === 'sm' ? '4px' : size === 'md' ? '6px' : '8px');
	const safeValue = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="support-track" style="height: {trackHeight};">
	<div class="support-fill theme-{theme}" style="width: {safeValue}%;"></div>
	{#if threshold !== undefined}
		<div class="support-threshold" style="left: {threshold}%;" title="{threshold}% threshold"></div>
	{/if}
</div>

<style>
	.support-track {
		width: 100%;
		background: var(--line, #ddd);
		border-radius: 9999px;
		position: relative;
	}
	.support-fill {
		height: 100%;
		border-radius: 9999px;
		transition:
			width 0.4s ease,
			background-color 0.4s ease;
	}

	/* Fallback colours using tailwind palette if vars aren't defined */
	.support-fill.theme-info {
		background-color: var(--info, #0ea5e9);
	}
	.support-fill.theme-warning {
		background-color: var(--warning, #eab308); /* Yellow/Orange */
	}
	.support-fill.theme-success {
		background-color: var(--success, #22c55e);
	}
	.support-fill.theme-brand {
		background-color: var(--brand, #3b82f6);
	}
	.support-fill.theme-danger {
		background-color: var(--destructive, #dc2626);
	}

	.support-threshold {
		position: absolute;
		top: -1.5px;
		bottom: -1.5px;
		width: 2px;
		background-color: var(--ink, #111);
		border-radius: 1px;
		z-index: 2;
	}
</style>
