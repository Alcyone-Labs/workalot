import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, unlink, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const TEST_OUTPUT_DIR = join(tmpdir(), "workalot-tests");

let cleanupHandlers: Array<() => Promise<void>> = [];

export async function setupTestOutputDir() {
  try {
    await mkdir(TEST_OUTPUT_DIR, { recursive: true });
  } catch (error) {
    console.warn("Failed to create test output directory:", error);
  }
}

export async function cleanupTestOutputDir() {
  try {
    await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
  } catch (error) {
    console.warn("Failed to cleanup test output directory:", error);
  }
}

export async function cleanupProjectRoot() {
  const root = process.cwd();
  const testFilePatterns = [/^test.*\.db$/, /^test.*\.tson[a-z]?$/, /^stress-test.*$/, /^test-/];

  try {
    const files = await readdir(root);
    for (const file of files) {
      if (testFilePatterns.some((pattern) => pattern.test(file))) {
        try {
          await unlink(join(root, file));
        } catch {
          // File might be locked or not exist, continue
        }
      }
    }
  } catch (error) {
    console.warn("Failed to cleanup project root:", error);
  }
}

export function getTestFilePath(filename: string) {
  return join(TEST_OUTPUT_DIR, `${filename}-${Date.now()}-${randomBytes(8).toString("hex")}`);
}

export function getTempDbFile(prefix: string = "test") {
  return join(TEST_OUTPUT_DIR, `${prefix}-${Date.now()}-${randomBytes(8).toString("hex")}.db`);
}

export function getTempTsonFile(prefix: string = "test") {
  return join(TEST_OUTPUT_DIR, `${prefix}-${Date.now()}-${randomBytes(8).toString("hex")}.tson`);
}

export function registerCleanupHandler(handler: () => Promise<void>) {
  cleanupHandlers.push(handler);
}

export async function runAllCleanupHandlers() {
  for (const handler of cleanupHandlers) {
    try {
      await handler();
    } catch (error) {
      console.warn("Cleanup handler failed:", error);
    }
  }
  cleanupHandlers = [];
}

export { TEST_OUTPUT_DIR };
