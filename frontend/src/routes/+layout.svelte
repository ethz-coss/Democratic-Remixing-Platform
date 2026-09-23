<script lang="ts">
	import './layout.css';
	import * as m from '$lib/paraglide/messages.js';
	import favicon from '$lib/assets/favicon.svg';
	import { dev } from '$app/environment';
	import DevSimulatorModal from '$lib/components/DevSimulatorModal.svelte';
	import SideDrawer from '$lib/components/SideDrawer.svelte';
	import NotificationPanel from '$lib/components/NotificationPanel.svelte';
	import IosInstallPrompt from '$lib/components/IosInstallPrompt.svelte';
	import PushPermissionBanner from '$lib/components/PushPermissionBanner.svelte';
	import { page } from '$app/state';
	import { localizePath } from '$lib/utils/i18n-path';
	import { headerState } from '$lib/stores/headerState.svelte';
	import ComparePoolHeaderButton from '$lib/components/ComparePoolHeaderButton.svelte';
	import { BookOpen } from '@lucide/svelte';

	let { data, children } = $props();

	// ── Drawer state ─────────────────────────────────────────────────
	let drawerOpen = $state(false);
	let notificationPanelOpen = $state(false);

	const isAuthPage = $derived(page.route.id === '/login' || page.route.id === '/register');
	const homePath = '/discourse';
	const isAdmin = $derived(data.user?.role === 'admin');

	// Locale-aware route detection using SvelteKit's route.id and params
	const isProposalsRoute = $derived(
		page.route.id?.startsWith('/questions/[id]/proposals') || false
	);

	let preferredQuestionId = $state<string | undefined>(undefined);

	// Extract question ID directly from SvelteKit route params
	const currentQuestionId = $derived(
		page.route.id?.includes('/questions/[id]') ? page.params.id : null
	);

	const canStartSimulationOnRoute = $derived.by(() => {
		return page.route.id?.startsWith('/questions/[id]/proposals') || false;
	});

	let isSimulatorOpen = $state(false);

	import { logAction } from '$lib/services/telemetry';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { onMount } from 'svelte';
	import { setHasNavigated, goBackWithFallback } from '$lib/utils/nav';

	onMount(() => {
		if (data.user) {
			if (data.user.language) {
				try {
					localStorage.setItem('language', data.user.language);
				} catch (e) {
					console.warn('Failed to sync language to localStorage', e);
				}
			}

			const isMobile = /Mobi|Android/i.test(navigator.userAgent);
			logAction('session_start', {
				metadata: {
					userAgent: navigator.userAgent,
					isMobile,
					screenWidth: window.innerWidth,
					screenHeight: window.innerHeight
				}
			});

			// Register service worker and sync push subscription if already granted
			if ('serviceWorker' in navigator && 'PushManager' in window) {
				navigator.serviceWorker
					.register('/service-worker.js', {
						type: dev ? 'module' : 'classic'
					})
					.catch((err) => {
						console.error('Service Worker registration failed:', err);
					});

				navigator.serviceWorker.ready.then(async (registration) => {
					if (Notification.permission === 'granted') {
						try {
							// Fetch current server VAPID key
							const configRes = await fetch('/api/push-subscribe');
							if (!configRes.ok) {
								console.warn('[push-sync] Failed to fetch VAPID config:', configRes.status);
								return;
							}
							const config = await configRes.json();
							const serverKey = (config.publicKey || '').replace(/^"|"$/g, '');

							let subscription = await registration.pushManager.getSubscription();

							// Detect VAPID key mismatch — existing subscription uses old key
							if (subscription && serverKey) {
								const subKey = subscription.options?.applicationServerKey;
								if (subKey) {
									const subKeyBase64 = btoa(
										String.fromCharCode(...new Uint8Array(subKey as ArrayBuffer))
									)
										.replace(/\+/g, '-')
										.replace(/\//g, '_')
										.replace(/=+$/, '');
									if (subKeyBase64 !== serverKey) {
										console.warn('[push-sync] VAPID key mismatch — re-subscribing');
										await subscription.unsubscribe();
										subscription = null; // Will be re-created below
									}
								}
							}

							// Re-subscribe if no valid subscription
							if (!subscription && serverKey) {
								const urlBase64ToUint8Array = (base64String: string) => {
									const clean = base64String.replace(/\s+/g, '');
									const padding = '='.repeat((4 - (clean.length % 4)) % 4);
									const b64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
									const raw = window.atob(b64);
									const arr = new Uint8Array(raw.length);
									for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
									return arr;
								};
								subscription = await registration.pushManager.subscribe({
									userVisibleOnly: true,
									applicationServerKey: urlBase64ToUint8Array(serverKey)
								});
								console.log('[push-sync] Created new push subscription');
							}

							if (subscription) {
								const syncRes = await fetch('/api/push-subscribe', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ subscription, userAgent: navigator.userAgent })
								});
								if (!syncRes.ok) {
									console.error('[push-sync] Failed to sync subscription:', syncRes.status);
								} else {
									console.log('[push-sync] Subscription synced successfully');
								}
							}
						} catch (e) {
							console.error('[push-sync] Failed to sync push subscription', e);
						}
					}
				});
			}
		}

		const handleVisibility = () => {
			if (!document.hidden && data.user) {
				logAction('tab_switch', { metadata: { state: 'visible' } });
			}
		};
		document.addEventListener('visibilitychange', handleVisibility);
		return () => document.removeEventListener('visibilitychange', handleVisibility);
	});

	$effect(() => {
		if (currentQuestionId) {
			preferredQuestionId = currentQuestionId;
		}
	});

	afterNavigate((navigation) => {
		if (navigation.from) {
			setHasNavigated();
		}
		if (data.user) {
			const questionId = preferredQuestionId || undefined;
			logAction('page_view', {
				question: questionId,
				metadata: {
					from: navigation.from?.url.pathname,
					to: navigation.to?.url.pathname
				}
			});
		}

		// Consume push notification click
		if (page.url.searchParams.has('notif')) {
			const notifId = page.url.searchParams.get('notif');
			if (notifId) {
				fetch('/api/push-action', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: notifId, status: 'actioned' })
				}).catch(console.error);

				const newUrl = new URL(page.url);
				newUrl.searchParams.delete('notif');
				replaceState(newUrl, page.state);
			}
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="app-shell" class:fixed-layout={isProposalsRoute}>
	{#if !isAuthPage}
		<header class="topbar">
			{#if headerState.mode === 'question'}
				<!-- ── Question / Proposals mode ── -->
				<!-- Burger: Always shown in this mode -->
				<button
					type="button"
					class="topbar-burger"
					onclick={() => headerState.onToggleDrawer?.()}
					aria-label="Open menu"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<line x1="3" y1="5" x2="17" y2="5" />
						<line x1="3" y1="10" x2="17" y2="10" />
						<line x1="3" y1="15" x2="17" y2="15" />
					</svg>
				</button>

				{#if !headerState.isTabPage}
					<!-- Back arrow: shown when on a detail page -->
					<button
						type="button"
						class="topbar-burger topbar-back-btn"
						onclick={() =>
							headerState.onBack ? headerState.onBack() : goBackWithFallback('/discourse')}
						aria-label="Back"
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 20 20"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M13 16 7 10l6-6" />
						</svg>
					</button>
					<span class="brand"></span>
				{:else}
					<!-- Question title: only shown on tab pages -->
					<span class="brand">{headerState.questionTitle}</span>
				{/if}

				<!-- Question context button (proposals workspace only) -->
				{#if headerState.showQuestionPanel}
					<button
						type="button"
						class="topbar-question-btn"
						aria-label={m.question_description_and_constraints()}
						title="Question & Constraints"
						onclick={() => headerState.onToggleQuestionPanel?.()}
					>
						<BookOpen size={18} />
					</button>
				{/if}

				<!-- Compare mode active override -->
				{#if headerState.compareModeActive}
					<button
						type="button"
						class="topbar-close-btn"
						onclick={() => headerState.onCloseCompare?.()}
						aria-label="Close Comparison"
						style="margin-left: auto; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: none; background: none; color: var(--color-text); cursor: pointer;"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				{:else}
					<!-- Compare pool button (proposals workspace only) -->
					{#if headerState.showComparePool}
						<ComparePoolHeaderButton labels={page.data.labels ?? []} />
					{/if}

					<!-- Bell: same class as default mode -->
					<button
						type="button"
						class="topbar-bell"
						aria-label={m.notification_title()}
						onclick={() => headerState.onToggleNotificationPanel?.()}
					>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
							<path d="M13.73 21a2 2 0 0 1-3.46 0" />
						</svg>
						{#if headerState.notificationCount > 0}
							<span class="topbar-bell-dot">{headerState.notificationCount}</span>
						{/if}
					</button>
				{/if}
			{:else}
				<!-- ── Default mode (feed, other pages) ── -->
				<button
					type="button"
					class="topbar-burger"
					onclick={() => (drawerOpen = true)}
					aria-label="Open menu"
				>
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					>
						<line x1="3" y1="5" x2="17" y2="5" />
						<line x1="3" y1="10" x2="17" y2="10" />
						<line x1="3" y1="15" x2="17" y2="15" />
					</svg>
				</button>
				<a href={localizePath(homePath)} class="brand">{m.nav_brand()}</a>
				<button
					type="button"
					class="topbar-bell"
					aria-label={m.notification_title()}
					onclick={() => (notificationPanelOpen = true)}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
						<path d="M13.73 21a2 2 0 0 1-3.46 0" />
					</svg>
					{#if headerState.notificationCount > 0}
						<span class="topbar-bell-dot">{headerState.notificationCount}</span>
					{/if}
				</button>
			{/if}
		</header>
	{/if}

	<main class="page-wrap" class:no-chrome={isProposalsRoute || isAuthPage}>
		{@render children()}
	</main>

	{#if !isAuthPage && !isProposalsRoute && headerState.mode !== 'question'}
		<SideDrawer
			open={drawerOpen}
			onClose={() => (drawerOpen = false)}
			user={data.user}
			questionTitle=""
			userGroups={data.userGroups}
			surveyUnlocked={data.surveyUnlocked}
			surveyCompleted={data.surveyCompleted}
		/>
		<NotificationPanel
			open={notificationPanelOpen}
			onClose={() => (notificationPanelOpen = false)}
			pushLogs={data.notifications?.pushLogs ?? []}
		/>
		<IosInstallPrompt />
		<PushPermissionBanner />
	{/if}

	{#if dev && isAdmin}
		<aside class="dev-sim-hover" class:open={isSimulatorOpen} aria-label="Simulator quick access">
			<button
				type="button"
				class="dev-sim-trigger"
				onclick={() => {
					isSimulatorOpen = !isSimulatorOpen;
				}}
				aria-expanded={isSimulatorOpen}
				aria-controls="dev-sim-modal"
			>
				{m.nav_simulator()}
			</button>
			<DevSimulatorModal
				open={isSimulatorOpen}
				{preferredQuestionId}
				canStartOnRoute={canStartSimulationOnRoute}
				onClose={() => {
					isSimulatorOpen = false;
				}}
			/>
		</aside>
	{/if}
</div>
