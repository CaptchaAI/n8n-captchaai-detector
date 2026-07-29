/**
 * Canvas -> base64 capture helpers, ported from
 * `content/utils/image-extractor.ts`.
 *
 * IMPORTANT format distinction preserved from the source (a downstream solve
 * call is format-sensitive, so this must not be "normalized" away):
 *  - Normal Image / Grid Image `body`: stripped base64 PNG (no `data:` prefix)
 *    - matches `extractImageAsBase64()` (image-extractor.ts:9-14) and
 *      `extractRecaptchaGridAsBase64()` (grid-image.ts:149, `.split(',')[1]`).
 *  - BLS `image_base64_N`: FULL data URI, compact JPEG
 *    - matches `extractImageAsCompactDataUri()` (image-extractor.ts:27-37),
 *      which does NOT strip the `data:` prefix - only `bls.ts` consumes it,
 *      and it is passed through as-is.
 *
 * Self-contained function declarations only - see `dom/deep-query.ts`.
 */

/** Resize a canvas so its largest edge is at most `maxEdge`, preserving aspect ratio. */
export function resizeCanvasToFit(sourceCanvas: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
	const largestEdge = Math.max(sourceCanvas.width, sourceCanvas.height);
	if (!largestEdge || largestEdge <= maxEdge) {
		const copy = document.createElement('canvas');
		copy.width = sourceCanvas.width;
		copy.height = sourceCanvas.height;
		const copyCtx = copy.getContext('2d');
		if (!copyCtx) throw new Error('Canvas 2D context unavailable');
		copyCtx.drawImage(sourceCanvas, 0, 0);
		return copy;
	}

	const scale = maxEdge / largestEdge;
	const resized = document.createElement('canvas');
	resized.width = Math.max(1, Math.round(sourceCanvas.width * scale));
	resized.height = Math.max(1, Math.round(sourceCanvas.height * scale));
	const ctx = resized.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	ctx.drawImage(sourceCanvas, 0, 0, resized.width, resized.height);
	return resized;
}

/**
 * Normalized PNG base64 (stripped of the `data:image/png;base64,` prefix),
 * ported from `extractImageAsBase64()` for the HTMLImageElement path.
 * Assumes the image is already decoded (caller must await the decode-settle
 * step first - see the implementation plan §6.1).
 */
export function imageElementToPngBase64(img: HTMLImageElement): string {
	const width = img.naturalWidth || img.width;
	const height = img.naturalHeight || img.height;
	if (!width || !height) {
		throw new Error('Image has no drawable dimensions');
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	ctx.drawImage(img, 0, 0, width, height);
	return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Compact JPEG data URI (full `data:image/jpeg;base64,...` string, NOT
 * stripped), ported from `extractImageAsCompactDataUri()`
 * (image-extractor.ts:27-37, 155-203): 260px max edge, quality ladder
 * [0.82, 0.72, 0.6, 0.5, 0.4], scale ladder [1, 0.92, 0.84, 0.76, 0.68, 0.6],
 * 140,000-char cap, final fallback at 0.5x scale / quality 0.35.
 */
export function imageElementToCompactJpegDataUri(img: HTMLImageElement): string {
	const width = img.naturalWidth || img.width;
	const height = img.naturalHeight || img.height;
	if (!width || !height) {
		throw new Error('Image has no drawable dimensions');
	}
	const sourceCanvas = document.createElement('canvas');
	sourceCanvas.width = width;
	sourceCanvas.height = height;
	const sourceCtx = sourceCanvas.getContext('2d');
	if (!sourceCtx) throw new Error('Canvas 2D context unavailable');
	sourceCtx.drawImage(img, 0, 0, width, height);

	const qualitySteps = [0.82, 0.72, 0.6, 0.5, 0.4];
	const maxEdge = 260;
	const maxDataUrlLength = 140_000;
	const scaleSteps = [1, 0.92, 0.84, 0.76, 0.68, 0.6];

	for (const scale of scaleSteps) {
		const canvas = resizeCanvasToFit(sourceCanvas, Math.max(1, Math.round(maxEdge * scale)));
		for (const quality of qualitySteps) {
			const dataUrl = canvas.toDataURL('image/jpeg', quality);
			if (dataUrl.length <= maxDataUrlLength) {
				return dataUrl;
			}
		}
	}

	const fallbackCanvas = resizeCanvasToFit(sourceCanvas, Math.max(1, Math.round(maxEdge * 0.5)));
	return fallbackCanvas.toDataURL('image/jpeg', 0.35);
}
