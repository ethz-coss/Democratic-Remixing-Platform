<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';

	let { data }: { data: PageData } = $props();

	let isMembersOpen = $state(false);
	let copiedToken = $state(false);
	let confirmRegenerate = $state(false);
	let regenerating = $state(false);

	function copyInviteLink() {
		const link = $page.url.origin + localizePath(`/invite/${data.group.invite_token}`);
		navigator.clipboard.writeText(link);
		copiedToken = true;
		setTimeout(() => (copiedToken = false), 2000);
	}
</script>

<svelte:head>
	<title>{data.group.name} | DRP</title>
</svelte:head>

<section class="stack" style="gap:2rem; max-width: 1100px; margin: 0 auto; padding: 2rem 1rem;">
	<header
		style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;"
	>
		<div>
			<h1 class="title" style="margin: 0; font-size: 2.25rem;">{data.group.name}</h1>
		</div>
		{#if data.isGlobalAdmin}
			<Badge label={m.role_admin()} theme="primary" shape="pill" />
		{/if}
	</header>

	<div class="group-layout">
		<!-- Left Column: Details & Invite -->
		<div class="layout-sidebar">
			<article class="info-card stack" style="gap: 1rem;">
				<h2 style="margin: 0; font-size: 1.25rem; font-weight: 700;">{m.groups_detail_title()}</h2>
				<div
					class="description-text"
					style="color: var(--muted); font-size: 0.95rem; line-height: 1.5;"
				>
					{@html data.group.description ||
						`<span style="font-style: italic;">${m.groups_no_description()}</span>`}
				</div>
			</article>

			<!-- Members List -->
			<article class="info-card">
				<button
					class="members-header"
					onclick={() => (isMembersOpen = !isMembersOpen)}
					aria-expanded={isMembersOpen}
				>
					<span>{m.groups_members_count({ count: data.members.length })}</span>
					<span
						style="transition: transform 0.2s;"
						style:transform={isMembersOpen ? 'rotate(180deg)' : 'rotate(0deg)'}>▼</span
					>
				</button>

				{#if isMembersOpen}
					<ul class="members-list">
						{#each data.members as member}
							<li class="member-item">
								<div style="display: flex; align-items: center; gap: 0.75rem;">
									<div class="member-avatar">
										{(member.user?.name || member.user?.username || '?').charAt(0).toUpperCase()}
									</div>
									<div style="display: flex; flex-direction: column;">
										<span style="font-weight: 600; font-size: 0.95rem;">
											{member.user?.name || member.user?.username || 'Unknown User'}
										</span>
										{#if member.user?.name && member.user?.username && member.user.name !== member.user.username}
											<span style="font-size: 0.75rem; color: var(--muted);"
												>@{member.user.username}</span
											>
										{/if}
									</div>
								</div>
								<Badge label={member.role} theme="muted" shape="pill" />
							</li>
						{/each}
					</ul>
				{/if}
			</article>

			{#if data.canCreateQuestion}
				<article class="info-card stack" style="gap: 0.75rem;">
					<h2 style="margin: 0; font-size: 1.1rem; font-weight: 700;">{m.groups_invite_link()}</h2>
					<p style="color: var(--muted); font-size: 0.8rem; margin: 0;">
						{m.groups_invite_share()}
					</p>
					<input
						type="text"
						class="invite-input"
						value={$page.url.origin + localizePath(`/invite/${data.group.invite_token}`)}
						readonly
					/>
					<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
						{#if confirmRegenerate}
							<form
								method="POST"
								action={localizePath('/admin/groups') + '?/regenerateToken'}
								use:enhance={() => {
									regenerating = true;
									return async ({ update }) => {
										regenerating = false;
										confirmRegenerate = false;
										await update();
									};
								}}
								style="display: flex; gap: 0.5rem;"
							>
								<input type="hidden" name="groupId" value={data.group.id} />
								<Button type="submit" variant="danger" size="sm" disabled={regenerating}>
									{regenerating ? m.groups_regenerating() : m.groups_regenerate_yes()}
								</Button>
								<Button variant="secondary" size="sm" onclick={() => (confirmRegenerate = false)}>
									{m.groups_regenerate_cancel()}
								</Button>
							</form>
						{:else}
							<Button variant="ghost" size="sm" onclick={() => (confirmRegenerate = true)}>
								{m.groups_regenerate_button()}
							</Button>
						{/if}
						<Button variant="secondary" size="sm" onclick={copyInviteLink}>
							{copiedToken ? m.groups_copied() : m.admin_copy_invite()}
						</Button>
					</div>
				</article>
			{/if}
		</div>

		<!-- Right Column: Questions -->
		<div class="layout-main">
			<article
				class="info-card stack"
				style="padding: 1.5rem; border: none; background: transparent; box-shadow: none;"
			>
				<div
					style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 1rem;"
				>
					<h2 style="margin: 0; font-size: 1.5rem; font-weight: 700;">
						{m.groups_questions_title()}
					</h2>
					{#if data.canCreateQuestion}
						<Button
							variant="secondary"
							size="sm"
							href={localizePath(`/questions/new?group=${data.group.id}`)}
						>
							{m.groups_new_question()}
						</Button>
					{/if}
				</div>

				{#if data.questions.length === 0}
					<div
						style="text-align: center; padding: 3rem 1rem; border: 1px dashed var(--line); border-radius: 12px; background: var(--surface-secondary);"
					>
						<p class="muted" style="margin: 0;">{m.groups_no_questions()}</p>
					</div>
				{:else}
					<div class="questions-grid">
						{#each data.questions as question}
							<div class="question-card">
								<div class="question-content">
									<div style="display: flex; gap: 0.5rem; align-items: center;">
										{#if question.current_phase_name === 'Proposed'}
											<span class="phase-badge proposed">{m.phase_proposed()}</span>
										{:else if question.current_phase_name === 'AnswerSearch'}
											<span class="phase-badge answer-search">{m.phase_answer_search()}</span>
										{:else if question.current_phase_name === 'Closing'}
											<span class="phase-badge closing">{m.phase_closing()}</span>
										{:else if question.current_phase_name === 'Voting'}
											<span class="phase-badge voting">{m.phase_voting()}</span>
										{:else if question.current_phase_name === 'Decided'}
											<span class="phase-badge decided">{m.phase_decided()}</span>
										{/if}
									</div>
									<h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; line-height: 1.4;">
										<a
											href={localizePath(`/questions/${question.id}`)}
											style="color: var(--ink); text-decoration: none;"
										>
											{question.title}
										</a>
									</h3>
								</div>

								<Button
									href={localizePath(`/questions/${question.id}`)}
									variant="primary"
									class="participate-btn"
								>
									{m.discourse_participate()}
								</Button>
							</div>
						{/each}
					</div>
				{/if}
			</article>
		</div>
	</div>
</section>

<style>
	/* Responsive Layout */
	.group-layout {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.layout-sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.layout-main {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	@media (min-width: 800px) {
		.group-layout {
			flex-direction: row;
			align-items: flex-start;
		}
		.layout-sidebar {
			flex: 0 0 340px;
			position: sticky;
			top: 5rem;
		}
		.layout-main {
			flex: 1;
			min-width: 0;
		}
	}

	/* Card Enhancements */
	.info-card {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--card-radius, 8px);
		padding: 1.5rem;
		box-shadow: var(--card-shadow, 0 1px 3px rgba(0, 0, 0, 0.06));
	}

	.questions-grid {
		container-type: inline-size;
		display: grid;
		gap: 1.25rem;
		grid-template-columns: 1fr;
	}

	/* Responsive Question Cards */
	.question-card {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		border: 1px solid var(--line);
		border-radius: var(--card-radius, 8px);
		background: var(--paper);
		box-shadow: var(--card-shadow, 0 1px 3px rgba(0, 0, 0, 0.06));
		transition:
			transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		height: 100%;
	}

	.question-card:hover {
		transform: translateY(var(--card-lift, -2px));
		box-shadow: var(--card-shadow-hover, 0 4px 12px rgba(0, 0, 0, 0.08));
		border-color: var(--primary);
	}

	.question-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		flex: 1;
	}

	:global(.participate-btn) {
		width: 100%;
		justify-content: center;
		margin-top: auto;
	}

	@container (min-width: 500px) {
		.question-card {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}
		:global(.participate-btn) {
			width: auto;
			margin-top: 0;
		}
	}

	/* Members Dropdown styling */
	.members-header {
		display: flex;
		width: 100%;
		justify-content: space-between;
		align-items: center;
		background: none;
		border: none;
		padding: 0;
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
		color: var(--ink);
	}

	.members-list {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
	}

	.member-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		margin: 0 -0.5rem;
		border-radius: 6px;
		transition: background 0.15s;
	}

	.member-item:hover {
		background: var(--surface-secondary, #f9fafb);
	}

	.member-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--line);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--ink);
	}

	.invite-input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--surface-secondary, #f9fafb);
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--ink);
		cursor: text;
	}
</style>
