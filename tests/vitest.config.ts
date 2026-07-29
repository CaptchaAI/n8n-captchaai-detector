import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tier 3 (implementation plan §6.4) hits real external sites and is slow/
// flaky by nature - opt-in only, via `npm run test:live` (sets LIVE=1).
const includeLive = process.env.LIVE === '1';

export default defineConfig({
	root: repoRoot,
	test: {
		environment: 'node',
		include: includeLive
			? ['tests/live/**/*.live.test.ts']
			: ['tests/unit/**/*.test.ts', 'tests/fixture-tests/**/*.test.ts'],
		testTimeout: includeLive ? 60_000 : 30_000,
		hookTimeout: includeLive ? 60_000 : 30_000,
	},
});
