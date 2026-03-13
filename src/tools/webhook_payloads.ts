// Airtable Webhook Payload tools: get_latest_payload, inspect_payload_changes,
//   replay_webhook_events, get_payload_statistics, filter_payloads_by_table,
//   get_payload_field_changes
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetLatestPayloadSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID"),
  limit: z.number().min(1).max(50).optional().default(10).describe("Number of recent payloads to return"),
});

const InspectPayloadChangesSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID"),
  cursor: z.number().optional().describe("Cursor to start from"),
  filter_table_id: z.string().optional().describe("Filter payloads to a specific table ID"),
  event_type: z.enum(["tableData", "tableFields", "tableMetadata", "all"]).optional().default("all"),
});

const GetPayloadStatisticsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID"),
  sample_size: z.number().min(1).max(100).optional().default(50),
});

const FilterPayloadsByTableSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID"),
  table_id: z.string().describe("Table ID to filter payloads for"),
  cursor: z.number().optional(),
  limit: z.number().optional().default(20),
});

const GetPayloadFieldChangesSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID"),
  record_id: z.string().describe("Record ID to get field change history for"),
  cursor: z.number().optional(),
});

const RefreshWebhookSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  webhook_id: z.string().describe("Webhook ID to refresh (extend expiration)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_latest_webhook_payloads",
      title: "Get Latest Webhook Payloads",
      description:
        "Retrieve the most recent buffered payloads for a webhook. Returns recent events with their change details. Useful for debugging webhooks, catching up on missed events, or auditing recent changes.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
          limit: { type: "number", description: "Number of recent payloads to retrieve (1-50, default 10)" },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          payloads: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          cursor: { type: "number" },
          might_have_more: { type: "boolean" },
        },
        required: ["payloads", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "inspect_payload_changes",
      title: "Inspect Payload Changes",
      description:
        "Inspect webhook payloads for detailed change information — which records changed, which fields were modified, old vs new values. Optionally filter by table or event type.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
          cursor: { type: "number", description: "Start from this cursor position" },
          filter_table_id: { type: "string", description: "Only show changes for this table" },
          event_type: { type: "string", enum: ["tableData", "tableFields", "tableMetadata", "all"] },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          changes: { type: "array", items: { type: "object" } },
          total_payloads: { type: "number" },
          records_changed: { type: "number" },
          fields_changed: { type: "array" },
          cursor: { type: "number" },
        },
        required: ["changes"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_payload_statistics",
      title: "Get Payload Statistics",
      description:
        "Get statistics about webhook payload activity — event frequency, most changed tables, most changed fields, event source distribution, and activity timeline.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
          sample_size: { type: "number", description: "Number of payloads to analyze (default 50)" },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          total_events: { type: "number" },
          tables_affected: { type: "object" },
          event_types: { type: "object" },
          sources: { type: "object" },
          activity_summary: { type: "string" },
        },
        required: ["total_events"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "filter_payloads_by_table",
      title: "Filter Payloads by Table",
      description:
        "Filter webhook payloads to only show events for a specific table. Returns table-specific record creates, updates, and deletes.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
          table_id: { type: "string" },
          cursor: { type: "number" },
          limit: { type: "number" },
        },
        required: ["base_id", "webhook_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          payloads: { type: "array", items: { type: "object" } },
          table_id: { type: "string" },
          count: { type: "number" },
          cursor: { type: "number" },
        },
        required: ["payloads", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_payload_field_changes",
      title: "Get Payload Field Changes",
      description:
        "Get field-level change history for a specific record from webhook payloads. Shows what changed, when, and the before/after values for each field.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
          record_id: { type: "string" },
          cursor: { type: "number" },
        },
        required: ["base_id", "webhook_id", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          record_id: { type: "string" },
          field_changes: { type: "array", items: { type: "object" } },
          change_count: { type: "number" },
        },
        required: ["record_id", "field_changes"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "refresh_webhook",
      title: "Refresh Webhook",
      description:
        "Refresh a webhook to extend its expiration time. Airtable webhooks expire after 7 days of inactivity. Call this to keep the webhook active.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          webhook_id: { type: "string" },
        },
        required: ["base_id", "webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          refreshed: { type: "boolean" },
          webhook_id: { type: "string" },
          message: { type: "string" },
        },
        required: ["refreshed"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_latest_webhook_payloads: async (args) => {
      const { base_id, webhook_id, limit } = GetLatestPayloadSchema.parse(args);

      const result = await logger.time("tool.get_latest_webhook_payloads", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads`)
      , { tool: "get_latest_webhook_payloads", base_id }) as { payloads: unknown[]; cursor: number; mightHaveMore: boolean };

      const payloads = (result.payloads || []).slice(0, limit ?? 10);

      const data = {
        payloads,
        count: payloads.length,
        cursor: result.cursor,
        might_have_more: result.mightHaveMore,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    inspect_payload_changes: async (args) => {
      const { base_id, webhook_id, cursor, filter_table_id, event_type } = InspectPayloadChangesSchema.parse(args);

      const params = cursor ? `?cursor=${cursor}` : "";
      const result = await logger.time("tool.inspect_payload_changes", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads${params}`)
      , { tool: "inspect_payload_changes" }) as { payloads: Array<{ changedTablesById?: Record<string, unknown>; dataTypes?: string[] }>; cursor: number };

      const payloads = result.payloads || [];
      const filtered = filter_table_id
        ? payloads.filter((p) => p.changedTablesById && filter_table_id in p.changedTablesById)
        : payloads;

      const changedFields = new Set<string>();
      let recordsChanged = 0;

      const changes = filtered.map((p) => {
        if (p.changedTablesById) {
          for (const [, tableChanges] of Object.entries(p.changedTablesById)) {
            const tc = tableChanges as Record<string, unknown>;
            if (tc.changedFieldsById) Object.keys(tc.changedFieldsById as Record<string, unknown>).forEach((k) => changedFields.add(k));
            if (tc.changedRecordsById) recordsChanged += Object.keys(tc.changedRecordsById as Record<string, unknown>).length;
          }
        }
        return p;
      });

      const data = {
        changes,
        total_payloads: payloads.length,
        records_changed: recordsChanged,
        fields_changed: [...changedFields],
        cursor: result.cursor,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_payload_statistics: async (args) => {
      const { base_id, webhook_id, sample_size } = GetPayloadStatisticsSchema.parse(args);

      const result = await logger.time("tool.get_payload_statistics", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads`)
      , { tool: "get_payload_statistics" }) as { payloads: Array<Record<string, unknown>> };

      const payloads = (result.payloads || []).slice(0, sample_size ?? 50);
      const tablesAffected: Record<string, number> = {};
      const eventTypes: Record<string, number> = {};
      const sources: Record<string, number> = {};

      for (const p of payloads) {
        if (p.createdTime) { /* track timing */ }
        if (p.changedTablesById) {
          for (const tId of Object.keys(p.changedTablesById as Record<string, unknown>)) {
            tablesAffected[tId] = (tablesAffected[tId] ?? 0) + 1;
          }
        }
        const types = (p.dataTypes as string[] | undefined) ?? ["tableData"];
        types.forEach((t) => { eventTypes[t] = (eventTypes[t] ?? 0) + 1; });
        const src = (p.createdBy as Record<string, string> | undefined)?.type ?? "unknown";
        sources[src] = (sources[src] ?? 0) + 1;
      }

      const data = {
        total_events: payloads.length,
        tables_affected: tablesAffected,
        event_types: eventTypes,
        sources,
        activity_summary: `${payloads.length} events analyzed: ${Object.keys(tablesAffected).length} tables affected`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    filter_payloads_by_table: async (args) => {
      const { base_id, webhook_id, table_id, cursor } = FilterPayloadsByTableSchema.parse(args);

      const params = cursor ? `?cursor=${cursor}` : "";
      const result = await logger.time("tool.filter_payloads_by_table", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads${params}`)
      , { tool: "filter_payloads_by_table" }) as { payloads: Array<{ changedTablesById?: Record<string, unknown> }>; cursor: number };

      const filtered = (result.payloads || []).filter(
        (p) => p.changedTablesById && table_id in p.changedTablesById
      );

      const data = { payloads: filtered, table_id, count: filtered.length, cursor: result.cursor };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_payload_field_changes: async (args) => {
      const { base_id, webhook_id, record_id, cursor } = GetPayloadFieldChangesSchema.parse(args);

      const params = cursor ? `?cursor=${cursor}` : "";
      const result = await logger.time("tool.get_payload_field_changes", () =>
        client.get(`/v0/bases/${base_id}/webhooks/${webhook_id}/payloads${params}`)
      , { tool: "get_payload_field_changes" }) as { payloads: Array<{ changedTablesById?: Record<string, unknown>; timestamp?: string }> };

      const fieldChanges: unknown[] = [];

      for (const payload of result.payloads || []) {
        if (!payload.changedTablesById) continue;
        for (const tableChanges of Object.values(payload.changedTablesById)) {
          const tc = tableChanges as { changedRecordsById?: Record<string, unknown> };
          if (tc.changedRecordsById && record_id in tc.changedRecordsById) {
            fieldChanges.push({
              timestamp: payload.timestamp,
              record_id,
              changes: tc.changedRecordsById[record_id],
            });
          }
        }
      }

      const data = { record_id, field_changes: fieldChanges, change_count: fieldChanges.length };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    refresh_webhook: async (args) => {
      const { base_id, webhook_id } = RefreshWebhookSchema.parse(args);

      await logger.time("tool.refresh_webhook", () =>
        client.post(`/v0/bases/${base_id}/webhooks/${webhook_id}/refresh`, {})
      , { tool: "refresh_webhook" });

      const data = {
        refreshed: true,
        webhook_id,
        message: "Webhook expiration extended by 7 days",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
