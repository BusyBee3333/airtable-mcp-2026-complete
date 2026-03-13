// Airtable Table management tools: update_table, delete_table, get_table_schema
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases/{baseId}/tables
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetTableSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
});

const UpdateTableSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().optional().describe("New name for the table"),
  description: z.string().optional().describe("New description for the table"),
});

const DeleteTableSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') to delete"),
});

// ============ New Schemas (round 2) ============

const ListTablesWithRecordCountSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_fields: z.boolean().optional().default(false).describe("If true, include field definitions for each table (default: false — metadata only)"),
  max_records_per_table: z.number().min(1).max(100).optional().default(1).describe("Max records to fetch per table for count estimate (1-100, default: 1). Use 100 for more accurate sample."),
});

const CreateTableFromSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  name: z.string().describe("Table name"),
  description: z.string().optional().describe("Table description"),
  fields: z.array(z.object({
    name: z.string().describe("Field name"),
    type: z.string().describe("Field type: singleLineText, multilineText, number, singleSelect, multipleSelects, date, dateTime, checkbox, email, url, phoneNumber, currency, percent, duration, rating, formula, multipleRecordLinks, etc."),
    description: z.string().optional().describe("Field description"),
    options: z.record(z.unknown()).optional().describe("Type-specific options. For singleSelect: {choices:[{name:'Option1',color:'blueBright'}]}. For number: {precision:2}. For formula: {formula:'...'}."),
  })).min(1).describe("Fields to create. First field becomes the primary field. Example: [{name:'Name',type:'singleLineText'},{name:'Status',type:'singleSelect',options:{choices:[{name:'Active'},{name:'Done'}]}}]"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_table_schema",
      title: "Get Table Schema",
      description:
        "Get the full schema for a single Airtable table including all fields, their types, and views. Returns primary field ID, all field definitions with options, and all view definitions. Use when you need detailed metadata about one specific table.",
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
          id: { type: "string" },
          name: { type: "string" },
          primaryFieldId: { type: "string" },
          fields: { type: "array" },
          views: { type: "array" },
        },
        required: ["id", "name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_table",
      title: "Update Table",
      description:
        "Rename a table or update its description. At least one of name or description must be provided. Returns the updated table. Use to rename tables or add/change descriptions.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "New table name" },
          description: { type: "string", description: "New table description" },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_table",
      title: "Delete Table",
      description:
        "Permanently delete a table from an Airtable base. This action is irreversible and removes all records in the table. Use only when explicitly requested by the user.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') to delete" },
        },
        required: ["base_id", "table_id"],
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
      name: "list_tables_with_record_count",
      title: "List Tables With Record Count",
      description:
        "List all tables in an Airtable base with their metadata plus approximate record counts. Fetches table schema and performs a quick count request per table. Returns table ID, name, description, field count, view count, and an estimated record count. Useful for capacity planning and data auditing. Note: counts are estimates based on API response metadata.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_fields: { type: "boolean", description: "Include field definitions per table (default: false)" },
          max_records_per_table: { type: "number", description: "Records to sample per table for count (1-100, default: 1)" },
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
                hasMoreRecords: { type: "boolean" },
              },
            },
          },
          totalTables: { type: "number" },
        },
        required: ["tables", "totalTables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_table_from_schema",
      title: "Create Table From Schema",
      description:
        "Create a new Airtable table with its fields defined in a single call. Specify the table name, optional description, and an array of field definitions. Each field needs a name and type; some types require options (e.g., singleSelect needs choices). The first field in the array becomes the primary field and must be a text-compatible type. Returns the created table with all field IDs.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          name: { type: "string", description: "Table name" },
          description: { type: "string", description: "Table description (optional)" },
          fields: {
            type: "array",
            items: { type: "object" },
            description: "Fields to create. First field = primary field (must be text-compatible). Example: [{name:'Name',type:'singleLineText'},{name:'Status',type:'singleSelect',options:{choices:[{name:'Active',color:'greenBright'}]}}]",
          },
        },
        required: ["base_id", "name", "fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          primaryFieldId: { type: "string" },
          fields: { type: "array" },
          views: { type: "array" },
        },
        required: ["id", "name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_table_schema: async (args) => {
      const { base_id, table_id } = GetTableSchemaSchema.parse(args);

      // Get all tables then filter for the specific one
      const result = await logger.time("tool.get_table_schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_table_schema", base_id, table_id });

      const raw = result as { tables?: Array<Record<string, unknown>> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(table, null, 2) }],
        structuredContent: table,
      };
    },

    update_table: async (args) => {
      const { base_id, table_id, name, description } = UpdateTableSchema.parse(args);

      if (!name && description === undefined) {
        throw new Error("update_table: at least one of 'name' or 'description' must be provided");
      }

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.update_table", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}`, body)
      , { tool: "update_table", base_id, table_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_table: async (args) => {
      const { base_id, table_id } = DeleteTableSchema.parse(args);

      const result = await logger.time("tool.delete_table", () =>
        client.delete(`/v0/meta/bases/${base_id}/tables/${table_id}`)
      , { tool: "delete_table", base_id, table_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    // ── Round 2 handlers ──

    list_tables_with_record_count: async (args) => {
      const { base_id, include_fields, max_records_per_table } = ListTablesWithRecordCountSchema.parse(args);

      // Fetch all table schemas
      const schemaResult = await logger.time("tool.list_tables_with_record_count.schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_tables_with_record_count", base_id });

      const raw = schemaResult as {
        tables?: Array<{
          id: string;
          name: string;
          description?: string;
          primaryFieldId?: string;
          fields?: unknown[];
          views?: unknown[];
          [key: string]: unknown;
        }>;
      };

      const allTables = raw.tables ?? [];
      const tablesWithCounts: Array<Record<string, unknown>> = [];

      for (const table of allTables) {
        // Quick record count via maxRecords=1 (returns offset if >1 records, or empty)
        let hasMoreRecords = false;
        let recordSample = 0;
        let offset: string | undefined;

        try {
          const countParams = new URLSearchParams();
          countParams.set("maxRecords", String(max_records_per_table ?? 1));
          countParams.set("pageSize", String(max_records_per_table ?? 1));

          const countResult = await logger.time("tool.list_tables_with_record_count.count", () =>
            client.get(`/v0/${base_id}/${encodeURIComponent(table.name)}?${countParams}`)
          , { tool: "list_tables_with_record_count.count", base_id, table: table.name });

          const countRaw = countResult as { records?: unknown[]; offset?: string };
          recordSample = (countRaw.records ?? []).length;
          hasMoreRecords = countRaw.offset !== undefined;
          offset = countRaw.offset;
        } catch {
          // Table might be empty or API call failed
          recordSample = 0;
        }

        const entry: Record<string, unknown> = {
          id: table.id,
          name: table.name,
          description: table.description,
          primaryFieldId: table.primaryFieldId,
          fieldCount: Array.isArray(table.fields) ? table.fields.length : 0,
          viewCount: Array.isArray(table.views) ? table.views.length : 0,
          recordSample,
          hasMoreRecords,
          recordCountNote: hasMoreRecords
            ? `At least ${recordSample} records (more exist)`
            : `${recordSample} records`,
        };

        if (include_fields) {
          entry.fields = table.fields ?? [];
          entry.views = table.views ?? [];
        }

        tablesWithCounts.push(entry);
      }

      const response = {
        tables: tablesWithCounts,
        totalTables: allTables.length,
        note: "Record counts are sampled estimates. Use list_records with max_records for exact counts (may be slow for large tables).",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    create_table_from_schema: async (args) => {
      const { base_id, name, description, fields } = CreateTableFromSchemaSchema.parse(args);

      const body: Record<string, unknown> = { name, fields };
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.create_table_from_schema", () =>
        client.post(`/v0/meta/bases/${base_id}/tables`, body)
      , { tool: "create_table_from_schema", base_id, name, fieldCount: fields.length });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
