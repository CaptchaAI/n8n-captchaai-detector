import { describe, expect, it } from 'vitest';
import { parseRenderSitekeyFromScriptSrc } from '../../nodes/CaptchaAiDetect/detectors/recaptcha-v3';

describe('parseRenderSitekeyFromScriptSrc', () => {
	it('parses a v3 sitekey from api.js', () => {
		expect(parseRenderSitekeyFromScriptSrc('https://www.google.com/recaptcha/api.js?render=6Lc123')).toEqual({
			sitekey: '6Lc123',
			enterprise: false,
		});
	});

	it('classifies enterprise.js separately from api.js (the source pools these into one flag-less set)', () => {
		expect(
			parseRenderSitekeyFromScriptSrc('https://www.google.com/recaptcha/enterprise.js?render=6Lc999'),
		).toEqual({ sitekey: '6Lc999', enterprise: true });
	});

	it('returns null for render=explicit (that is a v2-explicit-render marker, not v3)', () => {
		expect(
			parseRenderSitekeyFromScriptSrc('https://www.google.com/recaptcha/api.js?render=explicit'),
		).toBeNull();
	});

	it('returns null when there is no render param at all', () => {
		expect(parseRenderSitekeyFromScriptSrc('https://www.google.com/recaptcha/api.js')).toBeNull();
	});

	it('decodes a URI-encoded sitekey', () => {
		expect(
			parseRenderSitekeyFromScriptSrc('https://www.google.com/recaptcha/api.js?render=6L%20c1'),
		).toEqual({ sitekey: '6L c1', enterprise: false });
	});
});
