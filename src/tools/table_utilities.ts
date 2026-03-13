// Airtable Table Utility tools: duplicate_table, get_table_by_name,
//   list_tables_summary, clear_table_records, rename_table, get_table_field_names
// Uses Airtable Metadata API and Records API
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetTableByNameSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_name: z.string().describe("Table name to find (case-insensitive search)"),
  exact_match: z.boolean().optional().default(false).describe("If true, require exact case-sensitive match; if false (default), case-insensitive substring match"),
});

const ListTablesSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_field_count: z.boolean().optional().default(true).describe("Include total field count per table (default: true)"),
  include_view_count: z.boolean().optional().default(true).describe("Include total view count per table (default: true)"),
  include_primary_field: z.boolean().optional().default(true).describe("Include primary field name (default: true)"),
  include_field_types: z.boolean().optional().default(false).describe("Include breakdown of field types per table (default: false)"),
});

const RenameTableSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') to rename"),
  new_name: z.string().describe("New table name"),
  new_description: z.string().optional().describe("Optional new table description"),
});

const GetTableFieldNamesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID (starts with 'tbl') or table name"),
  field_type_filter: z.array(z.string()).optional()
    .describe("Only return fields of these types (e.g., ['singleLineText', 'number', 'email'])"),
  include_ids: z.boolean().optional().default(false).describe("Include field IDs alongside names (default: false)"),
  include_descriptions: z.boolean().optional().default(false).describe("Include field descriptions (default: false)"),
  include_options: z.boolean().optional().default(false).describe("Include field options/config (default: false)"),
});

const ClearTableRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter which records to delete. If omitted, ALL records are deleted."),
  confirm_delete_all: z.boolean().describe("Set to true to confirm you want to delete records. Required for safety."),
  max_records: z.number().min(1).optional().describe("Limit the maximum number of records to delete (optional safety limit)"),
});

const GetTablePrimaryFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
});

const ListTableViewsExtendedSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_type_filter: z.array(z.enum(["grid", "form", "calendar", "gallery", "kanban", "timeline", "gantt"])).optional()
    .describe("Filter to specific view types only"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_table_by_name",
      title: "Get Table by Name",
      description:
        "Look up a table in a base by its name. Returns the full table schema including ID, fields, and views. Case-insensitive search by default. Use when you know the table name but need its ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_name: { type: "string", description: "Table name to find" },
          exact_match: { type: "boolean", description: "Exact case-sensitive match (default: false, case-insensitive)" },
        },
        required: ["base_id", "table_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          found: { type: "boolean" },
          fields: { type: "array", items: { type: "object" } },
          views: { type: "array", items: { type: "object" } },
        },
        required: ["found"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_tables_summary",
      title: "List Tables Summary",
      description:
        "Get a concise summary of all tables in a base: names, IDs, field counts, view counts, and primary field names. Lighter than get_base_schema — use for quick overview of a base structure without full field definitions.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_field_count: { type: "boolean", description: "Include field count per table (default: true)" },
          include_view_count: { type: "boolean", description: "Include view count per table (default: true)" },
          include_primary_field: { type: "boolean", description: "Include primary field name (default: true)" },
          include_field_types: { type: "boolean", description: "Include field type breakdown (default: false)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                fieldCount: { type: "number" },
                viewCount: { type: "number" },
                primaryFieldName: { type: "string" },
              },
            },
          },
          tableCount: { type: "number" },
          totalFields: { type: "number" },
        },
        required: ["tables", "tableCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "rename_table",
      title: "Rename Table",
      description:
        "Rename an Airtable table and optionally update its description. Returns the updated table metadata. Use to organize a base or correct naming errors.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') to rename" },
          new_name: { type: "string", description: "New table name" },
          new_description: { type: "string", description: "Optional new table description" },
        },
        required: ["base_id", "table_id", "new_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_table_field_names",
      title: "Get Table Field Names",
      description:
        "Get the names of all fields in a table. Can filter by field type and optionally include field IDs, descriptions, and options. Use when you need to know available fields before building formulas or record operations.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_type_filter: {
            type: "array",
            items: { type: "string" },
            description: "Only return fields of these types (e.g., ['singleSelect', 'number'])",
          },
          include_ids: { type: "boolean", description: "Include field IDs (default: false)" },
          include_descriptions: { type: "boolean", description: "Include field descriptions (default: false)" },
          include_options: { type: "boolean", description: "Include field options/config (default: false)" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tableId: { type: "string" },
          tableName: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                id: { type: "string" },
                type: { type: "string" },
              },
            },
          },
          fieldCount: { type: "number" },
        },
        required: ["fields", "fieldCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "clear_table_records",
      title: "Clear Table Records",
      description:
        "Delete records from a table — either all records or filtered by a formula. DESTRUCTIVE: this cannot be undone. confirm_delete_all=true required for safety. Optionally limit maximum deletes via max_records. Batches deletions automatically.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          filter_by_formula: { type: "string", description: "Optional formula to filter which records to delete. If omitted, ALL records are deleted." },
          confirm_delete_all: { type: "boolean", description: "Must be true to proceed with deletion" },
          max_records: { type: "number", description: "Optional max records to delete (safety limit)" },
        },
        required: ["base_id", "table_id_or_name", "confirm_delete_all"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deletedCount: { type: "number" },
          batchCount: { type: "number" },
          filter: { type: "string" },
        },
        required: ["deletedCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_table_primary_field",
      title: "Get Table Primary Field",
      description:
        "Get the primary field of a table (the first column / key field used for record names). Returns the field ID, name, and type. Use when you need to know which field is the primary identifier in a table.",
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
          primaryFieldId: { type: "string" },
          primaryFieldName: { type: "string" },
          primaryFieldType: { type: "string" },
          tableId: { type: "string" },
          tableName: { type: "string" },
        },
        required: ["primaryFieldId"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_table_views_extended",
      title: "List Table Views Extended",
      description:
        "List all views for a table with filtering by view type. Returns view IDs, names, types, and creation info. More targeted than list_views — can filter to only grid, form, kanban, gallery, calendar, timeline, or gantt views.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_type_filter: {
            type: "array",
            items: { type: "string" },
            description: "Filter to view types: grid, form, calendar, gallery, kanban, timeline, gantt",
          },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          views: { type: "array", items: { type: "object" } },
          viewCount: { type: "number" },
          filteredTypes: { type: "array", items: { type: "string" } },
        },
        required: ["views", "viewCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_table_by_name: async (args) => {
      const { base_id, table_name, exact_match } = GetTableByNameSchema.parse(args);

      const result = await logger.time("tool.get_table_by_name", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_table_by_name", base_id });

      const raw = result as { tables?: Array<Record<string, unknown>> };
      const tables = (raw.tables || []) as Array<{ id: string; name: string; fields: unknown[]; views?: unknown[] }>;

      const found = tables.find((t) => {
        if (exact_match) return t.name === table_name;
        return t.name.toLowerCase().includes(table_name.toLowerCase());
      });

      if (!found) {
        const response = {
          found: false,
          searchedFor: table_name,
          availableTables: tables.map((t) => ({ id: t.id, name: t.name })),
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      const response = { ...found, found: true };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_tables_summary: async (args) => {
      const { base_id, include_field_count, include_view_count, include_primary_field, include_field_types } = ListTablesSummarySchema.parse(args);

      const result = await logger.time("tool.list_tables_summary", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_tables_summary", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; primaryFieldId: string; fields: Array<{ id: string; name: string; type: string }>; views?: Array<{ id: string; type: string }> }> };

      let totalFields = 0;
      const tables = (raw.tables || []).map((t) => {
        const summary: Record<string, unknown> = { id: t.id, name: t.name };

        if (include_field_count !== false) {
          summary.fieldCount = (t.fields || []).length;
          totalFields += summary.fieldCount as number;
        }
        if (include_view_count !== false) {
          summary.viewCount = (t.views || []).length;
        }
        if (include_primary_field !== false) {
          const pf = (t.fields || []).find((f) => f.id === t.primaryFieldId);
          summary.primaryFieldName = pf?.name || null;
          summary.primaryFieldId = t.primaryFieldId;
        }
        if (include_field_types) {
          const byType: Record<string, number> = {};
          for (const f of (t.fields || [])) {
            byType[f.type] = (byType[f.type] || 0) + 1;
          }
          summary.fieldTypes = byType;
        }

        return summary;
      });

      const response = { tables, tableCount: tables.length, totalFields };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    rename_table: async (args) => {
      const { base_id, table_id, new_name, new_description } = RenameTableSchema.parse(args);

      const body: Record<string, unknown> = { name: new_name };
      if (new_description !== undefined) body.description = new_description;

      const result = await logger.time("tool.rename_table", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}`, body)
      , { tool: "rename_table", base_id, table_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_table_field_names: async (args) => {
      const { base_id, table_id_or_name, field_type_filter, include_ids, include_descriptions, include_options } = GetTableFieldNamesSchema.parse(args);

      const result = await logger.time("tool.get_table_field_names", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_table_field_names", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; description?: string; options?: unknown }> }> };

      const table = (raw.tables || []).find(
        (t) => t.id === table_id_or_name || t.name.toLowerCase() === table_id_or_name.toLowerCase()
      );

      if (!table) {
        throw new Error(`Table "${table_id_or_name}" not found in base`);
      }

      let fields = table.fields || [];

      if (field_type_filter && field_type_filter.length > 0) {
        fields = fields.filter((f) => field_type_filter.includes(f.type));
      }

      const fieldList = fields.map((f) => {
        const item: Record<string, unknown> = { name: f.name, type: f.type };
        if (include_ids) item.id = f.id;
        if (include_descriptions && f.description) item.description = f.description;
        if (include_options && f.options) item.options = f.options;
        return item;
      });

      const response = {
        tableId: table.id,
        tableName: table.name,
        fields: fieldList,
        fieldCount: fieldList.length,
        ...(field_type_filter ? { filteredByTypes: field_type_filter } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    clear_table_records: async (args) => {
      const { base_id, table_id_or_name, filter_by_formula, confirm_delete_all, max_records } = ClearTableRecordsSchema.parse(args);

      if (!confirm_delete_all) {
        throw new Error("clear_table_records: set confirm_delete_all=true to proceed. This operation is irreversible.");
      }

      // Fetch all record IDs
      const allIds: string[] = [];
      let offset: string | undefined;

      do {
        const queryParams = new URLSearchParams();
        queryParams.set("pageSize", "100");
        queryParams.set("fields[]", "_dummyField_");
        if (filter_by_formula) queryParams.set("filterByFormula", filter_by_formula);
        if (offset) queryParams.set("offset", offset);

        const q = new URLSearchParams();
        q.set("pageSize", "100");
        if (filter_by_formula) q.set("filterByFormula", filter_by_formula);
        if (offset) q.set("offset", offset);

        const result = await logger.time("tool.clear_table_records.fetch", () =>
          client.get<{ records: Array<{ id: string }>; offset?: string }>(
            `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
          )
        , { tool: "clear_table_records", base_id });

        for (const rec of result.records || []) {
          allIds.push(rec.id);
          if (max_records && allIds.length >= max_records) break;
        }

        offset = (max_records && allIds.length >= max_records) ? undefined : result.offset;
      } while (offset);

      // Delete in batches of 10
      const BATCH_SIZE = 10;
      let deletedCount = 0;
      let batchCount = 0;

      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        const q = new URLSearchParams();
        batch.forEach((id) => q.append("records[]", id));

        await logger.time("tool.clear_table_records.delete_batch", () =>
          client.delete(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`)
        , { tool: "clear_table_records", base_id, batchIndex: batchCount });

        deletedCount += batch.length;
        batchCount++;
      }

      const response = {
        deletedCount,
        batchCount,
        ...(filter_by_formula ? { filter: filter_by_formula } : { filter: "none (all records deleted)" }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_table_primary_field: async (args) => {
      const { base_id, table_id } = GetTablePrimaryFieldSchema.parse(args);

      const result = await logger.time("tool.get_table_primary_field", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_table_primary_field", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; primaryFieldId: string; fields: Array<{ id: string; name: string; type: string }> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table ${table_id} not found in base`);
      }

      const primaryField = (table.fields || []).find((f) => f.id === table.primaryFieldId);

      const response = {
        primaryFieldId: table.primaryFieldId,
        primaryFieldName: primaryField?.name || null,
        primaryFieldType: primaryField?.type || null,
        tableId: table.id,
        tableName: table.name,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_table_views_extended: async (args) => {
      const { base_id, table_id, view_type_filter } = ListTableViewsExtendedSchema.parse(args);

      const result = await logger.time("tool.list_table_views_extended", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_table_views_extended", base_id });

      const raw = result as { tables?: Array<{ id: string; views?: Array<{ id: string; name: string; type: string }> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table ${table_id} not found in base`);
      }

      let views = table.views || [];

      if (view_type_filter && view_type_filter.length > 0) {
        views = views.filter((v) => (view_type_filter as string[]).includes(v.type));
      }

      const response = {
        views,
        viewCount: views.length,
        ...(view_type_filter ? { filteredTypes: view_type_filter } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
