import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { imageElementToCompactJpegDataUri, resizeCanvasToFit } from '../dom/image-capture';
import type { CaptchaTypeName, RawDetection, SolveParams } from '../libs/types';

interface RawBlsHit {
	instructions: string;
	images: string[]; // full data URIs, '' for a cell with no image element
}

export interface BlsCellEntry<T> {
	ref: T;
	left: number;
	top: number;
	zIndex: number;
}

/**
 * The EXACT (not tolerant) cell-grouping/ordering algorithm from finding 1.1
 * of the implementation plan, ported from `detector.ts:3157-3188`. Generic
 * over the cell reference type so the identical algorithm is both:
 *  - reusable inside `detectBlsInPage` below (`T = Element`), bundled via
 *    `composeBrowserScript`, and
 *  - directly unit-testable in plain Node with `T = string` - see
 *    `tests/unit/bls-grouping.test.ts`.
 *
 * Grouping key is `${parseInt(left)},${parseInt(top)}` - an EXACT string
 * match on truncated integer CSS px, not a rounded/tolerant bucket. Two
 * cells at `top: 110px` and `top: 110.6px` both truncate to `110` and DO
 * group; `110px` and `111px` do NOT group. The highest z-index entry per key
 * wins. Only the final sort uses a 5px row tolerance, and it never affects
 * which cells were grouped as the same cell - do not "improve" the grouping
 * step with a rounding bucket, that would silently reorder the 9-image array
 * the BLS API is index-sensitive about.
 */
export function groupAndOrderBlsCells<T>(entries: Array<BlsCellEntry<T>>): T[] {
	const coordGroups = new Map<string, BlsCellEntry<T>>();

	for (const entry of entries) {
		const coordKey = `${entry.left},${entry.top}`;
		const existing = coordGroups.get(coordKey);
		if (!existing || existing.zIndex < entry.zIndex) {
			coordGroups.set(coordKey, entry);
		}
	}

	const sorted = Array.from(coordGroups.values()).sort((a, b) => {
		if (Math.abs(a.top - b.top) > 5) return a.top - b.top;
		return a.left - b.left;
	});

	return sorted.map((entry) => entry.ref);
}

/**
 * Ported from `detector.ts:3091-3281` (`detectBLS`).
 */
function detectBlsInPage(): RawBlsHit | null {
	const items = document.querySelectorAll('.col-4');

	// If nothing is displayed yet, there is nothing usable this pass. The
	// extension's own retry-on-empty path (detector.ts:3105-3109) only ever
	// leads to a "No images found" solve failure anyway in that state, so a
	// one-shot detector treats it the same as "not present".
	const displayedItems = Array.from(items).filter((el) => el.getClientRects().length > 0);
	if (displayedItems.length === 0) return null;

	// --- Instructions: highest z-index .box-label (detector.ts:3124-3153) ---
	const instructionElements = document.querySelectorAll('.box-label');
	let highestZ = 0;
	let instructions = '';
	instructionElements.forEach((el) => {
		const zIndex = window.getComputedStyle(el).getPropertyValue('z-index');
		if (zIndex !== 'auto' && parseInt(zIndex, 10) > highestZ) {
			highestZ = parseInt(zIndex, 10);
			instructions = ((el as HTMLElement).innerText || '').replace(/\D/g, '');
		}
	});

	let rawInstructions = '';
	if (!instructions) {
		rawInstructions = Array.from(instructionElements)
			.map((el) => (el as HTMLElement).innerText || '')
			.join(' ');
	} else {
		rawInstructions = Array.from(instructionElements)
			.filter((el) => window.getComputedStyle(el).getPropertyValue('z-index') === highestZ.toString())
			.map((el) => (el as HTMLElement).innerText || '')
			.join(' ');
		if (!rawInstructions) rawInstructions = instructions;
	}

	// --- Cell grouping (finding 1.1: EXACT match, not tolerant) ---
	const groupAndOrderBlsCellsFn = groupAndOrderBlsCells as any;
	const cellEntries: Array<{ ref: Element; left: number; top: number; zIndex: number }> = [];

	Array.from(document.querySelectorAll('.col-4')).forEach((el) => {
		if (el.getClientRects().length === 0) return;
		const style = window.getComputedStyle(el);
		const leftStr = style.getPropertyValue('left');
		const topStr = style.getPropertyValue('top');
		const left = parseInt(leftStr, 10) || 0;
		const top = parseInt(topStr, 10) || 0;
		if (style.display === 'none') return;
		const zIndexStr = style.getPropertyValue('z-index');
		const zIndex = zIndexStr === 'auto' ? 0 : parseInt(zIndexStr, 10);
		cellEntries.push({ ref: el, left, top, zIndex });
	});

	const cells: Element[] = groupAndOrderBlsCellsFn(cellEntries);
	const images: string[] = [];

	for (const cell of cells) {
		const img = cell.querySelector('img') as HTMLImageElement | null;
		if (!img || !img.src) {
			images.push('');
			continue;
		}
		try {
			images.push(imageElementToCompactJpegDataUri(img));
		} catch {
			images.push('');
		}
	}

	if (images.filter((img) => img !== '').length === 0) return null;

	return { instructions: rawInstructions.replace(/\D/g, ''), images };
}

/** Strip `data:image/...;base64,` — detect output uses raw base64 for image fields. */
export function blsDataUriToRawBase64(dataUri: string): string {
	if (!dataUri) return '';
	const comma = dataUri.indexOf(',');
	if (dataUri.startsWith('data:') && comma >= 0) return dataUri.slice(comma + 1);
	return dataUri;
}

/**
 * One BLS detection item: nine image slots plus flat `blsImage1`…`blsImage9` for the
 * CaptchaAI solve node (`n8n-captchaai` paramBuilder).
 */
export function blsHitToDetection(hit: RawBlsHit): RawDetection {
	const images = hit.images.slice(0, 9);
	while (images.length < 9) images.push('');

	const imagesBase64 = images.map((uri) => blsDataUriToRawBase64(uri));

	const solveParams: SolveParams = {
		method: 'bls',
		instructions: hit.instructions,
	};
	for (let index = 0; index < 9; index++) {
		const uri = images[index];
		if (uri) solveParams[`image_base64_${index + 1}`] = uri;
	}

	const blsFields: Record<string, string> = {};
	for (let index = 0; index < 9; index++) {
		blsFields[`blsImage${index + 1}`] = imagesBase64[index] ?? '';
	}

	return {
		type: 'bls',
		source: 'dom',
		instructions: hit.instructions,
		imagesBase64,
		...blsFields,
		solveParams,
	} as RawDetection;
}

export async function detectBls(frame: Frame, enabledTypes: Set<CaptchaTypeName>): Promise<RawDetection[]> {
	if (!enabledTypes.has('bls')) return [];

	const script = composeBrowserScript(
		[resizeCanvasToFit, imageElementToCompactJpegDataUri, groupAndOrderBlsCells],
		detectBlsInPage,
		undefined,
	);
	const hit = (await frame.evaluate(script)) as RawBlsHit | null;
	if (!hit) return [];

	return [blsHitToDetection(hit)];
}
