/**
 * Two DIFFERENT visibility predicates, both ported verbatim from the
 * extension. Do not merge them - the difference is deliberate and load
 * bearing (see the implementation plan, finding 1.2-D).
 *
 * Self-contained function declarations only - see the note in
 * `dom/deep-query.ts` about why (Playwright evaluate serialization).
 */

/**
 * Standard visibility check, ported from `dom-helpers.ts:43-50`. Requires a
 * non-zero bounding rect IN ADDITION to computed style. Used for reCAPTCHA
 * v2 containers/iframes and other widgets that are truly absent from layout
 * when hidden.
 */
export function isVisible(element: Element): boolean {
	const style = window.getComputedStyle(element);
	if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
		return false;
	}
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

/**
 * Turnstile-specific visibility check, ported from `detector.ts:2937-2943`
 * (`getVisibleTurnstileContainers`). Deliberately omits the bounding-rect
 * check so zero-size / pre-render Turnstile containers still count as
 * "visible" - `isVisible()` above would silently drop them.
 */
export function isTurnstileVisible(element: Element): boolean {
	const style = window.getComputedStyle(element);
	return (
		style.display !== 'none' &&
		style.visibility !== 'hidden' &&
		style.opacity !== '0' &&
		(element as HTMLElement).dataset.caiTurnstileStale !== '1'
	);
}
