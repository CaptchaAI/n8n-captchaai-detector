import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import type { CaptchaTypeName, CaptchaaiDetectHookStore, RawDetection } from '../libs/types';
import type { GeetestNetworkHit } from '../hooks/geetest-network';

/**
 * GeeTest v3 params (`gt`, `challenge`, `api_server`) come ONLY from the
 * `initGeetest` hook (`hooks/init-script.ts`, ported from
 * `main-world.ts:1458-1476`) - the DOM detector
 * (`detector.ts:3078-3089`) yields no parameters at all, it only sets a
 * flag. The hook is top-frame only (implementation plan §4.3).
 *
 * GeeTest v4 is fully out of scope: no hook, no detector, no output field,
 * no stub.
 */
export function processGeetestHookStore(
	store: CaptchaaiDetectHookStore | null,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
	networkHits: GeetestNetworkHit[] = [],
): RawDetection[] {
	if (!enabledTypes.has('geetest_v3')) return [];
	const out: RawDetection[] = [];
	const seen = new Set<string>();

	const ingest = (entry: { gt: string; challenge: string; apiServer?: string }, source: 'hook' | 'network') => {
		if (!entry.gt || !entry.challenge) return;
		const dedupeKey = `${entry.gt}:${entry.challenge}`;
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		out.push({
			type: 'geetest_v3',
			source,
			gt: entry.gt,
			challenge: entry.challenge,
			apiServer: entry.apiServer,
			solveParams: {
				method: 'geetest',
				gt: entry.gt,
				challenge: entry.challenge,
				pageurl,
				...(entry.apiServer ? { api_server: entry.apiServer } : {}),
			},
		});
	};

	if (store) {
		for (const entry of store.geetestV3) {
			ingest(entry, 'hook');
		}
	}
	for (const entry of networkHits) {
		ingest(entry, 'network');
	}

	return out;
}

function detectGeetestWidgetVisibleInPage(): { widgetVisible: boolean; scriptPresent: boolean } {
	const isVisibleFn = isVisible as any;
	const widgets = Array.from(
		document.querySelectorAll('.geetest_widget, .geetest_panel, .geetest_holder, .geetest_box'),
	);
	const widgetVisible = widgets.some((el) => isVisibleFn(el));
	const scriptPresent =
		document.querySelector(
			'script[src*="gt.js"], script[src*="geetest.com"], script[src*="static.geetest.com"]',
		) !== null;
	return { widgetVisible, scriptPresent };
}

/**
 * Presence-only signal: a GeeTest widget is visible in this frame but no
 * `initGeetest` hook data exists for it (either because it needs a
 * `triggerSelector` interaction, or because it lives in a subframe the
 * top-frame-only hook can never see). Skipped for the top frame when a full
 * hook-derived item was already produced there, to avoid reporting the same
 * page-level widget twice under two different `source` values.
 */
export async function detectGeetestPresence(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	options: { isTopFrame: boolean; hasHookResults: boolean },
): Promise<RawDetection[]> {
	if (!enabledTypes.has('geetest_v3')) return [];
	if (options.isTopFrame && options.hasHookResults) return [];

	const script = composeBrowserScript([isVisible], detectGeetestWidgetVisibleInPage, undefined);
	const signals = (await frame.evaluate(script)) as { widgetVisible: boolean; scriptPresent: boolean };
	if (!signals.widgetVisible && !signals.scriptPresent) return [];

	return [
		{
			type: 'geetest_v3',
			source: 'dom',
			presenceOnly: true,
			solveParams: {
				method: 'geetest',
			},
		},
	];
}
