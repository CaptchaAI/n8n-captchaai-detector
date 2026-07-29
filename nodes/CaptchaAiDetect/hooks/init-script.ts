/**
 * Top-frame-only init script: hooks grecaptcha/turnstile/initGeetest render &
 * execute calls, and widens closed shadow roots to open.
 *
 * Frame scope (see the implementation plan §4.2-4.3): the extension's own
 * hook code lives in `main-world.ts`, which `manifest.json` scopes to the
 * top frame only (`all_frames` is absent from that content-script entry,
 * defaulting to `false` - contrast with `detector.ts`'s entry, which sets
 * `all_frames: true`). Playwright's `page.addInitScript` has no frame
 * filter of its own - it always injects into every frame - so this script
 * opens with an explicit `window.top !== window` guard and does nothing at
 * all in any subframe. This is deliberately consistent with the CaptchaFox
 * trigger-click guard in `detectors/captchafox.ts`, which uses the same
 * check.
 *
 * Every hook here is pass-through only: record what was seen, then always
 * `return original.apply(this, arguments)`. This is the OPPOSITE of the
 * extension's own hooks, which intentionally mock/block to drive a solve.
 * Blocking here would break the page for no reason - this node only reports
 * what it observes.
 *
 * GeeTest v4 (`initGeetest4`) is out of scope: no hook, no detector, no
 * output field, no stub.
 *
 * This function is passed directly to `page.addInitScript()`. Playwright
 * ships it to the browser via `fn.toString()`, so it must not reference
 * anything outside its own body (no closures, no imports) - see the note in
 * `dom/compose.ts` for why.
 */
