import type { Browser, Page } from 'playwright';
import { detectBls } from '../detectors/bls';
import { detectCaptchaFox } from '../detectors/captchafox';
import { detectFriendlyCaptcha } from '../detectors/friendly-captcha';
import { detectGeetestPresence, processGeetestHookStore } from '../detectors/geetest-v3';
import { detectGridImage } from '../detectors/grid-image';
import { detectLemin } from '../detectors/lemin';
import { detectNormalImage } from '../detectors/normal-image';
import { detectRecaptchaV2 } from '../detectors/recaptcha-v2';
import { detectRecaptchaV3ScriptTag, processRecaptchaHookStore } from '../detectors/recaptcha-v3';
import { detectTurnstileDom } from '../detectors/turnstile';
import { launchBrowser, navigateAndSettle, waitForImagesToSettle } from './browser';
import { browserEvalPreamble } from '../dom/compose';
import { dedupeDetections } from './dedupe';
import { getFrameUrl } from './frames';
import { captchaaiDetectHookInitScript } from '../hooks/init-script';
import { GeetestNetworkWatcher } from '../hooks/geetest-network';
import { CaptchaFoxNetworkWatcher } from '../hooks/network';
import { readHookStore } from '../hooks/store';
import { stampDetection } from './output';
import { normalizeCaptchaTypes } from './normalize-captcha-types';
import { postProcessRecaptchaClassifications } from './recaptcha-postprocess';
import type { CaptchaTypeName, DetectionResult, NodeDetectOptions, RawDetection } from './types';

const IMAGE_TYPES = new Set<CaptchaTypeName>(['normal_image', 'grid_image', 'bls']);

async function runDetectorStep(
	label: string,
	frameUrl: string,
	run: () => Promise<RawDetection[]>,
): Promise<RawDetection[]> {
	try {
		return await run();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const likelyBenign =
			/(detached|Target closed|Frame was detached|Execution context was destroyed)/i.test(message);
		if (!likelyBenign) {
			void label;
			void frameUrl;
			void error;
		}
		return [];
	}
}

/**
 * One full sweep across every frame: runs every enabled DOM detector in
 * every frame (implementation plan §4.2), merges in the top-frame-only hook
 * store (§4.3), and optionally the CaptchaFox trigger-click path (§5, only
 * ever run on the very first sweep - see `runDetection` below).
 */
async function collectFullSweep(
	page: Page,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
	options: { imageSelector?: string; inputSelector?: string },
	networkWatcher: CaptchaFoxNetworkWatcher,
	geetestNetworkWatcher: GeetestNetworkWatcher,
	includeCaptchaFox: boolean,
): Promise<DetectionResult[]> {
	const results: DetectionResult[] = [];
	const store = await readHookStore(page);
	const geetestNetworkHits = geetestNetworkWatcher.getHits();
	const hookRecaptcha = processRecaptchaHookStore(store, enabledTypes, pageurl);
	const hookGeetest = processGeetestHookStore(store, enabledTypes, pageurl, geetestNetworkHits);
	results.push(...stampAll(hookRecaptcha, pageurl, pageurl));
	results.push(...stampAll(hookGeetest, pageurl, pageurl));

	const hasHookGeetest = hookGeetest.length > 0;
	const mainFrame = page.mainFrame();
	const needsImageSettle = [...enabledTypes].some((type) => IMAGE_TYPES.has(type));

	for (const frame of page.frames()) {
		const frameUrl = getFrameUrl(frame);
		const isTopFrame = frame === mainFrame;

		try {
			if (needsImageSettle) {
				await waitForImagesToSettle(frame);
			}

			const perFrame: RawDetection[] = [];

			perFrame.push(
				...(await runDetectorStep('recaptcha_v2', frameUrl, () =>
					detectRecaptchaV2(frame, enabledTypes, pageurl))),
			);

			const turnstile = await runDetectorStep('turnstile', frameUrl, async () => {
				const t = await detectTurnstileDom(frame, enabledTypes, pageurl);
				return t.detections;
			});
			perFrame.push(...turnstile);

			perFrame.push(
				...(await runDetectorStep('friendly_captcha', frameUrl, () =>
					detectFriendlyCaptcha(frame, enabledTypes, pageurl))),
			);
			perFrame.push(
				...(await runDetectorStep('recaptcha_v3_script', frameUrl, () =>
					detectRecaptchaV3ScriptTag(frame, enabledTypes, pageurl))),
			);
			perFrame.push(
				...(await runDetectorStep('geetest_presence', frameUrl, () =>
					detectGeetestPresence(frame, enabledTypes, { isTopFrame, hasHookResults: hasHookGeetest }))),
			);
			perFrame.push(
				...(await runDetectorStep('grid_image', frameUrl, () => detectGridImage(frame, enabledTypes, pageurl))),
			);
			perFrame.push(
				...(await runDetectorStep('bls', frameUrl, () => detectBls(frame, enabledTypes))),
			);
			perFrame.push(
				...(await runDetectorStep('normal_image', frameUrl, () =>
					detectNormalImage(frame, enabledTypes, options))),
			);
			perFrame.push(
				...(await runDetectorStep('lemin', frameUrl, () => detectLemin(frame, enabledTypes, pageurl))),
			);

			results.push(...stampAll(perFrame, pageurl, frameUrl));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const likelyBenign =
				/(detached|Target closed|Frame was detached|Execution context was destroyed)/i.test(message);
			if (!likelyBenign) {
				void error;
			}
		}
	}

	if (includeCaptchaFox) {
		const captchaFox = await detectCaptchaFox(page, enabledTypes, pageurl, networkWatcher);
		results.push(...stampAll(captchaFox, pageurl, pageurl));
	}

	return results;
}

