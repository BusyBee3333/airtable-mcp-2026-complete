// Airtable Rate Limit Management tools: get_rate_limit_status, estimate_request_budget,
//   optimize_batch_plan, get_api_usage_stats, calculate_sync_schedule
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetRateLimitStatusSchema = z.object({
  base_id: z.string().optional().describe("Optional base ID to get per-base rate limit status (starts with 'app')"),
});

const EstimateRequestBudgetSchema = z.object({
  operations: z.array(z.object({
    type: z.enum(["list_records", "get_record", "create_records", "update_records", "delete_records", "schema_read", "webhook", "other"]).describe("Operation type"),
    count: z.number().min(1).describe("Number of this operation"),
    records_per_call: z.number().optional().describe("Records per API call (for batch operations)"),
  })).min(1).describe("Operations to estimate"),
  time_window_seconds: z.number().min(1).optional().default(60).describe("Time window in seconds to complete all operations"),
});

const OptimizeBatchPlanSchema = z.object({
  total_records: z.number().min(1).describe("Total number of records to process"),
  operation: z.enum(["create", "update", "delete", "read"]).describe("Operation type"),
  target_completion_minutes: z.number().min(1).optional().default(5).describe("Target time to complete in minutes"),
  records_per_batch: z.number().min(1).max(10).optional().default(10).describe("Records per API batch (1-10 for write ops, up to 100 for read)"),
});

const GetApiUsageStatsSchema = z.object({
  include_health_check: z.boolean().optional().default(true).describe("Include a live API health check in results"),
});

