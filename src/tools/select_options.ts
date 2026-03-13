// Airtable Select Options tools: list_select_options, add_select_option,
//   update_select_option, reorder_select_options, delete_select_option,
//   bulk_add_select_options, set_select_option_color
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the single/multi-select field"),
});

const AddSelectOptionSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
  name: z.string().describe("Option name/label to add"),
  color: z.enum([
    "blueLight2", "cyanLight2", "tealLight2", "greenLight2", "yellowLight2",
    "orangeLight2", "redLight2", "pinkLight2", "purpleLight2", "grayLight2",
    "blueLight1", "cyanLight1", "tealLight1", "greenLight1", "yellowLight1",
    "orangeLight1", "redLight1", "pinkLight1", "purpleLight1", "grayLight1",
    "blue", "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray",
    "blueDark1", "cyanDark1", "tealDark1", "greenDark1", "yellowDark1",
    "orangeDark1", "redDark1", "pinkDark1", "purpleDark1", "grayDark1",
  ]).optional().describe("Color for the option"),
});

const UpdateSelectOptionSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
  option_id: z.string().describe("Option ID to update"),
  name: z.string().optional().describe("New name for the option"),
  color: z.string().optional().describe("New color for the option"),
});

const ReorderSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
  option_names_in_order: z.array(z.string()).min(1).describe("Option names in desired order (all options must be listed)"),
});

const BulkAddSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld')"),
  options: z.array(z.object({
    name: z.string(),
    color: z.string().optional(),
  })).min(1).max(50).describe("Options to add: [{name:'Option1',color:'blue'}, ...]"),
});

const GetSelectOptionsMapSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_select_options",
      title: "List Select Options",
      description:
        "List all options for a single-select or multi-select field in an Airtable table. Returns option IDs, names, and colors. Use to audit available options or find option IDs needed for updates.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Select field name" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field_name: { type: "string" },
          field_id: { type: "string" },
          field_type: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" }, color: { type: "string" } },
            },
          },
          count: { type: "number" },
        },
        required: ["options", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_select_option",
      title: "Add Select Option",
      description:
        "Add a new option to a single-select or multi-select field. Specify the option name and optional color. Returns the updated field with all options.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_id: { type: "string" },
          name: { type: "string" },
          color: { type: "string", description: "Airtable color name (e.g., 'blue', 'red', 'greenLight1')" },
        },
        required: ["base_id", "table_id", "field_id", "name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_select_option",
      title: "Update Select Option",
      description:
        "Update an existing select option — rename it or change its color. Changing option names does NOT break existing records that use that option; Airtable tracks options by ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_id: { type: "string" },
          option_id: { type: "string", description: "Option ID to update" },
          name: { type: "string", description: "New option name" },
          color: { type: "string", description: "New color name" },
        },
        required: ["base_id", "table_id", "field_id", "option_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "boolean" },
          field: { type: "object" },
        },
        required: ["updated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "reorder_select_options",
      title: "Reorder Select Options",
      description:
        "Reorder options in a select field by specifying their desired order. Provide all option names in the new desired order. The field is updated with options in the specified sequence.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_id: { type: "string" },
          option_names_in_order: { type: "array", items: { type: "string" }, description: "All option names in desired order" },
        },
        required: ["base_id", "table_id", "field_id", "option_names_in_order"],
      },
      outputSchema: {
        type: "object",
        properties: {
          reordered: { type: "boolean" },
          new_order: { type: "array", items: { type: "string" } },
        },
        required: ["reordered"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_add_select_options",
      title: "Bulk Add Select Options",
      description:
        "Add multiple select options to a field at once — more efficient than adding one at a time. Each option can have a name and optional color. Existing options are preserved.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_id: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, color: { type: "string" } },
              required: ["name"],
            },
            description: "Options to add (max 50)",
          },
        },
        required: ["base_id", "table_id", "field_id", "options"],
      },
      outputSchema: {
        type: "object",
        properties: {
          added_count: { type: "number" },
          total_options: { type: "number" },
          field: { type: "object" },
        },
        required: ["added_count"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_select_options_map",
      title: "Get Select Options Map",
      description:
        "Get a complete map of all select and multi-select fields in a table, with their options. Returns a structured object keyed by field name — useful for building dropdowns, validating inputs, or auditing all select fields at once.",
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
          select_fields: { type: "object" },
          field_count: { type: "number" },
          total_options: { type: "number" },
        },
        required: ["select_fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_select_options: async (args) => {
      const { base_id, table_id_or_name, field_name } = ListSelectOptionsSchema.parse(args);

      const schema = await logger.time("tool.list_select_options", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_select_options", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }> };

      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      const field = table?.fields.find((f) => f.name === field_name);

      if (!field) throw new Error(`Field '${field_name}' not found`);

      const choices = (field.options as { choices?: Array<{ id: string; name: string; color: string }> } | undefined)?.choices ?? [];

      const data = {
        field_name: field.name,
        field_id: field.id,
        field_type: field.type,
        options: choices,
        count: choices.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    add_select_option: async (args) => {
      const { base_id, table_id, field_id, name, color } = AddSelectOptionSchema.parse(args);

      // Get current field config
      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; fields: Array<{ id: string; type: string; options?: Record<string, unknown> }> }> };
      const table = schema.tables.find((t) => t.id === table_id);
      const field = table?.fields.find((f) => f.id === field_id);
      if (!field) throw new Error(`Field ${field_id} not found`);

      const currentChoices = (field.options as { choices?: unknown[] } | undefined)?.choices ?? [];
      const newChoice: Record<string, string> = { name };
      if (color) newChoice.color = color;
      const updatedChoices = [...currentChoices, newChoice];

      const result = await client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, {
        options: { choices: updatedChoices },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    },

    update_select_option: async (args) => {
      const { base_id, table_id, field_id, option_id, name, color } = UpdateSelectOptionSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; fields: Array<{ id: string; type: string; options?: Record<string, unknown> }> }> };
      const table = schema.tables.find((t) => t.id === table_id);
      const field = table?.fields.find((f) => f.id === field_id);
      if (!field) throw new Error(`Field ${field_id} not found`);

      const choices = (field.options as { choices?: Array<{ id: string; name: string; color: string }> } | undefined)?.choices ?? [];
      const updated = choices.map((c) => {
        if (c.id !== option_id) return c;
        return { ...c, ...(name ? { name } : {}), ...(color ? { color } : {}) };
      });

      const result = await client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, {
        options: { choices: updated },
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ updated: true, field: result }, null, 2) }],
        structuredContent: { updated: true, field: result as Record<string, unknown> },
      };
    },

    reorder_select_options: async (args) => {
      const { base_id, table_id, field_id, option_names_in_order } = ReorderSelectOptionsSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; fields: Array<{ id: string; type: string; options?: Record<string, unknown> }> }> };
      const table = schema.tables.find((t) => t.id === table_id);
      const field = table?.fields.find((f) => f.id === field_id);
      if (!field) throw new Error(`Field ${field_id} not found`);

      const choices = (field.options as { choices?: Array<{ id: string; name: string; color: string }> } | undefined)?.choices ?? [];
      const choiceMap = new Map(choices.map((c) => [c.name, c]));
      const reordered = option_names_in_order.map((name) => choiceMap.get(name)).filter(Boolean);

      await client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, {
        options: { choices: reordered },
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ reordered: true, new_order: option_names_in_order }, null, 2) }],
        structuredContent: { reordered: true, new_order: option_names_in_order },
      };
    },

    bulk_add_select_options: async (args) => {
      const { base_id, table_id, field_id, options } = BulkAddSelectOptionsSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; fields: Array<{ id: string; type: string; options?: Record<string, unknown> }> }> };
      const table = schema.tables.find((t) => t.id === table_id);
      const field = table?.fields.find((f) => f.id === field_id);
      if (!field) throw new Error(`Field ${field_id} not found`);

      const existing = (field.options as { choices?: unknown[] } | undefined)?.choices ?? [];
      const newChoices = options.map((o) => ({ name: o.name, ...(o.color ? { color: o.color } : {}) }));
      const allChoices = [...existing, ...newChoices];

      const result = await client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, {
        options: { choices: allChoices },
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ added_count: options.length, total_options: allChoices.length, field: result }, null, 2) }],
        structuredContent: { added_count: options.length, total_options: allChoices.length, field: result as Record<string, unknown> },
      };
    },

    get_select_options_map: async (args) => {
      const { base_id, table_id_or_name } = GetSelectOptionsMapSchema.parse(args);

      const schema = await logger.time("tool.get_select_options_map", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_select_options_map", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }> };

      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const selectFields = table.fields.filter((f) => f.type === "singleSelect" || f.type === "multipleSelects");
      const map: Record<string, unknown> = {};
      let totalOptions = 0;

      for (const f of selectFields) {
        const choices = (f.options as { choices?: unknown[] } | undefined)?.choices ?? [];
        map[f.name] = { field_id: f.id, type: f.type, options: choices, count: choices.length };
        totalOptions += choices.length;
      }

      const data = { select_fields: map, field_count: selectFields.length, total_options: totalOptions };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
