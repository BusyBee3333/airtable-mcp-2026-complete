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
  };

  return { tools, handlers };
}
