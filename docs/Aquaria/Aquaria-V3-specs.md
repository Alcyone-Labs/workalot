---

- Tags: #prd | #aquaria

---

# Context

Aquaria (Namespaced name: **@alcyone-labs/aquaria**) is a Node.js library built to be ran with Bun.js with the purpose to write AI workflows.

The main goal is enable building and composign workflows, schedule them, and run them, either locally all on one machine, or in a distributed fashion where a Distributed Job Queue handles centralizing the jobs, and every execution node pulls job when they have some capacity.

The Distributed Job Queue is an in-house library that supports local in-memory queueing via electric-sql, as well as highly distributed, high volume queue dispatch via a hosted TimecaleDB and a LISTEN/NOTIFY pattern as well as a worker-state-aware balancing. It supports job refusal (e.g. when a node is overloaded), retries, `ON UPDATE LOCK` for efficient job fetching by multiple services, and highly performant job historization via TimescaleDB compressed hypertables.

Aquaria itself is a Workflow Executor, composed of an Orchestrator that handles workflow execution, job fetching, as well as message synchronization via WebSocket ran by the Orchestrator, and Step Executors, each on its own thread with a max threads set to `os.cpus().length / 2` to keep room for the OS to function. Each step executor is started and lightly managed by the Orchestrator which only starts it and restarts it if one crashes, the `Step Executor` then connects to the Orchestrator’s WebSocket server via `ws://localhost:port`, sends status updates to and receives orders from the orchestrator.

# Table of Contents

- Essence
- V3 Principles
- Core Concepts
- Execution Model
- Event Sourcing and Control
- Oracle
- Interfaces (Tool, Step, Path, Workflow, Meta Envelope)
- Model Routing and LLM Providers
- MCP Integration
- Research Workflow Example
- Telemetry, Budgets, Errors
- Compatibility Notes

# Essence

Aquaria is an orchestration-first framework. Everything is a tool call or a business-logic step that composes tools. Steps chain into paths; paths compose into workflows. The orchestrator steers execution using a uniform context envelope, an event-sourced ledger, and optional Oracles for guidance. Focus: composability, inspectability, interruptibility, and provider-agnostic LLM use via Vercel AI SDK.

# V3 Principles

- Tools and MCP are first-class.
- Steps only define business logic and metadata; they do not own IO, transport, or provider logic.
- Each step receives the previous output plus a `_meta` envelope with full run context. Each step returns outputs plus updated `_meta`.
- Uniform signatures with Zod-validated schemas.
- Event-sourced chain-of-events at step and tool boundaries. Everything emits events; everything can be paused/resumed.
- Deterministic resumption via replay from the event ledger.
- Composable routing: steps connect into paths with conditional next, fan-out, and joins; cycles are allowed but bounded by budgets and sequence caps.
- Provider-agnostic by default; model and tool selection is orchestrated, not hardcoded.

- Steps and paths expose option schemas for CLI via ArgParser, enabling dynamic topology without hardcoding.

# Core Concepts

- Tool: A callable capability with typed input/output and `_meta` updates.
- MCP Tool: Remote tool accessed via MCP with the same callable shape.
- Step: Business logic that calls tools, routes outputs, or transforms data.
- Path: A named composition of steps with conditional next routing.
- Workflow: A DAG of paths and steps with entry params and exit conditions.
- Orchestrator: The runtime that executes steps, manages events, and consults Oracles.
- Run Ledger (Event Store): Append-only store of all events for replay and audit.
- Context Envelope (`_meta`): Execution state attached to every hop; includes sequence numbers, run durations, tokens, models, tools, status codes, budgets, and errors.
- Model Router: LLM model selection using Vercel AI SDK and configured preferences.
- Oracle: Advisory module that can recommend next steps, tools, or corrections.

# Execution Model

- Input Envelope: `{ data, _meta }` flows between steps and tools.
- `_meta` carries: sequenceNo, runTime (ms), tokensIn, tokensOut, modelsUsed[], toolsUsed[], statusCode, budgetRemaining, error?, notes[]. Avoid timestamps; rely on sequence and durations.
- Steps:
  - Receive `{ data, _meta }`, may call tools, emit events, and return `{ data, _meta }`.
  - May propose next routing hints; orchestrator resolves final routing.
- Paths:
  - Define `next` rules: static, predicate-based, or Oracle-guided.
