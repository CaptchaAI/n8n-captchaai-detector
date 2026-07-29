import { describe, expect, it } from 'vitest';
import { blsDataUriToRawBase64, blsHitToDetection } from '../../nodes/CaptchaAiDetect/detectors/bls';

describe('blsHitToDetection', () => {
	it('emits one item with nine imagesBase64 slots and blsImage1…9 for the solve node', () => {
		const item = blsHitToDetection({
			instructions: '249',
			images: [
				'data:image/jpeg;base64,AAA',
				'',
				'data:image/jpeg;base64,BBB',
				'',
				'',
				'',
				'',
				'',
				'data:image/jpeg;base64,CCC',
			],
		});

		expect(item.type).toBe('bls');
		expect(item.imagesBase64).toHaveLength(9);
		expect(item.imagesBase64![0]).toBe('AAA');
		expect(item.imagesBase64![2]).toBe('BBB');
		expect(item.imagesBase64![8]).toBe('CCC');
		expect(item.blsImage1).toBe('AAA');
		expect(item.blsImage3).toBe('BBB');
		expect(item.blsImage9).toBe('CCC');
		expect(item.blsImage2).toBe('');
		expect(item.solveParams.image_base64_1).toBe('data:image/jpeg;base64,AAA');
		expect(item.solveParams.image_base64_9).toBe('data:image/jpeg;base64,CCC');
		expect(item.solveParams.image_base64_2).toBeUndefined();
	});

	it('strips data URI prefix for field values', () => {
		expect(blsDataUriToRawBase64('data:image/jpeg;base64,xyz')).toBe('xyz');
	});

	it('keeps JPEG raw base64 that starts with /9j/', () => {
		const item = blsHitToDetection({
			instructions: '1',
			images: ['data:image/jpeg;base64,/9j/4AAQ=test'],
		});
		expect(item.blsImage1).toMatch(/^\/9j\//);
		expect(item.imagesBase64![0]).toMatch(/^\/9j\//);
	});
});
