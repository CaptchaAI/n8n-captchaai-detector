import type { Page, Request } from 'playwright';

/**
 * Ported from `extractCaptchaFoxSitekeyFromChallengeUrl()`
 * (detector.ts:3874-3890). The sitekey is never in the DOM - it only shows up
 * as a path segment on this network request, which usually only fires after
 * a click on the widget (see `detectors/captchafox.ts`).
 */
export function extractCaptchaFoxSitekeyFromUrl(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl);
		if (!/api\.captchafox\.com$/i.test(url.hostname)) return null;
		const match = url.pathname.match(/\/captcha\/([^/]+)\/challenge(?:\/|$)/i);
		if (!match?.[1]) return null;
		return decodeURIComponent(match[1]).trim() || null;
	} catch {
		const match = rawUrl.match(/api\.captchafox\.com\/captcha\/([^/?#]+)\/challenge/i);
		if (!match?.[1]) return null;
		try {
			return decodeURIComponent(match[1]).trim() || null;
		} catch {
			return match[1].trim() || null;
		}
	}
}

/**
 * Watches every request on the page for the CaptchaFox challenge URL for the
 * whole run (attached before navigation), so a sitekey learned at any point -
 * including from the deliberate trigger click in `detectors/captchafox.ts` -
 * is available when detection results are assembled.
 */
export class CaptchaFoxNetworkWatcher {
	private sitekey: string | null = null;

	private readonly handler = (request: Request): void => {
		const found = extractCaptchaFoxSitekeyFromUrl(request.url());
		if (found) this.sitekey = found;
	};

	constructor(private readonly page: Page) {
		page.on('request', this.handler);
	}

	getSitekey(): string | null {
		return this.sitekey;
	}

	dispose(): void {
		this.page.off('request', this.handler);
	}
}
