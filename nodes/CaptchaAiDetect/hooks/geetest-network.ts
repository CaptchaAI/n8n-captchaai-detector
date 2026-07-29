import type { Page, Response } from 'playwright';

export interface GeetestNetworkHit {
	gt: string;
	challenge: string;
	apiServer?: string;
}

const GEETEST_URL = /geetest\.com|gtimg\.com/i;

function extractGtFromUrl(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl);
		const gt = url.searchParams.get('gt');
		return gt?.trim() || null;
	} catch {
		const match = rawUrl.match(/[?&]gt=([^&]+)/i);
		if (!match?.[1]) return null;
		try {
			return decodeURIComponent(match[1]).trim() || null;
		} catch {
			return match[1].trim() || null;
		}
	}
}

function parseGeetestBody(body: string): { gt?: string; challenge?: string } | null {
	const trimmed = body.trim();
	if (!trimmed) return null;

	let jsonText = trimmed;
	const jsonp = trimmed.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
	if (jsonp?.[1]) jsonText = jsonp[1].trim();

	try {
		const data = JSON.parse(jsonText) as Record<string, unknown>;
		const challenge =
			typeof data.challenge === 'string'
				? data.challenge.trim()
				: typeof data.geetest_challenge === 'string'
					? data.geetest_challenge.trim()
					: '';
		const gt = typeof data.gt === 'string' ? data.gt.trim() : '';
		if (!challenge) return null;
		return { gt: gt || undefined, challenge };
	} catch {
		return null;
	}
}

/**
 * Captures GeeTest v3 `gt` + `challenge` from register/get XHR responses.
 * Many sites call `initGeetest` before the challenge exists; the extension
 * relies on the same hook timing — this watcher fills the gap for detect-only.
 */
export class GeetestNetworkWatcher {
	private readonly hits: GeetestNetworkHit[] = [];
	private readonly seen = new Set<string>();

	private readonly handler = async (response: Response): Promise<void> => {
		try {
			const url = response.url();
			if (!GEETEST_URL.test(url)) return;
			if (response.request().resourceType() !== 'xhr' && response.request().resourceType() !== 'fetch') {
				return;
			}
			const status = response.status();
			if (status < 200 || status >= 300) return;

			const body = await response.text().catch(() => '');
			const parsed = parseGeetestBody(body);
			if (!parsed?.challenge) return;

			const gt = parsed.gt || extractGtFromUrl(url);
			if (!gt) return;

			const dedupeKey = `${gt}::${parsed.challenge}`;
			if (this.seen.has(dedupeKey)) return;
			this.seen.add(dedupeKey);

			let apiServer: string | undefined;
			try {
				const host = new URL(url).hostname;
				if (host.endsWith('geetest.com')) {
					apiServer = `https://${host}/`;
				}
			} catch {
				// ignore
			}

			this.hits.push({ gt, challenge: parsed.challenge, apiServer });
		} catch {
			// ignore parse races on aborted responses
		}
	};

	constructor(private readonly page: Page) {
		page.on('response', this.handler);
	}

	getHits(): GeetestNetworkHit[] {
		return [...this.hits];
	}

	dispose(): void {
		this.page.off('response', this.handler);
	}
}
