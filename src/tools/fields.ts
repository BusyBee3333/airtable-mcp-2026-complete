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

// ============ New Schemas (round 2) ============

const ListFieldTypesSchema = z.object({
  category: z.enum(["all", "text", "numeric", "date", "select", "relational", "special"]).optional().default("all").describe("Category filter: all, text, numeric, date, select, relational, special (default: all)"),
});

const CreateSelectFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name"),
  type: z.enum(["singleSelect", "multipleSelects"]).describe("'singleSelect' for single choice, 'multipleSelects' for multi-choice"),
  choices: z.array(z.object({
    name: z.string().describe("Choice label"),
    color: z.string().optional().describe("Color: blueBright, cyanBright, tealBright, greenBright, yellowBright, orangeBright, redBright, pinkBright, purpleBright, grayBright, blue, cyan, teal, green, yellow, orange, red, pink, purple, gray"),
  })).optional().describe("Initial choices. Example: [{name:'Active',color:'greenBright'},{name:'Inactive',color:'redBright'}]"),
  description: z.string().optional().describe("Field description"),
});

const AddSelectOptionSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id: z.string().describe("Field ID (starts with 'fld') of the select/multiSelect field"),
  name: z.string().describe("New option name to add"),
  color: z.string().optional().describe("Option color (e.g., 'blueBright', 'greenBright', 'redBright')"),
});

const CreateFormulaFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name for the formula field"),
  formula: z.string().describe("Airtable formula expression. Example: CONCATENATE({First Name},' ',{Last Name}) or IF({Score}>80,'Pass','Fail')"),
  description: z.string().optional().describe("Field description"),
});

const CreateRollupFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name for the rollup field"),
  linked_field_id: z.string().describe("Field ID (starts with 'fld') of the linked record field to roll up from"),
  lookup_field_id: z.string().describe("Field ID (starts with 'fld') in the linked table to aggregate"),
  rollup_function: z.enum([
    "COUNT", "COUNTA", "COUNTALL", "SUM", "AVERAGE", "MIN", "MAX",
    "AND", "OR", "CONCATENATE", "ARRAYJOIN", "ARRAYUNIQUE", "ARRAYCOMPACT",
  ]).describe("Aggregation function to apply. Examples: SUM (total numbers), COUNT (count non-empty), ARRAYJOIN (join text values)"),
  description: z.string().optional().describe("Field description"),
});

const CreateLinkedFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') of the source table (where the field will be created)"),
  name: z.string().describe("Field name for the linked record field"),
  linked_table_id: z.string().describe("Table ID (starts with 'tbl') of the table to link to"),
  is_single_record_link: z.boolean().optional().describe("If true, restricts to linking only one record (default: false — allows multiple)"),
  description: z.string().optional().describe("Field description"),
});

// ============ Field type reference data ============

