<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import FormField from '$lib/components/ui/FormField.svelte';

	import { localizePath } from '$lib/utils/i18n-path';
	import LanguageToggle from '$lib/components/LanguageToggle.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	import { getLocale } from '$lib/paraglide/runtime.js';
	import { enhance } from '$app/forms';

	let { form, data } = $props();

	let submitting = $state(false);
</script>

<section class="stack" style="max-width:26rem;margin:1.3rem auto;">
	<header class="section-card stack" style="gap:0.4rem; position: relative;">
		<div style="position: absolute; top: 1rem; right: 1rem;">
			<LanguageToggle />
		</div>
		<p class="muted" style="margin:0;">{m.auth_welcome_back()}</p>
		<h1 class="title">{m.auth_login()}</h1>
		<p class="muted" style="margin:0;">{m.auth_login_subtitle()}</p>
	</header>

	<form
		method="POST"
		class="section-card stack"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
	>
		<input type="hidden" name="redirect" value={data?.redirectTo ?? ''} />
		<input type="hidden" name="locale" value={getLocale()} />

		{#if form?.message}
			<div class="error-banner" role="alert">
				{form.message}
			</div>
		{/if}

		<FormField label={m.auth_username()} required={true}>
			<input
				name="username"
				type="text"
				required
				value={form?.username ?? ''}
				autocomplete="username"
			/>
		</FormField>
		<FormField label={m.auth_password()} required={true}>
			<input
				name="password"
				type="password"
				required
				minlength="8"
				autocomplete="current-password"
			/>
		</FormField>

		<Button type="submit" disabled={submitting}>
			{#if submitting}
				…
			{:else}
				{m.auth_login()}
			{/if}
		</Button>

		<div style="text-align: center; margin-top: 1rem;">
			<span class="muted">{m.auth_no_account()}</span>
			<a
				href={localizePath('/register')}
				class="brand-link"
				style="margin-left: 0.5rem; font-weight: bold;">{m.auth_create_one()}</a
			>
		</div>
	</form>
</section>

<style>
	.error-banner {
		background: color-mix(in srgb, #a03b2f 12%, var(--paper, #fff));
		border: 1px solid #a03b2f;
		color: #a03b2f;
		padding: 0.65rem 0.85rem;
		border-radius: 0.5rem;
		font-size: 0.9rem;
		font-weight: 500;
	}
</style>
