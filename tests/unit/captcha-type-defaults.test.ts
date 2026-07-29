import { describe, expect, it } from 'vitest';
import { ALL_CAPTCHA_TYPES } from '../../nodes/CaptchaAiDetect/libs/types';
import { nodeProperties } from '../../nodes/CaptchaAiDetect/descriptions';

describe('CAPTCHA Types node property default', () => {
	it('matches ALL_CAPTCHA_TYPES exactly (the two are kept as separate literals for lint reasons)', () => {
		const captchaTypesProp = nodeProperties.find((p) => p.name === 'captchaTypes');
		expect(captchaTypesProp).toBeDefined();
		expect(captchaTypesProp!.default).toEqual(ALL_CAPTCHA_TYPES);
	});

	it('every option value in the property matches an ALL_CAPTCHA_TYPES entry', () => {
		const captchaTypesProp = nodeProperties.find((p) => p.name === 'captchaTypes');
		const optionValues = (captchaTypesProp!.options as Array<{ value: string }>).map((o) => o.value);
		expect(new Set(optionValues)).toEqual(new Set(ALL_CAPTCHA_TYPES));
	});
});