const FIELD_TYPES = [
  // Text
  { type: "singleLineText", category: "text", description: "Single-line text field", optionsSchema: null },
  { type: "multilineText", category: "text", description: "Multi-line text / long text field", optionsSchema: null },
  { type: "richText", category: "text", description: "Rich text with formatting (bold, italic, lists, etc.)", optionsSchema: null },
  { type: "email", category: "text", description: "Email address field (validated format)", optionsSchema: null },
  { type: "url", category: "text", description: "URL / web link field", optionsSchema: null },
  { type: "phoneNumber", category: "text", description: "Phone number field", optionsSchema: null },
  // Numeric
  { type: "number", category: "numeric", description: "Numeric field", optionsSchema: { precision: "integer 0-8 (decimal places)" } },
  { type: "currency", category: "numeric", description: "Currency field with symbol", optionsSchema: { precision: "integer 0-7", symbol: "currency symbol e.g. '$'" } },
  { type: "percent", category: "numeric", description: "Percentage field", optionsSchema: { precision: "integer 0-8" } },
  { type: "rating", category: "numeric", description: "Rating (1-N stars or icons)", optionsSchema: { max: "integer 1-10", icon: "star|heart|thumbsUp|flag|dot", color: "color name" } },
  { type: "duration", category: "numeric", description: "Duration field (hh:mm, hh:mm:ss, etc.)", optionsSchema: { durationFormat: "h:mm | h:mm:ss | h:mm:ss.S | h:mm:ss.SS | h:mm:ss.SSS" } },
  { type: "autoNumber", category: "numeric", description: "Auto-incrementing integer ID (read-only after creation)", optionsSchema: null },
  // Date / Time
  { type: "date", category: "date", description: "Date picker (no time)", optionsSchema: { dateFormat: { name: "local|friendly|us|european|iso", format: "M/D/YYYY etc." } } },
  { type: "dateTime", category: "date", description: "Date and time picker", optionsSchema: { dateFormat: { name: "local|friendly|us|european|iso" }, timeFormat: { name: "12hour|24hour" }, timeZone: "IANA timezone or 'utc'" } },
  { type: "createdTime", category: "date", description: "Record creation timestamp (system, read-only)", optionsSchema: { dateFormat: { name: "local|friendly|us|european|iso" }, timeFormat: { name: "12hour|24hour" }, timeZone: "IANA timezone" } },
  { type: "lastModifiedTime", category: "date", description: "Last modification timestamp for specified fields", optionsSchema: { referencedFieldIds: "array of field IDs to watch", dateFormat: {}, timeFormat: {}, timeZone: "IANA timezone" } },
  // Select
  { type: "singleSelect", category: "select", description: "Single-choice dropdown", optionsSchema: { choices: "[{ name: string, color?: string }]" } },
  { type: "multipleSelects", category: "select", description: "Multi-choice checkboxes", optionsSchema: { choices: "[{ name: string, color?: string }]" } },
  // Relational
  { type: "multipleRecordLinks", category: "relational", description: "Linked record field (links to another table)", optionsSchema: { linkedTableId: "tblXXX", isReversed: "boolean (read-only)", prefersSingleRecordLink: "boolean" } },
  { type: "lookup", category: "relational", description: "Lookup values from linked records (auto-created with links)", optionsSchema: { recordLinkFieldId: "fldXXX", fieldIdInLinkedTable: "fldXXX" } },
  { type: "rollup", category: "relational", description: "Aggregated values from linked records", optionsSchema: { recordLinkFieldId: "fldXXX", fieldIdInLinkedTable: "fldXXX", referencedFieldIds: "array", options: { rollupFunction: "SUM|COUNT|etc." } } },
  // Special
  { type: "formula", category: "special", description: "Computed field using Airtable formula", optionsSchema: { formula: "formula expression string" } },
  { type: "checkbox", category: "special", description: "Boolean checkbox field", optionsSchema: { icon: "check|star|heart|thumbsUp|flag|dot", color: "color name" } },
  { type: "multipleAttachments", category: "special", description: "File attachment field (multiple files)", optionsSchema: { isReversed: "boolean" } },
  { type: "multipleCollaborators", category: "special", description: "Multi-user collaborator field", optionsSchema: null },
  { type: "singleCollaborator", category: "special", description: "Single-user collaborator field", optionsSchema: null },
  { type: "createdBy", category: "special", description: "User who created the record (system, read-only)", optionsSchema: null },
  { type: "lastModifiedBy", category: "special", description: "User who last modified the record (system, read-only)", optionsSchema: null },
  { type: "button", category: "special", description: "Button field that triggers URLs or automations", optionsSchema: { label: "string", style: "{ element: string }" } },
  { type: "barcode", category: "special", description: "Barcode scanning field", optionsSchema: null },
  { type: "aiText", category: "special", description: "AI-generated text field", optionsSchema: { prompt: "string" } },
  { type: "externalSyncSource", category: "special", description: "Synced from external source (read-only)", optionsSchema: null },
];

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
    // ── Round 2 additions ──
    {
      name: "list_field_types",
      title: "List Field Types",
      description:
        "Returns a comprehensive reference of all supported Airtable field types with their categories, descriptions, and options schema. Useful when creating fields — shows what options each field type accepts. Categories: text, numeric, date, select, relational, special.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Filter by category: all, text, numeric, date, select, relational, special (default: all)" },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          fieldTypes: { type: "array", items: { type: "object" } },
          totalCount: { type: "number" },
        },
        required: ["fieldTypes", "totalCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_select_field",
      title: "Create Select Field",
      description:
        "Shortcut to create a singleSelect or multipleSelects field with predefined choices in one call. Equivalent to create_field with type='singleSelect' and choices pre-populated. Specify choice names and optional colors. Returns the created field with choice IDs.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name" },
          type: { type: "string", description: "'singleSelect' or 'multipleSelects'" },
          choices: { type: "array", items: { type: "object" }, description: "Choices: [{name:'Active',color:'greenBright'},{name:'Inactive',color:'redBright'}]" },
          description: { type: "string", description: "Field description (optional)" },
        },
        required: ["base_id", "table_id", "name", "type"],
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, options: { type: "object" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "add_select_option",
      title: "Add Select Option",
      description:
        "Add a new choice option to an existing singleSelect or multipleSelects field. Fetches the current choices and appends the new one. Preserves all existing choices — non-destructive. Optionally specify a color for the new option. Returns the updated field with all choices.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_id: { type: "string", description: "Field ID (starts with 'fld') of the select field" },
          name: { type: "string", description: "New option name" },
          color: { type: "string", description: "Option color (e.g., 'blueBright', 'greenBright', 'redBright', 'yellowBright', 'purpleBright')" },
        },
        required: ["base_id", "table_id", "field_id", "name"],
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, options: { type: "object" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_formula_field",
      title: "Create Formula Field",
      description:
        "Shortcut to create a formula field with a specified expression. Formula fields compute their value automatically from other fields. Example formulas: CONCATENATE({First Name},' ',{Last Name}), IF({Score}>80,'Pass','Fail'), DATEADD({Start Date},30,'days'), {Revenue}-{Cost}. Returns the created field.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name" },
          formula: { type: "string", description: "Airtable formula. Example: CONCATENATE({First Name},' ',{Last Name})" },
          description: { type: "string", description: "Field description (optional)" },
        },
        required: ["base_id", "table_id", "name", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, options: { type: "object" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_rollup_field",
      title: "Create Rollup Field",
      description:
        "Create a rollup field that aggregates values from linked records. Requires an existing linked record field and a field in the linked table to aggregate. Aggregation functions: SUM, COUNT, COUNTA, AVERAGE, MIN, MAX, CONCATENATE, ARRAYJOIN, ARRAYUNIQUE. Example: sum all Invoice.Amount values linked to a Client record.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') where the rollup field will be created" },
          name: { type: "string", description: "Field name for the rollup" },
          linked_field_id: { type: "string", description: "Field ID (starts with 'fld') of the linked record field to roll up from" },
          lookup_field_id: { type: "string", description: "Field ID (starts with 'fld') in the linked table to aggregate" },
          rollup_function: { type: "string", description: "Aggregation: SUM, COUNT, COUNTA, AVERAGE, MIN, MAX, CONCATENATE, ARRAYJOIN, ARRAYUNIQUE, ARRAYCOMPACT, AND, OR" },
          description: { type: "string", description: "Field description (optional)" },
        },
        required: ["base_id", "table_id", "name", "linked_field_id", "lookup_field_id", "rollup_function"],
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, options: { type: "object" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_linked_field",
      title: "Create Linked Record Field",
      description:
        "Create a linked record field (multipleRecordLinks) that connects records in one table to records in another. Optionally restrict to single-record linking. When you create a linked field, Airtable automatically creates the reciprocal linked field in the target table. Returns the created field with linked table details.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') where the linked field will be created" },
          name: { type: "string", description: "Field name" },
          linked_table_id: { type: "string", description: "Table ID (starts with 'tbl') of the table to link to" },
          is_single_record_link: { type: "boolean", description: "Restrict to linking one record only (default: false)" },
          description: { type: "string", description: "Field description (optional)" },
        },
        required: ["base_id", "table_id", "name", "linked_table_id"],
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, options: { type: "object" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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

    // ── Round 2 handlers ──

    list_field_types: async (args) => {
      const { category } = ListFieldTypesSchema.parse(args);

      const filtered = category === "all"
        ? FIELD_TYPES
        : FIELD_TYPES.filter((f) => f.category === category);

      const response = {
        fieldTypes: filtered,
        totalCount: filtered.length,
        categories: ["text", "numeric", "date", "select", "relational", "special"],
        note: "Use the 'type' value when calling create_field. Options listed in optionsSchema are passed in the 'options' parameter.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    create_select_field: async (args) => {
      const { base_id, table_id, name, type, choices, description } = CreateSelectFieldSchema.parse(args);

      const body: Record<string, unknown> = {
        name,
        type,
        options: { choices: choices ?? [] },
      };
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.create_select_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_select_field", base_id, table_id, name, type });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    add_select_option: async (args) => {
      const { base_id, table_id, field_id, name, color } = AddSelectOptionSchema.parse(args);

      // First, fetch the current field to get existing choices
      const tablesResult = await logger.time("tool.add_select_option.fetch", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "add_select_option.fetch", base_id, table_id });

      const tablesRaw = tablesResult as { tables?: Array<{ id: string; fields?: Array<{ id: string; type: string; options?: { choices?: unknown[] } }> }> };
      const table = (tablesRaw.tables ?? []).find((t) => t.id === table_id);
      if (!table) throw new Error(`Table '${table_id}' not found`);

      const field = (table.fields ?? []).find((f) => f.id === field_id);
      if (!field) throw new Error(`Field '${field_id}' not found in table '${table_id}'`);
      if (field.type !== "singleSelect" && field.type !== "multipleSelects") {
        throw new Error(`Field '${field_id}' is type '${field.type}', not singleSelect or multipleSelects`);
      }

      const existingChoices = field.options?.choices ?? [];
      const newChoice: Record<string, unknown> = { name };
      if (color) newChoice.color = color;

      const updatedChoices = [...existingChoices, newChoice];

      const result = await logger.time("tool.add_select_option", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, { options: { choices: updatedChoices } })
      , { tool: "add_select_option", base_id, table_id, field_id, newOption: name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_formula_field: async (args) => {
      const { base_id, table_id, name, formula, description } = CreateFormulaFieldSchema.parse(args);

      const body: Record<string, unknown> = {
        name,
        type: "formula",
        options: { formula },
      };
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.create_formula_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_formula_field", base_id, table_id, name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_rollup_field: async (args) => {
      const { base_id, table_id, name, linked_field_id, lookup_field_id, rollup_function, description } =
        CreateRollupFieldSchema.parse(args);

      const body: Record<string, unknown> = {
        name,
        type: "rollup",
        options: {
          recordLinkFieldId: linked_field_id,
          fieldIdInLinkedTable: lookup_field_id,
          referencedFieldIds: [lookup_field_id],
          options: { rollupFunction: rollup_function },
        },
      };
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.create_rollup_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_rollup_field", base_id, table_id, name, rollup_function });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_linked_field: async (args) => {
      const { base_id, table_id, name, linked_table_id, is_single_record_link, description } =
        CreateLinkedFieldSchema.parse(args);

      const body: Record<string, unknown> = {
        name,
        type: "multipleRecordLinks",
        options: {
          linkedTableId: linked_table_id,
          ...(is_single_record_link !== undefined ? { prefersSingleRecordLink: is_single_record_link } : {}),
        },
      };
      if (description !== undefined) body.description = description;

      const result = await logger.time("tool.create_linked_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_linked_field", base_id, table_id, name, linked_table_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
