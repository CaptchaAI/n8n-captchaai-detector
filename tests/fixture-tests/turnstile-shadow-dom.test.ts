import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captchaaiDetectHookInitScript } from '../../nodes/CaptchaAiDetect/hooks/init-script';
import { loadBundled } from './load-bundled';
import type * as TurnstileModule from '../../nodes/CaptchaAiDetect/detectors/turnstile';

// Loaded through a real esbuild bundle, not a direct import - see
// `load-bundled.ts` for why this is required for correctness, not just style.
const { detectTurnstileDom } = loadBundled<typeof TurnstileModule>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/turnstile.ts'),
);

const ENABLED = new Set(['turnstile'] as const);

/**
 * Regression guard for the implementation plan's finding 1.2-D and the
 * "Known failure modes from the prior build" checklist: Turnstile detection
 * MUST use `querySelectorAllDeep`, not `document.querySelectorAll`, or
 * shadow-rendered widgets are silently missed.
 */
describe('Turnstile detection pierces shadow DOM', () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	it('finds a Turnstile widget inside an OPEN shadow root', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div id="host"></div>
				<script>
					const host = document.getElementById('host');
					const shadow = host.attachShadow({ mode: 'open' });
					const widget = document.createElement('div');
					widget.className = 'cf-turnstile';
					widget.setAttribute('data-sitekey', 'shadow-open-sitekey');
					shadow.appendChild(widget);
				</script>
			</body></html>
		`);

		// Sanity check: confirms the test fixture actually requires deep
		// querying and isn't accidentally passing for an unrelated reason.
		const plainQueryFindsIt = await page.evaluate(
			() => document.querySelectorAll('.cf-turnstile[data-sitekey]').length > 0,
		);
		expect(plainQueryFindsIt).toBe(false);

		const { detections } = await detectTurnstileDom(page.mainFrame(), ENABLED as any, 'https://example.com/');
		expect(detections).toHaveLength(1);
		expect(detections[0].sitekey).toBe('shadow-open-sitekey');

		await page.close();
	});

	it('finds a Turnstile widget inside a CLOSED shadow root once the hook init script has widened it', async () => {
		const context = await browser.newContext();
		await context.addInitScript(captchaaiDetectHookInitScript);
		page = await context.newPage();

		await page.setContent(`
			<!doctype html>
			<html><body>
				<div id="host"></div>
				<script>
					const host = document.getElementById('host');
					const shadow = host.attachShadow({ mode: 'closed' });
					const widget = document.createElement('div');
					widget.className = 'cf-turnstile';
					widget.setAttribute('data-sitekey', 'shadow-closed-sitekey');
					shadow.appendChild(widget);
				</script>
			</body></html>
		`);

		const { detections } = await detectTurnstileDom(page.mainFrame(), ENABLED as any, 'https://example.com/');
		expect(detections).toHaveLength(1);
		expect(detections[0].sitekey).toBe('shadow-closed-sitekey');

		await context.close();
	});
});
