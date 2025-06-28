#!/bin/bash

# Backend Comparison Benchmark
# Compares SQLite, PGLite, and Memory backends with identical workloads

set -e

echo "⚡ Backend Performance Comparison"
echo "================================"
echo ""

# Default difficulty and cores
DIFFICULTY=${1:-easy}
CORES=${2:-4}
JOBS=${3:-1k}

echo "Configuration:"
echo "  Difficulty: $DIFFICULTY"
echo "  Cores: $CORES"
echo "  Jobs: $JOBS"
echo ""

# Build config names
MEMORY_CONFIG="${CORES}-cores-${JOBS}-jobs-memory"
SQLITE_MEMORY_CONFIG="${CORES}-cores-${JOBS}-jobs-sqlite-memory"
SQLITE_FILE_CONFIG="${CORES}-cores-${JOBS}-jobs-sqlite-file"
PGLITE_CONFIG="${CORES}-cores-${JOBS}-jobs-pglite"
PGLITE_FILE_CONFIG="${CORES}-cores-${JOBS}-jobs-pglite-file"

echo "🏁 Running Backend Comparison Benchmarks"
echo "----------------------------------------"

# Run all backends with the same configuration
bun run benchmarks/run-benchmarks.ts \
  --configs $MEMORY_CONFIG,$SQLITE_MEMORY_CONFIG,$SQLITE_FILE_CONFIG,$PGLITE_CONFIG,$PGLITE_FILE_CONFIG \
  --difficulty $DIFFICULTY

echo ""
echo "✅ Backend comparison completed!"
echo ""
echo "📊 Performance Summary:"
echo "  1. Memory Backend (baseline)"
echo "  2. SQLite In-Memory (recommended)"
echo "  3. SQLite File-Based (with persistence)"
echo "  4. PGLite In-Memory (PostgreSQL compatibility)"
echo "  5. PGLite File-Based (full PostgreSQL persistence)"
echo ""
echo "💡 Expected performance ranking (fastest to slowest):"
echo "  1. Memory > SQLite In-Memory > SQLite File > PGLite In-Memory > PGLite File"
echo ""
echo "📈 Results are saved in benchmarks/results/ directory"
