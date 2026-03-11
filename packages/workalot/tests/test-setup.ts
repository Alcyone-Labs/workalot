import { beforeAll, afterAll } from "vitest";
import {
  setupTestOutputDir,
  cleanupTestOutputDir,
  cleanupProjectRoot,
  runAllCleanupHandlers,
} from "./test-utils.js";
import RedisMock from "ioredis-mock";

let redisMock: InstanceType<typeof RedisMock> | null = null;

beforeAll(async () => {
  await setupTestOutputDir();

  redisMock = new RedisMock();
  (global as any).__REDIS_MOCK__ = redisMock;

  process.env.REDIS_MOCK_AVAILABLE = "true";
  console.log("In-memory Redis mock started");
}, 30000);

afterAll(async () => {
  runAllCleanupHandlers();
  await cleanupTestOutputDir();
  await cleanupProjectRoot();

  if (redisMock) {
    await redisMock.quit();
    redisMock = null;
    process.env.REDIS_MOCK_AVAILABLE = undefined;
    console.log("In-memory Redis mock stopped");
  }
}, 10000);

export { redisMock };
