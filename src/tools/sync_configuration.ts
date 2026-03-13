// Airtable Sync Configuration tools: list_sync_sources_detailed, get_sync_source_health,
//   get_sync_table_mapping, list_sync_enabled_tables, get_sync_status_summary,
//   check_sync_conflicts
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListSyncSourcesDetailedSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  include_schema: z.boolean().optional().default(false).describe("Include schema details for each sync source"),
});

const GetSyncSourceHealthSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  sync_source_id: z.string().describe("Sync source ID"),
});

const GetSyncStatusSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
});

const ListSyncEnabledTablesSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
});

const GetSyncTableMappingSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name to get sync mapping for"),
});

const CheckSyncConflictsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  local_fields: z.array(z.string()).describe("Local field names that might conflict with synced fields"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_sync_sources_detailed",
      title: "List Sync Sources (Detailed)",
      description:
        "List all external sync sources for an Airtable base with detailed information — source type, last sync time, sync frequency, status, and optionally the schema of synced fields.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          include_schema: { type: "boolean", description: "Include field schema for each source" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sync_sources: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          source_types: { type: "array", items: { type: "string" } },
        },
        required: ["sync_sources", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_sync_source_health",
      title: "Get Sync Source Health",
      description:
        "Get the health status of a specific sync source — whether it's active, when it last synced, if there are errors, and the next scheduled sync.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          sync_source_id: { type: "string" },
        },
        required: ["base_id", "sync_source_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sync_source_id: { type: "string" },
          status: { type: "string" },
          last_sync_time: { type: "string" },
          error_message: { type: "string" },
          is_healthy: { type: "boolean" },
        },
        required: ["is_healthy"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_sync_status_summary",
      title: "Get Sync Status Summary",
      description:
        "Get an overall sync health summary for a base — how many sync sources exist, which are healthy vs erroring, last sync times, and a traffic-light status indicator.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          total_sources: { type: "number" },
          healthy: { type: "number" },
          unhealthy: { type: "number" },
          overall_status: { type: "string" },
          sources_summary: { type: "array" },
        },
        required: ["total_sources", "overall_status"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_sync_enabled_tables",
      title: "List Sync-Enabled Tables",
      description:
        "List all tables in a base that have sync sources configured. Returns table names, IDs, and which fields come from sync vs are native.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sync_tables: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          total_tables: { type: "number" },
        },
        required: ["sync_tables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_sync_table_mapping",
      title: "Get Sync Table Mapping",
      description:
        "Get the field mapping for a synced table — which fields come from the external sync source and which are native Airtable fields. Helps understand what can be edited vs what is read-only from sync.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          table_name: { type: "string" },
          synced_fields: { type: "array" },
          native_fields: { type: "array" },
          sync_source_id: { type: "string" },
        },
        required: ["table_name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "check_sync_conflicts",
      title: "Check Sync Conflicts",
      description:
        "Check if local field names conflict with synced field names in a table. Returns a report of fields that overlap between local and synced configurations — potential data conflicts.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          local_fields: { type: "array", items: { type: "string" }, description: "Local field names to check" },
        },
        required: ["base_id", "table_id_or_name", "local_fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          conflicts: { type: "array", items: { type: "string" } },
          safe_fields: { type: "array", items: { type: "string" } },
          conflict_count: { type: "number" },
          has_conflicts: { type: "boolean" },
        },
        required: ["conflicts", "has_conflicts"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_sync_sources_detailed: async (args) => {
      const { base_id, include_schema } = ListSyncSourcesDetailedSchema.parse(args);

      const result = await logger.time("tool.list_sync_sources_detailed", () =>
        client.get(`/v0/meta/bases/${base_id}/sync/sourceSchema`)
      , { tool: "list_sync_sources_detailed", base_id }).catch(() => ({ syncSources: [] })) as { syncSources?: Array<Record<string, unknown>> };

      const sources = result.syncSources ?? [];
      const sourceTypes = [...new Set(sources.map((s) => String(s.type ?? "unknown")))];

      const data = {
        sync_sources: include_schema ? sources : sources.map((s) => ({ id: s.id, type: s.type, status: s.status })),
        count: sources.length,
        source_types: sourceTypes,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_sync_source_health: async (args) => {
      const { base_id, sync_source_id } = GetSyncSourceHealthSchema.parse(args);

      const result = await logger.time("tool.get_sync_source_health", () =>
        client.get(`/v0/meta/bases/${base_id}/sync/sourceSchema`)
      , { tool: "get_sync_source_health" }).catch(() => ({ syncSources: [] })) as { syncSources?: Array<{ id: string; status?: string; lastSyncTime?: string; errorMessage?: string }> };

      const source = (result.syncSources ?? []).find((s) => s.id === sync_source_id);

      const data = {
        sync_source_id,
        status: source?.status ?? "unknown",
        last_sync_time: source?.lastSyncTime ?? null,
        error_message: source?.errorMessage ?? null,
        is_healthy: source?.status === "active" || source?.status === "synced",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_sync_status_summary: async (args) => {
      const { base_id } = GetSyncStatusSummarySchema.parse(args);

      const result = await logger.time("tool.get_sync_status_summary", () =>
        client.get(`/v0/meta/bases/${base_id}/sync/sourceSchema`)
      , { tool: "get_sync_status_summary", base_id }).catch(() => ({ syncSources: [] })) as { syncSources?: Array<{ id: string; status?: string }> };

      const sources = result.syncSources ?? [];
      const healthy = sources.filter((s) => s.status === "active" || s.status === "synced").length;
      const unhealthy = sources.length - healthy;
      const overallStatus = sources.length === 0 ? "no_sync" : unhealthy === 0 ? "healthy" : unhealthy === sources.length ? "critical" : "degraded";

      const data = {
        total_sources: sources.length,
        healthy,
        unhealthy,
        overall_status: overallStatus,
        sources_summary: sources.map((s) => ({ id: s.id, status: s.status })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    list_sync_enabled_tables: async (args) => {
      const { base_id } = ListSyncEnabledTablesSchema.parse(args);

      const schema = await logger.time("tool.list_sync_enabled_tables", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_sync_enabled_tables", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ type: string }> }> };

      const syncTables = schema.tables
        .filter((t) => t.fields.some((f) => f.type === "externalSyncSource"))
        .map((t) => ({
          id: t.id,
          name: t.name,
          field_count: t.fields.length,
          sync_field_count: t.fields.filter((f) => f.type === "externalSyncSource").length,
        }));

      return {
        content: [{ type: "text", text: JSON.stringify({ sync_tables: syncTables, count: syncTables.length, total_tables: schema.tables.length }, null, 2) }],
        structuredContent: { sync_tables: syncTables, count: syncTables.length, total_tables: schema.tables.length },
      };
    },

    get_sync_table_mapping: async (args) => {
      const { base_id, table_id_or_name } = GetSyncTableMappingSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: unknown }> }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const syncField = table.fields.find((f) => f.type === "externalSyncSource");
      const syncedFields = table.fields.filter((f) => f.type === "externalSyncSource" || (f.options as Record<string, unknown> | undefined)?.isSynced);
      const nativeFields = table.fields.filter((f) => !syncedFields.find((sf) => sf.id === f.id));

      const data = {
        table_name: table.name,
        synced_fields: syncedFields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        native_fields: nativeFields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        sync_source_id: (syncField?.options as Record<string, unknown> | undefined)?.syncSourceId ?? null,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    check_sync_conflicts: async (args) => {
      const { base_id, table_id_or_name, local_fields } = CheckSyncConflictsSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ name: string; type: string }> }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const existingFieldNames = new Set(table.fields.map((f) => f.name.toLowerCase()));
      const conflicts = local_fields.filter((f) => existingFieldNames.has(f.toLowerCase()));
      const safe = local_fields.filter((f) => !existingFieldNames.has(f.toLowerCase()));

      const data = { conflicts, safe_fields: safe, conflict_count: conflicts.length, has_conflicts: conflicts.length > 0 };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
