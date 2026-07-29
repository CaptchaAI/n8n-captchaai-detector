import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import { parseRenderSitekeyFromScriptSrc } from './recaptcha-v3';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface RawRecaptchaV2Hit {
	sitekey: string;
	invisible: boolean;
	enterprise: boolean;
}

/**
 * Self-contained browser-side detector. Ported from `detector.ts:2562-2757`
 * (`detectRecaptchaV2`), DOM-detection portion only (the solve/queueing
 * machinery is dropped - this node never solves).
 *
 * Runs in EVERY frame (see the implementation plan §4.2) - this is a plain
 * function declaration composed with `isVisible` via `composeBrowserScript`,
 * so it must not reference anything outside its own body except that helper.
 */
function detectRecaptchaV2InPage(): RawRecaptchaV2Hit[] {
	const isVisibleFn = isVisible as any;
	const parseRenderSitekeyFromScriptSrcFn = parseRenderSitekeyFromScriptSrc as any;

	const v3RenderSitekeys = new Set<string>();
	for (const script of Array.from(
		document.querySelectorAll<HTMLScriptElement>(
			'script[src*="recaptcha/api.js"], script[src*="recaptcha/enterprise.js"]',
		),
	)) {
		const src = script.getAttribute('src') || '';
		const hit = parseRenderSitekeyFromScriptSrcFn(src) as { sitekey: string } | null;
		if (hit?.sitekey) v3RenderSitekeys.add(hit.sitekey);
	}

	const hasTurnstileCompatRecaptcha =
		document.querySelector(
			'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"][src*="compat=recaptcha"]',
		) !== null;
	const hasNativeRecaptchaScript =
		document.querySelector('script[src*="recaptcha/api.js"], script[src*="recaptcha/enterprise.js"]') !==
		null;

	// Turnstile reCAPTCHA-compat pages expose grecaptcha-like markup, but must
	// be solved via Turnstile, not reCAPTCHA v2 (detector.ts:2566-2575).
	if (hasTurnstileCompatRecaptcha && !hasNativeRecaptchaScript) return [];

	const enterpriseAutoDetected = document.querySelector('script[src*="enterprise"]') !== null;
	const results: RawRecaptchaV2Hit[] = [];
	const seen = new Set<string>();

	function urlHasInvisibleRecaptchaSize(href: string): boolean {
		return /[?&]size=invisible(?:&|$)/i.test(href);
	}

	function pageUrlIndicatesInvisibleRecaptchaV2(): boolean {
		try {
			return /[?&]invisible=true(?:&|$)/i.test(window.location.href);
		} catch {
			return false;
		}
	}

	function anchorIframeIsInvisibleForSitekey(sitekey: string): boolean {
		const iframes = Array.from(
			document.querySelectorAll<HTMLIFrameElement>(
				'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]',
			),
		);
		for (const iframe of iframes) {
			const src = iframe.getAttribute('src') || '';
			if (!urlHasInvisibleRecaptchaSize(src)) continue;
			const match = src.match(/[?&]k=([^&]+)/);
			if (!match) continue;
			let key = match[1];
			try {
				key = decodeURIComponent(key);
			} catch {
				// keep raw
			}
			if (key === sitekey) return true;
		}
		return false;
	}

	function resolveInvisibleV2(sitekey: string, dataSize: string | null): boolean {
		if (dataSize === 'invisible') return true;
		if (anchorIframeIsInvisibleForSitekey(sitekey)) return true;
		if (pageUrlIndicatesInvisibleRecaptchaV2()) return true;
		return false;
	}

	const divCandidates = Array.from(
		document.querySelectorAll<HTMLElement>(
			'.g-recaptcha[data-sitekey], div[data-sitekey][data-size], div[data-sitekey][data-callback], div[data-sitekey][data-expired-callback], div[data-sitekey][data-theme]',
		),
	).filter((el) => {
		const sitekey = el.getAttribute('data-sitekey');
		if (!sitekey) return false;
		const isInvisible = resolveInvisibleV2(sitekey, el.getAttribute('data-size'));
		if (!isInvisible && !isVisibleFn(el)) return false;
		if (el.classList.contains('cf-turnstile') || el.closest('.cf-turnstile')) return false;
		if (el.classList.contains('h-captcha') || el.closest('.h-captcha')) return false;
		if (!isInvisible && el.closest('.grecaptcha-badge')) return false;
		return true;
	});

	for (const el of divCandidates) {
		const sitekey = el.getAttribute('data-sitekey');
		if (!sitekey) continue;
		const isInvisible = resolveInvisibleV2(sitekey, el.getAttribute('data-size'));
		// Pure v3 `?render=SITEKEY` pages must not emit v2 for the same key (detector.ts uses v3 script keys for iframe skips).
		if (v3RenderSitekeys.has(sitekey) && !isInvisible) continue;
		const dedupeKey = `${sitekey}:${isInvisible ? 'inv' : 'std'}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		results.push({ sitekey, invisible: isInvisible, enterprise: enterpriseAutoDetected });
	}

	// Fallback: explicit anchor iframes not already tied to a visible container (detector.ts:2599-2607).
	const iframes = Array.from(
		document.querySelectorAll<HTMLIFrameElement>(
			'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]',
		),
	).filter((iframe) => {
		const src = iframe.getAttribute('src') || '';
		const isInvisible = urlHasInvisibleRecaptchaSize(src);
		if (!isInvisible && !isVisibleFn(iframe)) return false;
		if (iframe.closest('.g-recaptcha[data-sitekey]')) {
			// Invisible anchors often sit inside `.g-recaptcha` while the container omits `data-size="invisible"`.
			if (!isInvisible) return false;
		}
		return true;
	});

	for (const iframe of iframes) {
		const src = iframe.getAttribute('src') || '';
		const match = src.match(/[?&]k=([^&]+)/);
		if (!match) continue;
		let sitekey: string;
		try {
			sitekey = decodeURIComponent(match[1]);
		} catch {
			sitekey = match[1];
		}
		const isInvisible = urlHasInvisibleRecaptchaSize(src);
		const hasExplicitV2Container = !!document.querySelector(
			`.g-recaptcha[data-sitekey="${CSS.escape(sitekey)}"]`,
		);
		// V3 badge uses the same invisible anchor iframe pattern (detector.ts:2688-2693).
		if (isInvisible && v3RenderSitekeys.has(sitekey) && !hasExplicitV2Container) continue;

		const enterprise = enterpriseAutoDetected || src.includes('enterprise');
		const dedupeKey = `${sitekey}:${isInvisible ? 'inv' : 'std'}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		results.push({ sitekey, invisible: isInvisible, enterprise });
	}

	return results;
}

