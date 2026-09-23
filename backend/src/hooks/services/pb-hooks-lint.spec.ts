/**
 * pb-hooks-lint.spec.ts — Build-output lint for PocketBase hook files.
 *
 * PocketBase's Goja JS runtime loads .pb.js files as scripts,
 * NOT as CommonJS modules. This means:
 *   1. `module` / `module.exports` / `exports` are NOT defined.
 *   2. Top-level `var x = require(...)` can abort the entire file
 *      if the require throws.
 *   3. Top-level function declarations are NOT hoisted reliably.
 *      Functions called from inside hook callbacks must be in
 *      require()-able CJS modules (services/ or utils/).
 *
 * These tests scan the compiled pb_hooks/*.pb.js output to catch
 * violations of these constraints before deployment.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PB_HOOKS_DIR = join(__dirname, '..', '..', '..', 'pb_hooks');

function getPbHookFiles(): { name: string; content: string }[] {
	try {
		return readdirSync(PB_HOOKS_DIR)
			.filter((f) => f.endsWith('.pb.js'))
			.map((name) => ({
				name,
				content: readFileSync(join(PB_HOOKS_DIR, name), 'utf-8')
			}));
	} catch {
		return [];
	}
}

describe('pb-hooks-lint: .pb.js files must not use module.exports', () => {
	const files = getPbHookFiles();

	if (files.length === 0) {
		it.skip('no .pb.js files found (run build:hooks first)', () => {});
		return;
	}

	for (const file of files) {
		it(`${file.name} must not contain module.exports`, () => {
			const hasModuleExports = /\bmodule\.exports\b/.test(file.content);
			const hasExportsAssignment = /\bexports\.\w+\s*=/.test(file.content);

			expect(
				hasModuleExports || hasExportsAssignment,
				`${file.name} contains module.exports or exports.X — ` +
					`.pb.js files run in PocketBase's Goja runtime where 'module' is not defined. ` +
					`Move this file to services/ or utils/ if it needs to export.`
			).toBe(false);
		});
	}
});

describe('pb-hooks-lint: .pb.js files must not have top-level statements', () => {
	const files = getPbHookFiles();

	if (files.length === 0) {
		it.skip('no .pb.js files found (run build:hooks first)', () => {});
		return;
	}

	// Allowed top-level patterns: hook registrations and comments
	const ALLOWED_TOP_LEVEL = [
		/^\/\//, // comment
		/^\/\*/, // block comment start
		/^\*/, // block comment continuation
		/^\s*$/, // blank line
		/^onRecord/, // onRecordCreateRequest, onRecordUpdateRequest, etc.
		/^onRecordAfterUpdateSuccess/, // after-update hooks
		/^routerAdd/, // route registration
		/^cronAdd/, // cron registration
	];

	// Forbidden top-level patterns
	const TOP_LEVEL_REQUIRE = /^(?:var|let|const)\s+\w+\s*=\s*require\s*\(/;
	const TOP_LEVEL_FUNCTION = /^function\s+\w+/;
	const TOP_LEVEL_VAR = /^(?:var|let|const)\s+/;

	for (const file of files) {
		it(`${file.name} must only have hook registrations at top level`, () => {
			const lines = file.content.split('\n');
			let depth = 0;
			const violations: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimmed = line.trim();

				// Track depth BEFORE checking (so we check if the line starts at depth 0)
				const lineStartDepth = depth;

				// Track brace depth
				for (const ch of line) {
					if (ch === '{') depth++;
					if (ch === '}') depth = Math.max(0, depth - 1);
				}

				// Only check top-level lines
				if (lineStartDepth !== 0) continue;
				if (!trimmed) continue;

				// Skip allowed patterns
				if (ALLOWED_TOP_LEVEL.some((re) => re.test(trimmed))) continue;

				// Check for forbidden patterns
				if (TOP_LEVEL_REQUIRE.test(trimmed)) {
					violations.push(`  line ${i + 1} [require]: ${trimmed.substring(0, 80)}`);
				} else if (TOP_LEVEL_FUNCTION.test(trimmed)) {
					violations.push(`  line ${i + 1} [function]: ${trimmed.substring(0, 80)}`);
				} else if (TOP_LEVEL_VAR.test(trimmed)) {
					violations.push(`  line ${i + 1} [var/let/const]: ${trimmed.substring(0, 80)}`);
				}
			}

			expect(
				violations.length,
				`${file.name} has forbidden top-level statements. ` +
					`PocketBase's Goja runtime does not reliably hoist function declarations ` +
					`and does not support module.exports in .pb.js files.\n` +
					`Violations:\n${violations.join('\n')}\n\n` +
					`Fix: Move functions/vars to a CJS module in services/ or utils/ ` +
					`and require() them inside hook callbacks.`
			).toBe(0);
		});
	}
});

describe('pb-hooks-lint: round completion must trigger finalization', () => {
	const files = getPbHookFiles();

	if (files.length === 0) {
		it.skip('no .pb.js files found (run build:hooks first)', () => {});
		return;
	}

	for (const file of files) {
		it(`${file.name}: any set("status", "Completed") + $app.save must be followed by finalizeCompletedRound`, () => {
			const lines = file.content.split('\n');
			const completionBlocks: { startLine: number; text: string; hasFinalize: boolean }[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Detect pattern: round.set("status", "Completed") or set("status","Completed")
				if (/\.set\(\s*["']status["']\s*,\s*["']Completed["']\s*\)/.test(line)) {
					// Look ahead up to 5 lines for $app.save and finalizeCompletedRound
					const lookahead = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
					const hasSave = /\$app\.save\(/.test(lookahead);
					const hasFinalize = /finalizeCompletedRound/.test(lookahead);

					if (hasSave) {
						completionBlocks.push({
							startLine: i + 1,
							text: line.trim().substring(0, 80),
							hasFinalize
						});
					}
				}
			}

			const violations = completionBlocks
				.filter((b) => !b.hasFinalize)
				.map((b) => `  line ${b.startLine}: ${b.text}`);

			if (violations.length > 0) {
				expect.fail(
					`${file.name} sets round status to "Completed" and saves without calling finalizeCompletedRound:\n` +
						violations.join('\n') +
						`\n\nProgrammatic $app.save() does not trigger onRecordUpdateRequest. ` +
						`You must call h.finalizeCompletedRound(roundId, round) explicitly.`
				);
			}
		});
	}
});
