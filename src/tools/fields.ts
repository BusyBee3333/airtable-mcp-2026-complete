// Airtable Field management tools: list_fields, update_field, delete_field
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/fields
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListFieldsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  include_visible_field_ids: z.boolean().optional().describe("Include the visibleFieldIds for each view"),
});

const UpdateFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
  name: z.string().optional().describe("New field name"),
  description: z.string().optional().describe("New field description"),
  options: z.record(z.unknown()).optional().describe("Updated field options (type-specific, e.g. precision for number fields, choices for select fields)"),
});

const DeleteFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld') to delete"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_fields",
      title: "List Fields",
      description:
        "List all fields in an Airtable table with their types, IDs, descriptions, and type-specific options. Returns field configurations including select choices, number precision, date formats, formula expressions, etc. Use before creating/updating fields.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          include_visible_field_ids: { type: "boolean", description: "Include visibleFieldIds per view" },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                description: { type: "string" },
                options: { type: "object" },
              },
            },
          },
        },
        required: ["fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_field",
      title: "Update Field",
      description:
        "Update a field's name, description, or options. You can rename a field, update its description, or modify type-specific options (e.g., add choices to a select field, change number precision). Cannot change field type. Returns the updated field.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_id: { type: "string", description: "Field ID (starts with 'fld')" },
          name: { type: "string", description: "New field name" },
          description: { type: "string", description: "New field description" },
          options: { type: "object", description: "Updated type-specific options. For singleSelect: {choices:[{name:'New Option',color:'blueBright'}]}" },
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
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_field",
      title: "Delete Field",
      description:
        "Permanently delete a field from an Airtable table. This removes the field and all its data from every record. Cannot be undone. Cannot delete the primary field. Use only when user explicitly requests deletion.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_id: { type: "string", description: "Field ID (starts with 'fld') to delete" },
        },
        required: ["base_id", "table_id", "field_id"],
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
    list_fields: async (args) => {
      const { base_id, table_id, include_visible_field_ids } = ListFieldsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (include_visible_field_ids) queryParams.set("include[]", "visibleFieldIds");

      const qs = queryParams.toString();
      // Fields come back as part of the table schema — fetch table and return fields
      const result = await logger.time("tool.list_fields", () =>
        client.get(`/v0/meta/bases/${base_id}/tables${qs ? `?${qs}` : ""}`)
      , { tool: "list_fields", base_id, table_id });

      const raw = result as { tables?: Array<{ id: string; fields?: unknown[] }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table '${table_id}' not found in base '${base_id}'`);
      }

      const response = { fields: table.fields || [] };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    update_field: async (args) => {
      const { base_id, table_id, field_id, name, description, options } = UpdateFieldSchema.parse(args);

      if (!name && description === undefined && !options) {
        throw new Error("update_field: at least one of 'name', 'description', or 'options' must be provided");
      }

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description !== undefined) body.description = description;
      if (options) body.options = options;

      const result = await logger.time("tool.update_field", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, body)
      , { tool: "update_field", base_id, table_id, field_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_field: async (args) => {
      const { base_id, table_id, field_id } = DeleteFieldSchema.parse(args);

      const result = await logger.time("tool.delete_field", () =>
        client.delete(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`)
      , { tool: "delete_field", base_id, table_id, field_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
