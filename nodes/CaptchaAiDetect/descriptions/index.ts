import type { INodeProperties } from 'n8n-workflow';

const CAPTCHA_TYPE_OPTIONS: Array<{ name: string; value: string; description: string }> = [
	{ name: 'reCAPTCHA V2', value: 'recaptcha_v2', description: 'Standard "I am not a robot" checkbox widget' },
	{
		name: 'reCAPTCHA V2 Invisible',
		value: 'recaptcha_v2_invisible',
		description: 'A reCAPTCHA v2 widget with no visible checkbox',
	},
	{
		name: 'reCAPTCHA V2 Enterprise',
		value: 'recaptcha_v2_enterprise',
		description: 'Enterprise reCAPTCHA v2',
	},
	{
		name: 'reCAPTCHA V3',
		value: 'recaptcha_v3',
		description: 'Score-based reCAPTCHA v3 (needs a JS execute()/render() call or a ?render= script tag)',
	},
	{
		name: 'reCAPTCHA V3 Enterprise',
		value: 'recaptcha_v3_enterprise',
		description: 'Enterprise reCAPTCHA v3',
	},
	{ name: 'Cloudflare Turnstile', value: 'turnstile', description: 'Cloudflare Turnstile widget' },
	{
		name: 'GeeTest V3',
		value: 'geetest_v3',
		description: 'GeeTest v3 slider (params require the page to call initGeetest, or a triggerSelector click)',
	},
	{
		name: 'Grid Image (reCAPTCHA)',
		value: 'grid_image',
		description: 'A reCAPTCHA image-selection challenge, only if already visible (passive - never clicks the checkbox)',
	},
	{ name: 'BLS', value: 'bls', description: 'BLS challenge built from a 3x3 grid of images' },
	{
		name: 'Normal Image (OCR)',
		value: 'normal_image',
		description: 'Distorted-text image CAPTCHA, including BotDetect-style widgets',
	},
	{ name: 'FriendlyCaptcha', value: 'friendly_captcha', description: 'FriendlyCaptcha proof-of-work widget' },
	{
		name: 'CaptchaFox',
		value: 'captchafox',
		description: 'CaptchaFox widget (sitekey is learned by clicking the widget once - see node notes)',
	},
	{ name: 'Lemin', value: 'lemin', description: 'Lemin cropped-puzzle CAPTCHA' },
];

export const nodeProperties: INodeProperties[] = [
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/login',
		description: 'The page to load and scan for CAPTCHA widgets',
	},
	{
		displayName: 'CAPTCHA Types',
		name: 'captchaTypes',
		type: 'multiOptions',
		options: CAPTCHA_TYPE_OPTIONS,
		// Inline array literal (not a reference to ALL_CAPTCHA_TYPES) - the n8n
		// lint rule for multiOptions defaults requires the default be
		// statically an array literal here. Kept in sync with
		// ALL_CAPTCHA_TYPES by tests/unit/captcha-type-defaults.test.ts.
		default: [
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
		],
		description: 'Which CAPTCHA types to look for. Defaults to every supported type.',
	},
	{
		displayName: 'Timeout',
		name: 'timeout',
		type: 'number',
		default: 30000,
		description: 'Overall page-load budget, in milliseconds',
	},
	{
		displayName: 'Trigger Selector',
		name: 'triggerSelector',
		type: 'string',
		default: '',
		placeholder: '#submit-button',
		description:
			'Optional CSS selector to click once after the page loads, then poll briefly for CAPTCHA types that only appear after an interaction (reCAPTCHA v3, GeeTest v3, CaptchaFox)',
	},
	{
		displayName: 'Image Selector',
		name: 'imageSelector',
		type: 'string',
		default: '',
		placeholder: '#captcha-image',
		description:
			'Optional CSS selector for a specific Normal Image CAPTCHA image, when heuristic auto-detection is not reliable enough',
	},
	{
		displayName: 'Input Selector',
		name: 'inputSelector',
		type: 'string',
		default: '',
		placeholder: '#captcha-answer',
		description:
			'Optional CSS selector for the Normal Image CAPTCHA answer field, used to help locate the matching image when Image Selector is not set',
	},
];
