import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dedupeDetections } from '../../nodes/CaptchaAiDetect/libs/dedupe';
import { stampDetection } from '../../nodes/CaptchaAiDetect/libs/output';
import type { DetectionResult } from '../../nodes/CaptchaAiDetect/libs/types';
import { loadBundled } from './load-bundled';
import type * as RecaptchaV2Module from '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2';

// Loaded through a real esbuild bundle, not a direct import - see
// `load-bundled.ts` for why this is required for correctness, not just style.
const { detectRecaptchaV2 } = loadBundled<typeof RecaptchaV2Module>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2.ts'),
);

const ENABLED = new Set(['recaptcha_v2'] as const);

describe('the same sitekey found in two frames yields two items, not one', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	it('produces two DetectionResults with different frameUrl and the same top-level pageurl', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();

		// Explicit width/height is required: an empty <div> has zero layout
		// height by default, and `isVisible()` (dom/visibility.ts) requires a
		// non-zero bounding rect for a non-invisible reCAPTCHA v2 container.
		const WIDGET_STYLE = 'style="width:300px;height:76px;"';

		await page.route('https://example.com/child', async (route) => {
			await route.fulfill({
				contentType: 'text/html',
				body: `<!doctype html><html><body><div class="g-recaptcha" data-sitekey="shared-sitekey" ${WIDGET_STYLE}></div></body></html>`,
			});
		});
		await page.route('https://example.com/', async (route) => {
			await route.fulfill({
				contentType: 'text/html',
				body: `<!doctype html><html><body>
					<div class="g-recaptcha" data-sitekey="shared-sitekey" ${WIDGET_STYLE}></div>
					<iframe src="https://example.com/child"></iframe>
				</body></html>`,
			});
		});

		await page.goto('https://example.com/');
		const pageurl = page.url();
		expect(page.frames()).toHaveLength(2);

		const results: DetectionResult[] = [];
		for (const frame of page.frames()) {
			const hits = await detectRecaptchaV2(frame, ENABLED as any, pageurl);
			for (const hit of hits) {
				results.push(stampDetection(hit, pageurl, frame.url()));
			}
		}

		expect(results).toHaveLength(2);
		expect(new Set(results.map((r) => r.frameUrl)).size).toBe(2);
		expect(results.every((r) => r.pageurl === pageurl)).toBe(true);
		expect(results.every((r) => r.sitekey === 'shared-sitekey')).toBe(true);

		const deduped = dedupeDetections(results);
		expect(deduped).toHaveLength(2); // NOT collapsed - different frameUrl

		await context.close();
	});
});
