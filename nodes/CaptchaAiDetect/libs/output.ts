import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import type { DetectionResult, RawDetection } from './types';

/** Stamps `pageurl` (always top-level) and `frameUrl` onto a raw detector hit. */
export function stampDetection(raw: RawDetection, pageurl: string, frameUrl: string): DetectionResult {
	return { ...raw, pageurl, frameUrl };
}

export function toExecutionData(results: DetectionResult[]): INodeExecutionData[] {
	return results.map((result) => ({ json: result as unknown as IDataObject }));
}