export function captchaaiDetectHookInitScript(): void {
	try {
		if (window.top !== window) return;
	} catch {
		return;
	}

	const w = window as any;

	w.__captchaaiDetect = {
		recaptchaExecute: [] as Array<{ sitekey: string; action?: string; enterprise: boolean }>,
		recaptchaRender: [] as Array<{
			sitekey?: string;
			action?: string;
			size?: string;
			enterprise: boolean;
		}>,
		turnstileRender: [] as Array<{
			sitekey?: string;
			action?: string;
			cData?: string;
			chlPageData?: string;
		}>,
		geetestV3: [] as Array<{ gt: string; challenge: string; apiServer?: string }>,
	};

	// --- Widen closed shadow roots to open, ported from main-world.ts:843-849 ---
	try {
		const originalAttachShadow = Element.prototype.attachShadow;
		Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
			const patched: ShadowRootInit =
				init && init.mode === 'closed' ? { ...init, mode: 'open' } : init;
			return originalAttachShadow.call(this, patched);
		};
	} catch {
		// ignore - some pages seal Element.prototype
	}

	// --- grecaptcha.render / execute (+ enterprise), ported from main-world.ts:586-804 ---
	function hookGrecaptchaRender(target: any, enterprise: boolean): void {
		if (!target || typeof target.render !== 'function' || target.render.__caiHooked) return;
		const orig = target.render;
		const wrapped = function (this: any, ...args: any[]) {
			try {
				const params = args[1] || {};
				w.__captchaaiDetect.recaptchaRender.push({
					sitekey: params.sitekey,
					action: params.action,
					size: params.size,
					enterprise,
				});
			} catch {
				// ignore
			}
			return orig.apply(this, args);
		};
		wrapped.__caiHooked = true;
		target.render = wrapped;
	}

	function hookGrecaptchaExecute(target: any, enterprise: boolean): void {
		if (!target || typeof target.execute !== 'function' || target.execute.__caiHooked) return;
		const orig = target.execute;
		const wrapped = function (this: any, ...args: any[]) {
			try {
				const sitekeyOrWidgetId = args[0];
				const options = args[1] || {};
				if (typeof sitekeyOrWidgetId === 'string') {
					w.__captchaaiDetect.recaptchaExecute.push({
						sitekey: sitekeyOrWidgetId,
						action: options.action,
						enterprise,
					});
				}
			} catch {
				// ignore
			}
			return orig.apply(this, args);
		};
		wrapped.__caiHooked = true;
		target.execute = wrapped;
	}

	function hookGrecaptchaObject(obj: any): void {
		if (!obj || typeof obj !== 'object' || obj.__caiObjectHooked) return;
		obj.__caiObjectHooked = true;

		let hooking = false;
		const hookAll = () => {
			if (hooking) return;
			hooking = true;
			try {
				hookGrecaptchaRender(obj, false);
				hookGrecaptchaExecute(obj, false);
				if (obj.enterprise) {
					hookGrecaptchaRender(obj.enterprise, true);
					hookGrecaptchaExecute(obj.enterprise, true);
				}
			} finally {
				hooking = false;
			}
		};
		hookAll();

		// reCAPTCHA often assigns .execute/.enterprise after the initial object
		// exists, so a property setter is needed to catch late assignment.
		['render', 'execute', 'enterprise'].forEach((prop) => {
			let ref = obj[prop];
			try {
				Object.defineProperty(obj, prop, {
					configurable: true,
					enumerable: true,
					get() {
						return ref;
					},
					set(value) {
						if (ref === value) return;
						ref = value;
						if (!hooking) hookAll();
					},
				});
			} catch {
				// sealed - ignore
			}
		});
	}

	let grecaptchaRef = w.grecaptcha;
	try {
		Object.defineProperty(window, 'grecaptcha', {
			configurable: true,
			get() {
				return grecaptchaRef;
			},
			set(value) {
				grecaptchaRef = value;
				hookGrecaptchaObject(value);
			},
		});
	} catch {
		// ignore
	}
	if (grecaptchaRef) hookGrecaptchaObject(grecaptchaRef);

	// --- turnstile.render, ported from main-world.ts:968-1025 ---
	function hookTurnstileRender(obj: any): void {
		if (!obj || typeof obj.render !== 'function' || obj.render.__caiHooked) return;
		const orig = obj.render;
		const wrapped = function (this: any, ...args: any[]) {
			try {
				const params = args[1] || {};
				w.__captchaaiDetect.turnstileRender.push({
					sitekey: params.sitekey,
					action: params.action,
					cData: params.cData || params.data,
					chlPageData: params.chlPageData,
				});
			} catch {
				// ignore
			}
			return orig.apply(this, args);
		};
		wrapped.__caiHooked = true;
		obj.render = wrapped;
	}

	let turnstileRef = w.turnstile;
	try {
		Object.defineProperty(window, 'turnstile', {
			configurable: true,
			get() {
				return turnstileRef;
			},
			set(value) {
				turnstileRef = value;
				hookTurnstileRender(value);
			},
		});
	} catch {
		// ignore
	}
	if (turnstileRef) hookTurnstileRender(turnstileRef);

	// --- initGeetest (v3 only), ported from main-world.ts:1458-1494, 1519-1538 ---
	function wrapInitGeetest(original: any): any {
		const wrapped = function (this: any, ...args: any[]) {
			try {
				const userConfig = args[0] || {};
				const gt = userConfig.gt;
				const challenge = userConfig.challenge;
				if (gt && challenge) {
					w.__captchaaiDetect.geetestV3.push({
						gt,
						challenge,
						apiServer: userConfig.api_server,
					});
				}
			} catch {
				// ignore
			}
			return original.apply(this, args);
		};
		wrapped.__caiHooked = true;
		return wrapped;
	}

	let initGeetestRef = w.initGeetest;
	try {
		Object.defineProperty(window, 'initGeetest', {
			configurable: true,
			get() {
				return initGeetestRef;
			},
			set(value) {
				if (typeof value === 'function' && !value.__caiHooked) {
					initGeetestRef = wrapInitGeetest(value);
				} else {
					initGeetestRef = value;
				}
			},
		});
	} catch {
		// ignore
	}
	if (typeof initGeetestRef === 'function' && !initGeetestRef.__caiHooked) {
		initGeetestRef = wrapInitGeetest(initGeetestRef);
	}
}
