<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import { generateUsername } from '$lib/utils/username-generator';
	import { enhance } from '$app/forms';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import LanguageToggle from '$lib/components/LanguageToggle.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FormField from '$lib/components/ui/FormField.svelte';

	import { untrack } from 'svelte';
	let { form, data } = $props();

	let currentUsername = $state(untrack(() => data?.suggestedUsername ?? generateUsername()));
	let currentPassword = $state('');
	let currentPasswordConfirm = $state('');

	let isUsernameValid = $derived(/^[a-zA-Z0-9_]{3,30}$/.test(currentUsername));
	let isPasswordValid = $derived(currentPassword.length === 0 || currentPassword.length >= 8);
	let isPasswordConfirmValid = $derived(
		currentPasswordConfirm.length === 0 || currentPassword === currentPasswordConfirm
	);

	function handleRegenerate() {
		currentUsername = generateUsername();
	}

	let step = $state(untrack(() => data.stepParam ?? (data.token ? 'consent' : 'token')));
	let validatedToken = $state(untrack(() => data.token ?? ''));
	let method = $state(untrack(() => data.method ?? 'A'));
	let groupName = $state(untrack(() => data.groupName ?? ''));

	$effect(() => {
		if (form?.username) currentUsername = form.username;
		if (form?.step) step = form.step;
	});

	let validating = $state(false);
	let creating = $state(false);

	let c1 = $state(false);
	let c2 = $state(false);
	let c3 = $state(false);
	let c4 = $state(false);
	let cScreen = $state(false);
	let cStop = $state(false);
	let cFinal = $state(false);

	let allConsentChecked = $derived(
		c1 && c2 && c3 && cFinal && (method === 'B' ? cScreen && cStop : c4)
	);

	$effect(() => {
		if (step === 'account' && !allConsentChecked) {
			const newUrl = new URL(page.url);
			newUrl.searchParams.delete('step');
			setTimeout(() => {
				replaceState(newUrl, page.state);
			}, 0);
			step = 'consent';
		}
		if (form?.step && step !== form.step) {
			step = form.step;
		}
	});
</script>

