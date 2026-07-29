/**
 * @type {import('@types/eslint').ESLint.ConfigData}
 */
module.exports = {
	root: true,

	env: {
		es6: true,
		node: true,
	},

	parser: '@typescript-eslint/parser',

	parserOptions: {
		project: ['./tsconfig.json'],
		sourceType: 'module',
		extraFileExtensions: ['.json'],
	},

	ignorePatterns: [
		'.eslintrc.js',
		'**/*.js',
		'**/node_modules/**',
		'**/dist/**',
		'tsup.config.ts',
	],

	overrides: [
		{
			files: ['package.json'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/community'],
			parserOptions: { project: null },
			rules: {
				'n8n-nodes-base/community-package-json-name-still-default': 'off',
				// Apache-2.0 (+ attribution addendum, see LICENSE.md) is a
				// deliberate, already-decided choice, not an unedited default.
				// This package also bundles Playwright + a downloaded Chromium
				// binary and is intentionally NOT eligible for n8n's verified
				// marketplace program (see README.md) - the verification-oriented
				// "use MIT" convention this rule enforces does not apply here.
				'n8n-nodes-base/community-package-json-license-not-default': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
				'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
				'n8n-nodes-base/node-param-type-options-max-value-present': 'off',
			},
		},
	],
};
