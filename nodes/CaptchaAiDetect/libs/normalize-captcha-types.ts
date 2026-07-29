import { ALL_CAPTCHA_TYPES, type CaptchaTypeName } from './types';

const TYPE_SET = new Set<string>(ALL_CAPTCHA_TYPES);

function isCaptchaTypeName(value: string): value is CaptchaTypeName {
	return TYPE_SET.has(value);
}

/**
 * n8n `multiOptions` usually returns `string[]`, but expressions, older
 * workflows, or a single selection can arrive as a string. Passing a string
 * into `new Set(...)` iterates characters and disables every detector.
 */
export function normalizeCaptchaTypes(raw: unknown): CaptchaTypeName[] {
	if (raw == null) return [...ALL_CAPTCHA_TYPES];

	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) return [...ALL_CAPTCHA_TYPES];
		const parts = trimmed.includes(',')
			? trimmed.split(',').map((s) => s.trim())
			: [trimmed];
		const valid = parts.filter(isCaptchaTypeName);
		return valid.length > 0 ? valid : [...ALL_CAPTCHA_TYPES];
	}

	if (Array.isArray(raw)) {
		const values: string[] = [];
		for (const entry of raw) {
			if (typeof entry === 'string') {
				values.push(entry);
			} else if (entry && typeof entry === 'object' && 'value' in entry) {
				const v = (entry as { value?: unknown }).value;
				if (typeof v === 'string') values.push(v);
			}
		}
		const valid = values.filter(isCaptchaTypeName);
		return valid.length > 0 ? valid : [...ALL_CAPTCHA_TYPES];
	}

	return [...ALL_CAPTCHA_TYPES];
}
