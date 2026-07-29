import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadBundled } from './load-bundled';
import type * as RecaptchaV2Module from '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2';

// Loaded through a real esbuild bundle, not a direct import - see
// `load-bundled.ts` for why this is required for correctness, not just style.
const { detectRecaptchaV2 } = loadBundled<typeof RecaptchaV2Module>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2.ts'),
);

const ENABLED_ALL_V2 = new Set(['recaptcha_v2', 'recaptcha_v2_invisible', 'recaptcha_v2_enterprise'] as const);

describe('reCAPTCHA v2 DOM detection', () => {
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

	it('detects a standard visible .g-recaptcha[data-sitekey] widget', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div class="g-recaptcha" data-sitekey="visible-sitekey" style="width:300px;height:76px;"></div>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(1);
		expect(results[0].sitekey).toBe('visible-sitekey');
		expect(results[0].invisible).toBe(false);
		expect(results[0].solveParams).toMatchObject({
			method: 'userrecaptcha',
			googlekey: 'visible-sitekey',
			pageurl: 'https://example.com/',
		});
	});

	it('detects an invisible widget even with zero layout size', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div class="g-recaptcha" data-sitekey="invisible-sitekey" data-size="invisible"></div>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(1);
		expect(results[0].invisible).toBe(true);
		expect(results[0].solveParams.invisible).toBe(1);
	});

	it('does not detect a hidden (display:none) standard widget', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div class="g-recaptcha" data-sitekey="hidden-sitekey" style="display:none;"></div>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(0);
	});

	it('skips Turnstile reCAPTCHA-compat pages (no native recaptcha script)', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?compat=recaptcha"></script>
				<div class="g-recaptcha" data-sitekey="compat-sitekey" style="width:300px;height:76px;"></div>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(0);
	});

	it('detects invisible v2 when only the anchor iframe has size=invisible (Google demo pattern)', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div class="g-recaptcha" data-sitekey="6LfP0CITAAAAAHq9FOgCo7v_fb0-pmmH9VW3ziFs"></div>
				<iframe src="https://www.google.com/recaptcha/api2/anchor?k=6LfP0CITAAAAAHq9FOgCo7v_fb0-pmmH9VW3ziFs&size=invisible"></iframe>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(1);
		expect(results[0].type).toBe('recaptcha_v2_invisible');
		expect(results[0].sitekey).toBe('6LfP0CITAAAAAHq9FOgCo7v_fb0-pmmH9VW3ziFs');
	});

	it('skips invisible anchor iframes that match a v3 ?render= sitekey (badge)', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<script src="https://www.google.com/recaptcha/enterprise.js?render=v3-sitekey"></script>
				<iframe src="https://www.google.com/recaptcha/enterprise/anchor?k=v3-sitekey&size=invisible"></iframe>
			</body></html>
		`);

		const results = await detectRecaptchaV2(page.mainFrame(), ENABLED_ALL_V2 as any, 'https://example.com/');
		expect(results).toHaveLength(0);
	});

	it('respects the enabledTypes filter (recaptcha_v2_invisible only)', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<div class="g-recaptcha" data-sitekey="visible-sitekey" style="width:300px;height:76px;"></div>
				<div class="g-recaptcha" data-sitekey="invisible-sitekey" data-size="invisible"></div>
			</body></html>
		`);

		const results = await detectRecaptchaV2(
			page.mainFrame(),
			new Set(['recaptcha_v2_invisible']) as any,
			'https://example.com/',
		);
		expect(results).toHaveLength(1);
		expect(results[0].sitekey).toBe('invisible-sitekey');
	});
});
