<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';

	let { data }: { data: PageData } = $props();
	let phaseFilter = $state('AnswerSearch');
</script>

<svelte:head>
	<title>{m.admin_page_title()}</title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8">
	<div class="mb-8">
		<h1 class="text-3xl font-bold">{m.admin_title()}</h1>
		<p class="text-base-content/60 mt-1 text-sm">{m.admin_subtitle()}</p>
	</div>

	<!-- Dashboard Grid -->
	<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
		<!-- Groups Section -->
		<section>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-2xl font-bold">Groups</h2>
				<Button variant="secondary" size="sm" href={localizePath('/admin/groups')}>
					Manage Groups
				</Button>
			</div>

			{#if data.groups.length === 0}
				<div class="bg-base-200 rounded-box py-8 text-center">
					<p class="text-base-content/70">{m.admin_no_groups_subtitle()}</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each data.groups as group (group.id)}
						<div class="card bg-base-100 border-base-200 border shadow-sm">
							<div class="card-body p-4">
								<h3 class="card-title mb-1 text-base">
									<a href={localizePath(`/groups/${group.id}`)} class="hover:underline">
										{group.name}
									</a>
								</h3>
								<div class="flex flex-wrap items-center gap-2 text-xs">
									<Badge
										label={m.admin_members_count({ count: group.memberCount })}
										theme="muted"
										shape="pill"
									/>
									<span class="text-base-content/50">Author: {group.authorName}</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-2xl font-bold">Questions</h2>
				<Button variant="secondary" size="sm" href={localizePath('/questions/new')}>
					Create Question
				</Button>
			</div>

			<div class="mb-4 flex items-center gap-4">
				<label for="phase-filter" class="label"
					><span class="label-text font-semibold">Filter:</span></label
				>
				<select
					id="phase-filter"
					class="select select-bordered select-sm w-full max-w-xs"
					bind:value={phaseFilter}
				>
					<option value="All">All Phases</option>
					<option value="Proposed">Proposed</option>
					<option value="AnswerSearch">AnswerSearch</option>
					<option value="Closing">Closing</option>
					<option value="Voting">Voting</option>
				</select>
			</div>

			{#if data.questions.filter((p) => phaseFilter === 'All' || p.current_phase_name === phaseFilter).length === 0}
				<div class="bg-base-200 rounded-box py-8 text-center">
					<p class="text-base-content/70">No questions match the filter.</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each data.questions.filter((p) => phaseFilter === 'All' || p.current_phase_name === phaseFilter) as question (question.id)}
						<div class="card bg-base-100 border-base-200 border shadow-sm">
							<div class="card-body p-4">
								<div
									class="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
								>
									<div>
										<h3 class="card-title mb-1 text-base">
											<a
												href={localizePath(`/admin/questions/${question.id}`)}
												class="line-clamp-1 hover:underline"
											>
												{question.title}
											</a>
										</h3>
										<div class="flex flex-wrap items-center gap-2 text-xs">
											{#if question.groupName}
												<Badge label={question.groupName} theme="primary" shape="pill" />
											{/if}
											<span class="text-base-content/50">Author: {question.authorName}</span>
										</div>
									</div>
									<Button
										variant="primary"
										size="sm"
										href={localizePath(`/admin/questions/${question.id}`)}
										class="shrink-0"
									>
										{m.admin_manage()}
									</Button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>
