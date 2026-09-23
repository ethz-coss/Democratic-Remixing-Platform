<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale, localizeUrl } from '$lib/paraglide/runtime.js';
	import { page } from '$app/state';

	const currentLocale = $derived(getLocale());
	const deUrl = $derived(localizeUrl(page.url.href, { locale: 'de' }).href);
	const enUrl = $derived(localizeUrl(page.url.href, { locale: 'en' }).href);

	function updateProfileLanguage(e: MouseEvent, lang: string) {
		if (page.data.user && page.data.user.language !== lang) {
			e.preventDefault();
			const target = e.currentTarget as HTMLAnchorElement;
			const href = target.href;

			try {
				localStorage.setItem('language', lang);
			} catch (err) {
				console.warn('Failed to save language to localStorage', err);
			}

			fetch('/api/user/language', {
				method: 'POST',
				body: JSON.stringify({ language: lang }),
				headers: { 'Content-Type': 'application/json' }
			})
				.catch(console.error)
				.finally(() => {
					window.location.href = href;
				});
		}
	}
</script>

<div class="lang-toggle">
	<a
		href={deUrl}
		class="lang-option"
		class:active={currentLocale === 'de'}
		onclick={(e) => updateProfileLanguage(e, 'de')}
		data-sveltekit-reload
	>
		DE
	</a>
	<span class="lang-divider">|</span>
	<a
		href={enUrl}
		class="lang-option"
		class:active={currentLocale === 'en'}
		onclick={(e) => updateProfileLanguage(e, 'en')}
		data-sveltekit-reload
	>
		EN
	</a>
</div>

<style>
	.lang-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.lang-option {
		color: var(--muted, #666);
		text-decoration: none;
		transition: color 0.2s;
	}
	.lang-option:hover {
		color: var(--text, #1a1a1a);
	}
	.lang-option.active {
		color: var(--color-brand, #3b82f6);
		font-weight: 600;
	}
	.lang-divider {
		color: var(--border, #ddd);
	}
</style>