<section class="stack" style="max-width:40rem; margin:1.3rem auto; padding-bottom: 6rem;">
	<header class="section-card stack" style="gap:0.4rem; position: relative;">
		<div style="position: absolute; top: 1rem; right: 1rem;">
			<LanguageToggle />
		</div>
		{#if groupName}
			<p class="muted" style="margin:0;">You've been invited to join</p>
			<h1 class="title">{groupName}</h1>
			<p class="muted" style="margin:0;">{m.auth_create_account()}</p>
		{:else}
			<p class="muted" style="margin:0;">{m.auth_join_board()}</p>
			<h1 class="title">{m.auth_create_account()}</h1>
		{/if}
	</header>

	{#if step === 'token'}
		<form
			method="POST"
			action="?/validateToken"
			class="section-card stack"
			use:enhance={() => {
				validating = true;
				return async ({ result, update }) => {
					if (result.type === 'success' && result.data) {
						validatedToken = String(result.data.token || '');
						method = String(result.data.method || 'A');
						groupName = String(result.data.groupName || '');

						await update();
						step = 'consent';

						const newUrl = new URL(page.url);
						newUrl.searchParams.set('token', validatedToken);
						newUrl.searchParams.set('step', 'consent');
						goto(newUrl.href, { replaceState: true, keepFocus: true });
					} else {
						await update();
					}
					validating = false;
				};
			}}
		>
			<p>An invite token is required to register.</p>
			<FormField label="Invite Token" required={true}>
				<input name="token" required value={form?.token ?? ''} />
			</FormField>
			<div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
				<Button type="submit" disabled={validating}>
					{validating ? 'Validating...' : 'Continue'}
				</Button>
			</div>
			{#if form?.message && step === 'token'}
				<p class="muted" style="color:#a03b2f;margin:0;">{form.message}</p>
			{/if}
		</form>
	{/if}

	{#if step === 'consent' || step === 'account'}
		<form
			method="POST"
			action="?/register"
			class="stack"
			use:enhance={() => {
				creating = true;
				return async ({ update, result }) => {
					await update({ reset: false });
					creating = false;
					if (form?.step) step = form.step;
				};
			}}
		>
			<input type="hidden" name="token" value={validatedToken} />
			<input type="hidden" name="method" value={method} />

			<!-- CONSENT STEP -->
			<div
				class="section-card stack"
				style="display: {step === 'consent' ? 'flex' : 'none'}; flex-direction: column; gap:1.5rem;"
			>
				<header class="stack">
					<h2 class="title" style="margin:0;">{m.consent_page_title()}</h2>
					<p class="muted">{m.consent_preamble()}</p>
				</header>

				{#if form?.message && step === 'consent'}
					<div class="section-card bg-muted" style="border-left: 4px solid var(--destructive);">
						<p style="margin:0; color:var(--destructive);">{form.message}</p>
					</div>
				{/if}

				<section class="stack" style="gap:0.5rem;">
					<h3 style="margin:0; font-size:1.1rem;">Study Information</h3>
					<ul style="padding-left:1.5rem; margin:0; word-break: break-word;">
						<li><strong>Contact:</strong> {m.consent_contact_value()}</li>
						<li><strong>DPO:</strong> {m.consent_dpo_value()}</li>
						<li><strong>Funding:</strong> {m.consent_section_funding_review()}</li>
					</ul>

					<h3 style="margin:0; font-size:1.1rem; margin-top:1rem;">Study Methods</h3>
					<details>
						<summary style="cursor:pointer; font-weight:600;">{m.consent_method_a_title()}</summary>
						<p style="margin-top:0.5rem; margin-bottom:0;">{m.consent_method_a_desc()}</p>
					</details>
					<details>
						<summary style="cursor:pointer; font-weight:600;">{m.consent_method_b_title()}</summary>
						<p style="margin-top:0.5rem; margin-bottom:0;">{m.consent_method_b_desc()}</p>
					</details>
				</section>

				<hr style="margin: 0; border: none; border-top: 1px solid var(--border);" />

				<section class="stack" style="gap:0.5rem; word-break: break-word;">
					<h3 style="margin:0; font-size:1.1rem;">What is investigated?</h3>
					<p style="margin:0;">
						{method === 'B'
							? m.consent_section_what_investigated_b()
							: m.consent_section_what_investigated_a()}
					</p>

					<h3 style="margin:0; font-size:1.1rem; margin-top:1rem;">What do I have to do?</h3>
					<p style="margin:0;">
						{method === 'B' ? m.consent_section_what_to_do_b() : m.consent_section_what_to_do_a()}
					</p>

					<h3 style="margin:0; font-size:1.1rem; margin-top:1rem;">Data Collection</h3>
					<p style="margin:0;">
						{method === 'B'
							? m.consent_section_data_collection_b()
							: m.consent_section_data_collection_a()}
					</p>

					<h3 style="margin:0; font-size:1.1rem; margin-top:1rem;">Rights and Risks</h3>
					<p style="margin:0;">
						{method === 'B'
							? m.consent_section_rights_risks_b()
							: m.consent_section_rights_risks_a()}
					</p>
					<p style="margin:0;">
						{method === 'B'
							? m.consent_section_compensation_b()
							: m.consent_section_compensation_a()}
					</p>

					<h3 style="margin:0; font-size:1.1rem; margin-top:1rem;">Data Privacy & Open Science</h3>
					<p style="margin:0;">{m.consent_section_data_processing()}</p>
					<p style="margin:0; margin-top:0.5rem;">{m.consent_section_anonymization()}</p>
					<p style="margin:0; margin-top:0.5rem;">{m.consent_section_secondary_use()}</p>
					<p style="margin:0; margin-top:0.5rem;">{m.consent_section_retention()}</p>
				</section>

				<hr style="margin: 0; border: none; border-top: 1px solid var(--border);" />

				<h3 style="margin:0; font-size:1.2rem;">Consent Checklist</h3>

				<label
					class:missing-consent={!c1}
					style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
				>
					<input
						type="checkbox"
						name="consent_1"
						required={step === 'consent'}
						style="margin-top:0.3rem; flex-shrink: 0;"
						bind:checked={c1}
					/>
					<span>{m.consent_checklist_1()}</span>
				</label>
				<label
					class:missing-consent={!c2}
					style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
				>
					<input
						type="checkbox"
						name="consent_2"
						required={step === 'consent'}
						style="margin-top:0.3rem; flex-shrink: 0;"
						bind:checked={c2}
					/>
					<span>{m.consent_checklist_2()}</span>
				</label>
				<label
					class:missing-consent={!c3}
					style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
				>
					<input
						type="checkbox"
						name="consent_3"
						required={step === 'consent'}
						style="margin-top:0.3rem; flex-shrink: 0;"
						bind:checked={c3}
					/>
					<span>{m.consent_checklist_3()}</span>
				</label>
				{#if method === 'A'}
					<label
						class:missing-consent={!c4}
						style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
					>
						<input
							type="checkbox"
							name="consent_4"
							required={step === 'consent'}
							style="margin-top:0.3rem; flex-shrink: 0;"
							bind:checked={c4}
						/>
						<span>{m.consent_checklist_4()}</span>
					</label>
				{/if}
				{#if method === 'B'}
					<label
						class:missing-consent={!cScreen}
						style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
					>
						<input
							type="checkbox"
							name="consent_screen"
							required={step === 'consent'}
							style="margin-top:0.3rem; flex-shrink: 0;"
							bind:checked={cScreen}
						/>
						<span>{m.consent_checklist_b_screen_recording()}</span>
					</label>
					<label
						class:missing-consent={!cStop}
						style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; word-break: break-word;"
					>
						<input
							type="checkbox"
							name="consent_stop"
							required={step === 'consent'}
							style="margin-top:0.3rem; flex-shrink: 0;"
							bind:checked={cStop}
						/>
						<span>{m.consent_checklist_b_stop_anytime()}</span>
					</label>
				{/if}

				<label
					class:missing-consent={!cFinal}
					style="display:flex; flex-direction:row; gap:0.5rem; align-items:flex-start; padding: 1rem; background: var(--bg-surface-2); border-radius: var(--radius); word-break: break-word;"
				>
					<input
						type="checkbox"
						name="consent_final"
						required={step === 'consent'}
						style="margin-top:0.3rem; width:1.5rem; height:1.5rem; flex-shrink: 0;"
						bind:checked={cFinal}
					/>
					<span style="font-weight:bold; font-size:1.1rem;">
						{method === 'B' ? m.consent_final_checkbox_b() : m.consent_final_checkbox_a()}
					</span>
				</label>

				{#if !allConsentChecked}
					<div
						class="section-card bg-muted"
						style="border-left: 4px solid var(--destructive); padding: 0.8rem 1rem;"
					>
						<p style="margin:0; color:var(--destructive); font-weight: 500;">
							Please read and check all highlighted consent boxes above to continue.
						</p>
					</div>
				{/if}

				<Button
					type="button"
					disabled={!allConsentChecked}
					onclick={(e: Event) => {
						const target = e.currentTarget as HTMLElement | null;
						const container = target?.parentElement;
						const inputs = container?.querySelectorAll('input[required]') || [];
						for (const input of inputs) {
							if (!(input as HTMLInputElement).checkValidity()) {
								(input as HTMLInputElement).reportValidity();
								return;
							}
						}

						const newUrl = new URL(page.url);
						newUrl.searchParams.set('step', 'account');
						replaceState(newUrl, page.state);

						step = 'account';
					}}
				>
					{m.consent_submit_button()}
				</Button>
			</div>

			<!-- ACCOUNT STEP -->
			<div
				class="stack"
				style="display: {step === 'account'
					? 'flex'
					: 'none'}; flex-direction: column; gap:1.5rem; max-width: 26rem; margin: 0 auto; width: 100%;"
			>
				<div
					class="section-card bg-muted"
					style="margin-bottom:-2rem; padding: 1rem; border-radius: var(--radius) var(--radius) 0 0; z-index: var(--z-base); border-bottom: none;"
				>
					<p class="muted" style="margin:0; font-size: 0.9em;">
						{m.auth_anonymous_info()}
					</p>
				</div>
				<div class="section-card stack" style="display: flex; flex-direction: column; gap: 1rem;">
					<FormField
						label={m.auth_username()}
						required={true}
						helpText={m.auth_username_hint
							? m.auth_username_hint()
							: 'Must be 3-30 characters long and contain only letters, numbers, and underscores.'}
					>
						<div style="display: flex; gap: 0.5rem; align-items: center;">
							<input
								name="username"
								type="text"
								required
								bind:value={currentUsername}
								pattern={'^[a-zA-Z0-9_]{3,30}$'}
								autocomplete="username"
								style="flex: 1;"
							/>
							<Button
								variant="secondary"
								onclick={handleRegenerate}
								aria-label={m.auth_regenerate_username()}
							>
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
									><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path
										d="M3 3v5h5"
									/></svg
								>
							</Button>
						</div>
					</FormField>

					<FormField
						label={m.auth_password()}
						required={true}
						helpText={m.auth_password_hint
							? m.auth_password_hint()
							: 'Must be at least 8 characters long.'}
					>
						<input
							name="password"
							type="password"
							required
							minlength="8"
							autocomplete="new-password"
							bind:value={currentPassword}
						/>
					</FormField>

					<FormField label={m.auth_confirm_password()} required={true}>
						<input
							name="passwordConfirm"
							type="password"
							required
							minlength="8"
							autocomplete="new-password"
							bind:value={currentPasswordConfirm}
						/>
						{#if currentPasswordConfirm.length > 0 && !isPasswordConfirmValid}
							<p class="muted" style="margin:0; font-size: 0.8em;" class:error-text={true}>
								Passwords do not match.
							</p>
						{/if}
					</FormField>

					<div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
						<Button type="submit" disabled={creating}>
							{creating ? 'Creating...' : m.auth_create_account()}
						</Button>
						<Button
							variant="secondary"
							onclick={() => {
								const newUrl = new URL(page.url);
								newUrl.searchParams.delete('step');
								replaceState(newUrl, page.state);
								step = 'consent';
							}}
							disabled={creating}
						>
							Back
						</Button>
					</div>

					{#if form?.message && step === 'account'}
						<p class="muted" style="color:#a03b2f;margin:0;">{form.message}</p>
					{/if}
				</div>
			</div>
		</form>
	{/if}

	<p class="muted" style="text-align:center;">
		{m.auth_already_have_account()} <a href={localizePath('/login')}>{m.auth_login()}</a>
	</p>
</section>

<style>
	.missing-consent {
		color: var(--destructive, #dc2626);
	}
	.missing-consent input[type='checkbox'] {
		outline: 1px solid var(--destructive, #dc2626);
		outline-offset: 1px;
	}
	.error-text {
		color: var(--destructive, #dc2626) !important;
		font-weight: 500;
	}
</style>