/** Cheap re-poll used during the `triggerSelector` wait: hook store only. */
async function collectHookOnly(
	page: Page,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
	geetestNetworkWatcher: GeetestNetworkWatcher,
): Promise<RawDetection[]> {
	const store = await readHookStore(page);
	return [
		...processRecaptchaHookStore(store, enabledTypes, pageurl),
		...processGeetestHookStore(store, enabledTypes, pageurl, geetestNetworkWatcher.getHits()),
	];
}

function stampAll(raw: RawDetection[], pageurl: string, frameUrl: string): DetectionResult[] {
	return raw.map((item) => stampDetection(item, pageurl, frameUrl));
}

const TRIGGER_POLL_COUNT = 5;
const TRIGGER_POLL_INTERVAL_MS = 500;

export async function runDetection(options: NodeDetectOptions): Promise<DetectionResult[]> {
	const enabledTypes = new Set<CaptchaTypeName>(normalizeCaptchaTypes(options.captchaTypes));
	let browser: Browser | undefined;

	try {
		browser = await launchBrowser();
		const context = await browser.newContext();
		const hookInitSource = `${browserEvalPreamble()}\n(${captchaaiDetectHookInitScript.toString()})();`;
		await context.addInitScript(hookInitSource);
		const page = await context.newPage();
		const networkWatcher = new CaptchaFoxNetworkWatcher(page);
		const geetestNetworkWatcher = new GeetestNetworkWatcher(page);

		try {
			await navigateAndSettle(page, options.url, options.timeoutMs);
			const pageurl = page.url();

			const results: DetectionResult[] = await collectFullSweep(
				page,
				enabledTypes,
				pageurl,
				options,
				networkWatcher,
				geetestNetworkWatcher,
				true,
			);

			if (options.triggerSelector) {
				try {
					await page.click(options.triggerSelector, { timeout: 5000 });
				} catch {
					// Trigger selector not found/clickable - proceed with what was already collected.
				}

				// Cheap hook-only re-reads for most of the wait; the DOM pass is
				// re-run across all frames only on the final iteration (implementation
				// plan §4.4), since a trigger click commonly renders a widget that
				// was not in the DOM at settle time. CaptchaFox is never re-clicked
				// here - `includeCaptchaFox` stays `false` for every poll iteration.
				for (let i = 0; i < TRIGGER_POLL_COUNT; i++) {
					await page.waitForTimeout(TRIGGER_POLL_INTERVAL_MS);
					const isLast = i === TRIGGER_POLL_COUNT - 1;
					const more = isLast
						? await collectFullSweep(page, enabledTypes, pageurl, options, networkWatcher, geetestNetworkWatcher, false)
						: stampAll(
								await collectHookOnly(page, enabledTypes, pageurl, geetestNetworkWatcher),
								pageurl,
								pageurl,
							);
					results.push(...more);
				}
			}

			networkWatcher.dispose();
			geetestNetworkWatcher.dispose();
			return postProcessRecaptchaClassifications(dedupeDetections(results));
		} finally {
			await context.close().catch(() => undefined);
		}
	} finally {
		if (browser) await browser.close().catch(() => undefined);
	}
}