export async function detectRecaptchaV2(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<RawDetection[]> {
	if (
		!enabledTypes.has('recaptcha_v2') &&
		!enabledTypes.has('recaptcha_v2_invisible') &&
		!enabledTypes.has('recaptcha_v2_enterprise')
	) {
		return [];
	}

	const script = composeBrowserScript(
		[isVisible, parseRenderSitekeyFromScriptSrc],
		detectRecaptchaV2InPage,
		undefined,
	);
	const hits = (await frame.evaluate(script)) as RawRecaptchaV2Hit[];

	const out: RawDetection[] = [];
	for (const hit of hits) {
		// A widget that is both invisible and enterprise is classified as
		// enterprise here - matching the *solver's own* `captchaType`
		// assignment order in `recaptcha-v2.ts:35-37` (`if (invisible) ...; if
		// (enterprise) ...;` - enterprise is set last and wins), rather than
		// the *stats-reporting* ternary elsewhere in the extension
		// (`detector.ts:2641`) which prioritizes invisible instead. The two
		// are genuinely inconsistent in the source; this picks the one that
		// reflects what the actual solve API call would be for this widget.
		// Both flags are still reported on the item regardless of `type`.
		const type: CaptchaTypeName = hit.enterprise
			? 'recaptcha_v2_enterprise'
			: hit.invisible
				? 'recaptcha_v2_invisible'
				: 'recaptcha_v2';

		if (!enabledTypes.has(type)) continue;

		out.push({
			type,
			source: 'dom',
			sitekey: hit.sitekey,
			invisible: hit.invisible,
			enterprise: hit.enterprise,
			solveParams: {
				method: 'userrecaptcha',
				googlekey: hit.sitekey,
				pageurl,
				...(hit.invisible ? { invisible: 1 } : {}),
				...(hit.enterprise ? { enterprise: 1 } : {}),
			},
		});
	}

	return out;
}
