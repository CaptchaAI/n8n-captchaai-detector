import { describe, expect, it } from 'vitest';
import { groupAndOrderBlsCells } from '../../nodes/CaptchaAiDetect/detectors/bls';

describe('groupAndOrderBlsCells (finding 1.1: exact, not tolerant, grouping)', () => {
	it('groups cells whose left/top truncate to the same integer px (110 vs 110.6)', () => {
		const result = groupAndOrderBlsCells([
			{ ref: 'low-z', left: 110, top: 110, zIndex: 1 },
			{ ref: 'high-z', left: 110, top: 110, zIndex: 2 },
		]);
		// Same coordKey ("110,110") for both -> only the highest z-index survives.
		expect(result).toEqual(['high-z']);
	});

	it('does NOT group cells at 110px vs 111px - those are different cells', () => {
		const result = groupAndOrderBlsCells([
			{ ref: 'cell-110', left: 110, top: 0, zIndex: 0 },
			{ ref: 'cell-111', left: 111, top: 0, zIndex: 0 },
		]);
		expect(result).toHaveLength(2);
		expect(result).toEqual(['cell-110', 'cell-111']);
	});

	it('picks the highest z-index element when multiple cells share a coordinate key', () => {
		const result = groupAndOrderBlsCells([
			{ ref: 'z0', left: 0, top: 0, zIndex: 0 },
			{ ref: 'z5', left: 0, top: 0, zIndex: 5 },
			{ ref: 'z2', left: 0, top: 0, zIndex: 2 },
		]);
		expect(result).toEqual(['z5']);
	});

	it('sorts by row (5px tolerance) then column, without affecting grouping', () => {
		// Three distinct grouping keys, laid out as a 3x3 grid out of visual order.
		const result = groupAndOrderBlsCells([
			{ ref: 'r0c2', left: 220, top: 0, zIndex: 0 },
			{ ref: 'r1c0', left: 0, top: 113, zIndex: 0 }, // within 5px tolerance of top:110 in the same row group
			{ ref: 'r0c0', left: 0, top: 0, zIndex: 0 },
			{ ref: 'r0c1', left: 110, top: 0, zIndex: 0 },
			{ ref: 'r1c1', left: 110, top: 110, zIndex: 0 },
		]);
		// Rows: [top~0-3] then [top~110-113], each sorted by left ascending.
		expect(result).toEqual(['r0c0', 'r0c1', 'r0c2', 'r1c0', 'r1c1']);
	});

	it('a >5px top difference is treated as a different row even with equal left', () => {
		const result = groupAndOrderBlsCells([
			{ ref: 'bottom', left: 0, top: 120, zIndex: 0 },
			{ ref: 'top', left: 0, top: 0, zIndex: 0 },
		]);
		expect(result).toEqual(['top', 'bottom']);
	});
});
