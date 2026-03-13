// Airtable Webhook tools: list_webhooks, create_webhook, delete_webhook, list_webhook_payloads
// Uses Airtable Webhooks API: https://api.airtable.com/v0/bases/{baseId}/webhooks
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListWebhooksSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
});

const CreateWebhookSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  notification_url: z.string().url().optional().describe("HTTPS URL to receive webhook POST notifications. Omit to create a polling-only webhook."),
  specification: z.object({
    options: z.object({
      filters: z.object({
        from_sources: z.array(z.enum(["client", "publicApi", "automation", "system"])).optional()
          .describe("Event sources to filter: client, publicApi, automation, system"),
        data_types: z.array(z.enum(["tableData", "tableFields", "tableMetadata"])).optional()
          .describe("Data types: tableData, tableFields, tableMetadata"),
        record_change_scope: z.string().optional()
          .describe("Restrict to a specific table ID (starts with 'tbl')"),
      }).optional(),
    }),
  }).optional().describe("Webhook specification with filters. Omit for all events."),
  cursor_for_next_payload: z.number().optional().describe("Starting cursor position for payload retrieval"),
});

const DeleteWebhookSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  webhook_id: z.string().describe("Webhook ID (starts with 'ach') to delete"),
});

const ListWebhookPayloadsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  webhook_id: z.string().describe("Webhook ID (starts with 'ach')"),
  cursor: z.number().optional().describe("Pagination cursor (starts at 1). Use the cursor from previous response to get next page."),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_webhooks",
      title: "List Webhooks",
      description:
        "List all webhooks registered for an Airtable base. Returns webhook IDs, notification URLs, specifications, and cursor positions. Use to audit or manage existing webhooks on a base.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          webhooks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                notificationUrl: { type: "string" },
                specification: { type: "object" },
                cursorForNextPayload: { type: "number" },
                isHookEnabled: { type: "boolean" },
                expirationTime: { type: "string" },
              },
            },
          },
        },
        required: ["webhooks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_webhook",
      title: "Create Webhook",
      description:
        "Create a webhook for an Airtable base to receive real-time notifications of data changes. You can filter by source (client, publicApi, automation, system), data type (tableData, tableFields, tableMetadata), or specific table. Returns the webhook ID and expiration time. Webhooks expire after 7 days unless refreshed.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          notification_url: { type: "string", description: "HTTPS URL to POST events to. Omit for polling-only." },
          specification: {
            type: "object",
            description: "Optional filters. Example: {options:{filters:{data_types:['tableData'],record_change_scope:'tblXXX'}}}",
          },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          expirationTime: { type: "string" },
          cursorForNextPayload: { type: "number" },
          areNotificationsEnabled: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_webhook",
      title: "Delete Webhook",
      description:
        "Delete a webhook from an Airtable base. Stops all future notifications for this webhook. This action is irreversible.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          webhook_id: { type: "string", description: "Webhook ID (starts with 'ach') to delete" },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
        required: ["success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_webhook_payloads",
      title: "List Webhook Payloads",
      description:
        "Retrieve buffered payload events for a webhook. Each payload contains change details about records, fields, or tables. Use a cursor to paginate through events. The cursor advances with each request — store it to receive only new events on subsequent calls.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          webhook_id: { type: "string", description: "Webhook ID (starts with 'ach')" },
          cursor: { type: "number", description: "Cursor for pagination. Use cursor from previous response for new events." },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          payloads: { type: "array", items: { type: "object" } },
          cursor: { type: "number" },
          mightHaveMore: { type: "boolean" },
        },
        required: ["payloads"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_webhooks: async (args) => {
      const { base_id } = ListWebhooksSchema.parse(args);

      const result = await logger.time("tool.list_webhooks", () =>
        client.get(`/v0/bases/${base_id}/webhooks`)
      , { tool: "list_webhooks", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_webhook: async (args) => {
      const { base_id, notification_url, specification, cursor_for_next_payload } = CreateWebhookSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (notification_url) body.notificationUrl = notification_url;
      if (specification) {
        // Map snake_case filter keys to camelCase for Airtable API
        const spec = specification as {
          options?: {
            filters?: {
              from_sources?: string[];
              data_types?: string[];
              record_change_scope?: string;
            };
          };
        };
        const filters: Record<string, unknown> = {};
        if (spec.options?.filters?.from_sources) filters.fromSources = spec.options.filters.from_sources;
        if (spec.options?.filters?.data_types) filters.dataTypes = spec.options.filters.data_types;
        if (spec.options?.filters?.record_change_scope) filters.recordChangeScope = spec.options.filters.record_change_scope;
        body.specification = { options: { filters } };
      }
      if (cursor_for_next_payload !== undefined) body.cursorForNextPayload = cursor_for_next_payload;

      const result = await logger.time("tool.create_webhook", () =>
        client.post(`/v0/bases/${base_id}/webhooks`, body)
      , { tool: "create_webhook", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_webhook: async (args) => {
      const { base_id, webhook_id } = DeleteWebhookSchema.parse(args);

      const result = await logger.time("tool.delete_webhook", () =>
        client.delete(`/v0/bases/${base_id}/webhooks/${webhook_id}`)
      , { tool: "delete_webhook", base_id, webhook_id });

      const response = { success: true, ...(result as Record<string, unknown>) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_webhook_payloads: async (args) => {
      const { base_id, webhook_id, cursor } = ListWebhookPayloadsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (cursor !== undefined) queryParams.set("cursor", String(cursor));

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_webhook_payloads", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads${qs ? `?${qs}` : ""}`)
      , { tool: "list_webhook_payloads", base_id, webhook_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
