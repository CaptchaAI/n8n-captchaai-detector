#!/usr/bin/env node
/**
 * Runs n8n's community-package verification lint against this working tree.
 *
 * `npx @n8n/scan-community-package <name>` only works on a package that is
 * already published: it checks npm provenance, downloads the tarball, and
 * fetches the attested GitHub source. This script reproduces the two lint legs
 * it performs so the same rules gate development before anything ships.
 *
 *   source leg: this repo,           ['package.json', '{nodes,credentials}/ ** / *.{js,ts,json}']
 *   dist leg:   `npm pack` output,   ['** / *.js', 'package.json']
 *
 * The rule sets and per-leg file patterns are taken from the installed scanner
 * so they stay in sync with it. The TypeScript parser is deliberately resolved
 * from this package instead: scan-community-package pins typescript 7, which
 * its own bundled @typescript-eslint/parser refuses to load.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRequire = createRequire(import.meta.url);

const scannerRoot = path.dirname(localRequire.resolve('@n8n/scan-community-package/package.json'));
const scannerRequire = createRequire(path.join(scannerRoot, 'index.js'));

const { ESLint } = await import(pathToFileURL(scannerRequire.resolve('eslint')).href);
const { n8nCommunityNodesPlugin } = await import(
	pathToFileURL(scannerRequire.resolve('@n8n/eslint-plugin-community-nodes')).href
);
const { SOURCE_FILE_PATTERNS } = await import(
	pathToFileURL(path.join(scannerRoot, 'scanner', 'scanner.mjs')).href
);

const n8nNodesPlugin = localRequire('eslint-plugin-n8n-nodes-base');
const parser = localRequire('@typescript-eslint/parser');

/** Mirrors buildScanConfig() in scan-community-package, plus detect-only exceptions. */
function buildScanConfig() {
	return [
		n8nCommunityNodesPlugin.configs.recommended,
		{ rules: { 'no-console': 'error' } },
		{ plugins: { 'n8n-nodes-base': n8nNodesPlugin } },
		{
			files: ['package.json'],
			rules: {
				...n8nNodesPlugin.configs.community.rules,
				// Apache-2.0 + Playwright/Chromium — self-hosted detect node, not n8n Cloud verified.
				'n8n-nodes-base/community-package-json-license-not-default': 'off',
				'@n8n/community-nodes/no-runtime-dependencies': 'off',
				'@n8n/community-nodes/no-forbidden-lifecycle-scripts': 'off',
			},
		},
		{
			files: ['**/credentials/**/*.ts'],
			rules: {
				...n8nNodesPlugin.configs.credentials.rules,
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
				'n8n-nodes-base/cred-class-field-type-options-password-missing': 'off',
			},
		},
		{
			files: ['**/nodes/**/*.ts', '**/hooks/**/*.ts', '**/libs/**/*.ts'],
			rules: {
				...n8nNodesPlugin.configs.nodes.rules,
				'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
				'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
				'n8n-nodes-base/node-param-type-options-max-value-present': 'off',
				'@n8n/community-nodes/no-restricted-imports': 'off',
				'@n8n/community-nodes/no-restricted-globals': 'off',
				'@n8n/community-nodes/require-node-api-error': 'off',
			},
		},
		{
			files: ['**/*.js'],
			rules: {
				'@n8n/community-nodes/no-restricted-imports': 'off',
				'@n8n/community-nodes/no-restricted-globals': 'off',
				'@n8n/community-nodes/no-dangerous-functions': 'off',
				'no-console': 'off',
			},
		},
		{ files: ['**/*.json'], languageOptions: { parser } },
		{ files: ['**/*.ts'], languageOptions: { parser } },
	];
}

async function lintLeg(label, dir, patterns) {
	const eslint = new ESLint({
		cwd: dir,
		allowInlineConfig: false,
		overrideConfigFile: true,
		overrideConfig: buildScanConfig(),
		errorOnUnmatchedPattern: false,
	});

	const results = await eslint.lintFiles(patterns);
	const errors = results.reduce((total, result) => total + result.errorCount, 0);

	if (errors === 0) {
		console.log(`PASS  ${label}`);
		return true;
	}

	const formatter = await eslint.loadFormatter('stylish');
	console.log(`FAIL  ${label}`);
	console.log(await formatter.format(results));
	return false;
}

function packToTempDir() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captchaai-detect-scan-'));
	const output = execFileSync('npm', ['pack', '--pack-destination', tempDir, '--silent'], {
		cwd: repoRoot,
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	const tarball = output.trim().split('\n').pop().trim();

	execFileSync('tar', ['-xzf', path.join(tempDir, tarball), '-C', tempDir], { encoding: 'utf8' });
	return { tempDir, extracted: path.join(tempDir, 'package') };
}

const { tempDir, extracted } = packToTempDir();
try {
	const source = await lintLeg('source', repoRoot, SOURCE_FILE_PATTERNS);
	const dist = await lintLeg('packed tarball', extracted, ['**/*.js', 'package.json']);
	if (!source || !dist) process.exitCode = 1;
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}
