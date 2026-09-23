<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, X } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages.js';
	import { dev } from '$app/environment';

	let showBanner = $state(false);
	let pushStatus = $state('default');
	let isSubscribing = $state(false);

	onMount(() => {
		if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
			// iOS check: push only works in standalone mode (installed on Home Screen)
			const isIOS = /iphone|ipad/i.test(navigator.userAgent);
			const isStandalone =
				window.matchMedia('(display-mode: standalone)').matches ||
				(navigator as any).standalone === true;
			if (isIOS && !isStandalone) {
				// Don't show push banner on iOS Safari tab — push won't work there
				return;
			}

			pushStatus = Notification.permission;

			// Show banner if permission is default and they haven't dismissed it
			const dismissed = localStorage.getItem('push_banner_dismissed') === 'true';
			if (pushStatus === 'default' && !dismissed) {
				// Small delay to not jump scare them on load
				setTimeout(() => {
					showBanner = true;
				}, 2000);
			}
		}
	});

	function dismiss() {
		showBanner = false;
		localStorage.setItem('push_banner_dismissed', 'true');
	}

	function urlBase64ToUint8Array(base64String: string) {
		const cleanBase64 = base64String.replace(/\s+/g, '');
		const padding = '='.repeat((4 - (cleanBase64.length % 4)) % 4);
		const base64 = (cleanBase64 + padding).replace(/\-/g, '+').replace(/_/g, '/');
		const rawData = window.atob(base64);
		const outputArray = new Uint8Array(rawData.length);
		for (let i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	async function enablePush() {
		isSubscribing = true;
		try {
			const permission = await Notification.requestPermission();
			pushStatus = permission;
			if (permission === 'granted') {
				const res = await fetch('/api/push-subscribe');
				const config = await res.json();
				if (config.publicKey) {
					const cleanKey = config.publicKey.replace(/^"|"$/g, '');

					// The layout already registers the SW. Just wait for it to be ready.
					const registration = await Promise.race([
						navigator.serviceWorker.ready,
						new Promise<ServiceWorkerRegistration>((_, reject) =>
							setTimeout(
								() => reject(new Error('Service Worker ready timeout. Ensure SW is registered.')),
								8000
							)
						)
					]);

					let subscription = await registration.pushManager.getSubscription();
					if (!subscription) {
						subscription = await registration.pushManager.subscribe({
							userVisibleOnly: true,
							applicationServerKey: urlBase64ToUint8Array(cleanKey)
						});
					}

					const response = await fetch('/api/push-subscribe', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ subscription, userAgent: navigator.userAgent })
					});
					if (!response.ok) throw new Error('Failed to save subscription on server');
				}
			}
			dismiss();
		} catch (e) {
			console.error(e);
		} finally {
			isSubscribing = false;
		}
	}
</script>

{#if showBanner}
	<div class="push-banner">
		<div class="push-banner-content">
			<div class="push-banner-icon">
				<Bell size={20} />
			</div>
			<div class="push-banner-text">
				<p class="push-title">{m.push_banner_title()}</p>
				<p class="push-desc">{m.push_banner_desc()}</p>
			</div>
		</div>
		<div class="push-banner-actions">
			<button class="push-btn dismiss" onclick={dismiss} disabled={isSubscribing}
				>{m.push_banner_dismiss()}</button
			>
			<button class="push-btn enable" onclick={enablePush} disabled={isSubscribing}>
				{isSubscribing ? m.push_banner_enabling() : m.push_banner_enable()}
			</button>
			<button class="push-btn-close" aria-label="Close" onclick={dismiss}><X size={16} /></button>
		</div>
	</div>
{/if}

<style>
	.push-banner {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		right: 1rem;
		max-width: 400px;
		background: var(--paper, #fff);
		border: 1px solid var(--line, #ddd);
		border-radius: 12px;
		padding: 1rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
		z-index: var(--z-modal, 100);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		animation: slide-up 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}

	@media (min-width: 600px) {
		.push-banner {
			bottom: 1.5rem;
			left: 1.5rem;
			right: auto;
		}
	}

	@keyframes slide-up {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.push-banner-content {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.push-banner-icon {
		background: color-mix(in srgb, var(--ink, #111) 5%, transparent);
		color: var(--ink, #111);
		width: 36px;
		height: 36px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.push-banner-text {
		flex: 1;
	}

	.push-title {
		margin: 0 0 0.2rem;
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--ink, #111);
	}

	.push-desc {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted, #666);
		line-height: 1.4;
	}

	.push-banner-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
		position: relative;
	}

	.push-btn-close {
		position: absolute;
		top: -3.5rem;
		right: -0.5rem;
		background: none;
		border: none;
		color: var(--muted, #666);
		padding: 0.25rem;
		cursor: pointer;
		opacity: 0.6;
		transition: opacity 0.2s;
	}

	.push-btn-close:hover {
		opacity: 1;
	}

	.push-btn {
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.45rem 0.8rem;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.push-btn.dismiss {
		background: none;
		border: 1px solid var(--line, #ddd);
		color: var(--ink, #111);
	}

	.push-btn.dismiss:hover {
		background: color-mix(in srgb, var(--ink, #111) 5%, var(--paper, #fff));
	}

	.push-btn.enable {
		background: var(--ink, #111);
		border: 1px solid var(--ink, #111);
		color: var(--paper, #fff);
	}

	.push-btn.enable:hover {
		opacity: 0.9;
	}
</style>
