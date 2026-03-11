import { WebSocketServer, ChannelMessage } from "../../src/communication/WebSocketServer.js";
import { WorkerMessageType } from "../../src/types/index.js";

/**
 * Example demonstrating the new channel routing and structured routing features
 */
export class ChannelRoutingExample {
  private server: WebSocketServer;

  constructor() {
    this.server = new WebSocketServer({ port: 8081 });
  }

  async start() {
    // Register a channel route for handling workflow messages
    this.server.registerChannelRoute({
      handler: async (connection, message) => {
        console.log("Received channel message:", message);

        // Handle different workflow actions
        if (message.action === "step-complete") {
          console.log(`Step ${message.type} completed with payload:`, message.payload);
        } else if (message.action === "workflow-start") {
          console.log(`Workflow ${message.type} started`);
        }
      },
      priority: 10,
    });

    // Register a structured route for custom message filtering
    this.server.registerStructuredRoute(
      (message) =>
        message.type === WorkerMessageType.JOB_RESULT && message.payload?.success === false,
      async (connection, message) => {
        console.log("Handling failed job result:", message.payload);
        // Custom logic for failed jobs
      },
      5,
    );

    // Start the server
    await this.server.start();
    console.log("Channel routing example server started on port 8081");
  }

  async stop() {
    await this.server.stop();
  }

  // Example of sending a channel message
  sendWorkflowMessage(workerId: number, workflowType: string, action: string, payload?: any) {
    const channelMessage: ChannelMessage = {
      type: workflowType,
      subChannel: "workflow",
      action,
      payload,
    };

    return this.server.sendChannelToWorker(workerId, channelMessage);
  }
}

// Example usage:
// const example = new ChannelRoutingExample();
// await example.start();
// example.sendWorkflowMessage(1, "data-processing", "step-complete", { stepId: "transform", result: "success" });
