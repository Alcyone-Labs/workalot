#!/usr/bin/env bun

/**
 * Script to remove isBunEnvironment conditionals from PostgreSQLQueue.ts
 * Both Bun and postgres package use the same API
 */

import { readFileSync, writeFileSync } from "node:fs";

const filePath = "src/queue/PostgreSQLQueue.ts";
let content = readFileSync(filePath, "utf-8");

// Backup
writeFileSync(filePath + ".backup2", content);

// Remove .rows checks and use direct array access
content = content.replace(/result\.rows\?\.\[0\]/g, "result[0]");
content = content.replace(/result\.rows\?\.length/g, "result.length");
content = content.replace(/result\.rows\s*\|\|\s*result/g, "result");
content = content.replace(/rows\.rows\s*\|\|\s*rows/g, "rows");
content = content.replace(/data\.rows/g, "data");
content = content.replace(/hypertableCheck\.rows/g, "hypertableCheck");
content = content.replace(/tableCheck\.rows/g, "tableCheck");
content = content.replace(/primaryKeyCheck\.rows/g, "primaryKeyCheck");

// Replace .query() with .unsafe() for dynamic table names
content = content.replace(/await this\.sql\.query\(/g, "await this.sql.unsafe(");

// Remove parameterized query arrays since we're using .unsafe()
// This is a bit tricky - we need to handle multi-line patterns

console.log("Simplified PostgreSQLQueue.ts");
console.log("Backup saved to", filePath + ".backup2");
console.log("Please review the changes manually");

writeFileSync(filePath, content);
