/**
 * Shared type definitions for the CaptchaAI Detect node.
 *
 * See the implementation plan (captchaai-n8n-detector-plan.md and the plan
 * file referenced in the project chat history) for the extension source
 * citations behind every field here.
 */

export type CaptchaTypeName =
	| 'recaptcha_v2'
	| 'recaptcha_v2_invisible'
	| 'recaptcha_v2_enterprise'
	| 'recaptcha_v3'
	| 'recaptcha_v3_enterprise'
	| 'turnstile'
	| 'geetest_v3'
	| 'grid_image'
	| 'bls'
	| 'normal_image'
	| 'friendly_captcha'
	| 'captchafox'
	| 'lemin';

export const ALL_CAPTCHA_TYPES: CaptchaTypeName[] = [
	'recaptcha_v2',
	'recaptcha_v2_invisible',
	'recaptcha_v2_enterprise',
	'recaptcha_v3',
	'recaptcha_v3_enterprise',
	'turnstile',
	'geetest_v3',
	'grid_image',
	'bls',
	'normal_image',
	'friendly_captcha',
	'captchafox',
	'lemin',
];

/** Where a detection's parameters came from. */
export type DetectionSource = 'dom' | 'hook' | 'script-tag' | 'network';

/** The exact CaptchaAI API params a downstream solve call would send. */
export interface SolveParams {
	method: string;
	[key: string]: string | number | boolean | undefined;
}

export interface DetectionResult {
	type: CaptchaTypeName;
	/** Always the top-level navigation URL (page.url()). */
	pageurl: string;
	/** The specific frame this widget/hook fired in. Equal to pageurl for hook-sourced items. */
	frameUrl: string;
	source: DetectionSource;
	sitekey?: string | null;
	action?: string | null;
	invisible?: boolean;
	enterprise?: boolean;
	/** True when a widget/type was seen but its solve params could not be resolved. */
	presenceOnly?: boolean;
	instructions?: string;
	gridSize?: '3x3' | '4x4';
	gt?: string;
	challenge?: string;
	apiServer?: string;
	captchaId?: string;
	divId?: string;
	imageBase64?: string;
	/** Nine grid slots: raw base64 only (no `data:` prefix). JPEG slots often start with `/9j/`. */
	imagesBase64?: string[];
	/** Same bytes as `imagesBase64` — field names expected by the CaptchaAI solve node. */
	blsImage1?: string;
	blsImage2?: string;
	blsImage3?: string;
	blsImage4?: string;
	blsImage5?: string;
	blsImage6?: string;
	blsImage7?: string;
	blsImage8?: string;
	blsImage9?: string;
	solveParams: SolveParams;
}

/** Raw shape returned from inside a `frame.evaluate()` DOM detector, before pageurl/frameUrl are stamped on. */
export type RawDetection = Omit<DetectionResult, 'pageurl' | 'frameUrl'>;

export interface DetectorContext {
	/** Always page.url(); constant across all frames for a single run. */
	pageurl: string;
	/** Enabled types for this run, already resolved from the node parameter. */
	enabledTypes: Set<CaptchaTypeName>;
}

/** window.__captchaaiDetect - populated by the top-frame-only hook init script. */
export interface CaptchaaiDetectHookStore {
	recaptchaExecute: Array<{
		sitekey: string;
		action?: string;
		enterprise: boolean;
	}>;
	recaptchaRender: Array<{
		sitekey: string;
		action?: string;
		size?: string;
		enterprise: boolean;
	}>;
	turnstileRender: Array<{
		sitekey: string;
		action?: string;
		cData?: string;
		chlPageData?: string;
	}>;
	geetestV3: Array<{
		gt: string;
		challenge: string;
		apiServer?: string;
	}>;
}

export interface NodeDetectOptions {
	url: string;
	captchaTypes: CaptchaTypeName[];
	timeoutMs: number;
	triggerSelector?: string;
	imageSelector?: string;
	inputSelector?: string;
}