- Workflows:
  - Define entry inputs, budgets, guardrails, and exit conditions.

# Event Sourcing and Control

- Event Types: `run:start`, `workflow:start`, `path:start`, `step:start`, `tool:start`, `tool:complete`, `tool:error`, `step:complete`, `step:error`, `path:complete`, `exit`, `budget:update`, `oracle:consult`.
- Control Commands: `pause`, `resume`, `abort`, `inject_context`, `redirect`, `replay_from`.
- Interruptibility: Orchestrator honors commands at tool and step boundaries, with cooperative cancellation inside steps via an abort signal.
- Subscriptions: Clients can subscribe to a run stream over streamable HTTP; all events are appended to the ledger for replay.

# Oracle

- Purpose: Guidance for next-step planning, tool choice, critique, and constraint checks.
- APIs:
  - `planNextStep(context) -> Recommendation` (stepId, justification, confidence)
  - `chooseTool(activity, availableTools, context) -> ToolId` (with rationale)
  - `critique(output, criteria, context) -> Suggestions[]`
- Configuration: System-level; model and prompt strategy set at server start. Multiple Oracles can be composed or voted.
- Orchestrator treats Oracle outputs as advisory; constraints and budgets take precedence.

# Interfaces (Tool, Step, Path, Workflow, Meta Envelope)

```ts
interface MetaEnvelope {
  sequenceNo: number;
  runTime?: number;
  tokensIn?: number;
  tokensOut?: number;
  modelsUsed?: string[];
  toolsUsed?: string[];
  statusCode?: number;
  budgetRemaining?: number;
  error?: { code: string; message: string };
}
```

```ts
interface ToolContext {
  runId: string;
  meta: MetaEnvelope;
  emit: (event: object) => void;
  abortSignal: AbortSignal;
}

interface ITool<I, O> {
  id: string;
  activity: string;
  run: (ctx: ToolContext, input: I) => Promise<{ output: O; _meta: MetaEnvelope }>;
}
```

```ts
interface StepExecution<I> {
  input: { data: I; _meta: MetaEnvelope };
  tools: Record<string, ITool<any, any>>;
  oracle?: {
    planNextStep: (ctx: any) => Promise<any>;
    chooseTool: (a: string, t: any[], c: any) => Promise<string>;
  };
  emit: (event: object) => void;
  abortSignal: AbortSignal;
}

interface IStep<I, O> {
  id: string;
  run: (exec: StepExecution<I>) => Promise<{ data: O; _meta: MetaEnvelope }>;
}
```

```ts
interface PathDefinition {
  id: string;
  steps: IStep<any, any>[];
  next: (state: { data: any; _meta: MetaEnvelope }) => string | null; // stepId or null
}

interface WorkflowDefinition {
  id: string;
  entry: IStep<any, any>;
  paths: Record<string, PathDefinition>;
  exit: { conditions: (m: MetaEnvelope) => boolean; pathId: string };
}
```

# Model Routing and LLM Providers

- Use Vercel AI SDK for model access and tool calling.
- Provider and model selection via a Model Router:
  - Prefer VeniceAI, then Gemini, then Mistral, then Anthropic, then OpenAI.
  - Configurable via env and CLI; no hardcoding in steps.
  - Choose models by task type (planning, extraction, evaluation, report), cost, and budgetRemaining.

# MCP Integration

- Host MCP client/server under `src/providers/mcp`.
- Use streamable HTTP transport only.
- Dynamic tool discovery with explicit aliases to avoid name collisions.
- Provide centralized tool registry and resource subscriptions.
- Inject MCP tools into `tools` for steps; enforce soft validation by default with per-workflow overrides.

# Research Workflow Example

- Plan: Oracle-guided plan from user goal to path skeleton.
- Query Optimization: Cheap model rephrasing for search queries and params.
- Search: Brave search tool.
- Extract: Firecrawl for content extraction and medium model to extract learnings.
- Evaluate: Thinking model checks sufficiency; if not sufficient and budgetRemaining > 0, iterate.
- Exit: When sufficient or budget reached, generate report outside of budget constraints.
- All steps/tool calls update `_meta` and emit events; report includes sources.

# Telemetry, Budgets, Errors

