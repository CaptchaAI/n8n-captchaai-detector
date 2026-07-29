import { chromium, type Browser, type Frame, type Page } from 'playwright';

const MANUAL_INSTALL_COMMAND = 'npx playwright install chromium';

/**
 * Launches the bundled Chromium. Some n8n deployments install community
 * nodes with `npm install --ignore-scripts`, which skips
 * `scripts/postinstall-playwright.js` and leaves no browser binary on disk.
 * Playwright's own launch error in that case is a generic ENOENT-style
 * message, so it is rethrown here naming the exact fix.
 */
export async function launchBrowser(): Promise<Browser> {
	try {
		return await chromium.launch({ headless: true });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not launch the bundled Chromium browser. Run "${MANUAL_INSTALL_COMMAND}" in this ` +
				`n8n instance's node_modules/n8n-nodes-captchaai-detect directory, then retry. ` +
				`Original error: ${reason}`,
		);
	}
}

const SETTLE_MS = 2500;

/**
 * Navigation strategy (locked decision - see the implementation plan §4.1):
 * `networkidle` primary, falling back to `domcontentloaded` + a fixed settle
 * delay for pages that never truly reach network-idle (some real sites never
 * do, and the node should not hard-fail navigation because of it).
 */
export async function navigateAndSettle(page: Page, url: string, timeoutMs: number): Promise<void> {
	try {
		await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
	} catch {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
		await page.waitForTimeout(SETTLE_MS);
	}
}

/**
 * Bounded settle for images to finish decoding before any image-based
 * detector reads `naturalWidth`/`naturalHeight` - see the implementation
 * plan §6.1. Without this, `img.decode()` may not have resolved yet and
 * every image-based detector (Normal Image, Grid, BLS) silently returns zero
 * results with no error, because the extension's own re-scan-on-`load`
 * safety net has no equivalent in a one-shot Playwright pass. Call once per
 * frame - each frame has its own document/image set.
 */
export async function waitForImagesToSettle(target: Page | Frame, timeoutMs = 4000): Promise<void> {
	try {
		await Promise.race([
			target.evaluate(() => {
				const images = Array.from(document.images);
				return Promise.all(
					images.map((img) =>
						img.decode ? img.decode().catch(() => undefined) : Promise.resolve(undefined),
					),
				);
			}),
			new Promise((resolve) => setTimeout(resolve, timeoutMs)),
		]);
	} catch {
		// Detached/cross-origin frame - nothing to settle.
	}
}
