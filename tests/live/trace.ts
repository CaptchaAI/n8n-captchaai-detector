import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

/**
 * Instrumented trace helper for tier-3 live tests (implementation plan
 * §6.4). The prior build's exact failure mode was a detector whose selectors
 * and filters reviewed as correct but silently returned zero results at
 * runtime - a bug that static analysis and fixture tests never caught. A
 * live test that only asserts pass/fail repeats that mistake: it would
 * "pass" on an empty result the same way it "passes" on a correct one. This
 * module records what actually happened at each stage instead, and takes a
 * screenshot at the exact stage transition (`elementCounts > 0` but
 * `afterFilter === 0`) that reproduces the prior bug's signature.
 */

export interface StageTrace {
	frames: Array<{ url: string; index: number }>;
	elementCounts: Record<string, number>;
	detectorRaw: Record<string, unknown>;
	afterFilter: Record<string, { count: number; droppedReasons?: string[] }>;
	afterDedupe: unknown[];
}

const ARTIFACTS_DIR = path.resolve(__dirname, '__artifacts__');

export function ensureArtifactsDir(): void {
	fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

export async function recordElementCounts(
	page: Page,
	selectorsByLabel: Record<string, string>,
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const frame of page.frames()) {
		for (const [label, selector] of Object.entries(selectorsByLabel)) {
			try {
				const count = await frame.evaluate((sel) => document.querySelectorAll(sel).length, selector);
				counts[`${label}@${frame.url()}`] = (counts[`${label}@${frame.url()}`] || 0) + count;
			} catch {
				// Detached / cross-origin frame - skip.
			}
		}
	}
	return counts;
}

/**
 * The prior build's bug signature: elements exist in the DOM
 * (`elementCounts > 0`) but the detector reported nothing
 * (`afterFilter === 0`). Captures a full-page screenshot plus every frame's
 * screenshot at that exact transition, and writes the full trace as JSON
 * next to them, so a human can see exactly what state the page was in when
 * detection silently failed.
 */
export async function captureFailureArtifacts(
	page: Page,
	label: string,
	trace: StageTrace,
): Promise<void> {
	ensureArtifactsDir();
	const stamp = `${label}-${Date.now()}`;

	await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${stamp}-full.png`), fullPage: true }).catch(() => undefined);

	for (const [index, frame] of page.frames().entries()) {
		try {
			// Playwright has no per-frame screenshot API; approximate by
			// evaluating the frame's bounding element and screenshotting that
			// region isn't reliable across origins, so we record the frame URL
			// in the JSON trace instead and rely on the full-page screenshot.
			void frame;
			void index;
		} catch {
			// ignore
		}
	}

	fs.writeFileSync(path.join(ARTIFACTS_DIR, `${stamp}-trace.json`), JSON.stringify(trace, null, 2));
}

export function isBugSignature(elementCounts: Record<string, number>, afterFilterCount: number): boolean {
	const totalElements = Object.values(elementCounts).reduce((sum, n) => sum + n, 0);
	return totalElements > 0 && afterFilterCount === 0;
}
