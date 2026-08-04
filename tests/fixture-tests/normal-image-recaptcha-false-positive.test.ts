import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadBundled } from './load-bundled';
import type * as NormalImageModule from '../../nodes/CaptchaAiDetect/detectors/normal-image';

// Loaded through a real esbuild bundle, not a direct import - see
// `load-bundled.ts` for why this is required for correctness, not just style.
const { detectNormalImage } = loadBundled<typeof NormalImageModule>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/normal-image.ts'),
);

const ENABLED = new Set(['normal_image'] as const);

/**
 * Regression guard: on nextcaptcha.com/demo/recaptcha_v3_enterprise (and any
 * other page embedding stock Google reCAPTCHA outside a `<form>`), Method 4
 * ("reverse heuristic") used to match the hidden `g-recaptcha-response`
 * textarea via `textarea[name*="captcha" i]` - "recaptcha" contains
 * "captcha" as a substring - then fell back to walking parents up to
 * `<body>` (no enclosing form) and grabbed an unrelated nearby image whose
 * alt/src also happened to contain "recaptcha", misreporting it as a
 * `normal_image` CAPTCHA to solve.
 *
 * This fixture reproduces that page shape: a bare `g-recaptcha-response`
 * textarea with no wrapping `<form>`, plus a decorative image elsewhere on
 * the page whose alt text mentions "recaptcha".
 */
async function buildRecaptchaDemoFixture(page: Page): Promise<void> {
	await page.setContent(`
		<!doctype html>
		<html><body>
			<div class="grecaptcha-badge">
				<textarea id="g-recaptcha-response-100000" name="g-recaptcha-response" class="g-recaptcha-response"></textarea>
			</div>
			<img id="demo-image" alt="recaptcha enterprise demo" width="120" height="120" />
		</body></html>
	`);
	// A real, decodable image (drawn via canvas, matching the pattern in
	// image-settle.test.ts) so `naturalWidth`/`naturalHeight` are non-zero and
	// the fixture actually exercises the naturalWidth/naturalHeight >= 20x10
	// candidacy check instead of being filtered out before the bug is reached.
	await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 300;
		canvas.height = 48;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'blue';
		ctx.fillRect(0, 0, 300, 48);
		(document.getElementById('demo-image') as HTMLImageElement).src = canvas.toDataURL('image/png');
	});
	await page.waitForFunction(() => (document.getElementById('demo-image') as HTMLImageElement).naturalWidth > 0);
}

describe('normal_image false-positive on bare reCAPTCHA response fields', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterEach(async () => {
		await page?.close();
	});

	afterAll(async () => {
		await browser.close();
	});

	it('does not treat the g-recaptcha-response textarea as an OCR answer field', async () => {
		page = await browser.newPage();
		await buildRecaptchaDemoFixture(page);

		const results = await detectNormalImage(page.mainFrame(), ENABLED as any, {});
		expect(results).toHaveLength(0);
	});
});
