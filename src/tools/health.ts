// Health check tool — validates env vars, API connectivity, and auth
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "health_check",
      title: "Health Check",
      description:
        "Validate server health: checks AIRTABLE_ACCESS_TOKEN is set, Airtable API is reachable, and token is valid. Returns connectivity status and latency. Use when diagnosing connection issues or verifying setup.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
          checks: {
            type: "object",
            properties: {
              envVars: { type: "object" },
              apiReachable: { type: "boolean" },
              authValid: { type: "boolean" },
              latencyMs: { type: "number" },
            },
          },
          error: { type: "string" },
        },
        required: ["status", "checks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    health_check: async () => {
      const checks: Record<string, unknown> = {};

      const requiredEnvVars = ["AIRTABLE_ACCESS_TOKEN"];
      const missing = requiredEnvVars.filter((v) => !process.env[v]);
      checks.envVars = { ok: missing.length === 0, missing };

      const healthResult = await client.healthCheck();
      checks.apiReachable = healthResult.reachable;
      checks.authValid = healthResult.authenticated;
      checks.latencyMs = healthResult.latencyMs;

      let status: "healthy" | "degraded" | "unhealthy";
      if (missing.length > 0 || !healthResult.reachable) {
        status = "unhealthy";
      } else if (!healthResult.authenticated) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      const result = {
        status,
        checks,
        ...(healthResult.error ? { error: healthResult.error } : {}),
      };

      logger.info("health_check", { status });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