const CalculateSyncScheduleSchema = z.object({
  tables: z.array(z.object({
    name: z.string(),
    estimated_records: z.number().min(1),
    operation: z.enum(["read", "write", "upsert"]),
    priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  })).min(1).describe("Tables to sync with their estimated record counts and operations"),
  available_requests_per_second: z.number().min(0.1).max(5).optional().default(5).describe("Available API requests per second (Airtable limit: 5/sec per base)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_rate_limit_status",
      title: "Get Rate Limit Status",
      description:
        "Get the current rate limit status and API health. Airtable allows 5 requests/second per base. Returns current limit, recommended batch sizes, backoff strategies, and a live health check. Use before large operations to ensure you won't be throttled.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Optional base ID for per-base status" },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          requestsPerSecond: { type: "number" },
          recommendedDelayMs: { type: "number" },
          maxBatchSize: { type: "number" },
          apiHealthy: { type: "boolean" },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["requestsPerSecond", "apiHealthy"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "estimate_request_budget",
      title: "Estimate Request Budget",
      description:
        "Estimate the number of API requests required for a set of operations and whether they fit within Airtable's rate limits. Returns total request count, estimated duration, rate limit compliance, and suggestions for staying within limits. Plan large operations before executing.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            items: { type: "object" },
            description: "Operations: [{type:'create_records',count:500,records_per_call:10},{type:'list_records',count:1}]",
          },
          time_window_seconds: { type: "number", description: "Time window to complete all operations (default: 60 seconds)" },
        },
        required: ["operations"],
      },
      outputSchema: {
        type: "object",
        properties: {
          totalRequests: { type: "number" },
          estimatedSeconds: { type: "number" },
          withinRateLimit: { type: "boolean" },
          requestsPerSecond: { type: "number" },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["totalRequests", "withinRateLimit"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "optimize_batch_plan",
      title: "Optimize Batch Plan",
      description:
        "Generate an optimized batching strategy for processing a large number of records. Given total record count, operation type, and target completion time, returns the ideal batch size, number of batches, delay between batches, and a step-by-step execution plan that stays within Airtable's 5 req/sec limit.",
      inputSchema: {
        type: "object",
        properties: {
          total_records: { type: "number", description: "Total records to process" },
          operation: { type: "string", description: "Operation: create, update, delete, read" },
          target_completion_minutes: { type: "number", description: "Target completion time in minutes (default: 5)" },
          records_per_batch: { type: "number", description: "Records per API batch (1-10 for writes, up to 100 for reads)" },
        },
        required: ["total_records", "operation"],
      },
      outputSchema: {
        type: "object",
        properties: {
          totalBatches: { type: "number" },
          recordsPerBatch: { type: "number" },
          delayBetweenBatchesMs: { type: "number" },
          estimatedDurationSeconds: { type: "number" },
          willMeetTarget: { type: "boolean" },
          executionPlan: { type: "object" },
        },
        required: ["totalBatches", "estimatedDurationSeconds"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_api_usage_stats",
      title: "Get API Usage Stats",
      description:
        "Get Airtable API configuration, limits, and live health information. Returns the current rate limit rules, batch size limits, timeout settings, and a live health check. Use to understand API constraints before building integrations.",
      inputSchema: {
        type: "object",
        properties: {
          include_health_check: { type: "boolean", description: "Include a live API health check (default: true)" },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          limits: { type: "object" },
          healthCheck: { type: "object" },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["limits"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "calculate_sync_schedule",
      title: "Calculate Sync Schedule",
      description:
        "Given a list of tables to sync with estimated record counts and operations, calculate the optimal sync schedule. Returns time estimates per table, total sync duration, recommended execution order (priority-first), and whether all syncs can complete within rate limits.",
      inputSchema: {
        type: "object",
        properties: {
          tables: {
            type: "array",
            items: { type: "object" },
            description: "Tables: [{name:'Users',estimated_records:500,operation:'read',priority:'high'}]",
          },
          available_requests_per_second: { type: "number", description: "Available API req/sec (max 5, Airtable limit). Default: 5" },
        },
        required: ["tables"],
      },
      outputSchema: {
        type: "object",
        properties: {
          schedule: { type: "array", items: { type: "object" } },
          totalDurationSeconds: { type: "number" },
          totalRequests: { type: "number" },
          feasible: { type: "boolean" },
        },
        required: ["schedule", "totalDurationSeconds"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_rate_limit_status: async (args) => {
      const params = GetRateLimitStatusSchema.parse(args);

      // Check API health with a lightweight call
      let apiHealthy = false;
      let latencyMs = 0;
      const start = Date.now();

      try {
        await logger.time("tool.get_rate_limit_status.health", () =>
          client.get("/v0/meta/whoami")
        , { tool: "get_rate_limit_status" });
        apiHealthy = true;
        latencyMs = Date.now() - start;
      } catch {
        latencyMs = Date.now() - start;
      }

      const RATE_LIMIT = 5; // requests per second per base
      const MIN_DELAY_MS = Math.ceil(1000 / RATE_LIMIT); // 200ms

      const recommendations = [
        `Airtable allows ${RATE_LIMIT} requests/second per base`,
        `Minimum ${MIN_DELAY_MS}ms between requests to avoid throttling`,
        "Use batch operations (up to 10 records) to reduce API call count",
        "For read operations, use pageSize=100 to minimize pagination calls",
        "Cache schema reads — they rarely change and count against rate limit",
        "On 429 errors, wait for the Retry-After header value before retrying",
      ];

      if (latencyMs > 500) {
        recommendations.push(`High latency detected (${latencyMs}ms) — consider caching frequently accessed data`);
      }

      const response = {
        requestsPerSecond: RATE_LIMIT,
        recommendedDelayMs: MIN_DELAY_MS,
        maxBatchSize: {
          createRecords: 10,
          updateRecords: 10,
          deleteRecords: 10,
          readRecords: 100,
          upsertRecords: 10,
        },
        apiHealthy,
        latencyMs,
        recommendations,
        baseId: params.base_id ?? null,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    estimate_request_budget: async (args) => {
      const params = EstimateRequestBudgetSchema.parse(args);
      const RATE_LIMIT = 5;
      const timeWindow = params.time_window_seconds ?? 60;

      let totalRequests = 0;

      for (const op of params.operations) {
        const batchSize = op.records_per_call ?? (op.type === "list_records" ? 100 : 10);
        const callsNeeded = Math.ceil(op.count / batchSize);
        totalRequests += callsNeeded;
      }

      const estimatedSeconds = totalRequests / RATE_LIMIT;
      const withinRateLimit = estimatedSeconds <= timeWindow;
      const requestsPerSecond = totalRequests / timeWindow;

      const recommendations: string[] = [];
      if (!withinRateLimit) {
        const neededSeconds = Math.ceil(totalRequests / RATE_LIMIT);
        recommendations.push(`Operations will take ~${neededSeconds}s but window is ${timeWindow}s — increase time window or reduce operations`);
        recommendations.push("Consider batching write operations at 10 records/call to reduce API calls");
      } else {
        recommendations.push(`All operations fit within ${timeWindow}s at ${requestsPerSecond.toFixed(1)} req/sec`);
      }

      if (totalRequests > 100) {
        recommendations.push("For large imports, use bulk_create_records which auto-batches in groups of 10");
      }

      const response = {
        totalRequests,
        estimatedSeconds: Math.ceil(estimatedSeconds),
        withinRateLimit,
        timeWindowSeconds: timeWindow,
        requestsPerSecond: parseFloat(requestsPerSecond.toFixed(2)),
        recommendations,
        operationBreakdown: params.operations.map((op) => ({
          type: op.type,
          count: op.count,
          batchSize: op.records_per_call ?? (op.type === "list_records" ? 100 : 10),
          apiCalls: Math.ceil(op.count / (op.records_per_call ?? (op.type === "list_records" ? 100 : 10))),
        })),
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    optimize_batch_plan: async (args) => {
      const params = OptimizeBatchPlanSchema.parse(args);
      const RATE_LIMIT = 5;
      const targetSeconds = (params.target_completion_minutes ?? 5) * 60;

      const maxBatchSize = params.operation === "read" ? 100 : 10;
      const batchSize = Math.min(params.records_per_batch ?? 10, maxBatchSize);
      const totalBatches = Math.ceil(params.total_records / batchSize);
      const minDurationSeconds = totalBatches / RATE_LIMIT;

      // Calculate optimal delay between batches
      let delayMs = 200; // minimum 200ms
      if (minDurationSeconds < targetSeconds) {
        // We have slack time — can add delay to be safer
        delayMs = Math.max(200, Math.floor((targetSeconds * 1000) / totalBatches));
      }

      const estimatedDurationSeconds = (totalBatches * delayMs) / 1000;
      const willMeetTarget = estimatedDurationSeconds <= targetSeconds;

      const executionPlan = {
        phase1_description: `Process ${totalBatches} batches of ${batchSize} records each`,
        phase1_batches: totalBatches,
        phase1_delay_ms: delayMs,
        parallelism: "Sequential (Airtable enforces per-base rate limit)",
        recommendation: totalBatches > 50
          ? "Consider splitting across multiple time windows for very large operations"
          : "Safe to execute in one run",
      };

      const response = {
        totalBatches,
        recordsPerBatch: batchSize,
        totalRecords: params.total_records,
        operation: params.operation,
        delayBetweenBatchesMs: delayMs,
        estimatedDurationSeconds: Math.ceil(estimatedDurationSeconds),
        targetSeconds,
        willMeetTarget,
        executionPlan,
        codeExample: `// Example JavaScript
for (let i = 0; i < ${params.total_records}; i += ${batchSize}) {
  const batch = records.slice(i, i + ${batchSize});
  await airtable.${params.operation}(batch);
  if (i + ${batchSize} < ${params.total_records}) {
    await sleep(${delayMs}); // Rate limit protection
  }
}`,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_api_usage_stats: async (args) => {
      const params = GetApiUsageStatsSchema.parse(args);

      let healthCheck: Record<string, unknown> = { checked: false };
      if (params.include_health_check) {
        const start = Date.now();
        try {
          const result = await logger.time("tool.get_api_usage_stats.health", () =>
            client.get("/v0/meta/whoami")
          , { tool: "get_api_usage_stats" }) as Record<string, unknown>;
          healthCheck = {
            checked: true,
            healthy: true,
            latencyMs: Date.now() - start,
            userId: result.id,
            email: result.email,
          };
        } catch (error) {
          healthCheck = {
            checked: true,
            healthy: false,
            latencyMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const limits = {
        requestsPerSecondPerBase: 5,
        minDelayBetweenRequestsMs: 200,
        maxBatchSizeCreate: 10,
        maxBatchSizeUpdate: 10,
        maxBatchSizeDelete: 10,
        maxPageSizeRead: 100,
        maxBatchSizeUpsert: 10,
        maxRecordFields: 500,
        maxCellSize: "100KB",
        maxAttachmentSize: "1000MB",
        maxFormulaLength: "No documented limit",
        webhookRetention: "7 days",
        maxWebhooksPerBase: "No documented limit",
        apiVersion: "v0",
        baseUrl: "https://api.airtable.com",
      };

      const recommendations = [
        "Batch write operations at max 10 records/call",
        "Use pageSize=100 for read operations to minimize API calls",
        "Cache base schema reads — they count against rate limits",
        "Use webhooks for real-time updates instead of polling",
        "Use filterByFormula to reduce data transfer on large tables",
        "Use fields[] parameter to fetch only needed fields",
      ];

      const response = { limits, healthCheck, recommendations };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    calculate_sync_schedule: async (args) => {
      const params = CalculateSyncScheduleSchema.parse(args);
      const rps = params.available_requests_per_second ?? 5;

      // Priority order
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const sorted = [...params.tables].sort(
        (a, b) => (priorityOrder[a.priority ?? "medium"] ?? 1) - (priorityOrder[b.priority ?? "medium"] ?? 1)
      );

      let totalRequests = 0;
      const schedule = sorted.map((table, idx) => {
        const batchSize = table.operation === "read" ? 100 : 10;
        const calls = Math.ceil(table.estimated_records / batchSize);
        const durationSeconds = calls / rps;
        totalRequests += calls;

        return {
          order: idx + 1,
          table: table.name,
          operation: table.operation,
          estimatedRecords: table.estimated_records,
          apiCalls: calls,
          estimatedSeconds: Math.ceil(durationSeconds),
          priority: table.priority ?? "medium",
        };
      });

      const totalDurationSeconds = Math.ceil(totalRequests / rps);
      const feasible = totalDurationSeconds < 3600; // under 1 hour

      const response = {
        schedule,
        totalDurationSeconds,
        totalRequests,
        feasible,
        estimatedMinutes: Math.ceil(totalDurationSeconds / 60),
        note: !feasible ? "Sync will take >1 hour. Consider splitting into multiple runs." : undefined,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
