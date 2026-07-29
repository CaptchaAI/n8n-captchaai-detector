import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { imageElementToPngBase64 } from '../dom/image-capture';
import { isVisible } from '../dom/visibility';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface RawNormalImageHit {
	imageBase64: string;
}

/**
 * Ported from `detector.ts:4108-4308` (`detectNormalImage`) and the scoring
 * helpers at `4391-4472`, plus `findNearbyOcrInput`/`findNearbyCaptchaImage`
 * (`normal-image-context.ts:32-67`, `detector.ts:4442-4473`).
 *
 * Method 1 (attribute-based marking) is dropped - it depends on the
 * extension's context-menu marking flow, which has no n8n equivalent.
 *
 * BotDetect superset (per the implementation plan §5): the extension only
 * ever reaches `.BDC_CaptchaImageDiv img` incidentally, via the generic
 * `img[id*="captcha" i]` heuristic selector, then boosts it +140 via
 * `isBotDetectPrimaryImage`. This port additionally adds
 * `BOTDETECT_PRIMARY_IMAGE_SELECTOR` directly to the Method-3 selector list,
 * making BotDetect a first-class detection path rather than an accidental
 * one - an intentional superset of the source, not a silent choice.
 */
function detectNormalImageInPage(args: {
	imageSelector?: string;
	inputSelector?: string;
}): RawNormalImageHit[] {
	const isVisibleFn = isVisible as any;

	// NOTE: these must be declared INSIDE this function body, not at module
	// scope - `composeBrowserScript` only ships this function's own source
	// text to the browser (plus whatever is explicitly passed as a helper
	// function), so a module-level `const` referenced here would silently be
	// `undefined` at runtime (this was caught by
	// `tests/fixture-tests/image-settle.test.ts` loading this module through
	// a real esbuild bundle - see `load-bundled.ts`).
	const BOTDETECT_PRIMARY_IMAGE_SELECTOR =
		'.BDC_CaptchaImageDiv img, img[id*="_CaptchaImage"], img[id$="_CaptchaImage"]';
	const BOTDETECT_IGNORED_IMAGE_SELECTOR = '.BDC_ReloadIcon, .BDC_SoundIcon, .BDC_ReloadLink img, .BDC_SoundLink img';

	const DECORATIVE_IMAGE_HINT_RE = /\b(?:logo|icon|badge|avatar|wordmark|brand|thumbnail|illustration)\b/i;
	const CHALLENGE_IMAGE_HINT_RE = /captcha|verification|verify|security|challenge/i;

	function getCandidateText(meta: {
		src?: string | null;
		id?: string | null;
		alt?: string | null;
		className?: string | null;
		ariaLabel?: string | null;
	}): string {
		return [meta.src, meta.id, meta.alt, meta.className, meta.ariaLabel]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
	}

	function shouldIgnoreByMetadata(meta: Parameters<typeof getCandidateText>[0]): boolean {
		const text = getCandidateText(meta);
		if (!text) return false;
		return DECORATIVE_IMAGE_HINT_RE.test(text) && CHALLENGE_IMAGE_HINT_RE.test(text);
	}

	function isBotDetectPrimaryImage(image: HTMLImageElement): boolean {
		return image.matches(BOTDETECT_PRIMARY_IMAGE_SELECTOR);
	}

	function isDecorativeUiAsset(image: HTMLImageElement): boolean {
		const rect = image.getBoundingClientRect();
		const width = image.naturalWidth || image.width || rect.width;
		const height = image.naturalHeight || image.height || rect.height;
		if (width <= 0 || height <= 0) return false;

		const largestSide = Math.max(width, height);
		const smallestSide = Math.min(width, height);
		const nearlySquare = smallestSide > 0 && largestSide / smallestSide <= 1.6;
		const compact = largestSide <= 160;
		if (!compact || !nearlySquare) return false;
		if (image.closest('form')) return false;

		const source = (image.currentSrc || image.getAttribute('src') || '').toLowerCase();
		const metadataText = getCandidateText({
			src: image.getAttribute('src'),
			id: image.getAttribute('id'),
			alt: image.getAttribute('alt'),
			className: image.getAttribute('class'),
			ariaLabel: image.getAttribute('aria-label'),
		});
		const hasDecorativeHint = /\b(?:logo|icon|badge|avatar|wordmark|brand|thumbnail|illustration)\b/i.test(
			metadataText,
		);
		const isVectorAsset = source.includes('.svg');
		if (!hasDecorativeHint && !isVectorAsset) return false;

		const semanticContainer = image.closest(
			'article, section, aside, nav, header, [role="article"], [role="navigation"]',
		);
		const linkCount = semanticContainer?.querySelectorAll('a[href]').length ?? 0;
		const interactiveWrapper = !!image.closest('a, button');
		return interactiveWrapper || linkCount >= 2;
	}

	function isIgnoredNormalImageCandidate(image: HTMLImageElement): boolean {
		return (
			image.matches(BOTDETECT_IGNORED_IMAGE_SELECTOR) ||
			shouldIgnoreByMetadata({
				src: image.getAttribute('src'),
				id: image.getAttribute('id'),
				alt: image.getAttribute('alt'),
				className: image.getAttribute('class'),
				ariaLabel: image.getAttribute('aria-label'),
			}) ||
			isDecorativeUiAsset(image)
		);
	}

	type OcrInputElement = HTMLInputElement | HTMLTextAreaElement;

	function isOcrInputElement(el: Element | null): el is OcrInputElement {
		return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
	}

	function isEligibleOcrInput(element: OcrInputElement): boolean {
		if (element instanceof HTMLInputElement) {
			if (['hidden', 'password', 'email', 'search', 'tel', 'number'].includes(element.type)) return false;
		}
		return !element.disabled && !(element as HTMLInputElement).readOnly;
	}

	function getNormalImageHeuristicScore(imageEl: HTMLImageElement, inputEl: OcrInputElement): number {
		if (isIgnoredNormalImageCandidate(imageEl)) return -200;

		const imageRect = imageEl.getBoundingClientRect();
		const inputRect = inputEl.getBoundingClientRect();
		const sameForm = !!(imageEl.closest('form') && imageEl.closest('form') === inputEl.closest('form'));
		const sameParent = imageEl.parentElement && imageEl.parentElement === inputEl.parentElement;

		const verticalDistance = Math.abs(inputRect.top - imageRect.bottom);
		const horizontalDistance = Math.abs(inputRect.left - imageRect.left);
		const centerDeltaX = Math.abs(
			imageRect.left + imageRect.width / 2 - (inputRect.left + inputRect.width / 2),
		);

		let score = 0;
		if (sameForm) score += 120;
		if (sameParent) score += 60;

		const inputText = [
			inputEl.getAttribute('name'),
			inputEl.getAttribute('id'),
			inputEl.getAttribute('placeholder'),
			inputEl.getAttribute('aria-label'),
			inputEl.getAttribute('class'),
		]
			.join(' ')
			.toLowerCase();

		const imageText = getCandidateText({
			src: imageEl.getAttribute('src'),
			id: imageEl.getAttribute('id'),
			alt: imageEl.getAttribute('alt'),
			className: imageEl.getAttribute('class'),
			ariaLabel: imageEl.getAttribute('aria-label'),
		});

		if (/captcha|verify|verification|code|answer|security/i.test(inputText)) score += 90;
		if (/email|search|phone|name|user|pass|login|username/i.test(inputText)) score -= 100;
		if (/captcha|verify|verification|code|security|securimage/i.test(imageText)) score += 70;
		if (isBotDetectPrimaryImage(imageEl)) score += 140;

		score += Math.max(0, 60 - Math.min(verticalDistance, 300) / 5);
		score += Math.max(0, 30 - Math.min(horizontalDistance, 300) / 10);
		score += Math.max(0, 25 - Math.min(centerDeltaX, 250) / 10);

		if (!isVisibleFn(imageEl) || !isVisibleFn(inputEl)) score -= 80;

		return score;
	}

	function findNearbyOcrInput(imageEl: HTMLImageElement): OcrInputElement | null {
		const selector = 'input[type="text"], input:not([type]), textarea';
		const candidates = new Set<OcrInputElement>();

		const form = imageEl.closest('form');
		if (form) {
			form.querySelectorAll<OcrInputElement>(selector).forEach((el) => {
				if (isEligibleOcrInput(el)) candidates.add(el);
			});
		}

		let current: Element | null = imageEl.parentElement;
		let depth = 0;
		while (current && depth < 4) {
			current.querySelectorAll<OcrInputElement>(selector).forEach((el) => {
				if (isEligibleOcrInput(el)) candidates.add(el);
			});
			current = current.parentElement;
			depth += 1;
		}

		let best: { element: OcrInputElement; score: number } | null = null;
		const imageRect = imageEl.getBoundingClientRect();
		for (const element of Array.from(candidates)) {
			const rect = element.getBoundingClientRect();
			const verticalDistance = Math.abs(rect.top - imageRect.bottom);
			const horizontalDistance = Math.abs(rect.left - imageRect.left);
			let score = 0;
			const attrText = [
				element.getAttribute('name'),
				element.getAttribute('id'),
				element.getAttribute('placeholder'),
				element.getAttribute('aria-label'),
				element.getAttribute('class'),
			]
				.join(' ')
				.toLowerCase();
			if (/captcha|verify|verification|code|answer|security/i.test(attrText)) score += 80;
			if (/email|search|phone|name|user|pass|login|username/i.test(attrText)) score -= 70;
			if (imageEl.closest('form') && element.closest('form') === imageEl.closest('form')) score += 40;
			if (imageEl.parentElement && element.parentElement === imageEl.parentElement) score += 10;
			score += Math.max(0, 40 - Math.min(verticalDistance, 200) / 5);
			score += Math.max(0, 20 - Math.min(horizontalDistance, 200) / 10);
			if (best === null || score > best.score) best = { element, score };
		}

		return best && best.score > -20 ? best.element : null;
	}

	function findNearbyCaptchaImage(input: OcrInputElement): HTMLImageElement | null {
		const candidates = new Set<HTMLImageElement>();
		const form = input.closest('form');
		if (form) {
			form.querySelectorAll('img').forEach((img) => candidates.add(img));
		}
		let current: Element | null = input.parentElement;
		let depth = 0;
		while (current && depth < 4) {
			current.querySelectorAll('img').forEach((img) => candidates.add(img));
			current = current.parentElement;
			depth += 1;
		}

		let best: { image: HTMLImageElement; score: number } | null = null;
		for (const image of Array.from(candidates)) {
			if (!image.src || image.naturalWidth < 20 || image.naturalHeight < 10) continue;
			if (isIgnoredNormalImageCandidate(image)) continue;
			const score = getNormalImageHeuristicScore(image, input);
			if (!best || score > best.score) best = { image, score };
		}
		return best && best.score >= 40 ? best.image : null;
	}

	const claimedImageKeys = new Set<string>();
	const results: RawNormalImageHit[] = [];

	function acceptImage(img: HTMLImageElement): void {
		const key = img.currentSrc || img.src;
		if (!key || claimedImageKeys.has(key)) return;
		claimedImageKeys.add(key);
		try {
			results.push({ imageBase64: imageElementToPngBase64(img) });
		} catch {
			// Not decodable this pass - skip.
		}
	}

	// --- Method 2: explicit imageSelector / inputSelector params ---
	if (args.imageSelector) {
		let imgEl: Element | null = null;
		try {
			imgEl = document.querySelector(args.imageSelector);
		} catch {
			imgEl = null;
		}
		if (imgEl instanceof HTMLImageElement && imgEl.src && imgEl.naturalWidth > 0) {
			acceptImage(imgEl);
		}
	}
	if (!args.imageSelector && args.inputSelector) {
		let inputEl: Element | null = null;
		try {
			inputEl = document.querySelector(args.inputSelector);
		} catch {
			inputEl = null;
		}
		if (isOcrInputElement(inputEl)) {
			const img = findNearbyCaptchaImage(inputEl);
			if (img) acceptImage(img);
		}
	}

	// --- Method 3: heuristic image selectors (BotDetect added per plan §5) ---
	const captchaSelectors = [
		'img[src*="captcha" i]',
		'img[id*="captcha" i]',
		'img[class*="captcha" i]',
		'img[alt*="captcha" i]',
		'img[src*="securimage" i]',
		'img[src*="verify" i][src*="image" i]',
		'.captcha-image img',
		'.captcha img',
		'#captcha-image',
		'#captchaImage',
		BOTDETECT_PRIMARY_IMAGE_SELECTOR,
	];

	type Candidate = { imageEl: HTMLImageElement; targetKey: string; imageKey: string; score: number };
	const heuristicCandidates = new Map<string, Candidate>();

	function addCandidate(imageEl: HTMLImageElement, inputEl: OcrInputElement): void {
		const imageKey = imageEl.currentSrc || imageEl.src;
		if (!imageKey) return;
		const form = imageEl.closest('form') || inputEl.closest('form');
		const targetKey = form ? `form:${Array.from(document.forms).indexOf(form as HTMLFormElement)}` : `input:${imageKey}`;
		const score = getNormalImageHeuristicScore(imageEl, inputEl);
		if (score < 40) return;
		const candidateKey = `${targetKey}::${imageKey}`;
		const existing = heuristicCandidates.get(candidateKey);
		if (!existing || score > existing.score) {
			heuristicCandidates.set(candidateKey, { imageEl, targetKey, imageKey, score });
		}
	}

	for (const selector of captchaSelectors) {
		let imgs: NodeListOf<HTMLImageElement>;
		try {
			imgs = document.querySelectorAll<HTMLImageElement>(selector);
		} catch {
			continue;
		}
		imgs.forEach((img) => {
			if (!img.src || img.naturalWidth < 20 || img.naturalHeight < 10) return;
			if (isIgnoredNormalImageCandidate(img)) return;
			const inputEl = findNearbyOcrInput(img);
			if (!inputEl) return;
			addCandidate(img, inputEl);
		});
	}

	// --- Method 4: reverse heuristic (input -> image) ---
	const captchaInputSelectors = [
		'input[type="text"][name*="captcha" i]',
		'input[type="text"][id*="captcha" i]',
		'input[type="text"][placeholder*="captcha" i]',
		'input:not([type])[name*="captcha" i]',
		'input[name="code" i]',
		'input[name="answer" i]',
		'textarea[name*="captcha" i]',
	];

	for (const selector of captchaInputSelectors) {
		let inputs: NodeListOf<Element>;
		try {
			inputs = document.querySelectorAll(selector);
		} catch {
			continue;
		}
		inputs.forEach((inputCandidate) => {
			if (!isOcrInputElement(inputCandidate)) return;
			const img = findNearbyCaptchaImage(inputCandidate);
			if (!img || !img.src || img.naturalWidth < 20 || img.naturalHeight < 10) return;
			addCandidate(img, inputCandidate);
		});
	}

	const selected = Array.from(heuristicCandidates.values()).sort((a, b) => b.score - a.score);
	const usedTargets = new Set<string>();
	for (const candidate of selected) {
		if (usedTargets.has(candidate.targetKey)) continue;
		usedTargets.add(candidate.targetKey);
		acceptImage(candidate.imageEl);
	}

	return results;
}

export async function detectNormalImage(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	options: { imageSelector?: string; inputSelector?: string },
): Promise<RawDetection[]> {
	if (!enabledTypes.has('normal_image')) return [];

	const script = composeBrowserScript([isVisible, imageElementToPngBase64], detectNormalImageInPage, {
		imageSelector: options.imageSelector,
		inputSelector: options.inputSelector,
	});
	const hits = (await frame.evaluate(script)) as RawNormalImageHit[];

	return hits.map((hit) => ({
		type: 'normal_image' as const,
		source: 'dom' as const,
		imageBase64: hit.imageBase64,
		solveParams: {
			method: 'base64',
			body: hit.imageBase64,
		},
	}));
}
