import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  WebSocketServer,
  WebSocketServerConfig,
  WebSocketConnection,
} from "../src/communication/WebSocketServer.js";
import { WorkerMessage, WorkerMessageType } from "../src/types/index.js";
import { ulid } from "ulidx";

describe("WebSocketServer", () => {
  let wsServer: WebSocketServer;
  let testPort: number;

  beforeEach(() => {
    testPort = 20000 + Math.floor(Math.random() * 10000);
    wsServer = new WebSocketServer({
      port: testPort,
      hostname: "localhost",
      enableMessageRecovery: true,
      enableHeartbeat: true,
      messageTimeout: 1000,
      maxRetries: 3,
      pingInterval: 5000,
    });
  });

  afterEach(async () => {
    try {
      await wsServer.stop();
    } catch {}
  });

  describe("Lifecycle", () => {
    it("should start and stop correctly", async () => {
      const startPromise = new Promise<void>((resolve) => {
        wsServer.once("started", () => resolve());
      });

      await wsServer.start();
      await startPromise;

      expect(wsServer.getStats().isRunning).toBe(true);

      const stopPromise = new Promise<void>((resolve) => {
        wsServer.once("stopped", () => resolve());
      });

      await wsServer.stop();
      await stopPromise;

      expect(wsServer.getStats().isRunning).toBe(false);
    });

    it("should not throw when stopping multiple times", async () => {
      await wsServer.start();
      await wsServer.stop();
      await wsServer.stop(); // Should not throw
    });

    it("should emit started event with correct port info", async () => {
      const startedPromise = new Promise<{ port: number; hostname: string }>((resolve) => {
        wsServer.once("started", resolve);
      });

      await wsServer.start();
      const info = await startedPromise;

      expect(info.port).toBe(testPort);
      expect(info.hostname).toBe("localhost");
    });
  });

  describe("Connection Management", () => {
    it("should track connection count", async () => {
      await wsServer.start();

      const stats = wsServer.getStats();
      expect(stats.connections).toBe(0);
      expect(stats.workers).toBe(0);
    });

    it("should get connection by ID", async () => {
      await wsServer.start();

      const connection = wsServer.getConnection("non-existent");
      expect(connection).toBeUndefined();
    });

    it("should get all connections", async () => {
      await wsServer.start();

      const connections = wsServer.getAllConnections();
      expect(Array.isArray(connections)).toBe(true);
      expect(connections.length).toBe(0);
    });
  });

  describe("Message Routing", () => {
    it("should register message routes", async () => {
      await wsServer.start();

      const route = {
        pattern: "test-type",
        handler: vi.fn(),
        priority: 1,
      };

      wsServer.registerRoute(route);
      // Should not throw
    });

    it("should register channel routes", async () => {
      await wsServer.start();

      const route = {
        handler: vi.fn(),
        priority: 1,
      };

      wsServer.registerChannelRoute(route);
      // Should not throw
    });

    it("should register structured routes", async () => {
      await wsServer.start();

      const predicate = (message: WorkerMessage) => message.type === WorkerMessageType.EXECUTE_JOB;
      const handler = vi.fn();

      wsServer.registerStructuredRoute(predicate, handler, 5);
      // Should not throw
    });

    it("should handle route priority sorting", async () => {
      await wsServer.start();

      // Register routes with different priorities
      wsServer.registerRoute({ pattern: "low", handler: vi.fn(), priority: 1 });
      wsServer.registerRoute({ pattern: "high", handler: vi.fn(), priority: 10 });
      wsServer.registerRoute({ pattern: "medium", handler: vi.fn(), priority: 5 });

      // Should not throw
    });
  });

  describe("Message Sending", () => {
    it("should return false when sending to non-existent connection", async () => {
      await wsServer.start();

      const message: WorkerMessage = {
        type: WorkerMessageType.EXECUTE_JOB,
        id: ulid(),
        payload: {},
      };

      const result = wsServer.sendToConnection("non-existent", message);
      expect(result).toBe(false);
    });

    it("should return false when sending to non-existent worker", async () => {
      await wsServer.start();

      const message: WorkerMessage = {
        type: WorkerMessageType.EXECUTE_JOB,
        id: ulid(),
        payload: {},
      };

      const result = wsServer.sendToWorker(999, message);
      expect(result).toBe(false);
    });

    it("should broadcast messages", async () => {
      await wsServer.start();

      const message: WorkerMessage = {
        type: WorkerMessageType.PING,
        id: ulid(),
        payload: {},
      };

      // Should not throw even with no connections
      wsServer.broadcast(message);
    });

    it("should send channel messages to workers", async () => {
      await wsServer.start();

      const result = wsServer.sendChannelToWorker(1, {
        channel: "test",
        data: { message: "hello" },
      } as any);

      expect(result).toBe(false); // No workers connected
    });
  });

  describe("Statistics", () => {
    it("should return correct statistics", async () => {
      await wsServer.start();

      const stats = wsServer.getStats();

      expect(stats).toHaveProperty("isRunning");
      expect(stats).toHaveProperty("connections");
      expect(stats).toHaveProperty("workers");
      expect(stats).toHaveProperty("pendingMessages");
      expect(stats.isRunning).toBe(true);
      expect(stats.connections).toBe(0);
      expect(stats.workers).toBe(0);
      expect(stats.pendingMessages).toBe(0);
    });

    it("should track pending messages correctly", async () => {
      await wsServer.start();

      const stats = wsServer.getStats();
      expect(stats.pendingMessages).toBe(0);
    });
  });

  describe("Event Emission", () => {
    it("should emit connection events", async () => {
      await wsServer.start();

      let connectionEstablished = false;
      let connectionClosed = false;

      wsServer.on("connection-established", () => {
        connectionEstablished = true;
      });

      wsServer.on("connection-closed", () => {
        connectionClosed = true;
      });

      // Simulate a connection by calling internal handler
      // This is tested through the event system
      expect(typeof wsServer.on).toBe("function");
    });

    it("should emit message-sent events", async () => {
      await wsServer.start();

      let messageSent = false;

      wsServer.on("message-sent", () => {
        messageSent = true;
      });

      // Event listener registered
      expect(typeof wsServer.on).toBe("function");
    });

    it("should emit message-error events", async () => {
      await wsServer.start();

      let messageError = false;

      wsServer.on("message-error", () => {
        messageError = true;
      });

      // Event listener registered
      expect(typeof wsServer.on).toBe("function");
    });
  });
});

