import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface RawLeminHit {
	captchaId: string;
	divId: string;
}

/**
 * Ported from `detector.ts:3520-3554` (`normalizeLeminCaptchaId`). Rejects
 * bundler/asset-path noise that would otherwise be picked up as a false
 * "captcha id" by the text-scraping patterns below. A standalone,
 * DOM-free function - exported both for the compose bundle (see
 * `detectLeminInPage`) and for direct tier-1 unit testing.
 */
export function normalizeLeminCaptchaId(value: string | null | undefined): string | null {
	if (!value) return null;
	let normalized = value.trim();
	if (!normalized) return null;
	try {
		normalized = decodeURIComponent(normalized);
	} catch {
		// keep raw value
	}
	normalized = normalized.trim();
	const lower = normalized.toLowerCase();
	const rejectedTokens = new Set([
		'api',
		'assets',
		'captcha',
		'challenge',
		'css',
		'dist',
		'image',
		'img',
		'js',
		'lemin',
		'leminnow',
		'puzzle',
		'static',
	]);
	if (rejectedTokens.has(lower)) return null;
	if (/^(?:bundle|chunk|index|main|script|style|vendor)(?:\.[a-z0-9_-]+)?$/i.test(normalized)) return null;
	if (/\.(?:css|gif|html?|ico|jpe?g|js|map|png|svg|webp)$/i.test(normalized)) return null;
	if (normalized.length < 8) return null;
	return normalized;
}

/**
 * Ported from `detector.ts:3570-3590` (`extractLeminCaptchaIdFromText`).
 * Standalone, DOM-free - see the note on `normalizeLeminCaptchaId` above.
 */
