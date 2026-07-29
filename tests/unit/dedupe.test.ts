import { describe, expect, it } from 'vitest';
import { buildDedupeKey, dedupeDetections } from '../../nodes/CaptchaAiDetect/libs/dedupe';
import type { DetectionResult } from '../../nodes/CaptchaAiDetect/libs/types';

function makeResult(overrides: Partial<DetectionResult>): DetectionResult {
	return {
		type: 'turnstile',
		pageurl: 'https://example.com/',
		frameUrl: 'https://example.com/',
		source: 'dom',
		sitekey: '1x00000000000000000000AA',
		solveParams: { method: 'turnstile' },
		...overrides,
	};
}

describe('buildDedupeKey', () => {
	it('is (type, sitekey, frameUrl, action)', () => {
		const key = buildDedupeKey({
			type: 'recaptcha_v2',
			sitekey: 'abc',
			frameUrl: 'https://example.com/',
			action: 'login',
		});
		expect(key).toBe('recaptcha_v2::abc::https://example.com/::login');
	});

	it('treats missing sitekey/action as empty string, not "undefined"', () => {
		const key = buildDedupeKey({
			type: 'grid_image',
			sitekey: undefined,
			frameUrl: 'https://example.com/',
			action: null,
		});
		expect(key).toBe('grid_image::::https://example.com/::');
	});
});

describe('dedupeDetections', () => {
	it('does NOT collapse the same sitekey found in two different frames', () => {
		const results = [
			makeResult({ frameUrl: 'https://example.com/' }),
			makeResult({ frameUrl: 'https://example.com/iframe' }),
		];
		expect(dedupeDetections(results)).toHaveLength(2);
	});

	it('collapses true duplicates: same type, sitekey, frameUrl, and action', () => {
		const results = [makeResult({}), makeResult({})];
		expect(dedupeDetections(results)).toHaveLength(1);
	});

	it('keeps two items for the same sitekey with different actions', () => {
		const results = [
			makeResult({ type: 'recaptcha_v3', action: 'login', solveParams: { method: 'userrecaptcha' } }),
			makeResult({ type: 'recaptcha_v3', action: 'signup', solveParams: { method: 'userrecaptcha' } }),
		];
		expect(dedupeDetections(results)).toHaveLength(2);
	});
});