- Track tokens, run durations, status codes, and budgets in `_meta`.
- Retries with backoff at tool level; fail-fast for critical constraints.
- Deterministic resume by replaying ledger and continuing at the last safe boundary.

# Compatibility Notes

Distributed job scheduling and WebSocket pub/sub from earlier designs can act as transport and control surfaces. The V3 orchestrator sits above them, consuming and emitting events with the same `_meta` envelope and control commands.


# History and Learnings

The first two versions of Aquaria were quite successful in building a layer that fit its original vision, but they both suffered from relatively similar issues:

- They tried to build too much *into* the framework itself so you had state management with many different backends, LLM management, prompt management, Search Providers management, a Provider Capability management, etc… We still need these but we can simply standardize tools and MCP extensions to greatly improve managing that code, reusing existing libraries (there are lots of available MCP servers) and simplifying the code
- They were both too heavy-handed in encapsulation, it became both very hard to compose, debug and optimize, and very easy to break
- They were way too taylored to each specific payload, so you had a step definition for every little thing
- Initially, I had written a code to handle talking to Language Models via APIs similar to Vercel AI SDK, but it’s no longer important or needed, so we can ditch all that code and gain new features and support
- The workflows were heavy and not stoppable, resumable, interruptable or distributable
- Each workflow and step had a lot of custom code to handle its own specificities, model, provider, etc…
- In V2, the graph connections were an afterthought, and ended up being relatively poorly designed, so we had to bake a lot of code to protect against cycles, and debugging behavior was very hard because the whole workflow ran as “one program with many steps chained together”
- The first two versions tried to “run as” the workflow itself, but that prevents a great many powerful composition patterns, starting with the ability to parallelize or distribute the execution
- Instead, we should use an orchestration pattern whereby each step belongs to a tree of execution (referred to as a Workflow)

Overall, they were good pieces of software, but they were not future-proof ones, and writing and running workflows felt like *way* too much grunt work. It was also extremely hard to maintain and improve.

What we need to build is a distillation of all the learnings we gained from it, leverage existing libraries such as Vercel AI SDK for managing models, leveraging on existing tools and MCP servers to extend functionality without having to rewrite things over and over again, and make the execution much more powerful by adding a strong oversight, traceability, statistics, interruptibility, all while making the code a lot simpler and the architecture a lot more robust.

# Glossary

## Execution Step | Workflow Step

The execution step, also called Workflow step, is the smallest unit of execution within the framework. Every step execute code, but some steps can be used to simply “route” or “cycle” or “control” in order to achieve any type of workflow composition. A step has inputs, outputs and a direct access to the orchestrator for querying various system parameters.

## Step Inputs

The step inputs contain all the variables that the step (or the sub-workflow) is going to be expecting to run properly.

A mandatory meta input is the `_meta` object, which will contain all the previous steps that have been ran so far, as well as their inputs and outputs, so as to be able to understand the context, as well as various statistics for every step, such as execution time, budget consumed, etc…, as well as the step parameters.

## Workflow Entrypoint

The workflow entrypoint is the starting point of a workflow. It sets the workflow parameters such as the orchestrator parameters for the current workflow, e.g. global budget or models, enqueues the various sub-workflows and steps, in the order it needs to achieve its goal, define the exit path thresholds / conditions and steps, and registers the workflow against the orchestrator, together with various parameters such as parallelization parameters, etc…

## Exit Path

An exit path is a directed, acyclic graph of steps that ends the execution of a workflow. An exit path has conditions at the orchestrator-level, meaning set directly by the starting step of the workflow, that the orchestrator will immediately trigger when the conditions or thesholds are reached.

## Exit Conditions | Exit Thresholds

The exit conditions / threshold define when a workflow must trigger the exit path. The orchestrator will decide whether a path should move to the exit path once a step has completed, but the step itself should exit if it reaches the conditions during execution, to avoid budget overruns.

## Sub-Workflow | Path

A sub-workflow, also called a path, contains a sequence of steps or other sub-workflows. A sub-workflow | path has a relatively similar signature to that of a step, being parameters, inputs and outputs, so any sub-workflow can be used as if it was an atomic execution step. This makes the workflow composition highly flexible.

Importantly, sub-workflows may also have exit conditions, so cyclic paths or long running paths may be able to elegantly exit if they reached a condition without waste.

## Workflow

