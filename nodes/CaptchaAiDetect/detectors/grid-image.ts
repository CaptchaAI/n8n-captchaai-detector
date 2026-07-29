import type { Frame } from 'playwright';
import { composeBrowserScript } from '../dom/compose';
import { isVisible } from '../dom/visibility';
import type { CaptchaTypeName, RawDetection } from '../libs/types';

interface RawGridHit {
	gridSize: '3x3' | '4x4';
	instructions: string;
	imageBase64: string;
}

/**
 * Ported from `grid-image.ts` (detection-relevant parts only - every
 * session/retry/click helper is dropped, this node never solves) and
 * `detector.ts:1441-1465, 1783-1861` for payload/instructions lookup.
 *
 * PASSIVE ONLY (locked decision): never clicks the reCAPTCHA v2 checkbox to
 * force a challenge open. Only reports a grid if `.rc-imageselect-payload`
 * is already visible - on load, or after the user's own `triggerSelector`
 * click.
 */
async function detectGridImageInPage(args: { readyTimeoutMs: number; pageurl: string }): Promise<RawGridHit | null> {
	const isVisibleFn = isVisible as any;

	function urlHasInvisibleRecaptchaSize(href: string): boolean {
		return /[?&]size=invisible(?:&|$)/i.test(href);
	}

	function isInvisibleRecaptchaV2Context(): boolean {
		try {
			if (/[?&]invisible=true(?:&|$)/i.test(args.pageurl)) return true;
			if (urlHasInvisibleRecaptchaSize(window.location.href)) return true;
			if (document.referrer && urlHasInvisibleRecaptchaSize(document.referrer)) return true;
			if (/[?&]invisible=true(?:&|$)/i.test(document.referrer || '')) return true;
		} catch {
			// ignore
		}
		if (document.querySelector('.g-recaptcha[data-sitekey][data-size="invisible"]')) return true;
		if (document.querySelector('div[data-sitekey][data-size="invisible"]')) return true;
		return false;
	}

	// Ported from detector.ts:1802-1812 — grid inside invisible v2 is not standalone grid_image.
	if (isInvisibleRecaptchaV2Context()) return null;

	function getActiveRecaptchaGridPayload(): HTMLElement | null {
		const payloads = Array.from(document.querySelectorAll<HTMLElement>('.rc-imageselect-payload'));
		return payloads.find((payload) => isVisibleFn(payload)) ?? null;
	}

	function getGridChallengeScope(gridContainer: Element): ParentNode {
		return gridContainer.closest('.rc-imageselect') || gridContainer.parentElement || gridContainer;
	}

	function getGridTable(gridContainer: Element, gridSize: '3x3' | '4x4'): HTMLElement | null {
		const selector = gridSize === '4x4' ? '.rc-imageselect-table-44' : '.rc-imageselect-table-33';
		if (gridContainer instanceof HTMLElement && gridContainer.matches(selector) && isVisibleFn(gridContainer)) {
			return gridContainer;
		}
		const localTables = Array.from(gridContainer.querySelectorAll<HTMLElement>(selector));
		return localTables.find((table) => isVisibleFn(table)) ?? localTables[0] ?? null;
	}

	function getGridCells(gridContainer: Element, gridSize: '3x3' | '4x4'): HTMLTableCellElement[] {
		const table = getGridTable(gridContainer, gridSize);
		if (!table) return [];
		return Array.from(table.querySelectorAll<HTMLTableCellElement>('td.rc-imageselect-tile'));
	}

	function getActiveTileImage(cell: Element): HTMLImageElement | null {
		const replacementImages = Array.from(cell.querySelectorAll<HTMLImageElement>('img.rc-image-tile-11'));
		if (replacementImages.length > 0) {
			const loadedReplacement = replacementImages
				.slice()
				.reverse()
				.find((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0);
			return loadedReplacement || null;
		}
		const images = Array.from(cell.querySelectorAll<HTMLImageElement>('img'));
		return (
			images
				.slice()
				.reverse()
				.find((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0) || null
		);
	}

	function getExpectedCellCount(gridSize: '3x3' | '4x4'): number {
		return gridSize === '4x4' ? 16 : 9;
	}

	function isRecaptchaGridReady(gridContainer: Element, gridSize: '3x3' | '4x4'): boolean {
		const table = getGridTable(gridContainer, gridSize);
		if (!table || !isVisibleFn(table)) return false;
		if (table.querySelector('.rc-imageselect-dynamic-selected')) return false;
		if (table.querySelector('.rc-imageselect-spinner-show')) return false;

		const cells = getGridCells(gridContainer, gridSize);
		if (cells.length !== getExpectedCellCount(gridSize)) return false;

		return cells.every((cell) => {
			const img = getActiveTileImage(cell);
			if (!img || !img.complete || img.naturalWidth < 100) return false;
			try {
				const imgOpacity = parseFloat(window.getComputedStyle(img).opacity);
				if (imgOpacity < 0.95) return false;
				const tileOpacity = parseFloat(window.getComputedStyle(cell).opacity);
				if (tileOpacity < 0.95) return false;
				const overlay = cell.querySelector('.rc-image-tile-overlay');
				if (overlay) {
					const overlayStyle = window.getComputedStyle(overlay);
					const overlayOpacity = parseFloat(overlayStyle.opacity);
					if (overlayStyle.display !== 'none' && overlayOpacity > 0.05) return false;
				}
			} catch {
				// ignore
			}
			return true;
		});
	}

	function drawVisibleTile(
		ctx: CanvasRenderingContext2D,
		cell: HTMLTableCellElement,
		img: HTMLImageElement,
		destX: number,
		destY: number,
		destWidth: number,
		destHeight: number,
	): void {
		const cellRect = cell.getBoundingClientRect();
		const imgRect = img.getBoundingClientRect();
		if (cellRect.width <= 0 || cellRect.height <= 0 || imgRect.width <= 0 || imgRect.height <= 0) {
			throw new Error('Grid tile has invalid geometry');
		}
		const left = Math.max(cellRect.left, imgRect.left);
		const top = Math.max(cellRect.top, imgRect.top);
		const right = Math.min(cellRect.right, imgRect.right);
		const bottom = Math.min(cellRect.bottom, imgRect.bottom);
		if (right <= left || bottom <= top) {
			throw new Error('Grid tile image is not visible yet');
		}
		const scaleX = img.naturalWidth / imgRect.width;
		const scaleY = img.naturalHeight / imgRect.height;
		const sx = Math.max(0, (left - imgRect.left) * scaleX);
		const sy = Math.max(0, (top - imgRect.top) * scaleY);
		const sw = Math.max(1, (right - left) * scaleX);
		const sh = Math.max(1, (bottom - top) * scaleY);
		ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destWidth, destHeight);
	}

	function extractRecaptchaGridAsBase64(gridContainer: Element, gridSize: '3x3' | '4x4'): string {
		const cells = getGridCells(gridContainer, gridSize);
		const columns = gridSize === '4x4' ? 4 : 3;
		const firstRect = cells[0]?.getBoundingClientRect();
		const tileWidth = Math.max(1, Math.round(firstRect?.width || 0));
		const tileHeight = Math.max(1, Math.round(firstRect?.height || 0));

		const canvas = document.createElement('canvas');
		canvas.width = tileWidth * columns;
		canvas.height = tileHeight * columns; // rows === columns for both supported grid sizes

		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');
		ctx.imageSmoothingEnabled = true;

		cells.forEach((cell, index) => {
			const img = getActiveTileImage(cell);
			if (!img) throw new Error(`Grid tile ${index} is not ready`);
			const row = Math.floor(index / columns);
			const col = index % columns;
			drawVisibleTile(ctx, cell, img, col * tileWidth, row * tileHeight, tileWidth, tileHeight);
		});

		return canvas.toDataURL('image/png').split(',')[1];
	}

	const rcImageselect = getActiveRecaptchaGridPayload();
	if (!rcImageselect || !isVisibleFn(rcImageselect)) return null;

	const imageElement = rcImageselect.querySelector('img.rc-image-tile-33, img.rc-image-tile-44') as HTMLImageElement | null;
	const instructionsEl = getGridChallengeScope(rcImageselect).querySelector('.rc-imageselect-instructions strong');
	if (!imageElement || !instructionsEl) return null;

	const gridSize: '3x3' | '4x4' = imageElement.classList.contains('rc-image-tile-44') ? '4x4' : '3x3';
	const instructions = (instructionsEl.textContent || '').trim();

	const start = Date.now();
	while (Date.now() - start < args.readyTimeoutMs) {
		if (isRecaptchaGridReady(rcImageselect, gridSize)) break;
		await new Promise((resolve) => setTimeout(resolve, 40));
	}
	if (!isRecaptchaGridReady(rcImageselect, gridSize)) return null;

	let imageBase64: string;
	try {
		imageBase64 = extractRecaptchaGridAsBase64(rcImageselect, gridSize);
	} catch {
		return null;
	}

	return { gridSize, instructions, imageBase64 };
}

const GRID_READY_TIMEOUT_MS = 6500;

export async function detectGridImage(
	frame: Frame,
	enabledTypes: Set<CaptchaTypeName>,
	pageurl: string,
): Promise<RawDetection[]> {
	if (!enabledTypes.has('grid_image')) return [];

	const script = composeBrowserScript([isVisible], detectGridImageInPage, {
		readyTimeoutMs: GRID_READY_TIMEOUT_MS,
		pageurl,
	});
	const hit = (await frame.evaluate(script)) as RawGridHit | null;
	if (!hit) return [];

	return [
		{
			type: 'grid_image',
			source: 'dom',
			instructions: hit.instructions,
			gridSize: hit.gridSize,
			imageBase64: hit.imageBase64,
			solveParams: {
				method: 'base64',
				body: hit.imageBase64,
				img_type: 'recaptcha',
				grid_size: hit.gridSize,
				instructions: hit.instructions,
			},
		},
	];
}
