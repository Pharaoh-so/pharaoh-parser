import { describe, expect, it } from "vitest";
import { isTestFile } from "../src/file-walker.js";

// Test files and test-support modules are excluded from reachability, so their
// exports never surface as dead production code. Support modules with
// production-looking names (x.mocks.ts, test-utils.ts) and Python's own test
// conventions were classified as production.
describe("isTestFile", () => {
	it.each([
		"src/user.test.ts",
		"src/user.spec.tsx",
		"src/worker.test.mts",
		"src/legacy.spec.cjs",
		"test/app.e2e-spec.ts",
		"src/app.e2e-spec.ts",
		"src/__tests__/user.ts",
		"src/__mocks__/fs.ts",
		"src/providers/okx/okx.mocks.ts",
		"src/providers/okx/okx.mock.ts",
		"src/utils/test-utils.ts",
		"src/services/alert/testUtils.ts",
		"src/test-helpers.ts",
		"src/setupTests.ts",
		"tests/fixtures/repo/index.ts",
		"app/models/test_user.py",
		"app/models/user_test.py",
		"app/conftest.py",
		"src/button.stories.tsx",
		// Playwright/Cypress suites: page objects and helpers live next to the specs
		"e2e/pages/login.ts",
		"apps/web/e2e/utils/wait.ts",
		"cypress/support/commands.ts",
	])("%s is a test file", (filePath) => {
		expect(isTestFile(filePath)).toBe(true);
	});

	it.each([
		"src/user.ts",
		"src/testing.ts",
		"src/contest.ts",
		"src/mocking-bird.ts",
		"src/latest-utils.ts",
		"app/models/user.py",
		"app/attestation.py",
		"src/protest_test_data.json",
		"src/features/ab-test.ts",
		"src/openapi-spec.ts",
		"src/e2e-encryption/keys.ts",
		// a scraper's Playwright driver is production code
		"src/playwright/browser.ts",
	])("%s is production code", (filePath) => {
		expect(isTestFile(filePath)).toBe(false);
	});
});
