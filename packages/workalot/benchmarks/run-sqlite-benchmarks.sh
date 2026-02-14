#!/bin/bash

# SQLite Benchmark Runner
# Runs comprehensive benchmarks for SQLite backend with both in-memory and file-based configurations

set -e

echo "🗄️  SQLite Backend Benchmark Suite"
echo "=================================="
echo ""

# Default difficulty
DIFFICULTY=${1:-easy}

echo "Running SQLite benchmarks with difficulty: $DIFFICULTY"
echo ""

# SQLite In-Memory Benchmarks (1k jobs)
echo "📊 SQLite In-Memory Benchmarks (1k jobs)"
echo "----------------------------------------"
bun run benchmarks/run-benchmarks.ts \
  --configs 2-cores-1k-jobs-sqlite-memory,4-cores-1k-jobs-sqlite-memory,6-cores-1k-jobs-sqlite-memory \
  --difficulty $DIFFICULTY

echo ""

# SQLite File-Based Benchmarks (1k jobs)
echo "💾 SQLite File-Based Benchmarks (1k jobs)"
echo "-----------------------------------------"
bun run benchmarks/run-benchmarks.ts \
  --configs 2-cores-1k-jobs-sqlite-file,4-cores-1k-jobs-sqlite-file,6-cores-1k-jobs-sqlite-file \
  --difficulty $DIFFICULTY

echo ""

# SQLite In-Memory Benchmarks (10k jobs)
echo "📊 SQLite In-Memory Benchmarks (10k jobs)"
echo "-----------------------------------------"
bun run benchmarks/run-benchmarks.ts \
  --configs 2-cores-10k-jobs-sqlite-memory,4-cores-10k-jobs-sqlite-memory,6-cores-10k-jobs-sqlite-memory \
  --difficulty $DIFFICULTY

echo ""

# SQLite File-Based Benchmarks (10k jobs)
echo "💾 SQLite File-Based Benchmarks (10k jobs)"
echo "------------------------------------------"
bun run benchmarks/run-benchmarks.ts \
  --configs 2-cores-10k-jobs-sqlite-file,4-cores-10k-jobs-sqlite-file,6-cores-10k-jobs-sqlite-file \
  --difficulty $DIFFICULTY

echo ""
echo "✅ SQLite benchmark suite completed!"
echo ""
echo "💡 To compare with other backends:"
echo "   bun run benchmarks/run-benchmarks.ts --configs 4-cores-1k-jobs-sqlite-memory,4-cores-1k-jobs-pglite,4-cores-1k-jobs-memory --difficulty $DIFFICULTY"
echo ""
echo "📈 Results are saved in benchmarks/results/ directory"
