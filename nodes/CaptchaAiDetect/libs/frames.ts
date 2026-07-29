import type { Frame, Page } from 'playwright';
import type { RawDetection } from './types';

export type FrameDetectorFn = (frame: Frame) => Promise<RawDetection[]>;

export interface FrameDetectionBatch {
	frame: Frame;
	frameUrl: string;
	results: RawDetection[];
}

export function getFrameUrl(frame: Frame): string {
	try {
		return frame.url();
	} catch {
		return '';
	}
}

/**
 * Runs a DOM detector across every frame on the page (mirrors the
 * extension's `all_frames: true` content-script scope - see the
 * implementation plan §4.2). A frame that throws (detached, cross-origin,
 * an `about:blank` race) is skipped silently; it never fails the whole run.
 */
export async function runAcrossAllFrames(
	page: Page,
	detectorFn: FrameDetectorFn,
): Promise<FrameDetectionBatch[]> {
	const frames = page.frames();
	const batches: FrameDetectionBatch[] = [];

	for (const frame of frames) {
		const frameUrl = getFrameUrl(frame);
		try {
			const results = await detectorFn(frame);
			batches.push({ frame, frameUrl, results });
		} catch {
			batches.push({ frame, frameUrl, results: [] });
		}
	}

	return batches;
}
