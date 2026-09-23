import { localizeHref } from '$lib/paraglide/runtime.js';

/**
 * Locale-aware path helper.
 * Wraps Paraglide's `localizeHref()` to prefix internal paths
 * with the current locale when needed (e.g., `/de/groups`).
 *
 * Usage: replace `href="/some/path"` with `href={localizePath('/some/path')}`
 */
export function localizePath(path: string): string {
	return localizeHref(path);
}
