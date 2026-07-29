import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { waitForImagesToSettle } from '../../nodes/CaptchaAiDetect/libs/browser';
import { loadBundled } from './load-bundled';
import type * as NormalImageModule from '../../nodes/CaptchaAiDetect/detectors/normal-image';

// Loaded through a real esbuild bundle, not a direct import - see
// `load-bundled.ts` for why this is required for correctness, not just style.
const { detectNormalImage } = loadBundled<typeof NormalImageModule>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/normal-image.ts'),
);

const ENABLED = new Set(['normal_image'] as const);

async function buildDelayedImageFixture(page: Page): Promise<void> {
	// The captcha image has no `src` at all until 500ms after the page loads -
	// standing in for the general shape of the plan §6.1 trap (a site that
	// injects/decodes its captcha image slightly after initial load, mirroring
	// why the extension re-scans on every `load` event - detector.ts:447-452).
	// A one-shot pass that runs before the image is ready sees a falsy `src`/
	// zero `naturalWidth` and silently reports nothing, with no error.
	//
	// The data URL is generated in-page via canvas (24x12, well above the
	// `naturalWidth < 20 || naturalHeight < 10` threshold at
	// detector.ts:4235, 4265) rather than a hand-written base64 literal - a
	// hand-crafted PNG byte string is easy to get subtly wrong (a valid-looking
	// IHDR header with corrupt pixel data still decodes to
	// naturalWidth/Height 0), whereas a canvas-drawn image is guaranteed valid.
	await page.setContent(`
		<!doctype html>
		<html><body>
			<form>
				<img id="captcha-image" alt="captcha" />
				<input type="text" name="captcha_code" />
			</form>
			<script>
				window.__imageAssigned = new Promise((resolve) => {
					setTimeout(() => {
						const canvas = document.createElement('canvas');
						canvas.width = 24;
						canvas.height = 12;
						const ctx = canvas.getContext('2d');
						ctx.fillStyle = 'red';
						ctx.fillRect(0, 0, 24, 12);
						document.getElementById('captcha-image').src = canvas.toDataURL('image/png');
						resolve();
					}, 500);
				});
			</script>
		</body></html>
	`);
}

/**
 * Regression guard for implementation plan §6.1: this is the prior build's
 * exact failure signature - a detector whose selectors and filters are
 * correct but which silently returns zero results at runtime because the
 * image was not ready yet. The first case here is expected to find nothing
 * (proving the trap is real); the second proves waiting for the image
 * (`waitForImagesToSettle`, after the `src` is actually assigned) is the fix.
 */
describe('image decode-settle (implementation plan §6.1)', () => {
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

	it('finds zero results if the detector runs before the image src is even assigned', async () => {
		page = await browser.newPage();
		await buildDelayedImageFixture(page);

		// Deliberately detect immediately, without waiting for `__imageAssigned`
		// or calling `waitForImagesToSettle` - reproduces the prior build's bug.
		const results = await detectNormalImage(page.mainFrame(), ENABLED as any, {});
		expect(results).toHaveLength(0);
	});

	it('finds the image once the src is assigned and waitForImagesToSettle is awaited', async () => {
		page = await browser.newPage();
		await buildDelayedImageFixture(page);

		await page.evaluate(() => (window as any).__imageAssigned);
		await waitForImagesToSettle(page);

		const results = await detectNormalImage(page.mainFrame(), ENABLED as any, {});
		expect(results).toHaveLength(1);
		expect(results[0].imageBase64).toBeTruthy();
	});
});
