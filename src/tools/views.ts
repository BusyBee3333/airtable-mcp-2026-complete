// Airtable View tools: list_views, get_view, create_view, delete_view
// Views are part of table schema in Airtable Metadata API
// POST/DELETE views: https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/views
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListViewsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
});

const GetViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw')"),
});

const CreateViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("View name"),
  type: z.enum(["grid", "form", "calendar", "gallery", "kanban", "timeline", "gantt"]).describe("View type: grid, form, calendar, gallery, kanban, timeline, or gantt"),
});

const DeleteViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw') to delete"),
});

// ============ New Schemas (round 2) ============

const GetViewRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("View ID (starts with 'viw') or view name"),
  fields: z.array(z.string()).optional().describe("Field names to return (default: all fields visible in the view)"),
  max_records: z.number().min(1).max(100000).optional().describe("Max records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100, default 100)"),
  offset: z.string().optional().describe("Pagination offset from previous response"),
});

const UpdateViewFilterSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw') to update. Note: Only personal views owned by the token's user can be updated via the API."),
  filter_by_formula: z.string().describe("New filter formula to apply to the view. Example: AND({Status}='Active',{Priority}='High')"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_views",
      title: "List Views",
      description:
        "List all views in an Airtable table. Returns view IDs, names, and types (grid, form, calendar, gallery, kanban, timeline, gantt). Use to discover available views before filtering records by view.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          views: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
              },
            },
          },
        },
        required: ["views"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_view",
      title: "Get View",
      description:
        "Get details about a specific view in an Airtable table. Returns the view's ID, name, type, and configuration. Use to inspect a view before using it for record filtering.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw')" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_view",
      title: "Create View",
      description:
        "Create a new view in an Airtable table. Supports grid, form, calendar, gallery, kanban, timeline, and gantt view types. Returns the created view with its ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "View name" },
          type: { type: "string", description: "View type: grid, form, calendar, gallery, kanban, timeline, or gantt" },
        },
        required: ["base_id", "table_id", "name", "type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["id", "name", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_view",
      title: "Delete View",
      description:
        "Permanently delete a view from an Airtable table. The primary/default grid view cannot be deleted. This action is irreversible. Use only when user explicitly requests deletion.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw') to delete" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "boolean" },
          id: { type: "string" },
        },
        required: ["deleted"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    // ── Round 2 additions ──
    {
      name: "get_view_records",
      title: "Get View Records",
      description:
        "Fetch records for a specific view with that view's filters, sort, and field visibility automatically applied by Airtable. Similar to list_records_by_view but from the views tool group. Returns records exactly as configured in the view. Use to replicate the data a user sees in a particular view. Supports pagination.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "View ID (starts with 'viw') or view name" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all visible in view)" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100, default 100)" },
          offset: { type: "string", description: "Pagination offset from previous response" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          view: { type: "string" },
          recordCount: { type: "number" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_view_filter",
      title: "Update View Filter",
      description:
        "Update the filter formula of a personal view in Airtable. Only personal views (owned by the API token's user) can be updated via the API — shared/collaborative views require the Airtable web app. Provide a new filterByFormula expression. Returns the updated view metadata. Note: View filter updates may have limited API support depending on your Airtable plan.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw') — must be a personal view owned by the token user" },
          filter_by_formula: { type: "string", description: "New filter formula. Example: AND({Status}='Active',{Priority}='High')" },
        },
        required: ["base_id", "table_id", "view_id", "filter_by_formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_views: async (args) => {
      const { base_id, table_id } = ListViewsSchema.parse(args);

      const result = await logger.time("tool.list_views", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_views", base_id, table_id });

      const raw = result as { tables?: Array<{ id: string; views?: unknown[] }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      const response = { views: table.views || [] };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_view: async (args) => {
      const { base_id, table_id, view_id } = GetViewSchema.parse(args);

      const result = await logger.time("tool.get_view", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_view", base_id, table_id, view_id });

      const raw = result as { tables?: Array<{ id: string; views?: Array<Record<string, unknown>> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      const view = (table.views || []).find((v) => v.id === view_id);
      if (!view) {
        throw new Error(`View '${view_id}' not found in table '${table_id}'`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(view, null, 2) }],
        structuredContent: view,
      };
    },

    create_view: async (args) => {
      const { base_id, table_id, name, type } = CreateViewSchema.parse(args);

      const body = { name, type };

      const result = await logger.time("tool.create_view", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/views`, body)
      , { tool: "create_view", base_id, table_id, name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_view: async (args) => {
      const { base_id, table_id, view_id } = DeleteViewSchema.parse(args);

      const result = await logger.time("tool.delete_view", () =>
        client.delete(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`)
      , { tool: "delete_view", base_id, table_id, view_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    // ── Round 2 handlers ──

    get_view_records: async (args) => {
      const { base_id, table_id_or_name, view_id_or_name, fields, max_records, page_size, offset } =
        GetViewRecordsSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("view", view_id_or_name);
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (fields) fields.forEach((f) => queryParams.append("fields[]", f));

      const result = await logger.time("tool.get_view_records", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "get_view_records", base_id, view: view_id_or_name });

      const raw = result as { records?: unknown[]; offset?: string };
      const records = raw.records ?? [];
      const response = {
        records,
        offset: raw.offset,
        view: view_id_or_name,
        recordCount: records.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    update_view_filter: async (args) => {
      const { base_id, table_id, view_id, filter_by_formula } = UpdateViewFilterSchema.parse(args);

      // Airtable Metadata API: PATCH /v0/meta/bases/{baseId}/tables/{tableId}/views/{viewId}
      // This is supported for personal views in the API
      const body = { filterByFormula: filter_by_formula };

      try {
        const result = await logger.time("tool.update_view_filter", () =>
          client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, body)
        , { tool: "update_view_filter", base_id, table_id, view_id });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const response = {
          error: errorMessage,
          view_id,
          attempted_formula: filter_by_formula,
          note: "View filter updates via API require a personal view owned by the token user. Collaborative views must be updated in the Airtable web app.",
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
          isError: true,
        };
      }
    },
  };

  return { tools, handlers };
}
