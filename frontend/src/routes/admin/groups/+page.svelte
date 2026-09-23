<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatSwissDate } from '$lib/utils/time';

	let { data }: { data: PageData } = $props();

	let showCreateForm = $state(false);
	let creating = $state(false);
	let copiedToken = $state<string | null>(null);

	function copyInviteLink(token: string) {
		const link = $page.url.origin + localizePath(`/invite/${token}`);
		navigator.clipboard.writeText(link);
		copiedToken = token;
		setTimeout(() => (copiedToken = null), 2000);
	}

	let confirmRegenerateId = $state<string | null>(null);
	let regeneratingId = $state<string | null>(null);
</script>

<svelte:head>
	<title>{m.admin_page_title()} - Groups</title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8">
	<div class="mb-4">
		<Button variant="ghost" size="sm" class="pl-0" href={localizePath('/admin')}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="mr-1"><path d="M19 12H5M12 19l-7-7 7-7" /></svg
			>
			Back to Admin
		</Button>
	</div>

	<div class="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h1 class="text-3xl font-bold">Manage Groups</h1>
			<p class="text-base-content/60 mt-1 text-sm">Create and manage groups in the application.</p>
		</div>
		<Button
			variant="primary"
			class="w-full sm:w-auto"
			onclick={() => (showCreateForm = !showCreateForm)}
		>
			{showCreateForm ? m.admin_cancel() : m.admin_create_group()}
		</Button>
	</div>

	{#if showCreateForm}
		<div class="card bg-base-100 border-base-200 mb-8 border shadow-md">
			<div class="card-body">
				<h2 class="card-title text-lg">{m.admin_create_group()}</h2>
				<form
					method="POST"
					action="?/createGroup"
					use:enhance={() => {
						creating = true;
						return async ({ update }) => {
							creating = false;
							await update();
						};
					}}
				>
					<FormField label={m.groups_name_label()} class="mb-4" required={true}>
						<input
							name="name"
							type="text"
							placeholder={m.groups_name_placeholder()}
							required
							minlength="3"
						/>
					</FormField>
					<FormField
						label={m.groups_description_label()}
						helpText={m.groups_description_optional()}
						class="mb-4"
					>
						<textarea name="description" placeholder={m.groups_description_placeholder()} rows="3"
						></textarea>
					</FormField>
					<Button type="submit" variant="primary" disabled={creating}>
						{creating ? m.admin_creating() : m.groups_create_button()}
					</Button>
				</form>
			</div>
		</div>
	{/if}

	{#if data.groups.length === 0}
		<div class="bg-base-200 rounded-box py-12 text-center">
			<h2 class="mb-2 text-xl font-semibold">{m.admin_no_groups()}</h2>
			<p class="text-base-content/70 mb-4">{m.admin_no_groups_subtitle()}</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.groups as group (group.id)}
				<div class="card bg-base-100 border-base-200 border shadow-md">
					<div class="card-body">
						<div class="flex flex-col items-start justify-between gap-4 sm:flex-row">
							<div class="w-full">
								<h2 class="card-title">
									<a href={localizePath(`/groups/${group.id}`)} class="break-words hover:underline">
										{group.name}
									</a>
								</h2>
								{#if group.description}
									<p class="text-base-content/70 mt-1 line-clamp-2 text-sm">
										{@html group.description}
									</p>
								{/if}
								<div class="mt-2 flex flex-wrap items-center gap-2 text-sm sm:gap-4">
									<Badge
										label={m.admin_members_count({ count: group.memberCount })}
										theme="muted"
										shape="pill"
									/>
									<span class="text-base-content/50 whitespace-nowrap">
										Author: {group.authorName}
									</span>
									<span class="text-base-content/50 whitespace-nowrap">
										{formatSwissDate(group.created)}
									</span>
								</div>
							</div>
							<div class="flex shrink-0">
								<Button href={localizePath(`/groups/${group.id}`)} variant="primary" size="sm">
									{m.admin_manage()}
								</Button>
							</div>
						</div>

						{#if group.questions && group.questions.length > 0}
							<div class="border-base-200 mt-4 border-t pt-4">
								<h3 class="mb-2 text-sm font-semibold">Questions</h3>
								<ul class="list-inside list-disc space-y-1 text-sm">
									{#each group.questions as question}
										<li>
											<a
												href={localizePath(`/admin/questions/${question.id}`)}
												class="text-primary hover:underline"
											>
												{question.title}
											</a>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						<div class="border-base-200 mt-4 border-t pt-4">
							<h3 class="mb-1 text-sm font-semibold">{m.groups_invite_link()}</h3>
							<p class="text-base-content/70 mb-3 text-xs">{m.groups_invite_share()}</p>
							<div class="flex flex-col gap-2 sm:flex-row">
								<input
									type="text"
									class="input input-sm input-bordered bg-base-200 w-full flex-1 font-mono text-xs"
									value={$page.url.origin + localizePath(`/invite/${group.invite_token}`)}
									readonly
								/>
								<div class="flex shrink-0 gap-2">
									{#if confirmRegenerateId === group.id}
										<form
											method="POST"
											action="?/regenerateToken"
											use:enhance={() => {
												regeneratingId = group.id;
												return async ({ update }) => {
													regeneratingId = null;
													confirmRegenerateId = null;
													await update();
												};
											}}
											class="flex gap-2"
										>
											<input type="hidden" name="groupId" value={group.id} />
											<Button
												type="submit"
												variant="danger"
												size="sm"
												disabled={regeneratingId === group.id}
											>
												{regeneratingId === group.id
													? m.groups_regenerating()
													: m.groups_regenerate_yes()}
											</Button>
											<Button
												variant="secondary"
												size="sm"
												onclick={() => (confirmRegenerateId = null)}
											>
												{m.groups_regenerate_cancel()}
											</Button>
										</form>
									{:else}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => (confirmRegenerateId = group.id)}
										>
											{m.groups_regenerate_button()}
										</Button>
									{/if}
									<Button
										variant="secondary"
										size="sm"
										onclick={() => copyInviteLink(group.invite_token)}
									>
										{copiedToken === group.invite_token ? m.groups_copied() : m.admin_copy_invite()}
									</Button>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
