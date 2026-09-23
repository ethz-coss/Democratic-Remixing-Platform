<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import { stripRichText } from '$lib/markdown';
	import Button from '$lib/components/ui/Button.svelte';
	import { Users, ClipboardList } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{m.groups_page_title()}</title>
</svelte:head>

<section class="stack" style="gap:1.5rem; max-width: 900px; margin: 0 auto; padding: 2rem 1rem;">
	<header style="display: flex; justify-content: space-between; align-items: center;">
		<h1 class="title" style="margin: 0; font-size: 1.75rem;">{m.groups_title()}</h1>
	</header>

	{#if data.groups.length === 0}
		<article
			class="section-card stack"
			style="text-align: center; padding: 3rem 1rem; border-style: dashed;"
		>
			<h2 style="margin:0;">{m.groups_no_groups_title()}</h2>
			<p class="muted" style="margin:0;">{m.groups_no_groups_subtitle()}</p>
		</article>
	{:else}
		<div
			class="grid"
			style="display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));"
		>
			{#each data.groups as group (group.id)}
				{@const descriptionPreview = stripRichText(group.description || '')}
				{@const counts = data.groupCounts[group.id] || { members: 0, questions: 0 }}

				<article
					class="group-card stack"
					style="gap: 1rem; padding: 1.5rem; display: flex; flex-direction: column;"
				>
					<h2 style="font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--ink);">
						{group.name}
					</h2>

					{#if descriptionPreview}
						<p
							style="margin: 0; font-size: 0.9rem; color: color-mix(in srgb, var(--ink) 80%, transparent); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"
						>
							{descriptionPreview}
						</p>
					{:else}
						<p class="muted" style="margin: 0; font-size: 0.9rem; font-style: italic;">
							{m.groups_no_description()}
						</p>
					{/if}

					<div style="flex-grow: 1;"></div>

					<div
						style="display: flex; gap: 1rem; font-size: 0.85rem; color: var(--muted); padding-top: 0.5rem; border-top: 1px solid var(--line);"
					>
						<span style="display: flex; align-items: center; gap: 0.25rem;">
							<Users size={14} />
							{m.groups_members_count({ count: counts.members })}
						</span>
						<span style="display: flex; align-items: center; gap: 0.25rem;">
							<ClipboardList size={14} />
							{counts.questions}
						</span>
					</div>

					<Button
						variant="secondary"
						block
						href={localizePath(`/groups/${group.id}`)}
						style="margin-top: 0.5rem;"
					>
						{m.groups_view()}
					</Button>
				</article>
			{/each}
		</div>
	{/if}
</section>

<style>
	.group-card {
		background: var(--paper, #ffffff);
		border: 1px solid var(--line, #e2e8f0);
		border-radius: 12px;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.05),
			0 2px 4px -2px rgba(0, 0, 0, 0.025);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease,
			border-color 0.2s ease;
	}

	.group-card:hover {
		transform: translateY(-2px);
		box-shadow:
			0 10px 15px -3px rgba(0, 0, 0, 0.08),
			0 4px 6px -4px rgba(0, 0, 0, 0.04);
		border-color: color-mix(in srgb, var(--primary, #4f7df9) 40%, var(--line, #e2e8f0));
	}
</style>
