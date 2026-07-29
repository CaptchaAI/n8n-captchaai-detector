import type { Page } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import { CaptchaFoxNetworkWatcher } from '../hooks/network';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface TriggerRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Ported from `findCaptchaFoxContainer` (detector.ts:3927-3950) and
 * `findCaptchaFoxTrigger` (detector.ts:3952-3967). Returns the trigger
 * element's viewport rect (for a page-level mouse click) or `null` if no
 * CaptchaFox container is present at all.
 */
function findCaptchaFoxTriggerRectInPage(): TriggerRect | null {
	const isVisibleFn = isVisible as any;

	function findCaptchaFoxContainer(): Element | null {
		const selectors = [
			'[data-captchafox]',
			'[data-captchafox-sitekey]',
			'[class*="captchafox" i]',
			'iframe[src*="captchafox.com"]',
			'input[name="cf-captcha-response"]',
			'textarea[name="cf-captcha-response"]',
			'input[name="cf_captcha_response"]',
			'textarea[name="cf_captcha_response"]',
			'input[name="captchafox-response"]',
			'textarea[name="captchafox-response"]',
		];
		for (const selector of selectors) {
			const element = document.querySelector(selector);
			if (!element) continue;
			return element instanceof HTMLIFrameElement
				? element.closest('[data-sitekey], form, div') || element
				: element;
		}
		return null;
	}

	function findCaptchaFoxTrigger(container: Element | null): Element | null {
		const root: ParentNode = container || document;
		const selectors = ['input[type="checkbox"]', 'button', '[role="checkbox"]', '[tabindex]'];
		for (const selector of selectors) {
			const element = root.querySelector?.(selector);
			if (element && isVisibleFn(element)) return element;
		}
		return container && isVisibleFn(container) ? container : null;
	}

	const container = findCaptchaFoxContainer();
	if (!container) return null;

	const trigger = findCaptchaFoxTrigger(container);
	if (!trigger) return null;

	const rect = trigger.getBoundingClientRect();
	return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function stripPageUrl(pageurl: string): string {
	try {
		const url = new URL(pageurl);
		url.hash = '';
		url.search = '';
		return url.href;
	} catch {
		return pageurl.split('#')[0].split('?')[0];
	}
}

/**
 * The CaptchaFox sitekey is never in the DOM - it only appears as a path
 * segment on `api.captchafox.com/captcha/{sitekey}/challenge`
 * (`hooks/network.ts`), and that request usually only fires after a click on
 * the widget (ported from `triggerCaptchaFoxLearningIfNeeded`,
 * detector.ts:3969-3994). This is the second documented exception to the
 * otherwise-passive detection stance (the first being the `attachShadow`
 * widening in the hook init script) - see the implementation plan §5 and
 * §10. Only runs in the top frame (`isTopFrame` guard, detector.ts:3970) and
 * only when `captchafox` is an enabled type.
 */
export async function detectCaptchaFox(
	page: Page,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
	networkWatcher: CaptchaFoxNetworkWatcher,
): Promise<RawDetection[]> {
	if (!enabledTypes.has('captchafox')) return [];

	const topFrame = page.mainFrame();
	const script = composeBrowserScript([isVisible], findCaptchaFoxTriggerRectInPage, undefined);

	let rect: TriggerRect | null;
	try {
		rect = (await topFrame.evaluate(script)) as TriggerRect | null;
	} catch {
		return [];
	}

	if (!rect) return [];

	if (!networkWatcher.getSitekey() && rect.width > 0 && rect.height > 0) {
		try {
			await page.mouse.click(rect.left + rect.width / 2, rect.top + rect.height / 2);
		} catch {
			// ignore - container may have detached between evaluate and click
		}

		const deadline = Date.now() + 3000;
		while (Date.now() < deadline && !networkWatcher.getSitekey()) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	const sitekey = networkWatcher.getSitekey();
	const solvePageUrl = stripPageUrl(pageurl);

	if (!sitekey) {
		return [
			{
				type: 'captchafox',
				source: 'network',
				sitekey: null,
				presenceOnly: true,
				solveParams: {
					method: 'captchafox',
					pageurl: solvePageUrl,
				},
			},
		];
	}

	return [
		{
			type: 'captchafox',
			source: 'network',
			sitekey,
			solveParams: {
				method: 'captchafox',
				sitekey,
				pageurl: solvePageUrl,
			},
		},
	];
}
