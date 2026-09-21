# Repository guidance

Use pnpm for dependencies and scripts; keep `pnpm-lock.yaml` as the package lockfile.

## Required checks

All changes must pass linting, formatting, typecheck, project checks, and tests
before they are considered complete. Run `pnpm run check` to execute these checks.
Resolve failures rather than skipping checks or weakening their configuration.
If an environment limitation prevents a check, report the command, the blocker,
and what remains unverified.

Use `pnpm run format` to apply Oxfmt formatting and import sorting. After lint
autofixes or formatting, verify that both checks pass and a second fix/format
pass leaves files unchanged.

## Tests

Write new tests with Vitest. Prefer pure unit tests running in Node; use Vitest
Browser Mode when behaviour depends on real browser APIs, layout, or interaction.
Keep mocking minimal. Prefer explicit dependency injection and real implementations
to module mocks, making small changes where needed rather than broad refactors
solely to enable testing.

Put tests for a specific unit or functionality in a `__tests__` directory beside
the code they cover, such as `src/editor/__tests__/schema-codec.test.ts`.
Put integration tests in the root `tests/` directory. Reserve `tests/e2e/` for
Playwright tests that require full-page application navigation or browser
automation unavailable in Vitest Browser Mode.
Use `*.test.ts` or `*.test.tsx` for new Vitest tests and insert `.browser` before
`.test` for Browser Mode; migrated JavaScript tests use the same convention.
Browser Mode runs in Chromium, Firefox, and WebKit. Keep browser-independent
logic in the Node suite. All suites are included in the required checks.

## Lint overrides

Lint overrides are exceptional, not the default response to a finding. Prefer
fixing the code so it meets the rule's intent.

Use an override only when correct, necessary code conflicts with a rule that
cannot express the requirement. Limit it to the specific rule and smallest
possible scope, and explain the concrete reason beside the override. Existing
overrides are not precedent for new ones. Broad file exclusions, blanket
disables, and reduced severities are not substitutes for fixing code.
