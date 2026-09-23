export interface SwipeOptions {
	threshold?: number;
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	disabled?: boolean;
	flyOutOnLeft?: boolean;
	flyOutOnRight?: boolean;
}

export function swipeToDismiss(node: HTMLElement, options: SwipeOptions) {
	let {
		threshold = 65,
		onSwipeLeft,
		onSwipeRight,
		disabled = false,
		flyOutOnLeft = true,
		flyOutOnRight = false
	} = options;

	let isSwiping = false;
	let hasCapturedPointer = false;
	let startX = 0;
	let startY = 0;
	let startTime = 0;
	let offset = 0;

	let ticking = false;

	const wrapper = node.parentElement;

	function updateDOM() {
		ticking = false;

		// Move the card
		node.style.transform = `translateX(${offset}px)`;
		node.style.transition = isSwiping ? 'none' : 'transform 0.2s ease-out';

		if (isSwiping) {
			node.classList.add('is-swiping');
		} else {
			node.classList.remove('is-swiping');
		}

		if (wrapper) {
			const progress = Math.min(1, Math.abs(offset) / (threshold * 0.7));
			wrapper.style.setProperty('--swipe-progress', progress.toString());
			wrapper.style.setProperty('--swipe-offset', offset.toString() + 'px');

			let action = 'none';
			if (offset < -threshold * 0.7) {
				action = 'left';
			} else if (offset > threshold * 0.7) {
				action = 'right';
			}
			wrapper.setAttribute('data-swipe-action', action);
		}
	}

	function requestUpdate() {
		if (!ticking) {
			requestAnimationFrame(updateDOM);
			ticking = true;
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (disabled || !e.isPrimary) return;

		// Protect interactive elements inside the card
		const target = e.target as HTMLElement | null;
		const closestInteractive = target?.closest(
			'button, a, input, select, textarea, [role="button"], .pc-action-btn, .pc-chip, .clickable, label'
		);

		// Ignore if the matched element is the card's main link wrapper itself
		if (closestInteractive && !closestInteractive.classList.contains('pc-card-link-wrapper')) {
			return;
		}

		isSwiping = true;
		hasCapturedPointer = false;
		startX = e.clientX;
		startY = e.clientY;
		startTime = performance.now();
		offset = 0;

		requestUpdate();
	}

	function onPointerMove(e: PointerEvent) {
		if (!isSwiping) return;

		const deltaX = e.clientX - startX;
		const deltaY = e.clientY - startY;
		const absX = Math.abs(deltaX);
		const absY = Math.abs(deltaY);

		if (!hasCapturedPointer) {
			// Lock out horizontal swipe if initial movement is vertical scroll
			if (absY > 8 && absY >= absX) {
				isSwiping = false;
				offset = 0;
				requestUpdate();
				return;
			}
			// Require clear horizontal intent before capturing pointer
			if (absX > 14 && absX > 1.8 * absY) {
				hasCapturedPointer = true;
				try {
					node.setPointerCapture(e.pointerId);
				} catch {
					// Safe fallback if setPointerCapture unsupported
				}
			} else {
				return;
			}
		}

		// Apply elastic dampening past threshold
		if (absX > threshold) {
			const overflow = absX - threshold;
			offset = Math.sign(deltaX) * (threshold + overflow * 0.35);
		} else {
			offset = deltaX;
		}

		requestUpdate();
	}

	function onPointerUp(e: PointerEvent) {
		if (!isSwiping) return;
		isSwiping = false;

		const deltaTime = performance.now() - startTime;
		const velocityX = Math.abs(offset) / (deltaTime || 1); // px/ms
		const isFlick = velocityX > 0.4 && Math.abs(offset) > 25;

		let didAction = false;

		const commitLeft = () => {
			didAction = true;
			if (flyOutOnLeft) {
				offset = -window.innerWidth;
				requestUpdate();
				if (onSwipeLeft) setTimeout(onSwipeLeft, 200);
			} else {
				offset = 0;
				requestUpdate();
				if (onSwipeLeft) onSwipeLeft();
			}
		};

		const commitRight = () => {
			didAction = true;
			if (flyOutOnRight) {
				offset = window.innerWidth;
				requestUpdate();
				if (onSwipeRight) setTimeout(onSwipeRight, 200);
			} else {
				offset = 0;
				requestUpdate();
				if (onSwipeRight) onSwipeRight();
			}
		};

		if (offset < -threshold * 0.7 || (isFlick && offset < 0)) {
			commitLeft();
		} else if (offset > threshold * 0.7 || (isFlick && offset > 0)) {
			commitRight();
		}

		if (!didAction) {
			offset = 0;
			requestUpdate();
		}

		if (hasCapturedPointer) {
			try {
				node.releasePointerCapture(e.pointerId);
			} catch {}
			hasCapturedPointer = false;
		}
	}

	function onPointerCancel(e: PointerEvent) {
		isSwiping = false;
		offset = 0;
		requestUpdate();
		if (hasCapturedPointer) {
			try {
				node.releasePointerCapture(e.pointerId);
			} catch {}
			hasCapturedPointer = false;
		}
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerCancel);

	return {
		update(newOptions: SwipeOptions) {
			threshold = newOptions.threshold ?? 65;
			onSwipeLeft = newOptions.onSwipeLeft;
			onSwipeRight = newOptions.onSwipeRight;
			disabled = newOptions.disabled ?? false;
			flyOutOnLeft = newOptions.flyOutOnLeft ?? true;
			flyOutOnRight = newOptions.flyOutOnRight ?? false;
		},
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerCancel);
		}
	};
}
