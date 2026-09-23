<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages.js';
	import Button from '$lib/components/ui/Button.svelte';
	import { Smartphone, Share, X } from '@lucide/svelte';

	let showPrompt = $state(false);

	onMount(() => {
		// Detect iOS Safari
		const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
		const isSafari =
			/WebKit/i.test(navigator.userAgent) &&
			!/CriOS/i.test(navigator.userAgent) &&
			!/FxiOS/i.test(navigator.userAgent);

		// Detect if already installed (standalone mode)
		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			('standalone' in navigator && (navigator as any).standalone === true);

		// Show prompt if iOS Safari and not installed, and user hasn't dismissed it recently
		const dismissed = localStorage.getItem('ios_install_prompt_dismissed');
		if (isIos && isSafari && !isStandalone && !dismissed) {
			showPrompt = true;
		}
	});

	function dismiss() {
		showPrompt = false;
		localStorage.setItem('ios_install_prompt_dismissed', 'true');
	}
</script>

{#if showPrompt}
	<div class="ios-install-prompt">
		<div class="prompt-content">
			<span class="prompt-icon"><Smartphone size={24} /></span>
			<div class="prompt-text">
				<p><strong>Install App</strong></p>
				<p>
					Tap <span class="share-icon"><Share size={14} class="inline-icon" /></span> and
					<strong>Add to Home Screen</strong> to receive push notifications.
				</p>
			</div>
			<Button variant="icon" class="prompt-close" onclick={dismiss} aria-label="Dismiss"
				><X size={18} /></Button
			>
		</div>
	</div>
{/if}

<style>
	.ios-install-prompt {
		position: fixed;
		bottom: env(safe-area-inset-bottom, 20px);
		left: 50%;
		transform: translateX(-50%);
		width: 90%;
		max-width: 400px;
		background: color-mix(in srgb, var(--ink, #111) 95%, var(--paper, #fff));
		color: var(--paper, #fff);
		border-radius: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		z-index: var(--z-dropdown);
		padding: 12px 16px;
		animation: slideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}
	@keyframes slideUp {
		from {
			transform: translate(-50%, 150%);
		}
		to {
			transform: translate(-50%, 0);
		}
	}
	.prompt-content {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.prompt-icon {
		font-size: 1.5rem;
	}
	.prompt-text {
		flex: 1;
		font-size: 0.85rem;
		line-height: 1.35;
	}
	.prompt-text p {
		margin: 0;
	}
</style>
