<script lang="ts">
	import { localizePath } from '$lib/utils/i18n-path';
	import * as m from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		ClipboardList,
		Users,
		BookOpen,
		NotebookPen,
		Settings,
		Globe,
		X,
		LogOut
	} from '@lucide/svelte';
	import LanguageToggle from '$lib/components/LanguageToggle.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		user: { id: string; name?: string; email?: string; role?: string; username?: string } | null;
		questionTitle: string;
		questionId?: string;
		/** User's group memberships */
		userGroups?: Array<{ id: string; name: string }>;
		surveyUnlocked?: boolean;
		surveyCompleted?: boolean;
	}

	let {
		open,
		onClose,
		user,
		questionTitle,
		questionId,
		userGroups = [],
		surveyUnlocked = false,
		surveyCompleted = false
	}: Props = $props();

	const userInitial = $derived(user?.name?.charAt(0).toUpperCase() ?? '?');
	const isAdmin = $derived(user?.role === 'admin');
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="drawer-backdrop" role="presentation" onclick={onClose}></div>
	<aside class="side-drawer" aria-label={m.drawer_navigation()}>
		<div class="drawer-header">
			<div class="drawer-lang-inline">
				<Globe size={16} color="var(--muted, #666)" />
				<LanguageToggle />
			</div>
			<Button variant="icon" onclick={onClose} aria-label={m.common_close()}><X size={18} /></Button
			>
		</div>

		<!-- User section (profile) -->
		{#if user}
			<div class="drawer-user">
				<span class="drawer-avatar">{userInitial}</span>
				<div class="drawer-user-info">
					<span class="drawer-user-name">{user.name || user.username || m.common_anonymous()}</span>

					<span class="drawer-role-badge">
						{isAdmin ? m.role_admin() : m.role_participant()}
					</span>
				</div>
			</div>
		{/if}

		<div class="drawer-divider"></div>

		<!-- Navigation links -->
		<nav class="drawer-nav">
			<a href={localizePath('/discourse')} class="drawer-link" onclick={onClose}>
				<span class="drawer-link-icon"><ClipboardList size={18} /></span>
				<span>{m.drawer_questions()}</span>
			</a>

			{#if user}
				<a href={localizePath('/groups')} class="drawer-link" onclick={onClose}>
					<span class="drawer-link-icon"><Users size={18} /></span>
					<span>{m.profile_groups()}</span>
				</a>
			{/if}

			<a
				href={localizePath('/how-it-works') + (questionId ? `?q=${questionId}` : '')}
				class="drawer-link"
				onclick={onClose}
			>
				<span class="drawer-link-icon"><BookOpen size={18} /></span>
				<span>{m.how_it_works_title()}</span>
			</a>

			{#if surveyUnlocked}
				<a
					href={localizePath('/post-study-survey')}
					class="drawer-link drawer-survey-link"
					onclick={onClose}
				>
					<span class="drawer-link-icon"><NotebookPen size={18} /></span>
					<span style="display: flex; align-items: center; gap: 0.5rem;">
						{#if !surveyCompleted}
							<div
								style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--primary, #3b82f6); flex-shrink: 0;"
							></div>
						{/if}
						<span>{m.post_study_survey() || 'Post-Study Survey'}</span>
					</span>
				</a>
			{/if}

			{#if isAdmin}
				<a
					href={localizePath('/admin')}
					class="drawer-link"
					data-sveltekit-preload-data="off"
					onclick={onClose}
				>
					<span class="drawer-link-icon"><Settings size={18} /></span>
					<span>{m.nav_admin()}</span>
				</a>
			{/if}
		</nav>

		<!-- Language switch removed from here -->

		<!-- Current question context -->
		{#if questionTitle}
			<div class="drawer-context">
				<span class="drawer-context-label">{m.drawer_current_question()}</span>
				<span class="drawer-context-title">{questionTitle}</span>
			</div>
			<div class="drawer-divider"></div>
		{/if}

		<!-- Logout -->
		{#if user}
			<div style="margin-top: auto; padding-bottom: 0.5rem;">
				<form method="POST" action="/logout" style="margin: 0; padding: 0; display: flex;">
					<button
						type="submit"
						class="drawer-link"
						style="width: 100%; text-align: left; background: none; border: none; cursor: pointer; font: inherit;"
					>
						<span class="drawer-link-icon"><LogOut size={18} /></span>
						<span>{m.auth_log_out()}</span>
					</button>
				</form>
			</div>
		{/if}
	</aside>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
		background: rgba(0, 0, 0, 0.35);
	}

	.side-drawer {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		z-index: var(--z-drawer);
		width: min(300px, 82vw);
		background: var(--paper, #fff);
		border-right: 1px solid var(--line, #ddd);
		box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		animation: slide-in-left 0.22s cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes slide-in-left {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(0);
		}
	}

	/* ── Drawer Close ──────────────────────────────────────── */
	.drawer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
	}

	.drawer-lang-inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* ── User / Profile section ────────────────────────────── */
	.drawer-user {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		color: inherit;
	}

	.drawer-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--ink, #111) 12%, var(--paper, #fff));
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--ink, #111);
		flex-shrink: 0;
	}

	.drawer-user-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 0.1rem;
	}

	.drawer-user-name {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--ink, #111);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.drawer-role-badge {
		display: inline-block;
		width: fit-content;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 1px 6px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--ink, #111) 8%, var(--paper, #fff));
		color: var(--muted, #666);
		margin-top: 0.1rem;
	}

	/* ── Sections ──────────────────────────────────────────── */

	/* ── Navigation ────────────────────────────────────────── */
	.drawer-divider {
		height: 1px;
		background: var(--line, #ddd);
		margin: 0.25rem 1rem;
	}

	.drawer-nav {
		display: flex;
		flex-direction: column;
		padding: 0.25rem 0;
	}

	.drawer-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink, #111);
		text-decoration: none;
		transition: background 0.12s;
		min-height: var(--touch-min, 44px);
	}

	.drawer-link:hover {
		background: color-mix(in srgb, var(--ink, #111) 5%, var(--paper, #fff));
		text-decoration: none;
	}

	.drawer-link-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		width: 1.5rem;
	}

	/* Language toggle styles removed */

	/* ── Context ───────────────────────────────────────────── */
	.drawer-context {
		padding: 0.75rem 1rem;
	}

	.drawer-context-label {
		display: block;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted, #666);
		margin-bottom: 0.25rem;
	}

	.drawer-context-title {
		display: block;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink, #111);
		line-height: 1.3;
	}
</style>
