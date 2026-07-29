import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface RawFriendlyCaptchaHit {
	sitekey: string;
}

/**
 * Ported from `detector.ts:3705-3822` (`detectFriendlyCaptcha`, 8 detection
 * strategies) and `detector.ts:3598-3655` (`extractFriendlyCaptchaSitekey`,
 * 5 sitekey-extraction methods) plus `isFriendlyCaptchaContainer`
 * (`detector.ts:3666-3703`).
 */
function detectFriendlyCaptchaInPage(): RawFriendlyCaptchaHit[] {
	const isVisibleFn = isVisible as any;

	function isFriendlyCaptchaContainer(el: Element): boolean {
		if ((el.classList.toString() || '').includes('frc')) return true;
		if (el.hasAttribute('site-key')) return true;
		if (el.hasAttribute('data-puzzle')) return true;
		if (el.hasAttribute('data-sitekey')) {
			const form = el.closest('form') || el.parentElement;
			if (form?.querySelector('input[name="frc-captcha-solution"], input.frc-captcha-solution')) {
				return true;
			}
		}
		const iframe = el.querySelector?.('iframe');
		if (iframe && /friendlycaptcha\.com|frcapi\.com/.test((iframe as HTMLIFrameElement).src || '')) {
			return true;
		}
		if (el.hasAttribute('data-solution-field-name')) return true;
		if (el.querySelector?.('.frc-captcha')) return true;
		if (el.querySelector?.('.frc-container')) return true;
		if (el.querySelector?.('input.frc-captcha-solution, input[name="captcha-solution"]')) return true;
		const tagName = el.tagName.toLowerCase();
		if (tagName.includes('captcha') && (el.classList.toString() || '').includes('frc')) return true;
		return false;
	}

	function extractFriendlyCaptchaSitekey(container: Element | null): string | null {
		if (container) {
			const key =
				container.getAttribute('data-sitekey') ||
				container.getAttribute('site-key') ||
				(container as HTMLElement).dataset?.sitekey ||
				(container as HTMLElement).dataset?.puzzle;
			if (key) return key.trim();
		}

		const anyWidget =
			container || document.querySelector('.frc-captcha, [class*="frc-captcha"], [data-sitekey], [site-key]');
		if (anyWidget) {
			const key =
				anyWidget.getAttribute('data-sitekey') ||
				anyWidget.getAttribute('site-key') ||
				(anyWidget as HTMLElement).dataset?.sitekey ||
				(anyWidget as HTMLElement).dataset?.puzzle;
			if (key) return key.trim();
		}

		if (container) {
			const solutionInput = container.querySelector('input.frc-captcha-solution, input[name="captcha-solution"]');
			if (solutionInput) {
				let parent = solutionInput.parentElement;
				for (let i = 0; i < 5 && parent; i++) {
					const key = parent.getAttribute('data-sitekey') || parent.getAttribute('site-key');
					if (key) return key.trim();
					parent = parent.parentElement;
				}
			}
		}

		const meta = document.querySelector('meta[name="friendly-captcha-sitekey"]') as HTMLMetaElement | null;
		if (meta?.content) return meta.content.trim();

		const scripts = document.querySelectorAll('script');
		for (const script of Array.from(scripts)) {
			if (script.src) continue;
			const content = script.textContent || '';
			const patterns = [
				/["']sitekey["']\s*:\s*["']([^"']+)["']/,
				/["']site-key["']\s*:\s*["']([^"']+)["']/,
				/friendlyCaptchaSitekey\s*=\s*["']([^"']+)["']/,
				/data-sitekey=["']([^"']+)["']/,
				/puzzle:\s*["']([^"']+)["']/,
			];
			for (const pattern of patterns) {
				const match = content.match(pattern);
				if (match?.[1]) return match[1].trim();
			}
		}

		return null;
	}

	const seen = new Set<Element>();

	// Strategy 1: standard .frc-captcha elements
	document.querySelectorAll('.frc-captcha').forEach((el) => {
		if (isVisibleFn(el)) seen.add(el);
	});

	// Strategy 2: elements with class containing "frc"
	document.querySelectorAll('[class*="frc"]').forEach((el) => {
		if (isVisibleFn(el) && isFriendlyCaptchaContainer(el)) seen.add(el);
	});

	// Strategy 3: custom elements with site-key attribute
	document.querySelectorAll('[site-key]').forEach((el) => {
		if (isVisibleFn(el)) seen.add(el);
	});

	// Strategy 4: elements with data-puzzle attribute
	document.querySelectorAll('[data-puzzle]').forEach((el) => {
		if (isVisibleFn(el) && isFriendlyCaptchaContainer(el)) seen.add(el);
	});

	// Strategy 5: elements containing FriendlyCaptcha iframes
	document.querySelectorAll('iframe[src*="friendlycaptcha"], iframe[src*="frcapi"]').forEach((iframe) => {
		const parent = iframe.closest('[data-sitekey], [site-key]') || iframe.parentElement;
		if (parent && isVisibleFn(parent)) seen.add(parent);
	});

	// Strategy 6: hidden input with frc-captcha-solution class -> find its container
	const frcInputs = document.querySelectorAll(
		'input.frc-captcha-solution, input[name="frc-captcha-solution"], input[name="captcha-solution"].frc-captcha-solution',
	);
	frcInputs.forEach((frcInput) => {
		let parent = frcInput.parentElement;
		for (let i = 0; i < 8 && parent && parent !== document.body; i++) {
			if (isFriendlyCaptchaContainer(parent)) {
				seen.add(parent);
				break;
			}
			parent = parent.parentElement;
		}
		const form = frcInput.closest('form');
		if (form) {
			const container = form.querySelector('[data-sitekey], [site-key], [data-puzzle], [class*="frc-captcha"]');
			if (container && isVisibleFn(container)) seen.add(container);
		}
	});

	// Strategy 7: any element with data-sitekey that has frc-related content
	document.querySelectorAll('[data-sitekey]').forEach((el) => {
		if (isVisibleFn(el) && isFriendlyCaptchaContainer(el)) seen.add(el);
	});

	// Strategy 8: custom web components with "captcha" in tag name + frc class
	document.querySelectorAll('*').forEach((el) => {
		const tag = el.tagName.toLowerCase();
		if (tag.includes('captcha') && (el.classList.toString() || '').includes('frc') && isVisibleFn(el)) {
			seen.add(el);
		}
	});

	const results: RawFriendlyCaptchaHit[] = [];
	const seenSitekeys = new Set<string>();
	for (const container of Array.from(seen)) {
		const sitekey = extractFriendlyCaptchaSitekey(container);
		if (!sitekey || seenSitekeys.has(sitekey)) continue;
		seenSitekeys.add(sitekey);
		results.push({ sitekey });
	}

	return results;
}

export async function detectFriendlyCaptcha(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<RawDetection[]> {
	if (!enabledTypes.has('friendly_captcha')) return [];

	const script = composeBrowserScript([isVisible], detectFriendlyCaptchaInPage, undefined);
	const hits = (await frame.evaluate(script)) as RawFriendlyCaptchaHit[];

	return hits.map((hit) => ({
		type: 'friendly_captcha' as const,
		source: 'dom' as const,
		sitekey: hit.sitekey,
		solveParams: {
			method: 'friendly_captcha',
			sitekey: hit.sitekey,
			pageurl,
		},
	}));
}
