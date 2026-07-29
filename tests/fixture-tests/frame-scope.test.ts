import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captchaaiDetectHookInitScript } from '../../nodes/CaptchaAiDetect/hooks/init-script';

/**
 * Regression guard for the implementation plan §4.2-§4.3 fix: the hook init
 * script (grecaptcha/turnstile/initGeetest interception + the attachShadow
 * patch) must install ONLY in the top frame, matching `manifest.json` where
 * `all_frames: true` sits on the `detector.ts` content-script entry and is
 * absent from the `main-world.ts` entry. A subframe that calls
 * `grecaptcha.execute()` itself must be completely unaffected - no
 * `window.__captchaaiDetect` store, and its own call must return normally
 * (pass-through, not blocked).
 */
describe('hook init script installs in the top frame only', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	it('creates window.__captchaaiDetect in the top frame but not in a same-origin iframe', async () => {
		const context = await browser.newContext();
		await context.addInitScript(captchaaiDetectHookInitScript);
		const page = await context.newPage();

		await page.setContent(`
			<!doctype html>
			<html><body>
				<iframe id="child" src="about:blank"></iframe>
				<script>
					const child = document.getElementById('child');
					child.contentDocument.open();
					child.contentDocument.write('<!doctype html><html><body>child frame</body></html>');
					child.contentDocument.close();
				</script>
			</body></html>
		`);

		const topHasStore = await page.evaluate(() => Boolean((window as any).__captchaaiDetect));
		expect(topHasStore).toBe(true);

		const childFrame = page.frames().find((f) => f !== page.mainFrame());
		expect(childFrame).toBeDefined();
		const childHasStore = await childFrame!.evaluate(() => Boolean((window as any).__captchaaiDetect));
		expect(childHasStore).toBe(false);

		await context.close();
	});

	it("does not affect a subframe's own grecaptcha.execute() call - pass-through, not blocked", async () => {
		const context = await browser.newContext();
		await context.addInitScript(captchaaiDetectHookInitScript);
		const page = await context.newPage();

		await page.setContent(`<!doctype html><html><body><iframe id="child" src="about:blank"></iframe></body></html>`);
		const childFrame = page.frames().find((f) => f !== page.mainFrame())!;

		await childFrame.evaluate(() => {
			(window as any).grecaptcha = {
				execute: (sitekey: string) => Promise.resolve(`token-for-${sitekey}`),
			};
		});

		const result = await childFrame.evaluate(async () => {
			return (window as any).grecaptcha.execute('subframe-sitekey');
		});
		expect(result).toBe('token-for-subframe-sitekey');

		// The subframe's grecaptcha.execute is genuinely unwrapped - no hooked marker.
		const isHooked = await childFrame.evaluate(() => !!(window as any).grecaptcha.execute.__caiHooked);
		expect(isHooked).toBe(false);

		await context.close();
	});

	it('DOES hook grecaptcha.execute() in the top frame and records the call without blocking it', async () => {
		const context = await browser.newContext();
		await context.addInitScript(captchaaiDetectHookInitScript);
		const page = await context.newPage();
		await page.setContent('<!doctype html><html><body>top</body></html>');

		await page.evaluate(() => {
			(window as any).grecaptcha = {
				execute: (sitekey: string) => Promise.resolve(`token-for-${sitekey}`),
			};
		});

		const result = await page.evaluate(async () => (window as any).grecaptcha.execute('top-sitekey'));
		expect(result).toBe('token-for-top-sitekey');

		const store = await page.evaluate(() => (window as any).__captchaaiDetect);
		expect(store.recaptchaExecute).toEqual([{ sitekey: 'top-sitekey', action: undefined, enterprise: false }]);

		await context.close();
	});
});
