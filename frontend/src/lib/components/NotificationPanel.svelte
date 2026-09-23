<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { localizePath } from '$lib/utils/i18n-path';
	import { editorState } from '$lib/editor.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		CheckCircle,
		Sparkles,
		Merge,
		X,
		ArrowRight,
		Bell,
		ListChecks,
		Clock,
		AlertTriangle
	} from '@lucide/svelte';
	import { onMount, onDestroy } from 'svelte';
	import { headerState } from '$lib/stores/headerState.svelte';
	import { logAction } from '$lib/services/telemetry';
	import { dev } from '$app/environment';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Global push notification logs */
		pushLogs?: any[];
	}

	let { open, onClose, pushLogs = [] }: Props = $props();

	// Local arrays to allow optimistic dismissal
	let localPushLogs = $state<any[]>([]);

	$effect(() => {
		// Sync when props change but allow local dismissals & filter invalid items
		localPushLogs = pushLogs.filter((log) => {
			let payload = log.payload_json;
			if (typeof payload === 'string') {
				try {
					payload = JSON.parse(payload);
				} catch (e) {
					return false;
				}
			}
			return payload && (payload.title || payload.body);
		});
	});

	async function dismissPushLog(log: any) {
		localPushLogs = localPushLogs.filter((l) => l.id !== log.id);
		try {
			await fetch(localizePath(`/api/push-action`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: log.id, status: 'dismissed', source: 'panel' })
			});
		} catch (e) {
			console.error('Failed to dismiss push log', e);
		}
	}

	async function actionPushLog(log: any) {
		localPushLogs = localPushLogs.filter((l) => l.id !== log.id);
		try {
			await fetch(localizePath(`/api/push-action`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: log.id, status: 'actioned', source: 'panel' })
			});
		} catch (e) {
			console.error('Failed to action push log', e);
		}

		let payload = log.payload_json;
		if (typeof payload === 'string') {
			try {
				payload = JSON.parse(payload);
			} catch (e) {}
		}
		payload = payload || {};

		const url = payload.data?.url || payload.url;
		if (url) {
			let targetUrlStr = url;
			try {
				// Safely extract just the relative path from the absolute URL payload
				// This prevents SvelteKit `goto` from crashing if the backend URL origin
				// (e.g. localhost) differs slightly from the browser's origin (e.g. 127.0.0.1)
				const parsed = new URL(url);
				targetUrlStr = parsed.pathname + parsed.search + parsed.hash;
			} catch (e) {
				// Fallback if url is already relative
				targetUrlStr = url.replace(window.location.origin, '');
			}
			onClose();
			await goto(targetUrlStr);
			invalidateAll();
		}
	}

	// Swipe to dismiss logic
	function setupSwipe(node: HTMLElement, onDismiss: () => void) {
		let startX = 0;
		let currentX = 0;
		let isDragging = false;

		function onTouchStart(e: TouchEvent) {
			startX = e.touches[0].clientX;
			isDragging = true;
			node.style.transition = 'none';
		}

		function onTouchMove(e: TouchEvent) {
			if (!isDragging) return;
			currentX = e.touches[0].clientX - startX;
			if (currentX > 0) {
				// Only allow swipe right
				node.style.transform = `translateX(${currentX}px)`;
				node.style.opacity = `${1 - currentX / node.offsetWidth}`;
			}
		}

		function onTouchEnd() {
			if (!isDragging) return;
			isDragging = false;
			node.style.transition = 'transform 0.2s, opacity 0.2s';
			if (currentX > 100) {
				node.style.transform = `translateX(100%)`;
				node.style.opacity = '0';
				setTimeout(onDismiss, 200);
			} else {
				node.style.transform = `translateX(0)`;
				node.style.opacity = '1';
			}
		}

		node.addEventListener('touchstart', onTouchStart, { passive: true });
		node.addEventListener('touchmove', onTouchMove, { passive: true });
		node.addEventListener('touchend', onTouchEnd);

		return {
			destroy() {
				node.removeEventListener('touchstart', onTouchStart);
				node.removeEventListener('touchmove', onTouchMove);
				node.removeEventListener('touchend', onTouchEnd);
			}
		};
	}

	const totalCount = $derived(localPushLogs.length);

	$effect(() => {
		headerState.notificationCount = totalCount;
	});

	$effect(() => {
		if (open) {
			logAction('notification_panel_open', { metadata: { unread_count: totalCount } });
		}
	});

	function getLogIconAndColor(log: any) {
		switch (log.event_type) {
			case 'proposal_remixed':
				return { icon: Sparkles, color: '#3b82f6' };
			case 'vote_migration':
				return { icon: Merge, color: '#f59e0b' };
			case 'phase_change':
				return { icon: Bell, color: '#10b981' };
			case 'phase_halfway':
				return { icon: Clock, color: '#f59e0b' };
			case 'phase_ending_soon':
				return { icon: AlertTriangle, color: '#ef4444' };
			case 'ballot_entry':
				return { icon: ListChecks, color: '#ef4444' };
			case 'survey_unlocked':
				return { icon: CheckCircle, color: '#8b5cf6' };
			default:
				return { icon: Bell, color: '#6b7280' };
		}
	}

	let pushStatus = $state<'default' | 'granted' | 'denied' | 'unsupported'>('unsupported');
	let isSubscribed = $state(false);
	let isSubscribing = $state(false);

	onMount(() => {
		(async () => {
			if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
				pushStatus = Notification.permission;
				if (pushStatus === 'granted') {
					try {
						const registration = await navigator.serviceWorker.ready;
						const subscription = await registration.pushManager.getSubscription();
						isSubscribed = !!subscription;
					} catch (e) {
						console.error(e);
					}
				}
			}
		})();

		// Realtime subscription via SvelteKit proxy
		const evtSource = new EventSource('/api/push-notifications/stream');
		evtSource.onmessage = (event) => {
			try {
				const e = JSON.parse(event.data);
				let rawPayload = e.record?.payload_json;
				if (typeof rawPayload === 'string') {
					try {
						rawPayload = JSON.parse(rawPayload);
					} catch (err) {}
				}
				const isValid = rawPayload && (rawPayload.title || rawPayload.body);

				if (e.action === 'create' && e.record.status === 'pending' && isValid) {
					localPushLogs = [e.record, ...localPushLogs];
				} else if (e.action === 'update') {
					if (e.record.status === 'pending' && isValid) {
						const idx = localPushLogs.findIndex((l) => l.id === e.record.id);
						if (idx >= 0) localPushLogs[idx] = e.record;
						else localPushLogs = [e.record, ...localPushLogs];
					} else {
						localPushLogs = localPushLogs.filter((l) => l.id !== e.record.id);
					}
				} else if (e.action === 'delete') {
					localPushLogs = localPushLogs.filter((l) => l.id !== e.record.id);
				}
			} catch (err) {
				console.error('Failed to parse push log stream event', err);
			}
		};

		return () => {
			evtSource.close();
		};
	});

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

	async function togglePush() {
		if (pushStatus === 'unsupported' || pushStatus === 'denied') return;
		isSubscribing = true;
		try {
			const permission = await Notification.requestPermission();
			pushStatus = permission;
			if (permission === 'granted') {
				const res = await fetch('/api/push-subscribe');
				const config = await res.json();
				if (!config.publicKey) throw new Error('No public key');

				const cleanKey = config.publicKey.replace(/^"|"$/g, '');
				console.log('Using VAPID Public Key:', cleanKey);

				// The layout already registers the SW. Just wait for it to be ready.
				const registration = await navigator.serviceWorker.ready;

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

				isSubscribed = true;
			}
		} catch (e) {
			console.error(e);
		} finally {
			isSubscribing = false;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="panel-backdrop" role="presentation" onclick={onClose}></div>
	<aside class="notification-panel" aria-label={m.notification_title()}>
		<div class="panel-header">
			<h2 class="panel-title">{m.notification_title()}</h2>
			<Button variant="icon" onclick={onClose} aria-label={m.common_close()}><X size={18} /></Button
			>
		</div>

		<div class="panel-content">
			{#if totalCount === 0}
				<div class="panel-empty">
					<span class="empty-icon"><CheckCircle size={32} /></span>
					<p class="empty-title">{m.notification_empty()}</p>
					<p class="empty-subtitle">{m.notification_empty_subtitle()}</p>
				</div>
			{:else}
				<div class="notif-list">
					{#each localPushLogs as log (log.id)}
						{@const rawPayload = log.payload_json}
						{@const payload =
							typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload || {}}
						{@const details = getLogIconAndColor(log)}
						{@const IconComponent = details.icon}
						<div
							class="notif-card type-general"
							style="border-left-color: {details.color}"
							use:setupSwipe={() => dismissPushLog(log)}
						>
							<button
								class="notif-card-dismiss"
								onclick={() => dismissPushLog(log)}
								aria-label={m.notification_dismiss()}
								title={m.notification_dismiss()}
							>
								<X size={16} />
							</button>
							<div class="notif-card-header">
								<IconComponent size={16} style="color: {details.color}" />
								<span class="notif-card-title">{payload.title || 'Notification'}</span>
							</div>
							<p class="notif-card-desc">{@html payload.body || 'You have a new update.'}</p>
							{#if payload.data?.url || payload.url}
								<button class="notif-card-cta" onclick={() => actionPushLog(log)}>
									{m.notification_view()}
									<ArrowRight size={14} class="btn-icon" />
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if pushStatus !== 'unsupported'}
				<div class="push-settings">
					<div class="push-settings-info">
						<h4>{m.push_settings_title()}</h4>
						<p>{m.push_settings_desc()}</p>
					</div>
					{#if pushStatus === 'granted' && isSubscribed}
						<span class="push-status enabled">{m.push_settings_enabled()}</span>
					{:else if pushStatus === 'denied'}
						<div class="push-status-denied">
							<span class="push-status disabled">{m.push_settings_blocked()}</span>
							<p class="push-hint">{m.push_settings_hint()}</p>
						</div>
					{:else}
						<button class="push-btn" onclick={togglePush} disabled={isSubscribing}>
							{isSubscribing ? m.push_settings_enabling() : m.push_settings_enable()}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-backdrop);
		background: rgba(0, 0, 0, 0.35);
	}

	.notification-panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: var(--z-drawer);
		width: min(360px, 90vw);
		background: var(--paper, #fff);
		border-left: 1px solid var(--line, #ddd);
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
		display: flex;
		flex-direction: column;
		animation: slide-in-right 0.22s cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes slide-in-right {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--line, #ddd);
		flex-shrink: 0;
	}

	.panel-title {
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0;
		color: var(--ink, #111);
	}

	.panel-content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
	}

	.panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1rem;
		text-align: center;
		gap: 0.25rem;
		flex: 1;
	}

	.empty-icon {
		font-size: 2rem;
		margin-bottom: 0.5rem;
	}
	.empty-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--ink, #111);
		margin: 0;
	}
	.empty-subtitle {
		font-size: 0.78rem;
		color: var(--muted, #666);
		margin: 0;
	}

	/* ── Notification List & Cards ───────────────────────────────────── */

	.notif-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex: 1;
	}

	.notif-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem 0.85rem;
		background: color-mix(in srgb, var(--ink, #111) 2%, var(--paper, #fff));
		border: 1px solid var(--line, #ddd);
		border-left-width: 4px;
		border-radius: 8px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
		touch-action: pan-y; /* For swipe-to-dismiss */
	}

	.notif-card-dismiss {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 4px;
		background: transparent;
		border: none;
		color: var(--muted, #666);
		cursor: pointer;
		opacity: 0.6;
		transition: all 0.15s;
	}

	.notif-card-dismiss:hover,
	.notif-card-dismiss:focus-visible {
		opacity: 1;
		background: color-mix(in srgb, var(--ink, #111) 8%, var(--paper, #fff));
		color: var(--ink, #111);
	}

	.notif-card-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.2rem;
		color: var(--ink, #111);
	}

	.notif-card-title {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.2;
		color: var(--ink, #111);
	}

	.notif-card-desc {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted, #666);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.notif-card-cta {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 44px; /* Accessible touch target */
		margin-top: 0.5rem;
		background: var(--ink, #111);
		color: var(--paper, #fff);
		border: none;
		border-radius: 6px;
		font-size: 0.82rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition:
			opacity 0.15s,
			transform 0.1s;
	}

	.notif-card-cta:hover {
		opacity: 0.9;
		text-decoration: none;
	}

	.notif-card-cta:active {
		transform: scale(0.98);
	}

	/* ── Push Settings ───────────────────────────────────────────── */
	.push-settings {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.8rem 1rem;
		margin-top: auto; /* Push to bottom */
		background: color-mix(in srgb, var(--ink, #111) 4%, var(--paper, #fff));
		border-radius: 8px;
		border: 1px solid var(--line, #ddd);
	}
	.push-settings-info h4 {
		margin: 0 0 0.2rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--ink, #111);
	}
	.push-settings-info p {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted, #666);
	}
	.push-status {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
	}
	.push-status.enabled {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.push-status.disabled {
		background: #ffebee;
		color: #c62828;
	}
	.push-status-denied {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
	}
	.push-hint {
		margin: 0;
		font-size: 0.65rem;
		color: var(--muted, #666);
		text-align: right;
		max-width: 140px;
	}
	.push-btn {
		background: var(--ink, #111);
		color: var(--paper, #fff);
		border: none;
		border-radius: 6px;
		padding: 0.5rem 0.8rem;
		min-height: 44px; /* Accessible touch target */
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.push-btn:hover {
		opacity: 0.85;
	}
	.push-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
