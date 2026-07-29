import { describe, expect, it } from 'vitest';
import { extractCaptchaFoxSitekeyFromUrl } from '../../nodes/CaptchaAiDetect/hooks/network';

describe('extractCaptchaFoxSitekeyFromUrl', () => {
	it('extracts the sitekey from a well-formed challenge URL', () => {
		expect(
			extractCaptchaFoxSitekeyFromUrl('https://api.captchafox.com/captcha/abc123/challenge'),
		).toBe('abc123');
	});

	it('extracts the sitekey with a trailing slash', () => {
		expect(
			extractCaptchaFoxSitekeyFromUrl('https://api.captchafox.com/captcha/abc123/challenge/'),
		).toBe('abc123');
	});

	it('decodes a URI-encoded sitekey segment', () => {
		expect(
			extractCaptchaFoxSitekeyFromUrl('https://api.captchafox.com/captcha/abc%20123/challenge'),
		).toBe('abc 123');
	});

	it('returns null for a different host', () => {
		expect(extractCaptchaFoxSitekeyFromUrl('https://example.com/captcha/abc123/challenge')).toBeNull();
	});

	it('returns null for a captchafox URL that is not a challenge request', () => {
		expect(extractCaptchaFoxSitekeyFromUrl('https://api.captchafox.com/captcha/abc123/status')).toBeNull();
	});

	it('returns null for an unrelated URL', () => {
		expect(extractCaptchaFoxSitekeyFromUrl('https://example.com/')).toBeNull();
	});
});
