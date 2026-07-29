import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { querySelectorAllDeep } from '../dom/deep-query';
import { isTurnstileVisible } from '../dom/visibility';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

export interface RawTurnstileHit {
	sitekey: string;
	action?: string;
	cData?: string;
	chlPageData?: string;
}

/**
 * Ported from `detector.ts:2935-3067` (`detectTurnstile`), DOM-detection
 * portion only. Two things are load-bearing here (implementation plan,
 * finding 1.2-D and the regression checklist):
 *  - MUST use `querySelectorAllDeep`, not `document.querySelectorAll` - a
 *    prior build used the latter and silently missed shadow-rendered
 *    widgets (closed shadow roots are additionally widened to open by the
 *    top-frame-only hook script - see `hooks/init-script.ts`).
 *  - MUST use `isTurnstileVisible` (computed style only), not the stricter
 *    `isVisible` (which also requires a non-zero bounding rect and would
 *    drop legitimate zero-size / pre-render Turnstile containers).
 *
 * Deliberately NOT ported: the stale-duplicate suppression at
 * `detector.ts:2960-2971`, which mutates the page (`display:none`,
 * `aria-hidden`) - a detect-only node must not do that. Duplicates are
 * handled by the dedupe key instead (`libs/dedupe.ts`).
 *
 * Also skips Cloudflare's own challenge/interstitial context
 * (`isIgnoredChallengePage`/`isSandboxedCloudflareChallengeSubframe` in the
 * source), so the anti-bot interstitial itself is never misreported as a
 * "Turnstile widget to solve".
 */
function detectTurnstileInPage(): RawTurnstileHit[] {
	const querySelectorAllDeepFn = querySelectorAllDeep as any;
	const isTurnstileVisibleFn = isTurnstileVisible as any;

	const isIgnoredChallengePage = (): boolean => {
		if (document.title === 'Just a moment...') return true;
		if (document.querySelector('#challenge-form, #cf-challenge-running, #challenge-running, .cf-challenge')) {
			return true;
		}
		if ((window as any)._cf_chl_opt) return true;
		return !!document.querySelector(
			'script[src*="/cdn-cgi/challenge-platform/"][src*="orchestrate/chl_page"]',
		);
	};

	const isSandboxedCloudflareChallengeSubframe = (): boolean => {
		try {
			if (window.top === window) return false;
		} catch {
			return false;
		}
		if (window.location.href !== 'about:blank') return false;
		return (
			!!document.querySelector('.cf-turnstile, .main-wrapper, #challenge-form, .cf-challenge') ||
			document.referrer.includes('/cdn-cgi/challenge-platform/')
		);
	};

	if (isSandboxedCloudflareChallengeSubframe() || isIgnoredChallengePage()) return [];

	const containers: HTMLElement[] = querySelectorAllDeepFn('.cf-turnstile[data-sitekey]').filter(
		(el: any) => isTurnstileVisibleFn(el),
	);

	const results: RawTurnstileHit[] = [];
	const seen = new Set<string>();

	for (const el of containers) {
		const sitekey = el.getAttribute('data-sitekey');
		if (!sitekey) continue;
		if (seen.has(sitekey)) continue;
		seen.add(sitekey);
		results.push({
			sitekey,
			action: el.getAttribute('data-action') || undefined,
			cData: el.getAttribute('data-cdata') || undefined,
			chlPageData: el.getAttribute('data-pagedata') || undefined,
		});
	}

	return results;
}

export async function detectTurnstileDom(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<{ raw: RawTurnstileHit[]; detections: RawDetection[] }> {
	if (!enabledTypes.has('turnstile')) return { raw: [], detections: [] };

	const script = composeBrowserScript(
		[querySelectorAllDeep, isTurnstileVisible],
		detectTurnstileInPage,
		undefined,
	);
	const raw = (await frame.evaluate(script)) as RawTurnstileHit[];

	const detections: RawDetection[] = raw.map((hit) => turnstileHitToDetection(hit, pageurl));
	return { raw, detections };
}

export function turnstileHitToDetection(hit: RawTurnstileHit, pageurl: string): RawDetection {
	return {
		type: 'turnstile',
		source: 'dom',
		sitekey: hit.sitekey,
		action: hit.action ?? null,
		solveParams: {
			method: 'turnstile',
			sitekey: hit.sitekey,
			pageurl,
			...(hit.action ? { action: hit.action } : {}),
			...(hit.cData ? { data: hit.cData } : {}),
			...(hit.chlPageData ? { pagedata: hit.chlPageData } : {}),
		},
	};
}
