import { beforeAll, afterAll } from "vitest";
import {
  setupTestOutputDir,
  cleanupTestOutputDir,
  cleanupProjectRoot,
  runAllCleanupHandlers,
} from "./test-utils.js";

beforeAll(async () => {
  await setupTestOutputDir();
});

afterAll(async () => {
  await runAllCleanupHandlers();
  await cleanupTestOutputDir();
  await cleanupProjectRoot();
}, 10000);
