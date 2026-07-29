import { describe, expect, it } from 'vitest';
import { normalizeCaptchaTypes } from '../../nodes/CaptchaAiDetect/libs/normalize-captcha-types';
import { ALL_CAPTCHA_TYPES } from '../../nodes/CaptchaAiDetect/libs/types';

describe('normalizeCaptchaTypes', () => {
	it('returns all types for null/undefined/empty', () => {
		expect(normalizeCaptchaTypes(null)).toEqual(ALL_CAPTCHA_TYPES);
		expect(normalizeCaptchaTypes(undefined)).toEqual(ALL_CAPTCHA_TYPES);
		expect(normalizeCaptchaTypes([])).toEqual(ALL_CAPTCHA_TYPES);
	});

	it('accepts a single type string (n8n edge case)', () => {
		expect(normalizeCaptchaTypes('recaptcha_v2')).toEqual(['recaptcha_v2']);
	});

	it('accepts comma-separated string', () => {
		expect(normalizeCaptchaTypes('recaptcha_v2, turnstile')).toEqual(['recaptcha_v2', 'turnstile']);
	});

	it('accepts string array', () => {
		expect(normalizeCaptchaTypes(['recaptcha_v2', 'turnstile'])).toEqual(['recaptcha_v2', 'turnstile']);
	});
});
