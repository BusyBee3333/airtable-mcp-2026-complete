// Airtable Automation tools: list_automations, get_automation, run_automation
// Uses Airtable Automations API: https://api.airtable.com/v0/bases/{baseId}/automations
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListAutomationsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  offset: z.string().optional().describe("Pagination offset token from previous response"),
  page_size: z.number().min(1).max(100).optional().describe("Number of automations per page (default: 100)"),
});

const GetAutomationSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().describe("Automation ID (starts with 'aut')"),
});

const RunAutomationSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  automation_id: z.string().describe("Automation ID (starts with 'aut'). Must have a 'Run a script' or manual trigger."),
  payload: z.record(z.unknown()).optional().describe("Optional payload data to pass to the automation trigger"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_automations",
      title: "List Automations",
      description:
        "List all automations in an Airtable base. Returns automation IDs, names, enabled/disabled status, and trigger types. Supports pagination via offset. Use to discover available automations before running them.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          offset: { type: "string", description: "Pagination offset token" },
          page_size: { type: "number", description: "Results per page (1-100)" },
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
              },
            },
          },
          offset: { type: "string" },
        },
        required: ["automations"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_automation",
      title: "Get Automation",
      description:
        "Get details about a specific Airtable automation including its trigger configuration, action steps, and enabled status. Use to inspect an automation before running it or debugging issues.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Automation ID (starts with 'aut')" },
        },
        required: ["base_id", "automation_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          isEnabled: { type: "boolean" },
          trigger: { type: "object" },
          actions: { type: "array" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "run_automation",
      title: "Run Automation",
      description:
        "Trigger an Airtable automation to run immediately. Only works on automations with a compatible trigger (e.g., 'When webhook received' or manual trigger). Returns the run ID and status. Use to programmatically execute workflows.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          automation_id: { type: "string", description: "Automation ID (starts with 'aut')" },
          payload: { type: "object", description: "Optional data to pass to the automation trigger" },
        },
        required: ["base_id", "automation_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          runId: { type: "string" },
          status: { type: "string" },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_automations: async (args) => {
      const { base_id, offset, page_size } = ListAutomationsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_automations", () =>
        client.get(`/v0/bases/${base_id}/automations${qs ? `?${qs}` : ""}`)
      , { tool: "list_automations", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_automation: async (args) => {
      const { base_id, automation_id } = GetAutomationSchema.parse(args);

      const result = await logger.time("tool.get_automation", () =>
        client.get(`/v0/bases/${base_id}/automations/${automation_id}`)
      , { tool: "get_automation", base_id, automation_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    run_automation: async (args) => {
      const { base_id, automation_id, payload } = RunAutomationSchema.parse(args);

      const body: Record<string, unknown> = payload ? { ...payload } : {};

      const result = await logger.time("tool.run_automation", () =>
        client.post(`/v0/bases/${base_id}/automations/${automation_id}/runAction`, body)
      , { tool: "run_automation", base_id, automation_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
