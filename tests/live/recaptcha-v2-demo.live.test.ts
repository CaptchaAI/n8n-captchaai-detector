import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadBundled } from '../fixture-tests/load-bundled';
import type * as RecaptchaV2Module from '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2';
import { dedupeDetections } from '../../nodes/CaptchaAiDetect/libs/dedupe';
import { stampDetection } from '../../nodes/CaptchaAiDetect/libs/output';
import type { DetectionResult } from '../../nodes/CaptchaAiDetect/libs/types';
import { captureFailureArtifacts, isBugSignature, recordElementCounts, type StageTrace } from './trace';

const { detectRecaptchaV2 } = loadBundled<typeof RecaptchaV2Module>(
	path.resolve(__dirname, '../../nodes/CaptchaAiDetect/detectors/recaptcha-v2.ts'),
);

const ENABLED = new Set(['recaptcha_v2', 'recaptcha_v2_invisible', 'recaptcha_v2_enterprise'] as const);

/**
 * Tier 3 (implementation plan §6.4): a real, external reCAPTCHA v2 page, not
 * a static fixture. This is the tier that would have caught the prior
 * build's exact bug - "reviewed as correct, silently returned zero results
 * at runtime" - because it inspects the actual DOM element counts, not just
 * the final detector output. A detector is only "done" when this shows a
 * non-empty result AND no unexplained collapse between `elementCounts` and
 * the detector's own output.
 *
 * Gated behind `LIVE=1` (`npm run test:live`): hits a real external site,
 * so it is slow and can be flaky if Google changes the demo page's markup.
 */
describe('reCAPTCHA v2 - live Google demo page', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	});

	afterAll(async () => {
		await browser.close();
	});

	it('detects the visible reCAPTCHA v2 widget on the official demo page', async () => {
		const page = await browser.newPage();
		await page.goto('https://www.google.com/recaptcha/api2/demo', {
			waitUntil: 'networkidle',
			timeout: 45_000,
		});

		const elementCounts = await recordElementCounts(page, {
			'.g-recaptcha[data-sitekey]': '.g-recaptcha[data-sitekey]',
			'recaptcha-anchor-iframe': 'iframe[src*="recaptcha/api2/anchor"]',
		});

		const pageurl = page.url();
		const results: DetectionResult[] = [];
		const detectorRaw: Record<string, unknown> = {};

		for (const frame of page.frames()) {
			const hits = await detectRecaptchaV2(frame, ENABLED as any, pageurl);
			detectorRaw[frame.url()] = hits;
			for (const hit of hits) {
				results.push(stampDetection(hit, pageurl, frame.url()));
			}
		}

		const deduped = dedupeDetections(results);

		const trace: StageTrace = {
			frames: page.frames().map((f, index) => ({ url: f.url(), index })),
			elementCounts,
			detectorRaw,
			afterFilter: { recaptcha_v2: { count: results.length } },
			afterDedupe: deduped,
		};

		if (isBugSignature(elementCounts, results.length)) {
			await captureFailureArtifacts(page, 'recaptcha-v2-demo', trace);
		}

		await page.close();

		// eslint-disable-next-line no-console
		console.log('[live trace] recaptcha-v2-demo:', JSON.stringify(trace, null, 2));

		expect(
			deduped.length,
			`Expected at least one reCAPTCHA v2 detection. elementCounts=${JSON.stringify(elementCounts)} - if this is 0 while elementCounts > 0, check tests/live/__artifacts__ for a screenshot + full trace.`,
		).toBeGreaterThan(0);
		expect(deduped.some((item) => item.type.startsWith('recaptcha_v2'))).toBe(true);
	});
});
