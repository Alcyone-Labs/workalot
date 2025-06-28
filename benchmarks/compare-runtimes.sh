#!/bin/bash

# Runtime Comparison Script for Workalot Benchmarks
# Runs the same benchmark configuration across Node.js, Bun, and Deno

set -e

# Configuration
DIFFICULTY=${1:-"easy"}
CONFIG=${2:-"2-cores-10k-jobs,4-cores-10k-jobs"}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="./benchmark-results-${TIMESTAMP}"

echo "Workalot Runtime Comparison"
echo "=============================="
echo "Difficulty: $DIFFICULTY"
echo "Configurations: $CONFIG"
echo "Results Directory: $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to run benchmark and capture timing
run_benchmark() {
    local runtime=$1
    local command=$2
    local output_dir="$RESULTS_DIR/$runtime"
    
    echo "Running benchmark with $runtime..."
    echo "Command: $command"
    echo ""
    
    # Create runtime-specific output directory
    mkdir -p "$output_dir"
    
    # Run the benchmark and capture timing
    local start_time=$(date +%s)
    if eval "$command --output $output_dir"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo "$runtime completed in ${duration}s"
        echo "$duration" > "$output_dir/runtime_duration.txt"
    else
        echo "$runtime failed"
        echo "FAILED" > "$output_dir/runtime_duration.txt"
    fi
    echo ""
}

# Build for Node.js
echo "Building project for Node.js..."
pnpm run build
echo ""

# Run benchmarks with each runtime
if command_exists node; then
    run_benchmark "nodejs" "node dist/benchmarks/run-benchmarks.js --configs $CONFIG --difficulty $DIFFICULTY"
else
    echo "⚠️  Node.js not found, skipping..."
fi

if command_exists bun; then
    run_benchmark "bun" "bun run benchmarks/run-benchmarks.ts --configs $CONFIG --difficulty $DIFFICULTY"
else
    echo "⚠️  Bun not found, skipping..."
fi

if command_exists deno; then
    # Deno runs the compiled JavaScript version for compatibility
    run_benchmark "deno" "deno run --allow-all dist/benchmarks/run-benchmarks.js --configs $CONFIG --difficulty $DIFFICULTY"
else
    echo "⚠️  Deno not found, skipping..."
fi

# Generate comparison report
echo "Generating comparison report..."
cat > "$RESULTS_DIR/comparison_report.md" << EOF
# Runtime Comparison Report

**Generated:** $(date)
**Configuration:** $CONFIG
**Difficulty:** $DIFFICULTY

## Runtime Performance Summary

EOF

# Add runtime durations to report
for runtime in nodejs bun deno; do
    if [ -f "$RESULTS_DIR/$runtime/runtime_duration.txt" ]; then
        duration=$(cat "$RESULTS_DIR/$runtime/runtime_duration.txt")
        echo "- **$runtime:** ${duration}s" >> "$RESULTS_DIR/comparison_report.md"
    fi
done

echo "" >> "$RESULTS_DIR/comparison_report.md"
echo "## Detailed Results" >> "$RESULTS_DIR/comparison_report.md"
echo "" >> "$RESULTS_DIR/comparison_report.md"
echo "Check individual runtime directories for detailed benchmark results:" >> "$RESULTS_DIR/comparison_report.md"

for runtime in nodejs bun deno; do
    if [ -d "$RESULTS_DIR/$runtime" ]; then
        echo "- \`$runtime/\` - Results from $runtime runtime" >> "$RESULTS_DIR/comparison_report.md"
    fi
done

echo ""
echo "Runtime comparison complete!"
echo "Results saved to: $RESULTS_DIR"
echo "View comparison report: $RESULTS_DIR/comparison_report.md"
echo ""
echo "Quick summary:"
for runtime in nodejs bun deno; do
    if [ -f "$RESULTS_DIR/$runtime/runtime_duration.txt" ]; then
        duration=$(cat "$RESULTS_DIR/$runtime/runtime_duration.txt")
        echo "  $runtime: ${duration}s"
    fi
done
