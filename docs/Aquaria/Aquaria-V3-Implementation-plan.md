# Aquaria V3 Implementation Plan

## Executive Summary

Aquaria V3 will be built as a workflow orchestration layer on top of Workalot V2, leveraging Workalot's robust job execution, queue management, and distributed worker infrastructure while adding workflow-specific capabilities like event sourcing, tool integration, and advanced control flow.

## Table of Contents

- [Architectural Boundary](#architectural-boundary)
- [Integration Points](#integration-points)
- [Implementation Approach](#implementation-approach)
- [Component Breakdown](#component-breakdown)
- [Workalot V2 Gaps](#workalot-v2-gaps)
- [Development Phases](#development-phases)

## Architectural Boundary

### Workalot V2 Responsibilities (Infrastructure Layer)

**What Workalot V2 Provides:**
- Job execution engine with BaseJob interface
- Queue management (SQLite, PGLite, PostgreSQL, Memory backends)
- Distributed worker management and health monitoring
- WebSocket communication infrastructure
- Basic orchestration (SimpleOrchestrator, WorkerManager)
- Job lifecycle events (job-scheduled, job-completed, job-failed)
- Task scheduling APIs (scheduleAndWait, schedule)

**Workalot V2 Scope:**
- Low-level job distribution and execution
- Worker thread/process management
- Database queue operations
- Network communication between orchestrator and workers
- Basic job result collection and error handling

### Aquaria V3 Responsibilities (Workflow Layer)

**What Aquaria V3 Adds:**
- Workflow definition and execution (Steps, Paths, Workflows)
- Event sourcing with replay/resume capabilities
- Tool and MCP integration framework
- Meta envelope context management (tokens, budgets, models)
- Oracle system for AI-guided decisions
- Advanced control flow (pause/resume/abort at step level)
- Hierarchical WebSocket pub/sub channels
- Workflow-specific orchestration logic

**Aquaria V3 Scope:**
- High-level workflow composition and routing
- AI-specific context and budget management
- Tool calling and MCP server integration
- Event ledger management for deterministic replay
- Workflow state management and persistence
- Advanced orchestration patterns (fan-out, joins, cycles)

## Integration Points

### 1. Job Execution Integration

Aquaria workflows execute as Workalot jobs:

```typescript
// Aquaria Step becomes a Workalot Job
class AquariaStepJob extends BaseJob {
  async run(payload: StepExecutionPayload, context: JobExecutionContext) {
    // Execute Aquaria step logic
    // Handle tool calls, meta envelope updates
    // Return step results
  }
}
```

### 2. Orchestrator Integration

Aquaria orchestrator uses Workalot's infrastructure:

```typescript
class AquariaOrchestrator {
  private workalotManager: TaskManager;
  private eventStore: EventStore;
  private webSocketChannels: WebSocketChannelManager;
  
  async executeWorkflow(workflow: WorkflowDefinition) {
    // Use Workalot for job scheduling
    // Add Aquaria-specific event sourcing
    // Manage workflow state and routing
  }
}
```

### 3. WebSocket Channel Extension

Extend Workalot's WebSocket system for Aquaria channels:

```typescript
// Extend Workalot's WebSocketServer
class AquariaWebSocketServer extends WebSocketServer {
  // Add hierarchical channel support
  // Implement jobs/workflows/service channels
  // Add pub/sub capabilities
}
```

### 4. Event System Integration

Bridge Workalot events to Aquaria event sourcing:

```typescript
// Listen to Workalot events and transform to Aquaria events
workalotManager.on('job-completed', (jobId, result) => {
  // Transform to Aquaria step:complete event
  // Store in event ledger
  // Trigger next workflow steps
});
```

## Implementation Approach

### Phase 1: Core Infrastructure Extensions

1. **Extend Workalot WebSocket System**
   - Add hierarchical channel support (jobs:*, workflows:*, service:*)
   - Implement pub/sub message routing
   - Add channel subscription management

2. **Create Aquaria Job Wrapper**
   - Implement AquariaStepJob extending BaseJob
   - Add meta envelope handling
   - Integrate tool calling framework

3. **Build Event Store**
   - Implement event sourcing with replay capabilities
   - Create event ledger persistence
   - Add deterministic resume functionality

### Phase 2: Workflow Engine

1. **Workflow Definition System**
   - Implement Step, Path, Workflow interfaces
   - Add workflow composition and validation
   - Create workflow registry

2. **Aquaria Orchestrator**
   - Build on top of Workalot's TaskManager
   - Add workflow-specific routing logic
   - Implement step execution coordination

3. **Meta Envelope System**
   - Create context passing infrastructure
   - Add budget and token tracking
   - Implement model and tool usage logging

### Phase 3: Tool Integration

1. **Tool Framework**
   - Create unified tool interface
   - Add tool registry and discovery
   - Implement tool execution context

2. **MCP Integration**
   - Add MCP client/server support
   - Implement dynamic tool discovery
   - Create tool aliasing system

3. **Oracle System**
   - Implement Oracle interface
   - Add AI-guided decision making
   - Create Oracle composition patterns

### Phase 4: Advanced Features

1. **Control Flow**
   - Add pause/resume/abort capabilities
   - Implement cooperative cancellation
   - Create workflow state checkpointing

2. **Advanced Orchestration**
   - Add parallel execution support
   - Implement fan-out and join patterns
   - Create cycle detection and bounds

## Component Breakdown

### Aquaria Core Components

```
src/aquaria/
├── core/
│   ├── WorkflowEngine.ts          # Main workflow execution engine
│   ├── AquariaOrchestrator.ts     # Workflow orchestrator
│   └── EventStore.ts              # Event sourcing implementation
├── definitions/
│   ├── Step.ts                    # Step interface and base classes
│   ├── Path.ts                    # Path composition
│   └── Workflow.ts                # Workflow definition
├── jobs/
│   ├── AquariaStepJob.ts          # Workalot job wrapper for steps
│   └── StepExecutionContext.ts    # Step execution environment
├── tools/
│   ├── ToolRegistry.ts            # Tool management
│   ├── MCPClient.ts               # MCP integration
│   └── ToolExecutor.ts            # Tool execution engine
├── communication/
│   ├── AquariaWebSocketServer.ts  # Extended WebSocket server
│   └── ChannelManager.ts          # Channel pub/sub management
├── oracle/
│   ├── OracleInterface.ts         # Oracle system interface
│   └── OracleComposer.ts          # Oracle composition
└── context/
    ├── MetaEnvelope.ts            # Context envelope management
    └── BudgetTracker.ts           # Budget and resource tracking
```

## Workalot V2 Gaps

### Critical Gaps to Address

1. **Hierarchical WebSocket Channels**
   - Current: Basic worker communication
   - Needed: jobs:*, workflows:*, service:* channel hierarchy
   - Solution: Extend WebSocketServer with channel routing

2. **Event Sourcing Infrastructure**
   - Current: Simple EventEmitter events
   - Needed: Persistent event ledger with replay
   - Solution: Add EventStore component to Workalot

3. **Granular Control Flow**
   - Current: Job-level start/stop
   - Needed: Step-level pause/resume/abort
   - Solution: Add control signal propagation

4. **Context Passing Enhancement**
   - Current: Basic JobExecutionContext
   - Needed: Rich meta envelope with budgets, tokens, models
   - Solution: Extend JobExecutionContext interface

5. **Tool Integration Framework**
   - Current: No tool system
   - Needed: Tool registry and execution framework
   - Solution: Add tool system as Workalot extension

### Recommended Workalot V2 Extensions

1. **Enhanced WebSocket System**
   ```typescript
   // Add to Workalot
   interface ChannelMessage {
     type: string;
     subChannel?: string;
     action: string;
     payload?: any;
   }
   ```

2. **Extended Job Context**
   ```typescript
   // Extend existing JobExecutionContext
   interface EnhancedJobExecutionContext extends JobExecutionContext {
     metaEnvelope: MetaEnvelope;
     toolRegistry: ToolRegistry;
     eventEmitter: EventEmitter;
   }
   ```

3. **Event Store Integration**
   ```typescript
   // Add to Workalot as optional component
   interface EventStore {
     append(event: WorkflowEvent): Promise<void>;
     replay(fromSequence: number): AsyncIterator<WorkflowEvent>;
   }
   ```

## Development Phases

### Phase 1: Foundation (Weeks 1-2)
- Extend Workalot WebSocket system for channels
- Create AquariaStepJob wrapper
- Implement basic event store
- Set up project structure

### Phase 2: Core Engine (Weeks 3-4)
- Build workflow definition system
- Implement Aquaria orchestrator
- Add meta envelope management
- Create step execution framework

### Phase 3: Tool Integration (Weeks 5-6)
- Implement tool registry and execution
- Add MCP client integration
- Create Oracle system foundation
- Add tool calling to steps

### Phase 4: Advanced Features (Weeks 7-8)
- Add pause/resume/abort controls
- Implement parallel execution
- Create workflow state persistence
- Add comprehensive error handling

### Phase 5: Polish & Testing (Weeks 9-10)
- Comprehensive testing suite
- Performance optimization
- Documentation and examples
- Integration testing with Workalot

## Success Criteria

1. **Clean Separation**: Aquaria uses Workalot as infrastructure without modifying core Workalot logic
2. **Performance**: Maintains Workalot's high-performance job execution
3. **Scalability**: Supports distributed workflow execution across multiple nodes
4. **Reliability**: Event sourcing enables deterministic replay and recovery
5. **Extensibility**: Tool and MCP integration allows easy workflow extension
6. **Usability**: Simple API for defining and executing complex AI workflows

This implementation plan provides a clear path to build Aquaria V3 on top of Workalot V2 while maintaining clean architectural boundaries and leveraging the strengths of both systems.