A workflow, is a directed, cyclic graph of Sub-Workflows or steps. A workflow has a entrypoint with starting parameters, and must contain an exit path with the appropriate exit conditions.

## Workflow Orchestrator

The workflow orchestrator is the main thread of the app, starts the WebSocket server that it uses to send commands and receive status updates from various `Step Executors` threads. It starts the step executors and restarts them when they crash, keeps track of which workflows and steps are running, and guides the execution of each workflow by deciding which step to run next based on the workflow definition from its entrypoint, as well as the parameters with which it was started. It triggers the exit path when relevant.

## Step Executor

The step executor is a worker thread started by the `Workflow Orchestrator`, it connects to the service WebSocket started by the Orchestrator in order to receive commands and send status updates. It will then load the workflow, steps and tools / MCP definitions in order to properly execute any step required by the Orchestrator.

# Architecture

## Workflow architecture

- Abstraction and Event Sourcing
  - Every class should emit events that detail exactly what it’s doing
  - Every class should be able to receive a “pause” / “resume” / “abort” event in order to provide granular control at step, path, workflow, tool / mcp level
- Tools and MCP must be first-class citizens
  - Tools and MCP servers should have a relatively similar signature since they behave roughly similarly from a step execution perspective
  - Tools / MCPs need to be grouped by behavior / category / activity, so steps can expect to call tools for their specific needs. For example, a tool that needs to fetch a webpage should be able to have a tool for activity `fetch_url`, or making a web search `web_search`, etc…
  - A common signature for all tools must be defined, such as:
    - `inputs`: all inputs as an object, including `_meta` environment properties
    - `outputs`: all outputs as an object, including `_meta` properties such as `runTime` execution in ms, `statusCode` number following the logic of HTTP codes so it’s already standardized and is likely to be most of the time a forward of the tool call API HTTP status code, `failureDetails` string containing any log relevant to the failure for debugging
    - `run()`: async method to trigger the tool call
  - An event must be triggered when a tool is used
  - We must build a uniform signature for tools and MCP to wrap how they are expected to behave for each type of tool / MCP
  -
- MCP for steps must be first class citizens
  - Every step should be able to require

## Sub-Systems

- Distributed Job Scheduling
  - Handles distributing jobs (starting workflows) to local nodes
  - V1: Hosted in-memory via electric-sql/pgsql
  - V2: Hosted on a VM and leveraging TigerDate (formerly TimescaleDB)
- Workflow Orchestrator runs the workflows
  - A job can be scheduled via WebSocket or via CLI
  - Orchestrator keeps track of the running jobs
  -
- WebSocket-based Pub/Sub service
  - Runs on its own thread
  - Elysia-based, leveraging Bun-native websocket
  - Connects to the Distributed Job Scheduling to receives jobs
    - Forwards them to WebSocket on proper channel when received
    - If orchestrator refuses, rejects the job to the Distributed Job Scheduler for requeue
-

## Stack

- BunJS as the runtime
- ElysiaJS as the HTTP + WebSocket (bun-native) server
- @alcyone-labs/workalot NPM package (in-house package) for distributed work

## Flow

- Service Starts
  - Orchestrator Starts on main thread
  -
- Orchestrator runs

# Sub-Systems Technical Definition

## Distributed Job Scheduling

## Workflow Orchestrator

## WebSocket and Job Relay

### WebSocket Channels Specification

This specification defines the WebSocket-based pub/sub channels for Aquaria's Layer 2 (node-level communication). It enables local, thread-aware messaging for orchestration, event sourcing, and control, while supporting future multi-node mesh balancing via inter-node WebSocket connections.

The system uses hierarchical channels to organize messages by domain (`jobs`, `workflows`, `service`), with sub-channels for scoping (e.g., to specific jobs or workflows). Messages are JSON-formatted for consistency and ease of parsing.

#### Message Format

All WebSocket messages follow this standardized structure:

```json
{
  "type": "string",          // Main channel type: "jobs", "workflows", or "service"
  "subChannel": "string?",   // Optional sub-channel (e.g., "jobs:123", "workflows:456"). If omitted, applies to the main type.
  "action": "string",        // Specific command or event (e.g., "start", "step:complete")
  "payload": "object?"       // Optional data object (e.g., inputs, outputs, _meta). Must be JSON-serializable.
}
```

