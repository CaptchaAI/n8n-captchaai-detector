import type { Page } from 'playwright';
import type { CaptchaaiDetectHookStore } from '../libs/types';

/**
 * Reads back `window.__captchaaiDetect`, installed by
 * `hooks/init-script.ts`. Deliberately a SINGLE top-frame read
 * (`page.mainFrame()`), not a per-frame sweep - the hook script only ever
 * installs in the top frame (see the implementation plan §4.2-4.3), so a
 * subframe's `window.__captchaaiDetect` would always be `undefined` anyway.
 */
export async function readHookStore(page: Page): Promise<CaptchaaiDetectHookStore | null> {
	return page.mainFrame().evaluate(() => {
		const w = window as any;
		return w.__captchaaiDetect || null;
	});
}
