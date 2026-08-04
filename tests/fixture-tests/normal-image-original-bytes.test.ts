import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

// A real, tiny (634-byte) JPEG - not a canvas-drawn placeholder - so a
// successful match on this file's exact bytes proves the detector returned
// the genuine downloaded file rather than a re-encoded copy.
const TINY_JPEG_BASE64 =
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeiiivzw/sgKKKKACiiigAooooAKKKKACiiigD//Z';
const TINY_JPEG_BYTES = Buffer.from(TINY_JPEG_BASE64, 'base64');

/**
 * Regression guard: `imageElementToPngBase64` (canvas re-render) used to be
 * the only way `imageBase64` was produced, so a real JPEG/GIF/etc. source
 * always came back re-encoded as PNG - same picture, different bytes than
 * the actual file (see conversation: 2captcha.com/demo/normal, `/9j/...`
 * downloaded file vs. `iVBORw0KGgo...` detector output). `detectNormalImage`
 * now fetches the original file for http(s) sources via Playwright's request
 * API and only falls back to the canvas re-encode when that isn't possible.
 * This fixture serves a real JPEG over a local HTTP server (not a data: URI
 * or canvas-drawn image) so the fetch path is actually exercised.
 */
describe('normal_image preserves the original file bytes over HTTP', () => {
	let browser: Browser;
	let page: Page;
	let server: http.Server;
	let baseUrl: string;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
		server = http.createServer((req, res) => {
			if (req.url === '/captcha.jpg') {
				res.writeHead(200, { 'Content-Type': 'image/jpeg' });
				res.end(TINY_JPEG_BYTES);
				return;
			}
			res.writeHead(404);
			res.end();
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await page?.close();
	});

	afterAll(async () => {
		await browser.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it('returns the exact original JPEG bytes, not a canvas-rendered PNG', async () => {
		page = await browser.newPage();
		await page.setContent(`
			<!doctype html>
			<html><body>
				<form>
					<img id="captcha-image" alt="captcha" src="${baseUrl}/captcha.jpg" />
					<input type="text" name="captcha_code" />
				</form>
			</body></html>
		`, { waitUntil: 'load' });
		await page.waitForFunction(() => {
			const img = document.getElementById('captcha-image') as HTMLImageElement;
			return img.complete && img.naturalWidth > 0;
		});

		const results = await detectNormalImage(page.mainFrame(), ENABLED as any, {});

		expect(results).toHaveLength(1);
		const imageBase64 = results[0]?.imageBase64 ?? '';
		expect(imageBase64).toBe(TINY_JPEG_BASE64);
		expect(imageBase64.startsWith('/9j/')).toBe(true);
		expect(imageBase64.startsWith('iVBORw0KGgo')).toBe(false);
	});
});