- **type**: Required. Determines the handler and routing logic.
- **subChannel**: Optional. Used for targeted subscriptions (e.g., only listen to messages for a specific job). If not provided, the message is broadcast to all subscribers of the `type`.
- **action**: Required. Describes the operation or event. Actions are prefixed for clarity (e.g., `step:` for step-related).
- **payload**: Optional. Contains event data, such as step inputs/outputs, `_meta` stats, or control parameters. For event sourcing, include detailed `_meta` (e.g., `runTime`, `statusCode`, `budgetConsumed`).

Clients subscribe to channels via a special `subscribe` action: `{ "type": "jobs", "subChannel": "jobs:123", "action": "subscribe" }`. Publishers send messages to the WebSocket endpoint (e.g., `/ws` in ElysiaJS).

#### Channel Types

##### 1. Jobs (`type: "jobs"`)

Handles job-level distribution, control, and status from Layer 1 (Distributed Job Scheduling). Jobs represent workflow initiations assigned to nodes.

- **Purpose**: Relay jobs from the scheduler, manage job lifecycle (start, pause, etc.), and report status for requeueing.

- **Sub-Channels**:

  - `jobs:${jobId}`: Scoped to a specific job (e.g., `jobs:abc-123`). Ensures only the assigned node processes it.

- **Actions**:

  - `start`: Initiates a job. Payload includes workflow details for forwarding to `workflows`.

    - Payload: `{ workflowId: "string", entrypoint: "object", parameters: "object" }`

  - `stop`: Halts a job. Payload specifies reason.

    - Payload: `{ reason: "string?" }`

  - `pause`: Suspends a job. Orchestrator saves state.

    - Payload: `{ reason: "string?" }`

  - `resume`: Resumes a paused job. Orchestrator restores state.

    - Payload: `{ }`

  - `status`: Updates or queries job state (e.g., running, failed). Used for Layer 1 feedback.

    - Payload: `{ state: "string", _meta: "object?" }` (e.g., `{ state: "failed", _meta: { error: "budget exceeded" } }`)

- **Examples**:

  - Subscribe to a job: `{ "type": "jobs", "subChannel": "jobs:abc-123", "action": "subscribe" }`
  - Start a job: `{ "type": "jobs", "subChannel": "jobs:abc-123", "action": "start", "payload": { "workflowId": "wf-456", "entrypoint": { "step": "init" } } }`
  - Report status: `{ "type": "jobs", "subChannel": "jobs:abc-123", "action": "status", "payload": { "state": "completed", "_meta": { "runTime": 500 } } }`

##### 2. Workflows (`type: "workflows"`)

Core orchestration channel for workflow execution, steps, sub-workflows, and tools. Supports event sourcing with detailed `_meta` for stats, context, and exit conditions.

- **Purpose**: Manage workflow lifecycle, step execution, parallelization, and control. Enables composable workflows via events.

- **Sub-Channels**:

  - `workflows:${workflowId}`: Scoped to a specific workflow (e.g., `workflows:wf-456`). Allows targeted control and event listening.

- **Actions**:

  - `start`: Launches a workflow. Orchestrator enqueues steps and sets parameters (e.g., budget).

    - Payload: `{ entrypoint: "object", parameters: "object", parallelization: "object?" }` (e.g., `{ entrypoint: { stepId: "init" }, parameters: { budget: 1000 } }`)

  - `step:execute`: Signals step start. Includes inputs and context.

    - Payload: `{ stepId: "string", inputs: "object", _meta: "object" }`

  - `step:complete`: Reports step success. Orchestrator checks exit conditions and triggers next steps.

    - Payload: `{ stepId: "string", outputs: "object", _meta: "object" }` (e.g., `{ stepId: "fetch-data", outputs: { data: "..." }, _meta: { runTime: 200, statusCode: 200, budgetConsumed: 50 } }`)

  - `step:fail`: Reports step failure. Includes debugging details.

    - Payload: `{ stepId: "string", failureDetails: "string", _meta: "object" }` (e.g., `{ stepId: "api-call", failureDetails: "Timeout", _meta: { statusCode: 500, runTime: 1000 } }`)

  - `tool:used`: Emitted when a tool or MCP is invoked. Uniform signature for first-class tools.

    - Payload: `{ toolId: "string", activity: "string", inputs: "object", outputs: "object", _meta: "object" }` (e.g., `{ toolId: "web-search", activity: "search", inputs: { query: "AI" }, outputs: { results: [...] }, _meta: { runTime: 150, statusCode: 200 } }`)

  - `exit`: Triggers exit path due to conditions (e.g., budget overrun). Orchestrator routes to exit steps.

    - Payload: `{ reason: "string", _meta: "object" }` (e.g., `{ reason: "budget", _meta: { consumed: 1200 } }`)

  - `parallel:start`: Initiates concurrent steps. Orchestrator manages parallelism.

    - Payload: `{ steps: "array" }` (e.g., `{ steps: [{ stepId: "step-1" }, { stepId: "step-2" }] }`)

  - `stop`, `pause`, `resume`: Workflow-level control. Applies to all active steps.

    - Payload: `{ reason: "string?" }`

