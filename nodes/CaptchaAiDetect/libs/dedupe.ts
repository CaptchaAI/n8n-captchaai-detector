import type { DetectionResult } from './types';

/**
 * Dedupe key (locked decision): `(type, sitekey, frameUrl, action)`. Same
 * sitekey found in two different frames yields two items - do not collapse
 * legitimate same-sitekey hits found in different frames.
 */
export function buildDedupeKey(
	item: Pick<DetectionResult, 'type' | 'sitekey' | 'frameUrl' | 'action'>,
): string {
	return [item.type, item.sitekey ?? '', item.frameUrl, item.action ?? ''].join('::');
}

export function dedupeDetections(items: DetectionResult[]): DetectionResult[] {
	const seen = new Set<string>();
	const out: DetectionResult[] = [];

	for (const item of items) {
		const key = buildDedupeKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}

	return out;
}