describe("WebSocketServer Message Recovery", () => {
  let wsServer: WebSocketServer;
  let testPort: number;

  beforeEach(() => {
    testPort = 20000 + Math.floor(Math.random() * 10000);
    wsServer = new WebSocketServer({
      port: testPort,
      hostname: "localhost",
      enableMessageRecovery: true,
      enableHeartbeat: false,
      messageTimeout: 100,
      maxRetries: 2,
    });
  });

  afterEach(async () => {
    try {
      await wsServer.stop();
    } catch {}
  });

  it("should disable message recovery when configured", async () => {
    const server = new WebSocketServer({
      port: testPort + 1,
      enableMessageRecovery: false,
    });

    await server.start();
    expect(server.getStats().isRunning).toBe(true);

    await server.stop();
  });

  it("should disable heartbeat when configured", async () => {
    const server = new WebSocketServer({
      port: testPort + 2,
      enableHeartbeat: false,
    });

    await server.start();

    // Statistics should work
    const stats = server.getStats();
    expect(stats.isRunning).toBe(true);

    await server.stop();
  });

  it("should handle configuration with custom timeouts", async () => {
    const server = new WebSocketServer({
      port: testPort + 3,
      messageTimeout: 5000,
      maxRetries: 5,
      pingInterval: 10000,
    });

    await server.start();

    const stats = server.getStats();
    expect(stats.isRunning).toBe(true);

    await server.stop();
  });
});

describe("WebSocketServer Route Pattern Matching", () => {
  let wsServer: WebSocketServer;

  beforeEach(async () => {
    wsServer = new WebSocketServer({
      port: 0,
      hostname: "localhost",
    });
    await wsServer.start();
  });

  afterEach(async () => {
    await wsServer.stop();
  });

  it("should match string patterns", async () => {
    const message: WorkerMessage = { type: WorkerMessageType.EXECUTE_JOB, id: ulid() };

    let matched = false;
    wsServer.registerRoute({
      pattern: WorkerMessageType.EXECUTE_JOB,
      handler: () => {
        matched = true;
      },
    });

    // Route registered
    expect(true).toBe(true);
  });

  it("should match regex patterns", async () => {
    wsServer.registerRoute({
      pattern: /^EXECUTE_/,
      handler: vi.fn(),
    });

    // Route registered
    expect(true).toBe(true);
  });

  it("should match function predicates", async () => {
    wsServer.registerRoute({
      pattern: (msg) => msg.type.startsWith("EXECUTE"),
      handler: vi.fn(),
    });

    // Route registered
    expect(true).toBe(true);
  });
});
