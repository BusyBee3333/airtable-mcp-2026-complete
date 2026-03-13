// Airtable Metadata tools: create_table, create_field, get_field_metadata, list_all_tables_with_schema
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases/{baseId}/tables
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

// Airtable field type definitions
const fieldSchema = z.object({
  name: z.string().describe("Field name"),
  type: z.string().describe(
    "Field type: singleLineText, multilineText, email, url, number, currency, percent, rating, duration, autoNumber, checkbox, singleSelect, multipleSelects, date, dateTime, phoneNumber, singleCollaborator, multipleCollaborators, multipleAttachments, multipleRecordLinks, rollup, count, lookup, formula, createdTime, lastModifiedTime, createdBy, lastModifiedBy, externalSyncSource, aiText, button"
  ),
  description: z.string().optional().describe("Field description"),
  options: z.record(z.unknown()).optional().describe(
    "Field type options. Required for some types:\n- singleSelect/multipleSelects: {choices:[{name:'Option 1',color:'blueBright'}]}\n- number/currency/percent: {precision:2}\n- date: {dateFormat:{name:'local'}}\n- multipleRecordLinks: {linkedTableId:'tblXXX'}\n- formula: {formula:'UPPER({Name})'}"
  ),
});

const CreateTableSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  name: z.string().describe("Table name"),
  description: z.string().optional().describe("Table description"),
  fields: z.array(fieldSchema).min(1).describe(
    "Table fields. First field becomes the primary field. Example: [{name:'Name',type:'singleLineText'},{name:'Status',type:'singleSelect',options:{choices:[{name:'Active'},{name:'Inactive'}]}}]"
  ),
});

const CreateFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl') — use list_tables to find it"),
  name: z.string().describe("Field name"),
  type: z.string().describe("Field type (see create_table for full list)"),
  description: z.string().optional().describe("Field description"),
  options: z.record(z.unknown()).optional().describe("Field type options (required for select, number, date, etc.)"),
});

const GetFieldMetadataSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
});

const ListAllTablesWithSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_field_options: z.boolean().optional().describe("Include full field options/configuration (default: true)"),
  include_views: z.boolean().optional().describe("Include views in the response (default: true)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "create_table",
      title: "Create Table",
      description:
        "Create a new table in an Airtable base with specified fields. The first field in the array becomes the primary field. Common field types: singleLineText, number, singleSelect, multipleSelects, date, checkbox, email, url. Returns the created table with ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          name: { type: "string", description: "Table name" },
          description: { type: "string", description: "Table description" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                description: { type: "string" },
                options: { type: "object" },
              },
              required: ["name", "type"],
            },
            description: "Fields array — first field is primary. E.g. [{name:'Name',type:'singleLineText'},{name:'Status',type:'singleSelect',options:{choices:[{name:'Active'}]}}]",
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
    {
      name: "create_field",
      title: "Create Field",
      description:
        "Add a new field to an existing Airtable table. Requires the table ID (not name — use list_tables to find it). Returns the created field with its ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') — use list_tables to find it" },
          name: { type: "string", description: "Field name" },
          type: { type: "string", description: "Field type: singleLineText, number, singleSelect, multipleSelects, date, checkbox, email, url, currency, percent, etc." },
          description: { type: "string", description: "Field description" },
          options: { type: "object", description: "Type options. For singleSelect: {choices:[{name:'Option 1'}]}. For number: {precision:2}" },
        },
        required: ["base_id", "table_id", "name", "type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          options: { type: "object" },
        },
        required: ["id", "name", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_field_metadata",
      title: "Get Field Metadata",
      description:
        "Get the complete metadata for a specific field including its full type-specific options. Returns field ID, name, type, description, and all configuration options (e.g., choices for select fields, formula expression, linked table ID, rollup configuration, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_id: { type: "string", description: "Field ID (starts with 'fld')" },
        },
        required: ["base_id", "table_id", "field_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          options: { type: "object" },
        },
        required: ["id", "name", "type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_all_tables_with_schema",
      title: "List All Tables With Schema",
      description:
        "Get the complete schema for all tables in an Airtable base in a single call. Returns every table with its full field definitions (including all type options), views, and primary field IDs. Use for comprehensive schema inspection or documentation generation.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_field_options: { type: "boolean", description: "Include full field options (default: true)" },
          include_views: { type: "boolean", description: "Include views (default: true)" },
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
                primaryFieldId: { type: "string" },
                fields: { type: "array" },
                views: { type: "array" },
              },
            },
          },
          tableCount: { type: "number" },
          totalFieldCount: { type: "number" },
        },
        required: ["tables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    create_table: async (args) => {
      const { base_id, name, description, fields } = CreateTableSchema.parse(args);

      const body: Record<string, unknown> = { name, fields };
      if (description) body.description = description;

      const result = await logger.time("tool.create_table", () =>
        client.post(`/v0/meta/bases/${base_id}/tables`, body)
      , { tool: "create_table", base_id, name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_field: async (args) => {
      const { base_id, table_id, name, type, description, options } = CreateFieldSchema.parse(args);

      const body: Record<string, unknown> = { name, type };
      if (description) body.description = description;
      if (options) body.options = options;

      const result = await logger.time("tool.create_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_field", base_id, table_id, name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_field_metadata: async (args) => {
      const { base_id, table_id, field_id } = GetFieldMetadataSchema.parse(args);

      // Fields are part of the table schema — fetch the table and find the field
      const result = await logger.time("tool.get_field_metadata", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_field_metadata", base_id, table_id, field_id });

      const raw = result as { tables?: Array<{ id: string; fields?: Array<Record<string, unknown>> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      const field = (table.fields || []).find((f) => f.id === field_id);
      if (!field) {
        throw new Error(`Field '${field_id}' not found in table '${table_id}'`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(field, null, 2) }],
        structuredContent: field,
      };
    },

    list_all_tables_with_schema: async (args) => {
      const { base_id, include_field_options, include_views } = ListAllTablesWithSchemaSchema.parse(args);

      const result = await logger.time("tool.list_all_tables_with_schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_all_tables_with_schema", base_id });

      const raw = result as { tables?: Array<{
        id: string;
        name: string;
        primaryFieldId: string;
        fields: Array<Record<string, unknown>>;
        views?: Array<Record<string, unknown>>;
      }> };

      const showFieldOptions = include_field_options !== false;
      const showViews = include_views !== false;

      const tables = (raw.tables || []).map((t) => {
        const tableData: Record<string, unknown> = {
          id: t.id,
          name: t.name,
          primaryFieldId: t.primaryFieldId,
        };

        if (showFieldOptions) {
          tableData.fields = t.fields;
        } else {
          tableData.fields = (t.fields || []).map((f) => ({ id: f.id, name: f.name, type: f.type }));
        }

        if (showViews) {
          tableData.views = t.views || [];
        }

        return tableData;
      });

      const totalFieldCount = (raw.tables || []).reduce((sum, t) => sum + (t.fields?.length || 0), 0);

      const response = {
        tables,
        tableCount: tables.length,
        totalFieldCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
