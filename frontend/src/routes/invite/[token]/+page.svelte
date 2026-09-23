<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import Button from '$lib/components/ui/Button.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>{m.invite_page_title()}</title>
</svelte:head>

<div
	class="bg-base-200 flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12 sm:px-6 lg:px-8"
>
	<div class="card bg-base-100 w-full max-w-md shadow-xl">
		<div class="card-body">
			<h2 class="card-title mb-2 text-center text-2xl font-bold">{m.invite_title()}</h2>

			<p class="text-base-content/80 mb-6 text-center">
				{#if data.inviteType === 'group'}
					{@html m.invite_message_group({ title: data.title })}
				{:else}
					{@html m.invite_message_question({ title: data.title })}
				{/if}
			</p>

			{#if data.alreadyMember}
				<div class="alert alert-success">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-6 w-6 shrink-0 stroke-current"
						fill="none"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/></svg
					>
					<span>{m.invite_already_member()}</span>
				</div>
				<div class="card-actions mt-6 justify-center">
					<Button href={localizePath(data.redirectUrl)} variant="primary">
						{data.inviteType === 'group' ? m.invite_go_to_group() : m.invite_go_to_question()}
					</Button>
				</div>
			{:else if data.isAuthenticated}
				<form method="POST" action="?/accept" use:enhance>
					<div class="card-actions mt-4 justify-center">
						<Button type="submit" variant="primary" class="w-full">{m.invite_accept()}</Button>
					</div>
				</form>
			{:else}
				<div class="alert alert-info mb-6 shadow-sm">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						class="h-6 w-6 shrink-0 stroke-current"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						></path></svg
					>
					<span>{m.auth_please_login_or_register()}</span>
				</div>
				<div class="flex flex-col gap-3">
					<Button href={localizePath(`/login?redirect=${data.redirectUrl}`)} variant="primary"
						>{m.invite_login()}</Button
					>
					<Button href={localizePath(`/register?invite_token=${data.token}`)} variant="secondary"
						>{m.auth_create_account_button()}</Button
					>
				</div>
			{/if}
		</div>
	</div>
</div>
