<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		error?: string;
		required?: boolean;
		helpText?: string;
		class?: string;
		style?: string;
		children: Snippet;
	}

	let {
		label,
		error,
		required = false,
		helpText,
		class: className = '',
		style = '',
		children
	}: Props = $props();
</script>

<label class="form-field stack {className}" style={style ? style : 'gap:0.3rem;'}>
	<span class="field-label-text">
		{label}
		{#if required}
			<span class="required-asterisk" aria-hidden="true">*</span>
		{/if}
	</span>

	{@render children()}

	{#if error}
		<span class="field-error">{error}</span>
	{:else if helpText}
		<span class="field-help">{helpText}</span>
	{/if}
</label>

<style>
	.form-field {
		/* Inherits .stack from global layout.css but we override gap inline */
		display: flex;
		flex-direction: column;
	}
	.field-label-text {
		font-weight: 500;
		font-size: 0.95rem;
		color: var(--ink);
		display: inline-flex;
		align-items: center;
	}
	.required-asterisk {
		color: var(--destructive, #dc2626);
		margin-left: 0.15rem;
	}
	.field-error {
		color: var(--destructive, #dc2626);
		font-size: 0.85rem;
		display: block;
	}
	.field-help {
		color: var(--muted, #666);
		font-size: 0.85rem;
		display: block;
	}
</style>
