# Contributing to Workalot

Thank you for your interest in contributing to Workalot! This document provides guidelines for contributing to the project.

## ⚠️ IMPORTANT: Use PNPM Only

**This project uses pnpm as its package manager. DO NOT use npm or yarn.**

### Why PNPM?

- **Workspace Support**: We use pnpm workspaces for our monorepo structure
- **Disk Efficiency**: pnpm's content-addressable storage saves disk space
- **Strict Dependencies**: pnpm enforces correct dependency relationships
- **Performance**: Faster installation and better caching

### Installing PNPM

```bash
# Using npm (one-time install)
npm install -g pnpm

# Using Homebrew (macOS)
brew install pnpm

# Using corepack (Node.js 16.10+)
corepack enable
corepack prepare pnpm@10.28.2 --activate
```

### Verifying PNPM

After installation, verify pnpm is available:

```bash
pnpm --version  # Should be 10.28.2 or higher
```

## Development Setup

1. **Clone the repository:**

```bash
git clone https://github.com/alcyone-labs/workalot.git
cd workalot
```

2. **Install dependencies:**

```bash
# CORRECT: Using pnpm
pnpm install

# WRONG: Do not use npm or yarn
# npm install    ❌
# yarn install   ❌
```

3. **Build all packages:**

```bash
pnpm run build
```

4. **Run tests:**

```bash
pnpm run test:run
```

## Monorepo Structure

This is a pnpm workspace monorepo with three packages:

```
workalot/
├── packages/
│   ├── workalot/              # Core job queue system
│   ├── workalot-telemetry/    # OpenTelemetry observability
│   └── workalot-dashboard/    # Web-based control plane
├── package.json               # Root monorepo config
└── pnpm-workspace.yaml        # Workspace definition
```

### Working with Packages

```bash
# Build specific package
pnpm run build:core
pnpm run build:telemetry
pnpm run build:dashboard

# Run tests for specific package
cd packages/workalot && pnpm run test:run

# Add dependency to specific package
cd packages/workalot && pnpm add lodash

# Add dev dependency to root
pnpm add -D typescript --workspace-root
```

## Development Workflow

### Making Changes

1. Create a feature branch:
```bash
git checkout -b feature/my-feature
```

2. Make your changes in the appropriate package(s)

3. Build and test:
```bash
pnpm run build
pnpm run test:run
```

4. Commit your changes (follow conventional commits):
```bash
git commit -m "feat(core): add new telemetry hook"
```

### Adding Dependencies

**To a specific package:**
```bash
cd packages/workalot
pnpm add lodash
```

**As a dev dependency:**
```bash
pnpm add -D @types/node
```

**To the root (shared tooling):**
```bash
pnpm add -D typescript --workspace-root
```

**Between workspace packages:**
```bash
cd packages/workalot-dashboard
pnpm add @alcyone-labs/workalot
```

The `workspace:*` protocol will be used automatically for workspace dependencies.

## Code Standards

### TypeScript

- Use strict TypeScript configuration
- All functions must have explicit return types
- Use interfaces over types for object definitions
- Prefer `interface` for public APIs

### Naming Conventions

- `PascalCase` - Classes, interfaces, types (`TaskManager`, `QueueConfig`)
- `camelCase` - Variables, functions, methods (`scheduleAndWait`, `jobPayload`)
- `UPPER_SNAKE_CASE` - Constants and enums (`WorkerMessageType`, `JobStatus`)
- `kebab-case` - File names (`job-scheduler.ts`, `format-job.ts`)

### Code Style

- Use async/await over callbacks
- Prefer early returns over nested conditionals
- Use path aliases (`#/*`) instead of relative imports
- Document all public APIs with JSDoc

## Testing

### Running Tests

```bash
# All packages
pnpm run test:run

# Specific package
cd packages/workalot && pnpm run test:run

# Watch mode
cd packages/workalot && pnpm run test
```

### Writing Tests

- Tests go in `tests/` directory
- Name test files `*.test.ts`
- Use Vitest for testing
- Mock external dependencies
- Test both success and error cases

## Submitting Changes

1. Ensure all tests pass:
```bash
pnpm run test:run
```

2. Build all packages:
```bash
pnpm run build
```

3. Check types:
```bash
pnpm run typecheck
```

4. Create a pull request with:
   - Clear description of changes
   - Link to related issues
   - Screenshots if UI changes
   - Updated documentation if needed

## Common Issues

### "Cannot find module" errors

Make sure you've built the packages:
```bash
pnpm run build
```

### "pnpm not found"

Install pnpm globally:
```bash
npm install -g pnpm
```

### Workspace dependency errors

Ensure you're using `workspace:*` protocol for internal dependencies:
```json
{
  "dependencies": {
    "@alcyone-labs/workalot": "workspace:*"
  }
}
```

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Check existing documentation first

Thank you for contributing! 🎉
