import { goto, preloadData, pushState } from '$app/navigation';
import { page } from '$app/state';
import { localizePath } from './i18n-path';

export async function openProposalModal(e: MouseEvent, href: string) {
	if (e.shiftKey || e.metaKey || e.ctrlKey) return;

	e.preventDefault();
	const localizedHref = localizePath(href);

	try {
		const result = await preloadData(localizedHref);

		// Deduce the current tab to return to
		const segments = page.url.pathname.split('/').filter(Boolean);
		let currentTab = segments[segments.length - 1] || 'ballot';
		if (currentTab === 'ideas') currentTab = 'discover';

		if (result.type === 'loaded' && 'status' in result && result.status === 200) {
			pushState(localizedHref, { proposalModalData: result.data, fromTab: currentTab });
		} else {
			void goto(localizedHref);
		}
	} catch (err) {
		void goto(localizedHref);
	}
}

export async function navigateToProposal(href: string) {
	const localizedHref = localizePath(href);
	const result = await preloadData(localizedHref);

	const segments = page.url.pathname.split('/').filter(Boolean);
	let currentTab = segments[segments.length - 1] || 'ballot';
	if (currentTab === 'ideas') currentTab = 'discover';

	if (result.type === 'loaded' && 'status' in result && result.status === 200) {
		pushState(localizedHref, { proposalModalData: result.data, fromTab: currentTab });
	} else {
		void goto(localizedHref);
	}
}
let hasNavigated = false;

export function setHasNavigated() {
	hasNavigated = true;
}

export function getHasNavigated() {
	return hasNavigated;
}

export function goBackWithFallback(fallbackUrl: string) {
	if (typeof window === 'undefined') return;

	if (hasNavigated) {
		window.history.back();
	} else {
		void goto(localizePath(fallbackUrl));
	}
}
