import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		'nodes/CaptchaAiDetect/CaptchaAiDetect.node': 'nodes/CaptchaAiDetect/CaptchaAiDetect.node.ts',
	},
	format: ['cjs'],
	platform: 'node',
	target: 'node20',
	external: ['n8n-workflow', 'playwright', 'playwright-core'],
	outDir: 'dist',
	clean: true,
	// keepNames must stay false: detector helpers are copied into the browser via
	// `fn.toString()` (see dom/compose.ts). esbuild's keepNames injects __name()
	// calls that throw ReferenceError inside frame.evaluate().
	minify: false,
	keepNames: false,
	sourcemap: false,
	splitting: false,
	dts: false,
});
