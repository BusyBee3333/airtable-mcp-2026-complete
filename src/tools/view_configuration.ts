// Airtable View Configuration tools: update_view_metadata, get_view_field_config,
//   set_view_field_visibility, list_view_fields_ordered, set_view_filter,
//   set_view_sort, set_view_group_by, set_view_color_config,
//   list_view_records_with_metadata
// Uses Airtable Metadata API for schema and Records API for data
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const UpdateViewMetadataSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw')"),
  name: z.string().optional().describe("New view name"),
  description: z.string().optional().describe("New view description"),
});

const GetViewFieldConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw')"),
});

const ListViewFieldsOrderedSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw')"),
  include_hidden: z.boolean().optional().default(false)
    .describe("Include hidden fields in result (default: false — only visible fields)"),
});

const GetViewSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw')"),
});

const ListViewsForTableWithTypeSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_type: z.enum(["grid", "form", "calendar", "gallery", "kanban", "timeline", "gantt", "any"]).optional().default("any")
    .describe("Filter by view type (default: any returns all types)"),
});

const GetViewRecordsPageSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("View ID (starts with 'viw') or view name"),
  page: z.number().min(1).optional().default(1)
    .describe("Page number (starts at 1, default 1). Each page returns up to page_size records."),
  page_size: z.number().min(1).max(100).optional().default(25)
    .describe("Records per page (1-100, default 25)"),
  fields: z.array(z.string()).optional().describe("Specific fields to return (default: all visible in view)"),
});

const DuplicateViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw') to duplicate"),
  new_name: z.string().describe("Name for the duplicated view"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "update_view_metadata",
      title: "Update View Metadata",
      description:
        "Update a view's name or description. Returns the updated view object. Use to rename views or add documentation. Note: Only personal views can typically be updated via API.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw')" },
          name: { type: "string", description: "New view name" },
          description: { type: "string", description: "New view description" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_view_field_config",
      title: "Get View Field Configuration",
      description:
        "Get the field configuration for a specific view including visible field IDs, field ordering, column widths, and frozen columns. Returns the view's visibleFieldIds which determines which fields are shown and in what order.",
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
          viewId: { type: "string" },
          viewName: { type: "string" },
          visibleFieldIds: { type: "array", items: { type: "string" } },
          hiddenFieldIds: { type: "array", items: { type: "string" } },
          visibleFieldCount: { type: "number" },
          hiddenFieldCount: { type: "number" },
        },
        required: ["viewId"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_view_fields_ordered",
      title: "List View Fields In Order",
      description:
        "List all visible fields in a view in their display order. Returns field names, IDs, and types sorted by their position in the view. Optionally include hidden fields. Use to understand the exact column layout of a view.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw')" },
          include_hidden: { type: "boolean", description: "Include hidden fields (default: false)" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          viewId: { type: "string" },
          viewName: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                position: { type: "number" },
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                isVisible: { type: "boolean" },
              },
            },
          },
          visibleCount: { type: "number" },
          hiddenCount: { type: "number" },
        },
        required: ["fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_view_summary",
      title: "Get View Summary",
      description:
        "Get a comprehensive summary of a view: type, field count, visible/hidden breakdown, view filters (if any in name), and basic stats. Returns view metadata without fetching all records.",
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
          visibleFieldCount: { type: "number" },
          hiddenFieldCount: { type: "number" },
          totalFieldCount: { type: "number" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_views_by_type",
      title: "List Views by Type",
      description:
        "List views in a table filtered by view type. Returns only views matching the specified type (grid, form, calendar, gallery, kanban, timeline, gantt) or all views. More focused than list_views.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_type: {
            type: "string",
            description: "View type to filter: grid, form, calendar, gallery, kanban, timeline, gantt, or any (default: any)",
          },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          views: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          filterType: { type: "string" },
        },
        required: ["views", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_view_records_page",
      title: "Get View Records Page",
      description:
        "Get a specific page of records from a view with explicit page-number navigation (page 1, 2, 3...). Unlike list_records which uses cursor-based offsets, this tool allows direct page navigation. Each page returns page_size records (default 25). The view's filters, sorts, and hidden fields are applied automatically.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "View ID (starts with 'viw') or view name" },
          page: { type: "number", description: "Page number (1 = first page, default 1)" },
          page_size: { type: "number", description: "Records per page (1-100, default 25)" },
          fields: { type: "array", items: { type: "string" }, description: "Specific fields to return (default: all visible)" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          page: { type: "number" },
          pageSize: { type: "number" },
          hasNextPage: { type: "boolean" },
          nextOffset: { type: "string" },
          recordCount: { type: "number" },
        },
        required: ["records", "page"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "duplicate_view",
      title: "Duplicate View",
      description:
        "Create a copy of an existing view with a new name. The duplicate inherits the same type, filters, sorts, field visibility, and grouping as the original. Returns the new view's ID and name.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw') to duplicate" },
          new_name: { type: "string", description: "Name for the duplicated view" },
        },
        required: ["base_id", "table_id", "view_id", "new_name"],
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    update_view_metadata: async (args) => {
      const { base_id, table_id, view_id, name, description } = UpdateViewMetadataSchema.parse(args);

      if (!name && description === undefined) {
        throw new Error("update_view_metadata: provide at least name or description to update");
      }

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.update_view_metadata", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, body)
      , { tool: "update_view_metadata", base_id, view_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_view_field_config: async (args) => {
      const { base_id, table_id, view_id } = GetViewFieldConfigSchema.parse(args);

      // Get table schema with visibleFieldIds
      const result = await logger.time("tool.get_view_field_config", () =>
        client.get(`/v0/meta/bases/${base_id}/tables?include=visibleFieldIds`)
      , { tool: "get_view_field_config", base_id });

      const raw = result as { tables?: Array<{
        id: string;
        fields: Array<{ id: string; name: string; type: string }>;
        views?: Array<{ id: string; name: string; type: string; visibleFieldIds?: string[] }>;
      }> };

      const table = (raw.tables || []).find((t) => t.id === table_id);
      if (!table) throw new Error(`Table ${table_id} not found`);

      const view = (table.views || []).find((v) => v.id === view_id);
      if (!view) throw new Error(`View ${view_id} not found in table ${table_id}`);

      const allFieldIds = (table.fields || []).map((f) => f.id);
      const visibleFieldIds = view.visibleFieldIds || allFieldIds;
      const hiddenFieldIds = allFieldIds.filter((id) => !visibleFieldIds.includes(id));

      const response = {
        viewId: view.id,
        viewName: view.name,
        viewType: view.type,
        visibleFieldIds,
        hiddenFieldIds,
        visibleFieldCount: visibleFieldIds.length,
        hiddenFieldCount: hiddenFieldIds.length,
        totalFieldCount: allFieldIds.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_view_fields_ordered: async (args) => {
      const { base_id, table_id, view_id, include_hidden } = ListViewFieldsOrderedSchema.parse(args);

      const result = await logger.time("tool.list_view_fields_ordered", () =>
        client.get(`/v0/meta/bases/${base_id}/tables?include=visibleFieldIds`)
      , { tool: "list_view_fields_ordered", base_id });

      const raw = result as { tables?: Array<{
        id: string;
        fields: Array<{ id: string; name: string; type: string }>;
        views?: Array<{ id: string; name: string; type: string; visibleFieldIds?: string[] }>;
      }> };

      const table = (raw.tables || []).find((t) => t.id === table_id);
      if (!table) throw new Error(`Table ${table_id} not found`);

      const view = (table.views || []).find((v) => v.id === view_id);
      if (!view) throw new Error(`View ${view_id} not found`);

      const fieldMap = new Map((table.fields || []).map((f) => [f.id, f]));
      const allFieldIds = (table.fields || []).map((f) => f.id);
      const visibleFieldIds = view.visibleFieldIds || allFieldIds;
      const visibleSet = new Set(visibleFieldIds);

      const visibleFields = visibleFieldIds.map((id, idx) => {
        const f = fieldMap.get(id);
        return { position: idx + 1, id, name: f?.name || id, type: f?.type || "unknown", isVisible: true };
      });

      const hiddenFields = allFieldIds
        .filter((id) => !visibleSet.has(id))
        .map((id, idx) => {
          const f = fieldMap.get(id);
          return { position: visibleFields.length + idx + 1, id, name: f?.name || id, type: f?.type || "unknown", isVisible: false };
        });

      const fields = include_hidden ? [...visibleFields, ...hiddenFields] : visibleFields;

      const response = {
        viewId: view.id,
        viewName: view.name,
        fields,
        visibleCount: visibleFields.length,
        hiddenCount: hiddenFields.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_view_summary: async (args) => {
      const { base_id, table_id, view_id } = GetViewSummarySchema.parse(args);

      const result = await logger.time("tool.get_view_summary", () =>
        client.get(`/v0/meta/bases/${base_id}/tables?include=visibleFieldIds`)
      , { tool: "get_view_summary", base_id });

      const raw = result as { tables?: Array<{
        id: string;
        fields: Array<{ id: string }>;
        views?: Array<{ id: string; name: string; type: string; visibleFieldIds?: string[] }>;
      }> };

      const table = (raw.tables || []).find((t) => t.id === table_id);
      if (!table) throw new Error(`Table ${table_id} not found`);

      const view = (table.views || []).find((v) => v.id === view_id);
      if (!view) throw new Error(`View ${view_id} not found`);

      const totalFieldCount = (table.fields || []).length;
      const visibleFieldIds = view.visibleFieldIds || (table.fields || []).map((f) => f.id);
      const visibleFieldCount = visibleFieldIds.length;
      const hiddenFieldCount = totalFieldCount - visibleFieldCount;

      const response = {
        id: view.id,
        name: view.name,
        type: view.type,
        tableId: table_id,
        visibleFieldCount,
        hiddenFieldCount,
        totalFieldCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_views_by_type: async (args) => {
      const { base_id, table_id, view_type } = ListViewsForTableWithTypeSchema.parse(args);

      const result = await logger.time("tool.list_views_by_type", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_views_by_type", base_id });

      const raw = result as { tables?: Array<{ id: string; views?: Array<{ id: string; name: string; type: string }> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);
      if (!table) throw new Error(`Table ${table_id} not found`);

      let views = table.views || [];
      const filterType = view_type || "any";
      if (filterType !== "any") {
        views = views.filter((v) => v.type === filterType);
      }

      const response = { views, count: views.length, filterType };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_view_records_page: async (args) => {
      const { base_id, table_id_or_name, view_id_or_name, page, page_size, fields } = GetViewRecordsPageSchema.parse(args);

      const targetPage = page || 1;
      const ps = page_size || 25;

      // We need to paginate to reach the correct page
      // Each "page" conceptually is: skip (targetPage-1)*ps records, take ps records
      let offset: string | undefined;
      let currentPage = 1;

      while (currentPage < targetPage) {
        const q = new URLSearchParams();
        q.set("pageSize", String(ps));
        q.set("view", view_id_or_name);
        if (offset) q.set("offset", offset);

        const result = await client.get<{ records: unknown[]; offset?: string }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
        );

        if (!result.offset) {
          // Ran out of pages
          const response = {
            records: [],
            page: targetPage,
            pageSize: ps,
            hasNextPage: false,
            nextOffset: undefined,
            recordCount: 0,
            message: `Page ${targetPage} does not exist. Table has fewer than ${(targetPage - 1) * ps} records.`,
          };
          return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
        }

        offset = result.offset;
        currentPage++;
      }

      // Fetch the target page
      const q = new URLSearchParams();
      q.set("pageSize", String(ps));
      q.set("view", view_id_or_name);
      if (offset) q.set("offset", offset);
      if (fields) fields.forEach((f) => q.append("fields[]", f));

      const result = await logger.time("tool.get_view_records_page", () =>
        client.get<{ records: unknown[]; offset?: string }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
        )
      , { tool: "get_view_records_page", base_id, page: targetPage });

      const response = {
        records: result.records || [],
        page: targetPage,
        pageSize: ps,
        hasNextPage: !!result.offset,
        nextOffset: result.offset,
        recordCount: (result.records || []).length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    duplicate_view: async (args) => {
      const { base_id, table_id, view_id, new_name } = DuplicateViewSchema.parse(args);

      const result = await logger.time("tool.duplicate_view", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}/duplicate`, { name: new_name })
      , { tool: "duplicate_view", base_id, view_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
