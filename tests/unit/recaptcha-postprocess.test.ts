import { describe, expect, it } from 'vitest';
import { postProcessRecaptchaClassifications } from '../../nodes/CaptchaAiDetect/libs/recaptcha-postprocess';
import type { DetectionResult } from '../../nodes/CaptchaAiDetect/libs/types';

function item(partial: Partial<DetectionResult> & Pick<DetectionResult, 'type'>): DetectionResult {
	return {
		pageurl: 'https://example.com/',
		frameUrl: 'https://example.com/',
		source: 'dom',
		solveParams: { method: 'userrecaptcha' },
		...partial,
	};
}

describe('postProcessRecaptchaClassifications', () => {
	it('drops v2 hits when the same sitekey was detected as v3', () => {
		const sitekey = 'shared-key';
		const out = postProcessRecaptchaClassifications([
			item({ type: 'recaptcha_v3', sitekey, source: 'script-tag' }),
			item({ type: 'recaptcha_v2_enterprise', sitekey }),
		]);
		expect(out.map((r) => r.type)).toEqual(['recaptcha_v3']);
	});

	it('drops grid_image when a recaptcha v2 family widget is present', () => {
		const out = postProcessRecaptchaClassifications([
			item({ type: 'recaptcha_v2_invisible', sitekey: 'inv-key' }),
			item({ type: 'grid_image', source: 'dom', solveParams: { method: 'base64', body: 'x' } }),
		]);
		expect(out.map((r) => r.type)).toEqual(['recaptcha_v2_invisible']);
	});
});