export function extractLeminCaptchaIdFromText(text: string): string | null {
	if (!text) return null;
	const patterns = [
		/\/(?:cropped|puzzle)\/([^/?#"')\s]+)/i,
		/(?:captcha[_-]?id|captchaId|puzzleId|lemin[_-]?(?:captcha[_-]?)?id)["']?\s*[:=]\s*["']([^"']+)["']/i,
		/(?:captcha[_-]?id|captchaId|puzzleId|lemin[_-]?(?:captcha[_-]?)?id)=([^&#"'\s]+)/i,
		/data-captcha-id=["']([^"']+)["']/i,
		/captcha-id=["']([^"']+)["']/i,
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]) {
			const captchaId = normalizeLeminCaptchaId(match[1]);
			if (captchaId) return captchaId;
		}
	}
	return null;
}

/**
 * Ported from `detector.ts:3285-3395` (`detectLemin`) and
 * `detector.ts:3477-3596` (`extractLeminCaptchaId`, `getLeminDivId`). The
 * retry-fallback timer chain (`LEMIN_DETECTION_FALLBACK_DELAYS_MS`) is
 * dropped - it exists in the extension to retry a MutationObserver-driven
 * live page; this node's `triggerSelector` re-poll (implementation plan
 * §4.4) is the one-shot equivalent for widgets that only appear after an
 * interaction.
 */
function detectLeminInPage(): RawLeminHit | null {
	const isVisibleFn = isVisible as any;

	function findNearestLeminHost(el: Element): HTMLElement | null {
		return (
			el.closest<HTMLElement>(
				'[id*="lemin" i], [class*="lemin" i], [data-captcha-id], [captcha-id], [data-lemin-id], [data-lemin-captcha-id], form',
			) ||
			document.querySelector<HTMLElement>('[id*="lemin" i], [class*="lemin" i], [data-captcha-id], [captcha-id]')
		);
	}

	function resolveLeminContainer(el: HTMLElement): HTMLElement | null {
		if (el instanceof HTMLScriptElement) return findNearestLeminHost(el);
		if (el instanceof HTMLImageElement || el instanceof HTMLIFrameElement || el instanceof HTMLCanvasElement) {
			return findNearestLeminHost(el) || el;
		}
		return el;
	}

	function getLeminExtractionElements(container: HTMLElement): HTMLElement[] {
		const elements = new Set<HTMLElement>([container]);
		const form = container.closest<HTMLElement>('form');
		if (form) elements.add(form);
		try {
			container.querySelectorAll<HTMLElement>('*').forEach((el) => elements.add(el));
		} catch {
			// ignore
		}
		return Array.from(elements);
	}

	function extractLeminCaptchaId(container: HTMLElement): string | null {
		const attributeNames = [
			'data-captcha-id',
			'captcha-id',
			'data-lemin-id',
			'data-lemin-captcha-id',
			'data-puzzle-id',
			'data-puzzle',
			'data-id',
			'captcha_id',
			'captchaId',
			'puzzleId',
		];

		for (const el of getLeminExtractionElements(container)) {
			for (const name of attributeNames) {
				const value = el.getAttribute(name);
				const captchaId = normalizeLeminCaptchaId(value);
				if (captchaId) return captchaId;
			}
			const fromDataset = extractLeminCaptchaIdFromText(Object.values(el.dataset || {}).join('\n'));
			if (fromDataset) return fromDataset;
			const fromText = extractLeminCaptchaIdFromText(
				[
					el.getAttribute('src') || '',
					el.getAttribute('href') || '',
					el.getAttribute('data-src') || '',
					el.getAttribute('data-url') || '',
					el.getAttribute('data-captcha-url') || '',
					el.getAttribute('style') || '',
				].join('\n'),
			);
			if (fromText) return fromText;
		}

		for (const script of Array.from(document.scripts)) {
			const fromScript = extractLeminCaptchaIdFromText(`${script.src || ''}\n${script.textContent || ''}`);
			if (fromScript) return fromScript;
		}

		return extractLeminCaptchaIdFromText(document.documentElement.innerHTML.slice(0, 250_000));
	}

	function getLeminDivId(container: HTMLElement): string {
		if (container.id) return container.id;
		const childWithId = container.querySelector<HTMLElement>('[id*="lemin" i], [id*="captcha" i]');
		return childWithId?.id || 'lemin-cropped-captcha';
	}

	const leminSelectors = [
		'[id^="lemin-"]',
		'[id*="lemin" i]',
		'.lemin-cropped-captcha',
		'.lemin-captcha',
		'#lemin-cropped-captcha',
		'[class*="lemin" i]',
		'div[data-captcha-id]',
		'[captcha-id]',
		'[data-lemin-id]',
		'[data-lemin-captcha-id]',
		'[data-puzzle-id]',
		'[data-puzzle]',
		'[data-div-id*="lemin" i]',
		'iframe[src*="lemin" i]',
		'img[src*="lemin" i]',
		'img[src*="/cropped/" i]',
		'img[src*="/puzzle/" i]',
		'canvas[id*="lemin" i]',
		'canvas[class*="lemin" i]',
		'script[src*="leminnow"]',
		'script[src*="lemin-captcha"]',
		'script[src*="lemin"]',
	];

	let container: HTMLElement | null = null;
	for (const selector of leminSelectors) {
		try {
			const el = document.querySelector<HTMLElement>(selector);
			const candidate = el ? resolveLeminContainer(el) : null;
			if (candidate && isVisibleFn(candidate)) {
				container = candidate;
				break;
			}
		} catch {
			// ignore invalid selector
		}
	}

	if (!container) return null;

	const captchaId = extractLeminCaptchaId(container);
	if (!captchaId) return null;

	const divId = getLeminDivId(container);
	return { captchaId, divId };
}

export async function detectLemin(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<RawDetection[]> {
	if (!enabledTypes.has('lemin')) return [];

	const script = composeBrowserScript(
		[isVisible, normalizeLeminCaptchaId, extractLeminCaptchaIdFromText],
		detectLeminInPage,
		undefined,
	);
	const hit = (await frame.evaluate(script)) as RawLeminHit | null;
	if (!hit) return [];

	return [
		{
			type: 'lemin',
			source: 'dom',
			captchaId: hit.captchaId,
			divId: hit.divId,
			solveParams: {
				method: 'lemin',
				captcha_id: hit.captchaId,
				div_id: hit.divId,
				pageurl,
			},
		},
	];
}
