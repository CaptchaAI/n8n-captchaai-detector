#!/usr/bin/env node
/**
 * Downloads the Chromium build Playwright needs. Runs on `npm install`.
 *
 * This intentionally never fails the parent install: some deployments run
 * `npm install --ignore-scripts` (skips this file entirely) or have no
 * outbound network access to download.cypress.io/playwright's CDN. In both
 * cases the fix is the same manual command, which browser.ts also names in
 * its own error message when a launch fails at runtime.
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANUAL_FALLBACK = 'npx playwright install chromium';

try {
	// playwright's package.json declares `"bin": { "playwright": "cli.js" }` -
	// resolve the package directory (not a specific export subpath, which
	// varies across versions) and join with that bin path directly.
	const playwrightPkgPath = require.resolve('playwright/package.json');
	const playwrightPkg = require(playwrightPkgPath);
	const cliRelativePath = typeof playwrightPkg.bin === 'string' ? playwrightPkg.bin : playwrightPkg.bin.playwright;
	const cliPath = path.join(path.dirname(playwrightPkgPath), cliRelativePath);

	execFileSync(process.execPath, [cliPath, 'install', 'chromium'], {
		stdio: 'inherit',
	});
} catch (error) {
	console.warn('[n8n-nodes-captchaai-detect] Could not download the Chromium browser automatically.');
	console.warn(`[n8n-nodes-captchaai-detect] Run "${MANUAL_FALLBACK}" before using the CaptchaAI Detect node.`);
	console.warn(`[n8n-nodes-captchaai-detect] Reason: ${error && error.message ? error.message : error}`);
	// Exit 0 on purpose - a failed browser download must not fail `npm install`.
	process.exit(0);
}
