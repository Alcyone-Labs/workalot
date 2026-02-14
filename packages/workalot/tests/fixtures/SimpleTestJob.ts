import { BaseJob } from "../../src/jobs/BaseJob.js";
import { ulid } from "ulidx";
import { createHash } from "node:crypto";

export class SimpleTestJob extends BaseJob {
  getJobId(payload?: Record<string, any>): string | undefined {
    // Generate a unique job ID for each job instance
    return ulid();
  }
  
  async run(payload: Record<string, any>) {
    // context parameter is added
    const { operation, values, numbers, error, invalid, message, delay } = payload;

    // Add delay if specified (for timeout testing)
    if (delay && typeof delay === 'number' && delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (error) {
      throw new Error("This is a test error");
    }

    if (invalid) {
      throw new Error("Unsupported operation: invalid");
    }

// Handle simple message case (like ping-pong)
      if (message && !operation) {
        // Add a small delay to ensure executionTime is greater than 0
        await new Promise(resolve => setTimeout(resolve, 50));
        return this.createSuccessResult({ message: "pong" });
      }

    // Use either 'values' or 'numbers' array
    const numberArray = values || numbers;

    if (operation === "add") {
      if (!numberArray || !Array.isArray(numberArray)) {
        throw new Error("Missing or invalid numbers array for add operation");
      }
      const result = numberArray.reduce(
        (sum: number, val: number) => sum + val,
        0,
      );
      return this.createSuccessResult({ result, workerId: -1 });
    }

    if (operation === "multiply") {
      if (!numberArray || !Array.isArray(numberArray)) {
        throw new Error(
          "Missing or invalid numbers array for multiply operation",
        );
      }
      const result = numberArray.reduce(
        (product: number, val: number) => product * val,
        1,
      );
      return this.createSuccessResult({ result, workerId: -1 });
    }

    if (operation === "invalid") {
      throw new Error("Unsupported operation: invalid");
    }

    return this.createSuccessResult({ message: "No operation performed" });
  }
}
