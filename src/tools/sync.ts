// Airtable Sync tools: list_sync_sources, get_sync_source_schema
// Airtable Sync lets you pull data from external sources (Google Sheets, Salesforce, etc.)
// Synced tables surface in the Metadata API with a `sourceInfo` property.
// Note: The Airtable public API does not expose a dedicated /sync endpoint;
//   we surface sync metadata from the table schema (sourceInfo, syncState, etc.)
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListSyncSourcesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
});

const GetSyncSourceSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') of the synced table"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_sync_sources",
      title: "List Sync Sources",
      description:
        "List all synced tables in an Airtable base, including their sync source information. Airtable Sync allows tables to pull data from external sources (Google Sheets, CSV, Salesforce, Jira, GitHub, etc.). Returns only tables that have a sync source configured, with their source type, sync status, and last sync time if available. Useful for auditing external data integrations.",
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
          syncedTables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                primaryFieldId: { type: "string" },
                sourceInfo: { type: "object" },
                syncState: { type: "object" },
                fieldCount: { type: "number" },
              },
            },
          },
          totalSyncedTables: { type: "number" },
          totalTables: { type: "number" },
        },
        required: ["syncedTables", "totalSyncedTables", "totalTables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_sync_source_schema",
      title: "Get Sync Source Schema",
      description:
        "Get the full schema of a synced table including all fields sourced from an external system. Returns field types, IDs, names, and source-specific metadata. Also returns sourceInfo (the external source details) and syncState (last sync time, sync status). Use to understand the structure of externally synced data before querying records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') of the synced table" },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          primaryFieldId: { type: "string" },
          sourceInfo: { type: "object" },
          syncState: { type: "object" },
          fields: { type: "array" },
          views: { type: "array" },
          isSynced: { type: "boolean" },
        },
        required: ["id", "name", "isSynced"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_sync_sources: async (args) => {
      const { base_id } = ListSyncSourcesSchema.parse(args);

      const result = await logger.time("tool.list_sync_sources", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_sync_sources", base_id });

      const raw = result as {
        tables?: Array<{
          id: string;
          name: string;
          primaryFieldId?: string;
          fields?: unknown[];
          views?: unknown[];
          sourceInfo?: unknown;
          syncState?: unknown;
          [key: string]: unknown;
        }>;
      };

      const allTables = raw.tables ?? [];

      // A synced table has a sourceInfo property from the Airtable Metadata API
      const syncedTables = allTables
        .filter((t) => t.sourceInfo !== undefined && t.sourceInfo !== null)
        .map((t) => ({
          id: t.id,
          name: t.name,
          primaryFieldId: t.primaryFieldId,
          sourceInfo: t.sourceInfo,
          syncState: t.syncState,
          fieldCount: Array.isArray(t.fields) ? t.fields.length : 0,
        }));

      const response = {
        syncedTables,
        totalSyncedTables: syncedTables.length,
        totalTables: allTables.length,
        note:
          syncedTables.length === 0
            ? "No synced tables found. Synced tables appear when a table uses Airtable Sync to import from an external source."
            : undefined,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_sync_source_schema: async (args) => {
      const { base_id, table_id } = GetSyncSourceSchemaSchema.parse(args);

      const result = await logger.time("tool.get_sync_source_schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_sync_source_schema", base_id, table_id });

      const raw = result as {
        tables?: Array<{
          id: string;
          name: string;
          primaryFieldId?: string;
          fields?: unknown[];
          views?: unknown[];
          sourceInfo?: unknown;
          syncState?: unknown;
          [key: string]: unknown;
        }>;
      };

      const table = (raw.tables ?? []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      const isSynced = table.sourceInfo !== undefined && table.sourceInfo !== null;

      const response = {
        id: table.id,
        name: table.name,
        primaryFieldId: table.primaryFieldId,
        isSynced,
        sourceInfo: table.sourceInfo ?? null,
        syncState: table.syncState ?? null,
        fields: table.fields ?? [],
        views: table.views ?? [],
        fieldCount: Array.isArray(table.fields) ? table.fields.length : 0,
        note: isSynced
          ? undefined
          : "This table does not appear to have a sync source configured. Use list_sync_sources to find synced tables.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
