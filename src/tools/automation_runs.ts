// Airtable Automation Runs tools: list_automation_runs, get_automation_run,
//   list_automations_with_runs, get_automation_run_stats, toggle_automation
// Uses Airtable Automations API: https://api.airtable.com/v0/bases/{baseId}/automations
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListAutomationRunsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().optional().describe("Filter runs by a specific automation ID (starts with 'auto'). Omit to list runs for all automations in the base."),
  cursor: z.string().optional().describe("Pagination cursor from previous response"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Runs per page (1-100, default 25)"),
  status_filter: z.enum(["all", "success", "error", "running"]).optional().default("all")
    .describe("Filter by run status: all, success, error, or running (default: all)"),
  start_time: z.string().optional().describe("ISO 8601 start time filter (e.g., '2024-01-01T00:00:00.000Z')"),
  end_time: z.string().optional().describe("ISO 8601 end time filter (e.g., '2024-12-31T23:59:59.999Z')"),
});

const GetAutomationRunSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().describe("Automation ID (starts with 'auto')"),
  run_id: z.string().describe("Run ID to fetch full details for"),
});

const GetAutomationRunStatsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().describe("Automation ID (starts with 'auto')"),
  time_range_days: z.number().min(1).max(90).optional().default(7)
    .describe("Number of days to look back for statistics (1-90, default 7)"),
});

const ToggleAutomationSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().describe("Automation ID (starts with 'auto') to enable or disable"),
  enabled: z.boolean().describe("true to enable the automation, false to disable it"),
});

const ListAutomationsWithRunCountSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_disabled: z.boolean().optional().default(true)
    .describe("Include disabled automations in results (default: true)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_automation_runs",
      title: "List Automation Runs",
      description:
        "List execution run history for automations in a base. Filter by automation ID, status (success/error/running), or time range. Returns run IDs, timestamps, trigger details, action results, and error messages. Use for debugging or monitoring automation health.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Filter to a specific automation ID (starts with 'auto'). Omit for all automations." },
          cursor: { type: "string", description: "Pagination cursor from previous response" },
          page_size: { type: "number", description: "Runs per page (1-100, default 25)" },
          status_filter: { type: "string", description: "Filter by status: all, success, error, or running (default: all)" },
          start_time: { type: "string", description: "ISO 8601 start time filter" },
          end_time: { type: "string", description: "ISO 8601 end time filter" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          runs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                automationId: { type: "string" },
                startTime: { type: "string" },
                endTime: { type: "string" },
                status: { type: "string" },
                trigger: { type: "object" },
                actionResults: { type: "array" },
                errorDetails: { type: "string" },
              },
            },
          },
          cursor: { type: "string" },
        },
        required: ["runs"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_automation_run",
      title: "Get Automation Run Details",
      description:
        "Get detailed execution results for a specific automation run including trigger payload, each action's input/output/status, timing, and error messages. Use to debug why an automation failed or to audit what a run changed.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Automation ID (starts with 'auto')" },
          run_id: { type: "string", description: "Run ID to fetch full details for" },
        },
        required: ["base_id", "automation_id", "run_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          automationId: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          status: { type: "string" },
          trigger: { type: "object" },
          actionResults: { type: "array", items: { type: "object" } },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_automation_run_stats",
      title: "Get Automation Run Stats",
      description:
        "Get run statistics for an automation over a time period: total runs, success count, error count, success rate, average duration. Use for monitoring automation reliability and performance.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Automation ID (starts with 'auto')" },
          time_range_days: { type: "number", description: "Days to look back (1-90, default 7)" },
        },
        required: ["base_id", "automation_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          automationId: { type: "string" },
          timeRangeDays: { type: "number" },
          totalRuns: { type: "number" },
          successfulRuns: { type: "number" },
          errorRuns: { type: "number" },
          runningRuns: { type: "number" },
          successRate: { type: "number" },
          averageDurationMs: { type: "number" },
        },
        required: ["totalRuns", "successRate"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "toggle_automation",
      title: "Toggle Automation",
      description:
        "Enable or disable an Airtable automation. Disabled automations do not run their triggers. Use to pause an automation during maintenance or re-enable one that was turned off.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Automation ID (starts with 'auto')" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["base_id", "automation_id", "enabled"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          isEnabled: { type: "boolean" },
        },
        required: ["id", "isEnabled"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_automations_with_run_count",
      title: "List Automations with Run Count",
      description:
        "List all automations in a base along with their recent run count and last run status. Returns automation names, IDs, enabled/disabled state, and run statistics. Use for a comprehensive automation health dashboard.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_disabled: { type: "boolean", description: "Include disabled automations (default: true)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          automations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                isEnabled: { type: "boolean" },
                triggerType: { type: "string" },
                recentRunCount: { type: "number" },
                lastRunStatus: { type: "string" },
                lastRunTime: { type: "string" },
              },
            },
          },
          totalCount: { type: "number" },
          enabledCount: { type: "number" },
          disabledCount: { type: "number" },
        },
        required: ["automations"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_automation_runs: async (args) => {
      const { base_id, automation_id, cursor, page_size, status_filter, start_time, end_time } = ListAutomationRunsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (cursor) queryParams.set("cursor", cursor);
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (status_filter && status_filter !== "all") queryParams.set("status", status_filter);
      if (start_time) queryParams.set("startTime", start_time);
      if (end_time) queryParams.set("endTime", end_time);
      const qs = queryParams.toString();

      let endpoint: string;
      if (automation_id) {
        endpoint = `/v0/bases/${base_id}/automations/${automation_id}/runs${qs ? `?${qs}` : ""}`;
      } else {
        endpoint = `/v0/bases/${base_id}/automations/runs${qs ? `?${qs}` : ""}`;
      }

      const result = await logger.time("tool.list_automation_runs", () =>
        client.get(endpoint)
      , { tool: "list_automation_runs", base_id, automation_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_automation_run: async (args) => {
      const { base_id, automation_id, run_id } = GetAutomationRunSchema.parse(args);

      const result = await logger.time("tool.get_automation_run", () =>
        client.get(`/v0/bases/${base_id}/automations/${automation_id}/runs/${run_id}`)
      , { tool: "get_automation_run", base_id, automation_id, run_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_automation_run_stats: async (args) => {
      const { base_id, automation_id, time_range_days } = GetAutomationRunStatsSchema.parse(args);

      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - (time_range_days || 7) * 24 * 60 * 60 * 1000).toISOString();

      const queryParams = new URLSearchParams();
      queryParams.set("startTime", startTime);
      queryParams.set("endTime", endTime);
      queryParams.set("pageSize", "100");

      const result = await logger.time("tool.get_automation_run_stats", () =>
        client.get(`/v0/bases/${base_id}/automations/${automation_id}/runs?${queryParams}`)
      , { tool: "get_automation_run_stats", base_id, automation_id });

      const raw = result as { runs?: Array<{ status: string; startTime?: string; endTime?: string }> };
      const runs = raw.runs || [];

      let successfulRuns = 0;
      let errorRuns = 0;
      let runningRuns = 0;
      let totalDurationMs = 0;
      let countWithDuration = 0;

      for (const run of runs) {
        if (run.status === "success") successfulRuns++;
        else if (run.status === "error" || run.status === "failed") errorRuns++;
        else if (run.status === "running") runningRuns++;

        if (run.startTime && run.endTime) {
          const durationMs = new Date(run.endTime).getTime() - new Date(run.startTime).getTime();
          if (durationMs > 0) {
            totalDurationMs += durationMs;
            countWithDuration++;
          }
        }
      }

      const totalRuns = runs.length;
      const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 10000) / 100 : 0;
      const averageDurationMs = countWithDuration > 0 ? Math.round(totalDurationMs / countWithDuration) : 0;

      const response = {
        automationId: automation_id,
        timeRangeDays: time_range_days || 7,
        startTime,
        endTime,
        totalRuns,
        successfulRuns,
        errorRuns,
        runningRuns,
        successRate,
        averageDurationMs,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    toggle_automation: async (args) => {
      const { base_id, automation_id, enabled } = ToggleAutomationSchema.parse(args);

      const result = await logger.time("tool.toggle_automation", () =>
        client.patch(`/v0/bases/${base_id}/automations/${automation_id}`, { isEnabled: enabled })
      , { tool: "toggle_automation", base_id, automation_id });

      const response = {
        id: automation_id,
        isEnabled: enabled,
        ...((result as Record<string, unknown>) || {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_automations_with_run_count: async (args) => {
      const { base_id, include_disabled } = ListAutomationsWithRunCountSchema.parse(args);

      // Fetch automations list
      const automationsResult = await logger.time("tool.list_automations_with_run_count.list", () =>
        client.get(`/v0/bases/${base_id}/automations`)
      , { tool: "list_automations_with_run_count", base_id });

      const raw = automationsResult as { automations?: Array<{ id: string; name: string; isEnabled: boolean; triggerType?: string }> };
      let automations = raw.automations || [];

      if (!include_disabled) {
        automations = automations.filter((a) => a.isEnabled);
      }

      // For each automation, try to get recent run stats (last 7 days)
      const recentStartTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const enriched = await Promise.all(
        automations.map(async (a) => {
          try {
            const runsResult = await client.get<{ runs?: Array<{ status: string; startTime?: string }> }>(
              `/v0/bases/${base_id}/automations/${a.id}/runs?pageSize=10&startTime=${encodeURIComponent(recentStartTime)}`
            );
            const runs = runsResult.runs || [];
            const lastRun = runs[0];
            return {
              ...a,
              recentRunCount: runs.length,
              lastRunStatus: lastRun?.status || null,
              lastRunTime: lastRun?.startTime || null,
            };
          } catch {
            return {
              ...a,
              recentRunCount: 0,
              lastRunStatus: null,
              lastRunTime: null,
            };
          }
        })
      );

      const enabledCount = enriched.filter((a) => a.isEnabled).length;
      const disabledCount = enriched.filter((a) => !a.isEnabled).length;

      const response = {
        automations: enriched,
        totalCount: enriched.length,
        enabledCount,
        disabledCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
