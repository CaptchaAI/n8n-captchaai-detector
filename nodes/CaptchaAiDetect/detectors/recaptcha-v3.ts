import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import type { CaptchaTypeName, CaptchaaiDetectHookStore, RawDetection } from '../libs/types';

/**
 * reCAPTCHA v3 has THREE independent sources, all wired to output - this is
 * where a prior build regressed (captured render-hook data but never
 * emitted it). See the implementation plan §5.
 *
 * Sources 1 (execute hook) and 2 (render hook) are TOP-FRAME ONLY (the hook
 * init script never installs in a subframe - implementation plan §4.3), so
 * they are processed once from the hook store, not per frame. Source 3
 * (script-tag `?render=`) is DOM-based and runs in EVERY frame.
 */

/**
 * Source 1 + 2: classify every captured `grecaptcha.execute()` /
 * `grecaptcha.render()` call from the top-frame hook store.
 *
 * A `size: 'invisible'` render is reCAPTCHA v2 invisible, not v3 - ported
 * from the extension's own render-hook branching in
 * `detector.ts:4646` (`data.sitekey && data.size === 'invisible'`). Rather
 * than silently drop that signal (the DOM-only `detectRecaptchaV2` has no
 * way to see it for JS-only renders with no `data-*` attributes on the
 * container), it is classified here as `recaptcha_v2_invisible` so a widget
 * that is only ever discoverable via the render hook is still reported.
 *
 * `grecaptcha.execute()` is only ever called with a real sitekey STRING for
 * v3 - v2-invisible's own `execute(widgetId)` call passes a numeric widget
 * ID, which the hook init script already filters out
 * (`hooks/init-script.ts`, `typeof sitekeyOrWidgetId === 'string'`). So
 * every entry in `recaptchaExecute` is safely v3/v3-enterprise.
 */
export function processRecaptchaHookStore(
	store: CaptchaaiDetectHookStore | null,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): RawDetection[] {
	if (!store) return [];
	const out: RawDetection[] = [];
	const seen = new Set<string>();

	for (const entry of store.recaptchaExecute) {
		if (!entry.sitekey) continue;
		const type: CaptchaTypeName = entry.enterprise ? 'recaptcha_v3_enterprise' : 'recaptcha_v3';
		if (!enabledTypes.has(type)) continue;
		const dedupeKey = `execute:${type}:${entry.sitekey}:${entry.action || ''}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		out.push(buildV3Detection(type, entry.sitekey, entry.action || 'verify', entry.enterprise, pageurl));
	}

	for (const entry of store.recaptchaRender) {
		if (!entry.sitekey) continue;

		if (entry.size === 'invisible') {
			if (!enabledTypes.has('recaptcha_v2_invisible')) continue;
			const dedupeKey = `render-v2inv:${entry.sitekey}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			out.push({
				type: 'recaptcha_v2_invisible',
				source: 'hook',
				sitekey: entry.sitekey,
				invisible: true,
				enterprise: entry.enterprise,
				solveParams: {
					method: 'userrecaptcha',
					googlekey: entry.sitekey,
					pageurl,
					invisible: 1,
					...(entry.enterprise ? { enterprise: 1 } : {}),
				},
			});
			continue;
		}

		const type: CaptchaTypeName = entry.enterprise ? 'recaptcha_v3_enterprise' : 'recaptcha_v3';
		if (!enabledTypes.has(type)) continue;
		const dedupeKey = `render:${type}:${entry.sitekey}:${entry.action || ''}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		out.push(buildV3Detection(type, entry.sitekey, entry.action || 'verify', entry.enterprise, pageurl));
	}

	return out;
}

function buildV3Detection(
	type: CaptchaTypeName,
	sitekey: string,
	action: string,
	enterprise: boolean,
	pageurl: string,
): RawDetection {
	return {
		type,
		source: 'hook',
		sitekey,
		action,
		enterprise,
		solveParams: {
			method: 'userrecaptcha',
			googlekey: sitekey,
			pageurl,
			version: 'v3',
			action,
			...(enterprise ? { enterprise: 1 } : {}),
		},
	};
}

interface RawScriptTagHit {
	sitekey: string;
	enterprise: boolean;
}

/**
 * Ported from `getRecaptchaV3RenderSitekeys()` (detector.ts:2542-2560):
 * parses a single script tag's `src` for a usable `?render=` sitekey.
 * Returns `null` for `render=explicit` (that marks a v2-explicit-render
 * page, not v3) or when no `render` param is present at all.
 *
 * Improvement over source (flagged, not silent - implementation plan §5):
 * the extension pools `api.js` and `enterprise.js` sitekeys into one
 * flag-less `Set`, losing the enterprise distinction entirely. This port
 * keeps the classification per script tag, so `enterprise.js?render=K`
 * correctly emits `recaptcha_v3_enterprise` instead of plain `recaptcha_v3`.
 *
 * Standalone, DOM-free - exported for both the compose bundle (see
 * `detectRecaptchaV3ScriptTagInPage`) and direct tier-1 unit testing.
 */
export function parseRenderSitekeyFromScriptSrc(src: string): RawScriptTagHit | null {
	const match = src.match(/[?&]render=([^&]+)/);
	if (!match) return null;

	let renderVal: string;
	try {
		renderVal = decodeURIComponent(match[1]).trim();
	} catch {
		renderVal = match[1].trim();
	}
	if (!renderVal || renderVal.toLowerCase() === 'explicit') return null;

	return { sitekey: renderVal, enterprise: src.includes('enterprise') };
}

/**
 * Source 3: `?render=SITEKEY` script-tag parse, ported from
 * `getRecaptchaV3RenderSitekeys()` (detector.ts:2542-2560). DOM-based, runs
 * in every frame.
 */
function detectRecaptchaV3ScriptTagInPage(): RawScriptTagHit[] {
	const parseRenderSitekeyFromScriptSrcFn = parseRenderSitekeyFromScriptSrc as any;

	const scripts = Array.from(
		document.querySelectorAll<HTMLScriptElement>('script[src*="recaptcha/api.js"], script[src*="recaptcha/enterprise.js"]'),
	);
	const results: RawScriptTagHit[] = [];
	const seen = new Set<string>();

	for (const script of scripts) {
		const src = script.getAttribute('src') || '';
		const hit = parseRenderSitekeyFromScriptSrcFn(src) as RawScriptTagHit | null;
		if (!hit) continue;

		const dedupeKey = `${hit.sitekey}:${hit.enterprise}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		results.push(hit);
	}

	return results;
}

export async function detectRecaptchaV3ScriptTag(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<RawDetection[]> {
	if (!enabledTypes.has('recaptcha_v3') && !enabledTypes.has('recaptcha_v3_enterprise')) return [];

	const script = composeBrowserScript([parseRenderSitekeyFromScriptSrc], detectRecaptchaV3ScriptTagInPage, undefined);
	const hits = (await frame.evaluate(script)) as RawScriptTagHit[];

	const out: RawDetection[] = [];
	for (const hit of hits) {
		const type: CaptchaTypeName = hit.enterprise ? 'recaptcha_v3_enterprise' : 'recaptcha_v3';
		if (!enabledTypes.has(type)) continue;
		// Default action when only the script tag is known (matches recaptcha-v3.ts:27 in the extension).
		out.push(buildV3Detection(type, hit.sitekey, 'verify', hit.enterprise, pageurl));
	}
	return out;
}
