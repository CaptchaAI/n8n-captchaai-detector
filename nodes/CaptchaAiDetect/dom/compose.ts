/**
 * Composes a set of self-contained helper functions plus one "main" function
 * into a single JS source string suitable for `frame.evaluate(source)`.
 *
 * Why this exists: Playwright ships a function to the browser by taking
 * `fn.toString()` and evaluating that text there - it does NOT resolve the
 * function's closures or its module's imports. A detector function that
 * calls `isVisible(el)` where `isVisible` was imported from another TS
 * module would throw `ReferenceError: isVisible is not defined` in the
 * browser, because only the detector function's own source text is shipped.
 *
 * The fix: bundle every helper the main function needs as sibling function
 * declarations inside one IIFE, then call the main function from inside that
 * same IIFE. Function declarations in the same scope are hoisted, so name
 * resolution between them works regardless of textual order or which file
 * they were authored in on the Node side.
 */

type AnyFn = (...args: any[]) => any;

const BROWSER_EVAL_PREAMBLE = 'var __name = function (target, _value) { return target; };';

export function composeBrowserScript(helperFns: AnyFn[], mainFn: AnyFn, args: unknown): string {
	const helperSource = helperFns
		.map((fn) => {
			if (!fn.name) {
				throw new Error('composeBrowserScript: helper functions must be named function declarations');
			}
			return `const ${fn.name} = ${fn.toString()};`;
		})
		.join('\n');

	const argsJson = JSON.stringify(args === undefined ? null : args);

	return [
		'(function () {',
		BROWSER_EVAL_PREAMBLE,
		helperSource,
		`return (${mainFn.toString()})(${argsJson});`,
		'})()',
	].join('\n');
}

/** For Playwright init scripts that may still reference __name after bundling. */
export function browserEvalPreamble(): string {
	return BROWSER_EVAL_PREAMBLE;
}
