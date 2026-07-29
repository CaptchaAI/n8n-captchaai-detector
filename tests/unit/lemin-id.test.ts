import { describe, expect, it } from 'vitest';
import {
	extractLeminCaptchaIdFromText,
	normalizeLeminCaptchaId,
} from '../../nodes/CaptchaAiDetect/detectors/lemin';

describe('normalizeLeminCaptchaId', () => {
	it('accepts a plausible captcha id', () => {
		expect(normalizeLeminCaptchaId('PUBLIC-abc123def456')).toBe('PUBLIC-abc123def456');
	});

	it('rejects known bundler/asset noise tokens', () => {
		expect(normalizeLeminCaptchaId('lemin')).toBeNull();
		expect(normalizeLeminCaptchaId('captcha')).toBeNull();
		expect(normalizeLeminCaptchaId('assets')).toBeNull();
	});

	it('rejects bundle/chunk-style filenames', () => {
		expect(normalizeLeminCaptchaId('main.js')).toBeNull();
		expect(normalizeLeminCaptchaId('vendor')).toBeNull();
		expect(normalizeLeminCaptchaId('chunk.abc123')).toBeNull();
	});

	it('rejects static asset extensions', () => {
		expect(normalizeLeminCaptchaId('sprite.png')).toBeNull();
		expect(normalizeLeminCaptchaId('styles.css')).toBeNull();
	});

	it('rejects values shorter than 8 characters', () => {
		expect(normalizeLeminCaptchaId('short')).toBeNull();
	});

	it('decodes a URI-encoded value before validating', () => {
		expect(normalizeLeminCaptchaId('PUBLIC-abc%20123456')).toBe('PUBLIC-abc 123456');
	});

	it('returns null for empty/whitespace input', () => {
		expect(normalizeLeminCaptchaId('')).toBeNull();
		expect(normalizeLeminCaptchaId('   ')).toBeNull();
		expect(normalizeLeminCaptchaId(null)).toBeNull();
		expect(normalizeLeminCaptchaId(undefined)).toBeNull();
	});
});

describe('extractLeminCaptchaIdFromText', () => {
	it('extracts an id from a /cropped/ path segment', () => {
		expect(extractLeminCaptchaIdFromText('https://cdn.example.com/cropped/PUBLIC-abcdef123456')).toBe(
			'PUBLIC-abcdef123456',
		);
	});

	it('extracts an id from a /puzzle/ path segment', () => {
		expect(extractLeminCaptchaIdFromText('https://cdn.example.com/puzzle/PUBLIC-98765432')).toBe(
			'PUBLIC-98765432',
		);
	});

	it('extracts an id from a captcha_id=value pattern', () => {
		expect(extractLeminCaptchaIdFromText('captcha_id=PUBLIC-abcdefgh')).toBe('PUBLIC-abcdefgh');
	});

	it('extracts an id from a data-captcha-id="value" attribute pattern', () => {
		expect(extractLeminCaptchaIdFromText('<div data-captcha-id="PUBLIC-longenough123">')).toBe(
			'PUBLIC-longenough123',
		);
	});

	it('returns null when nothing matches or the only match is rejected noise', () => {
		expect(extractLeminCaptchaIdFromText('just some unrelated page text')).toBeNull();
		expect(extractLeminCaptchaIdFromText('/cropped/lemin')).toBeNull();
	});
});