- **Mesh Extensions** (for future multi-node): Use `workflows:mesh:${nodeId}` for cross-node actions like `balance` (redistribute workflows).

- **Examples**:

  - Subscribe to a workflow: `{ "type": "workflows", "subChannel": "workflows:wf-456", "action": "subscribe" }`
  - Start workflow: `{ "type": "workflows", "subChannel": "workflows:wf-456", "action": "start", "payload": { "entrypoint": { "stepId": "init" }, "parameters": { "model": "gpt-4" } } }`
  - Step completion: `{ "type": "workflows", "subChannel": "workflows:wf-456", "action": "step:complete", "payload": { "stepId": "data-process", "outputs": { "result": "processed" }, "_meta": { "runTime": 300, "budgetConsumed": 75, "statusCode": 200 } } }`
  - Tool usage: `{ "type": "workflows", "subChannel": "workflows:wf-456", "action": "tool:used", "payload": { "toolId": "fetch-url", "activity": "fetch_url", "inputs": { "url": "https://example.com" }, "outputs": { "content": "..." }, "_meta": { "runTime": 100, "statusCode": 200 } } }`

##### 3. Service (`type: "service"`)

System-level channel for configuration, health checks, and lifecycle management.

- **Purpose**: Handle node-level settings and operations, enabling mesh connectivity.

- **Sub-Channels**:

  - `service:settings`: For configuration updates.
  - `service:health`: For status checks.

- **Actions**:

  - `settings:set`: Updates system settings (e.g., global budget defaults).

    - Payload: `{ key: "string", value: "any" }` (e.g., `{ key: "maxBudget", value: 2000 }`)

  - `shutdown`: Gracefully stops the node.

    - Payload: `{ reason: "string?" }`

  - `restart`: Restarts the node/service.

    - Payload: `{ }`

  - `health:check`: Ping for node status. Used for mesh monitoring.

    - Payload: `{ }` (Response via separate message or direct reply).

- **Mesh Extensions**: Use `service:mesh:connect` for inter-node links (e.g., `{ "type": "service", "subChannel": "service:mesh", "action": "connect", "payload": { "targetNode": "node-2" } }`).

- **Examples**:

  - Set settings: `{ "type": "service", "subChannel": "service:settings", "action": "set", "payload": { "key": "timeout", "value": 30 } }`
  - Shutdown: `{ "type": "service", "action": "shutdown", "payload": { "reason": "maintenance" } }`
  - Health check: `{ "type": "service", "subChannel": "service:health", "action": "check" }`

#### Implementation Notes

- **Routing**: Use a handler map (e.g., `{ jobs: jobsHandler, workflows: workflowsHandler, service: serviceHandler }`) to route messages based on `type`. This minimizes code complexity—each handler processes actions/sub-channels via switch or Map lookups.
- **Subscriptions**: Clients subscribe explicitly to avoid spam. Unsubscribing can be added via `unsubscribe` action if needed.
- **Error Handling**: Invalid messages return `{ "error": "string" }`. For example, unknown `type` or malformed payload.
- **Security**: For mesh, use WSS (secure WebSockets) and authenticate nodes.
- **Event Sourcing**: Log all messages in-memory (or persist) for replay/resumability. Include `_meta` in payloads for stats.
- **Performance**: In-memory subscriber sets ensure fast pub/sub. Limit concurrent workflows per node to avoid overload.

This specification ensures unambiguous, composable communication, aligning with Aquaria's learnings on orchestration and simplicity. For updates, add new actions/payloads as needed.