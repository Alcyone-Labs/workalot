#!/usr/bin/env bun
import { DashboardServer } from "./DashboardServer.js";
import type { QueueConfig } from "@alcyone-labs/workalot";

// Configuration from environment variables
const backend = (process.env.BACKEND as any) || "memory";
const databaseUrl = process.env.DB_URL;
const port = parseInt(process.env.PORT || "3000");
const hostname = process.env.HOSTNAME || "localhost";

console.log(`Initializing Workalot Dashboard...`);
console.log(`Backend: ${backend}`);
if (databaseUrl) console.log(`Database URL: ${databaseUrl}`);

const queueConfig: QueueConfig = {
    backend,
    databaseUrl,
};

const server = new DashboardServer({
    port,
    hostname,
    queueConfig
});

try {
    await server.start();
} catch (error) {
    console.error("Failed to start dashboard server:", error);
    process.exit(1);
}

// Graceful shutdown
const shutdown = async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
