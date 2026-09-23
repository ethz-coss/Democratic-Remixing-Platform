<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';

	interface Props {
		currentPage: number;
		totalPages: number;
		onPageChange: (page: number) => void;
	}

	let { currentPage, totalPages, onPageChange }: Props = $props();

	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages && page !== currentPage) {
			onPageChange(page);
		}
	}
</script>

{#if totalPages > 1}
	<div class="pagination-bar">
		<button
			type="button"
			class="pagination-btn"
			disabled={currentPage === 1}
			onclick={() => goToPage(1)}
			aria-label="First page"
		>
			«
		</button>
		<button
			type="button"
			class="pagination-btn"
			disabled={currentPage === 1}
			onclick={() => goToPage(currentPage - 1)}
			aria-label="Previous page"
		>
			‹
		</button>

		<span class="pagination-info">
			{currentPage} / {totalPages}
		</span>

		<button
			type="button"
			class="pagination-btn"
			disabled={currentPage === totalPages}
			onclick={() => goToPage(currentPage + 1)}
			aria-label="Next page"
		>
			›
		</button>
		<button
			type="button"
			class="pagination-btn"
			disabled={currentPage === totalPages}
			onclick={() => goToPage(totalPages)}
			aria-label="Last page"
		>
			»
		</button>
	</div>
{/if}

<style>
	.pagination-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
		padding: 1rem 0;
	}

	.pagination-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: 1px solid var(--line, #e5e7eb);
		border-radius: 6px;
		background: var(--paper, #fff);
		color: var(--ink, #111);
		font-size: 1.2rem;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}

	.pagination-btn:hover:not(:disabled) {
		border-color: var(--primary, #4f7df9);
		color: var(--primary, #4f7df9);
		background: var(--color-bg-tertiary, #f3f4f6);
	}

	.pagination-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.pagination-info {
		font-size: 0.9rem;
		color: var(--muted, #666);
		margin: 0 0.5rem;
		font-weight: 500;
	}
</style>
