import { buildSync } from 'esbuild';
import Module from 'node:module';
import path from 'node:path';

/**
 * Loads a TS module through a REAL esbuild bundle (single file, no code
 * splitting) instead of importing it directly.
 *
 * Why this is necessary: `composeBrowserScript` (see `dom/compose.ts`) ships
 * detector functions to the browser via `Function.prototype.toString()`,
 * which only works correctly when every helper a function calls resolves as
 * a same-scope, same-file identifier - exactly what tsup's bundled
 * production build produces (`tsup.config.ts` uses a single entry, no
 * splitting). Vitest, in contrast, runs TS files through Vite's per-module
 * SSR transform, which rewrites cross-module references inside a function's
 * body into `__vite_ssr_import_N__.helperName` - a variable that only exists
 * in Vite's own module registry, not in the string handed to
 * `frame.evaluate`. A test that imports detector functions directly would
 * pass typecheck and even pass if it never exercised the composed script,
 * while the exact same code throws `ReferenceError` in a real browser - so a
 * fixture test that imports normally is not proof the detector works
 * end-to-end.
 *
 * Bundling the target file with esbuild here reproduces production's
 * single-scope output exactly, so what these tests exercise is what
 * actually ships.
 */
export function loadBundled<T = unknown>(entryFile: string): T {
	const absoluteEntry = path.resolve(entryFile);
	const result = buildSync({
		entryPoints: [absoluteEntry],
		bundle: true,
		platform: 'node',
		format: 'cjs',
		write: false,
		external: ['playwright', 'n8n-workflow'],
		logLevel: 'silent',
	});

	const code = result.outputFiles[0].text;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mod = new Module(absoluteEntry, module as any);
	mod.filename = absoluteEntry;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mod.paths = (Module as any)._nodeModulePaths(path.dirname(absoluteEntry));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(mod as any)._compile(code, absoluteEntry);
	return mod.exports as T;
}
