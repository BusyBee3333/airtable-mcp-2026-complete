// Airtable Select Options Management: list_select_options, add_select_option,
//   update_select_option, reorder_select_options, bulk_add_select_options,
//   delete_select_option, get_select_option_usage
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const AIRTABLE_COLORS = [
  "cyanLight2", "tealLight2", "greenLight2", "yellowLight2", "orangeLight2", "redLight2",
  "pinkLight2", "purpleLight2", "grayLight2", "cyanLight1", "tealLight1", "greenLight1",
  "yellowLight1", "orangeLight1", "redLight1", "pinkLight1", "purpleLight1", "grayLight1",
  "cyan", "teal", "green", "yellow", "orange", "red", "pink", "purple", "gray",
  "cyanDark1", "tealDark1", "greenDark1", "yellowDark1", "orangeDark1", "redDark1",
  "pinkDark1", "purpleDark1", "grayDark1",
] as const;

const ListSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Single select or multiple select field ID or name"),
});

const AddSelectOptionSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Select field ID or name"),
  name: z.string().describe("Name for the new option"),
  color: z.enum(AIRTABLE_COLORS).optional().describe("Color for the option. Options: cyanLight2, tealLight2, greenLight2, yellowLight2, orangeLight2, redLight2, pinkLight2, purpleLight2, grayLight2, cyan, teal, green, yellow, orange, red, pink, purple, gray, and dark variants"),
});

const UpdateSelectOptionSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Select field ID or name"),
  option_id: z.string().describe("Option ID (starts with 'opt')"),
  name: z.string().optional().describe("New name for the option"),
  color: z.enum(AIRTABLE_COLORS).optional().describe("New color for the option"),
});

const ReorderSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Select field ID or name"),
  option_ids: z.array(z.string()).min(1).describe("Option IDs in desired order (all existing IDs must be included)"),
});

const BulkAddSelectOptionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Select field ID or name"),
  options: z.array(z.object({
    name: z.string(),
    color: z.enum(AIRTABLE_COLORS).optional(),
  })).min(1).max(50).describe("Options to add: [{name:'Draft',color:'grayLight1'},{name:'Active',color:'greenLight1'}]"),
});

const GetSelectOptionUsageSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_id_or_name: z.string().describe("Select field ID or name"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_select_options",
      title: "List Select Options",
      description:
        "List all options for a single select or multiple select field, including their IDs, names, and colors. Use to inspect available choices before creating records or to audit select fields for data governance.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          fieldName: { type: "string" },
          fieldType: { type: "string" },
          options: { type: "array", items: { type: "object" } },
          optionCount: { type: "number" },
        },
        required: ["fieldName", "options", "optionCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_select_option",
      title: "Add Select Option",
      description:
        "Add a new option to a single select or multiple select field. Optionally assign a color. The new option is appended to the end of the options list. Returns the updated field with all options.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
          name: { type: "string", description: "Name for the new option" },
          color: { type: "string", description: "Option color (e.g., greenLight1, redLight1, blueLight1)" },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name", "name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "object" },
          addedOption: { type: "object" },
        },
        required: ["field"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_select_option",
      title: "Update Select Option",
      description:
        "Update the name or color of an existing select option. You must provide the option ID (starts with 'opt'). Use list_select_options to get option IDs. Updating an option name changes all records that use that option automatically.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
          option_id: { type: "string", description: "Option ID (starts with 'opt')" },
          name: { type: "string", description: "New name for the option" },
          color: { type: "string", description: "New color for the option" },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name", "option_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "object" },
        },
        required: ["field"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "reorder_select_options",
      title: "Reorder Select Options",
      description:
        "Change the display order of options in a select field. Provide all option IDs in the desired new order. This controls the order shown in dropdowns and grouped views. All existing option IDs must be included.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
          option_ids: { type: "array", items: { type: "string" }, description: "All option IDs in desired order: ['optXXX','optYYY','optZZZ']" },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name", "option_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "object" },
          optionCount: { type: "number" },
        },
        required: ["field"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_add_select_options",
      title: "Bulk Add Select Options",
      description:
        "Add multiple options to a select field in a single operation. Useful when setting up a new field with many choices (e.g., status stages, category lists). Skips options that already exist by name. Returns the updated field with all options.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
          options: {
            type: "array",
            items: { type: "object" },
            description: "Options to add: [{name:'Draft',color:'grayLight1'},{name:'Active',color:'greenLight1'}]",
          },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name", "options"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "object" },
          addedCount: { type: "number" },
          skippedCount: { type: "number" },
        },
        required: ["field", "addedCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_select_option_usage",
      title: "Get Select Option Usage",
      description:
        "Count how many records use each option in a select field. Returns usage statistics for all options, including unused options. Useful for data cleanup (identifying unused options) and understanding data distribution across select values.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_id_or_name: { type: "string", description: "Select field ID or name" },
        },
        required: ["base_id", "table_id_or_name", "field_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          fieldName: { type: "string" },
          usage: { type: "array", items: { type: "object" } },
          totalRecords: { type: "number" },
          unusedOptions: { type: "array", items: { type: "string" } },
        },
        required: ["fieldName", "usage", "totalRecords"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function getField(client: AirtableClient, base_id: string, table_id_or_name: string, field_id_or_name: string) {
    const schema = await logger.time("tool.select_options.get_field", () =>
      client.get(`/v0/meta/bases/${base_id}/tables`)
    , { tool: "select_options" }) as {
      tables?: Array<{
        id: string;
        name: string;
        fields?: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }>;
      }>;
    };

    const table = (schema.tables ?? []).find(
      (t) => t.id === table_id_or_name || t.name === table_id_or_name
    );
    if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

    const field = (table.fields ?? []).find(
      (f) => f.id === field_id_or_name || f.name === field_id_or_name
    );
    if (!field) throw new Error(`Field '${field_id_or_name}' not found`);
    if (!["singleSelect", "multipleSelects"].includes(field.type)) {
      throw new Error(`Field '${field.name}' is type '${field.type}', not a select field`);
    }

    return { table, field };
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_select_options: async (args) => {
      const params = ListSelectOptionsSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const choices = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];

      const response = {
        fieldName: field.name,
        fieldType: field.type,
        options: choices,
        optionCount: choices.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    add_select_option: async (args) => {
      const params = AddSelectOptionSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const existing = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];

      const newOption: Record<string, unknown> = { name: params.name };
      if (params.color) newOption.color = params.color;

      const updatedChoices = [...existing, newOption];

      const result = await logger.time("tool.add_select_option", () =>
        client.patch(`/v0/meta/bases/${params.base_id}/tables/${field.id}/fields/${field.id}`, {
          options: { choices: updatedChoices },
        })
      , { tool: "add_select_option" }) as Record<string, unknown>;

      // Use the Airtable field update endpoint with table id
      const schema = await logger.time("tool.add_select_option.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "add_select_option" }) as { tables?: Array<{ id: string; name: string }> };

      const tableObj = (schema.tables ?? []).find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );
      if (!tableObj) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const updateResult = await logger.time("tool.add_select_option.update", () =>
        client.patch(`/v0/meta/bases/${params.base_id}/tables/${tableObj.id}/fields/${field.id}`, {
          options: { choices: updatedChoices },
        })
      , { tool: "add_select_option" });

      const addedOption = newOption;
      const response = { field: updateResult, addedOption, result };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    update_select_option: async (args) => {
      const params = UpdateSelectOptionSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const existing = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];

      const updatedChoices = existing.map((opt) => {
        if (opt.id === params.option_id) {
          return {
            ...opt,
            ...(params.name ? { name: params.name } : {}),
            ...(params.color ? { color: params.color } : {}),
          };
        }
        return opt;
      });

      const schema = await logger.time("tool.update_select_option.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "update_select_option" }) as { tables?: Array<{ id: string; name: string }> };

      const tableObj = (schema.tables ?? []).find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );
      if (!tableObj) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const result = await logger.time("tool.update_select_option", () =>
        client.patch(`/v0/meta/bases/${params.base_id}/tables/${tableObj.id}/fields/${field.id}`, {
          options: { choices: updatedChoices },
        })
      , { tool: "update_select_option" });

      const response = { field: result };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    reorder_select_options: async (args) => {
      const params = ReorderSelectOptionsSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const existing = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];

      // Reorder by option_ids
      const existingMap = Object.fromEntries(existing.map((opt) => [opt.id, opt]));
      const reordered = params.option_ids.map((id) => {
        if (!existingMap[id]) throw new Error(`Option ID '${id}' not found in field`);
        return existingMap[id];
      });

      const schema = await logger.time("tool.reorder_select_options.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "reorder_select_options" }) as { tables?: Array<{ id: string; name: string }> };

      const tableObj = (schema.tables ?? []).find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );
      if (!tableObj) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const result = await logger.time("tool.reorder_select_options", () =>
        client.patch(`/v0/meta/bases/${params.base_id}/tables/${tableObj.id}/fields/${field.id}`, {
          options: { choices: reordered },
        })
      , { tool: "reorder_select_options" });

      const response = { field: result, optionCount: reordered.length };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    bulk_add_select_options: async (args) => {
      const params = BulkAddSelectOptionsSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const existing = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];
      const existingNames = new Set(existing.map((opt) => opt.name.toLowerCase()));

      const toAdd = params.options.filter((opt) => !existingNames.has(opt.name.toLowerCase()));
      const skipped = params.options.filter((opt) => existingNames.has(opt.name.toLowerCase()));

      const updatedChoices = [...existing, ...toAdd];

      const schema = await logger.time("tool.bulk_add_select_options.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "bulk_add_select_options" }) as { tables?: Array<{ id: string; name: string }> };

      const tableObj = (schema.tables ?? []).find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );
      if (!tableObj) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const result = await logger.time("tool.bulk_add_select_options", () =>
        client.patch(`/v0/meta/bases/${params.base_id}/tables/${tableObj.id}/fields/${field.id}`, {
          options: { choices: updatedChoices },
        })
      , { tool: "bulk_add_select_options" });

      const response = {
        field: result,
        addedCount: toAdd.length,
        skippedCount: skipped.length,
        skippedNames: skipped.map((o) => o.name),
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_select_option_usage: async (args) => {
      const params = GetSelectOptionUsageSchema.parse(args);
      const { field } = await getField(client, params.base_id, params.table_id_or_name, params.field_id_or_name);
      const choices = (field.options?.choices as Array<{ id: string; name: string; color?: string }>) ?? [];

      // Fetch all records with this field
      const qp = new URLSearchParams();
      qp.append("fields[]", field.name);
      const allRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.get_select_option_usage.records", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "get_select_option_usage" }) as { records?: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
      } while (offset);

      // Count usage
      const usageMap: Record<string, number> = {};
      for (const rec of allRecords) {
        const val = rec.fields[field.name];
        if (val === null || val === undefined) continue;
        if (Array.isArray(val)) {
          for (const v of val) {
            usageMap[String(v)] = (usageMap[String(v)] ?? 0) + 1;
          }
        } else {
          usageMap[String(val)] = (usageMap[String(val)] ?? 0) + 1;
        }
      }

      const usage = choices.map((opt) => ({
        id: opt.id,
        name: opt.name,
        color: opt.color,
        count: usageMap[opt.name] ?? 0,
        percentage: allRecords.length > 0 ? Math.round(((usageMap[opt.name] ?? 0) / allRecords.length) * 100) : 0,
      }));

      const unusedOptions = usage.filter((u) => u.count === 0).map((u) => u.name);

      const response = {
        fieldName: field.name,
        fieldType: field.type,
        usage,
        totalRecords: allRecords.length,
        unusedOptions,
        unusedCount: unusedOptions.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
