import type { DetectionResult } from './types';

const V2_TYPES = new Set(['recaptcha_v2', 'recaptcha_v2_invisible', 'recaptcha_v2_enterprise']);
const V3_TYPES = new Set(['recaptcha_v3', 'recaptcha_v3_enterprise']);

/**
 * reCAPTCHA v3 pages expose an invisible badge iframe that the v2 DOM detector
 * can misread as v2 (often enterprise when enterprise.js is loaded). Drop v2
 * hits when the same sitekey was already classified as v3 on this run.
 */
export function suppressV2WhenV3Present(items: DetectionResult[]): DetectionResult[] {
	const v3Sitekeys = new Set<string>();
	for (const item of items) {
		if (item.sitekey && V3_TYPES.has(item.type)) {
			v3Sitekeys.add(item.sitekey);
		}
	}
	if (v3Sitekeys.size === 0) return items;

	return items.filter((item) => {
		if (!item.sitekey || !V2_TYPES.has(item.type)) return true;
		return !v3Sitekeys.has(item.sitekey);
	});
}

/** Prefer v3 types over grid_image when both appear (invisible v2 image challenge). */
export function suppressGridWhenRecaptchaWidgetPresent(items: DetectionResult[]): DetectionResult[] {
	const hasRecaptchaWidget = items.some(
		(item) => item.type !== 'grid_image' && V2_TYPES.has(item.type),
	);
	if (!hasRecaptchaWidget) return items;
	return items.filter((item) => item.type !== 'grid_image');
}

/** Drop grid_image on pages that are explicitly invisible reCAPTCHA v2 demos. */
export function suppressGridOnInvisibleRecaptchaPage(items: DetectionResult[]): DetectionResult[] {
	const invisiblePage = items.some(
		(item) => item.pageurl && /[?&]invisible=true(?:&|$)/i.test(item.pageurl),
	);
	if (!invisiblePage) return items;
	return items.filter((item) => item.type !== 'grid_image');
}

export function postProcessRecaptchaClassifications(items: DetectionResult[]): DetectionResult[] {
	return suppressGridOnInvisibleRecaptchaPage(
		suppressGridWhenRecaptchaWidgetPresent(suppressV2WhenV3Present(items)),
	);
}
