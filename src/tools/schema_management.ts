// Airtable Schema Management tools: bulk_create_fields, get_field_by_name,
//   find_tables_with_field, get_linked_tables, get_table_stats,
//   copy_table_structure, update_field_options, rename_field,
//   get_base_field_names, validate_field_name
// Uses Airtable Metadata API
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BulkCreateFieldsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  fields: z.array(z.object({
    name: z.string().describe("Field name"),
    type: z.string().describe("Field type (e.g., singleLineText, number, email, checkbox, singleSelect, etc.)"),
    description: z.string().optional().describe("Field description"),
    options: z.record(z.unknown()).optional().describe("Type-specific options"),
  })).min(1).describe("Array of fields to create. Each must have name and type."),
});

const GetFieldByNameSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_name: z.string().describe("Field name to look up (case-insensitive search)"),
});

const FindTablesWithFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  field_name: z.string().optional().describe("Field name to search for (case-insensitive). Returns tables that have a field with this name."),
  field_type: z.string().optional().describe("Field type to filter by. Returns tables that have at least one field of this type (e.g., singleSelect, multipleRecordLinks, formula)."),
});

const GetLinkedTablesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') to find linked tables for"),
});

const GetTableStatsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
});

const CopyTableStructureSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  source_table_id: z.string().describe("Source table ID (starts with 'tbl') to copy structure from"),
  new_table_name: z.string().describe("Name for the new table with copied structure"),
  include_field_types: z.array(z.string()).optional()
    .describe("Only include fields of these types (e.g., ['singleLineText','number']). Omit to include all non-computed fields."),
  exclude_computed_fields: z.boolean().optional().default(true)
    .describe("If true (default), skip formula/rollup/lookup/computed fields which would fail to copy"),
});

const RenameFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_id_or_name: z.string().describe("Field ID (starts with 'fld') or current field name to rename"),
  new_name: z.string().describe("New field name"),
  new_description: z.string().optional().describe("Optional new description for the field"),
});

const GetBaseFieldNamesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_field_ids: z.boolean().optional().default(false).describe("Include field IDs alongside field names"),
  include_field_types: z.boolean().optional().default(false).describe("Include field type alongside field names"),
});

const ValidateSchemaCompatibilitySchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_data: z.record(z.unknown()).describe("Sample record field data to validate against the table's schema. Example: {Name:'Alice',Status:'Active',Score:95}"),
});

// Computed field types that can't be created via API
const COMPUTED_FIELD_TYPES = new Set([
  "formula", "rollup", "lookup", "multipleLookupValues", "count",
  "autoNumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy",
  "externalSyncSource", "button",
]);

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "bulk_create_fields",
      title: "Bulk Create Fields",
      description:
        "Create multiple fields in a table in a single operation. Fields are created sequentially. Returns all created fields with their assigned IDs. More efficient than calling create_field/create_formula_field/create_rollup_field individually for initial setup.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
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
            description: "Fields to create. Each needs name and type.",
          },
        },
        required: ["base_id", "table_id", "fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          createdFields: { type: "array", items: { type: "object" } },
          createdCount: { type: "number" },
          errors: { type: "array", items: { type: "object" } },
        },
        required: ["createdFields", "createdCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_field_by_name",
      title: "Get Field by Name",
      description:
        "Look up a specific field in a table by its name. Returns the full field definition including ID, type, and options. Case-insensitive search. Use when you know the field name but need its ID for other operations.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_name: { type: "string", description: "Field name to search for (case-insensitive)" },
        },
        required: ["base_id", "table_id", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          options: { type: "object" },
          found: { type: "boolean" },
        },
        required: ["found"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_tables_with_field",
      title: "Find Tables With Field",
      description:
        "Search all tables in a base for those that contain a specific field name or field type. Returns matching tables with field details. Use for schema audits, finding relationships, or locating where a field is used.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          field_name: { type: "string", description: "Field name to search for (case-insensitive)" },
          field_type: { type: "string", description: "Field type to filter by (e.g., singleSelect, multipleRecordLinks)" },
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
                tableId: { type: "string" },
                tableName: { type: "string" },
                matchingFields: { type: "array", items: { type: "object" } },
              },
            },
          },
          matchCount: { type: "number" },
          searchedTables: { type: "number" },
        },
        required: ["tables", "matchCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_linked_tables",
      title: "Get Linked Tables",
      description:
        "Find all tables that a given table is linked to via multipleRecordLinks fields. Returns the linked table IDs and names, the linking field names, and whether the link is bidirectional. Use to understand a base's relational structure.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') to find links for" },
        },
        required: ["base_id", "table_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sourceTableId: { type: "string" },
          sourceTableName: { type: "string" },
          links: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fieldId: { type: "string" },
                fieldName: { type: "string" },
                linkedTableId: { type: "string" },
                linkedTableName: { type: "string" },
                isReversed: { type: "boolean" },
                prefersSingleRecordLink: { type: "boolean" },
              },
            },
          },
          linkCount: { type: "number" },
        },
        required: ["links", "linkCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_table_stats",
      title: "Get Table Stats",
      description:
        "Get a statistical summary of a table's schema: total fields, breakdown by field type, computed vs editable fields, primary field info, and view count. Useful for schema documentation and understanding table complexity.",
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
          tableId: { type: "string" },
          tableName: { type: "string" },
          primaryFieldId: { type: "string" },
          primaryFieldName: { type: "string" },
          fieldCount: { type: "number" },
          computedFieldCount: { type: "number" },
          editableFieldCount: { type: "number" },
          fieldsByType: { type: "object" },
          viewCount: { type: "number" },
          viewsByType: { type: "object" },
        },
        required: ["tableId", "fieldCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "copy_table_structure",
      title: "Copy Table Structure",
      description:
        "Create a new empty table in the same base by copying the field structure from an existing table. Computed fields (formula, rollup, lookup, auto-number) are excluded by default since they require manual reconfiguration. Use for creating template-based tables.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          source_table_id: { type: "string", description: "Table ID (starts with 'tbl') to copy structure from" },
          new_table_name: { type: "string", description: "Name for the new table" },
          include_field_types: {
            type: "array",
            items: { type: "string" },
            description: "Only include fields of these types. Omit for all non-computed fields.",
          },
          exclude_computed_fields: { type: "boolean", description: "Skip computed fields (default: true)" },
        },
        required: ["base_id", "source_table_id", "new_table_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          newTableId: { type: "string" },
          newTableName: { type: "string" },
          fieldsCreated: { type: "number" },
          fieldsSkipped: { type: "number" },
          skippedFields: { type: "array", items: { type: "object" } },
        },
        required: ["newTableId", "fieldsCreated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "rename_field",
      title: "Rename Field",
      description:
        "Rename a field in a table. Can also optionally update the field's description at the same time. Look up the field by ID or by current name. Returns the updated field definition.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          field_id_or_name: { type: "string", description: "Current field ID (starts with 'fld') or field name" },
          new_name: { type: "string", description: "New field name" },
          new_description: { type: "string", description: "Optional new field description" },
        },
        required: ["base_id", "table_id", "field_id_or_name", "new_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          previousName: { type: "string" },
        },
        required: ["id", "name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_base_field_names",
      title: "Get Base Field Names",
      description:
        "Get a complete map of all field names across all tables in a base. Returns a nested object: table name → list of field names. Useful for data mapping, building form schemas, or understanding what fields are available.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_field_ids: { type: "boolean", description: "Include field IDs alongside names (default: false)" },
          include_field_types: { type: "boolean", description: "Include field types alongside names (default: false)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          fieldsByTable: { type: "object" },
          tableCount: { type: "number" },
          totalFieldCount: { type: "number" },
        },
        required: ["fieldsByTable"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "validate_schema_compatibility",
      title: "Validate Schema Compatibility",
      description:
        "Validate that a record's field data is compatible with a table's schema before creating/updating records. Checks field names exist, value types match, required fields are present, and select choices are valid. Returns validation results with specific errors.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_data: { type: "object", description: "Record fields to validate. Example: {Name:'Alice',Status:'Active',Score:95}" },
        },
        required: ["base_id", "table_id_or_name", "record_data"],
      },
      outputSchema: {
        type: "object",
        properties: {
          isValid: { type: "boolean" },
          validFields: { type: "array", items: { type: "string" } },
          unknownFields: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "object" } },
          errors: { type: "array", items: { type: "object" } },
          tableId: { type: "string" },
          tableName: { type: "string" },
        },
        required: ["isValid"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    bulk_create_fields: async (args) => {
      const { base_id, table_id, fields } = BulkCreateFieldsSchema.parse(args);

      const createdFields: unknown[] = [];
      const errors: Array<{ fieldName: string; error: string }> = [];

      for (const field of fields) {
        const body: Record<string, unknown> = { name: field.name, type: field.type };
        if (field.description) body.description = field.description;
        if (field.options) body.options = field.options;

        try {
          const result = await logger.time("tool.bulk_create_fields.single", () =>
            client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
          , { tool: "bulk_create_fields", base_id, fieldName: field.name });
          createdFields.push(result);
        } catch (e) {
          errors.push({ fieldName: field.name, error: e instanceof Error ? e.message : String(e) });
        }
      }

      const response = { createdFields, createdCount: createdFields.length, errors };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_field_by_name: async (args) => {
      const { base_id, table_id, field_name } = GetFieldByNameSchema.parse(args);

      const result = await logger.time("tool.get_field_by_name", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_field_by_name", base_id });

      const raw = result as { tables?: Array<{ id: string; fields: Array<{ id: string; name: string; type: string; description?: string; options?: unknown }> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        const response = { found: false, error: `Table ${table_id} not found` };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      const field = (table.fields || []).find(
        (f) => f.name.toLowerCase() === field_name.toLowerCase()
      );

      if (!field) {
        const response = { found: false, fieldName: field_name, tableId: table_id, availableFields: (table.fields || []).map((f) => f.name) };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      const response = { ...field, found: true };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    find_tables_with_field: async (args) => {
      const { base_id, field_name, field_type } = FindTablesWithFieldSchema.parse(args);

      if (!field_name && !field_type) {
        throw new Error("find_tables_with_field: provide at least field_name or field_type");
      }

      const result = await logger.time("tool.find_tables_with_field", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "find_tables_with_field", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };
      const tables = raw.tables || [];

      const matching = tables
        .map((table) => {
          const matchingFields = (table.fields || []).filter((f) => {
            const nameMatch = !field_name || f.name.toLowerCase().includes(field_name.toLowerCase());
            const typeMatch = !field_type || f.type === field_type;
            return nameMatch && typeMatch;
          });
          return { tableId: table.id, tableName: table.name, matchingFields };
        })
        .filter((t) => t.matchingFields.length > 0);

      const response = {
        tables: matching,
        matchCount: matching.reduce((sum, t) => sum + t.matchingFields.length, 0),
        searchedTables: tables.length,
        filter: { field_name, field_type },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_linked_tables: async (args) => {
      const { base_id, table_id } = GetLinkedTablesSchema.parse(args);

      const result = await logger.time("tool.get_linked_tables", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_linked_tables", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: { linkedTableId?: string; isReversed?: boolean; prefersSingleRecordLink?: boolean } }> }> };
      const tables = raw.tables || [];

      const tableMap = new Map(tables.map((t) => [t.id, t.name]));
      const sourceTable = tables.find((t) => t.id === table_id);

      if (!sourceTable) {
        throw new Error(`Table ${table_id} not found in base`);
      }

      const links = (sourceTable.fields || [])
        .filter((f) => f.type === "multipleRecordLinks")
        .map((f) => ({
          fieldId: f.id,
          fieldName: f.name,
          linkedTableId: f.options?.linkedTableId || null,
          linkedTableName: f.options?.linkedTableId ? (tableMap.get(f.options.linkedTableId) || null) : null,
          isReversed: f.options?.isReversed || false,
          prefersSingleRecordLink: f.options?.prefersSingleRecordLink || false,
        }));

      const response = {
        sourceTableId: table_id,
        sourceTableName: sourceTable.name,
        links,
        linkCount: links.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_table_stats: async (args) => {
      const { base_id, table_id } = GetTableStatsSchema.parse(args);

      const result = await logger.time("tool.get_table_stats", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_table_stats", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; primaryFieldId: string; fields: Array<{ id: string; name: string; type: string }>; views?: Array<{ id: string; type: string }> }> };
      const table = (raw.tables || []).find((t) => t.id === table_id);

      if (!table) {
        throw new Error(`Table ${table_id} not found in base`);
      }

      const fields = table.fields || [];
      const fieldsByType: Record<string, number> = {};
      let computedFieldCount = 0;
      let editableFieldCount = 0;

      for (const field of fields) {
        fieldsByType[field.type] = (fieldsByType[field.type] || 0) + 1;
        if (COMPUTED_FIELD_TYPES.has(field.type)) {
          computedFieldCount++;
        } else {
          editableFieldCount++;
        }
      }

      const views = table.views || [];
      const viewsByType: Record<string, number> = {};
      for (const view of views) {
        viewsByType[view.type] = (viewsByType[view.type] || 0) + 1;
      }

      const primaryField = fields.find((f) => f.id === table.primaryFieldId);

      const response = {
        tableId: table.id,
        tableName: table.name,
        primaryFieldId: table.primaryFieldId,
        primaryFieldName: primaryField?.name || null,
        fieldCount: fields.length,
        computedFieldCount,
        editableFieldCount,
        fieldsByType,
        viewCount: views.length,
        viewsByType,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    copy_table_structure: async (args) => {
      const { base_id, source_table_id, new_table_name, include_field_types, exclude_computed_fields } = CopyTableStructureSchema.parse(args);

      // Fetch source table schema
      const result = await logger.time("tool.copy_table_structure.fetch", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "copy_table_structure", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; primaryFieldId: string; fields: Array<{ id: string; name: string; type: string; description?: string; options?: unknown }> }> };
      const sourceTable = (raw.tables || []).find((t) => t.id === source_table_id);

      if (!sourceTable) {
        throw new Error(`Source table ${source_table_id} not found`);
      }

      // Filter fields
      const skipComputed = exclude_computed_fields !== false;
      const skippedFields: Array<{ name: string; type: string; reason: string }> = [];
      const fieldsToCreate = (sourceTable.fields || []).filter((f) => {
        // Always skip primary field (will be created automatically)
        if (f.id === sourceTable.primaryFieldId) {
          return false;
        }
        if (skipComputed && COMPUTED_FIELD_TYPES.has(f.type)) {
          skippedFields.push({ name: f.name, type: f.type, reason: "computed field" });
          return false;
        }
        if (include_field_types && !include_field_types.includes(f.type)) {
          skippedFields.push({ name: f.name, type: f.type, reason: "type not in include_field_types" });
          return false;
        }
        return true;
      });

      // Create new table
      const primaryField = sourceTable.fields.find((f) => f.id === sourceTable.primaryFieldId);
      const tableBody = {
        name: new_table_name,
        fields: [
          { name: primaryField?.name || "Name", type: primaryField?.type || "singleLineText" },
          ...fieldsToCreate.map((f) => {
            const fieldBody: Record<string, unknown> = { name: f.name, type: f.type };
            if (f.description) fieldBody.description = f.description;
            if (f.options) fieldBody.options = f.options;
            return fieldBody;
          }),
        ],
      };

      const newTable = await logger.time("tool.copy_table_structure.create", () =>
        client.post(`/v0/meta/bases/${base_id}/tables`, tableBody)
      , { tool: "copy_table_structure", base_id });

      const raw2 = newTable as { id?: string; name?: string };
      const response = {
        newTableId: raw2.id || null,
        newTableName: new_table_name,
        fieldsCreated: fieldsToCreate.length,
        fieldsSkipped: skippedFields.length,
        skippedFields,
        sourceTableId: source_table_id,
        sourceTableName: sourceTable.name,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    rename_field: async (args) => {
      const { base_id, table_id, field_id_or_name, new_name, new_description } = RenameFieldSchema.parse(args);

      let field_id = field_id_or_name;
      let previousName = field_id_or_name;

      // If not a field ID, look it up by name
      if (!field_id_or_name.startsWith("fld")) {
        const result = await logger.time("tool.rename_field.lookup", () =>
          client.get(`/v0/meta/bases/${base_id}/tables`)
        , { tool: "rename_field", base_id });

        const raw = result as { tables?: Array<{ id: string; fields: Array<{ id: string; name: string }> }> };
        const table = (raw.tables || []).find((t) => t.id === table_id);
        const field = (table?.fields || []).find(
          (f) => f.name.toLowerCase() === field_id_or_name.toLowerCase()
        );

        if (!field) {
          throw new Error(`Field "${field_id_or_name}" not found in table ${table_id}`);
        }
        field_id = field.id;
        previousName = field.name;
      }

      const body: Record<string, unknown> = { name: new_name };
      if (new_description !== undefined) body.description = new_description;

      const updated = await logger.time("tool.rename_field.update", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, body)
      , { tool: "rename_field", base_id, field_id });

      const response = { ...((updated as Record<string, unknown>) || {}), previousName };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_base_field_names: async (args) => {
      const { base_id, include_field_ids, include_field_types } = GetBaseFieldNamesSchema.parse(args);

      const result = await logger.time("tool.get_base_field_names", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_base_field_names", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };
      const tables = raw.tables || [];

      const fieldsByTable: Record<string, unknown> = {};
      let totalFieldCount = 0;

      for (const table of tables) {
        const fields = (table.fields || []).map((f) => {
          if (include_field_ids && include_field_types) {
            return { name: f.name, id: f.id, type: f.type };
          } else if (include_field_ids) {
            return { name: f.name, id: f.id };
          } else if (include_field_types) {
            return { name: f.name, type: f.type };
          } else {
            return f.name;
          }
        });
        fieldsByTable[table.name] = fields;
        totalFieldCount += fields.length;
      }

      const response = {
        fieldsByTable,
        tableCount: tables.length,
        totalFieldCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    validate_schema_compatibility: async (args) => {
      const { base_id, table_id_or_name, record_data } = ValidateSchemaCompatibilitySchema.parse(args);

      const result = await logger.time("tool.validate_schema_compatibility", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "validate_schema_compatibility", base_id });

      const raw = result as { tables?: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }> };

      // Find table by ID or name
      const table = (raw.tables || []).find(
        (t) => t.id === table_id_or_name || t.name.toLowerCase() === table_id_or_name.toLowerCase()
      );

      if (!table) {
        throw new Error(`Table "${table_id_or_name}" not found in base`);
      }

      const fieldMap = new Map(table.fields.map((f) => [f.name.toLowerCase(), f]));
      const fieldKeys = Object.keys(record_data);

      const validFields: string[] = [];
      const unknownFields: string[] = [];
      const warnings: Array<{ field: string; message: string }> = [];
      const errors: Array<{ field: string; message: string }> = [];

      for (const key of fieldKeys) {
        const field = fieldMap.get(key.toLowerCase());
        if (!field) {
          unknownFields.push(key);
        } else {
          validFields.push(key);
          const val = record_data[key];

          // Type-specific validation
          if (field.type === "number" || field.type === "currency" || field.type === "percent" || field.type === "rating" || field.type === "duration") {
            if (val !== null && val !== undefined && typeof val !== "number") {
              warnings.push({ field: key, message: `Field type is ${field.type} but value is ${typeof val}. Use typecast=true to auto-convert.` });
            }
          } else if (field.type === "checkbox") {
            if (val !== null && val !== undefined && typeof val !== "boolean") {
              warnings.push({ field: key, message: `Checkbox field expects boolean (true/false), got ${typeof val}` });
            }
          } else if (field.type === "singleSelect" || field.type === "multipleSelects") {
            const choices = (field.options?.choices as Array<{ name: string }> || []);
            if (choices.length > 0) {
              const choiceNames = new Set(choices.map((c) => c.name));
              const testVals = field.type === "multipleSelects" ? (Array.isArray(val) ? val : [val]) : [val];
              for (const v of testVals) {
                if (v !== null && v !== undefined && !choiceNames.has(String(v))) {
                  warnings.push({ field: key, message: `"${v}" is not a recognized choice. Valid: ${choices.map((c) => c.name).join(", ")}. Use typecast=true to auto-create.` });
                }
              }
            }
          } else if (COMPUTED_FIELD_TYPES.has(field.type)) {
            errors.push({ field: key, message: `Field "${key}" is a computed ${field.type} field and cannot be written to` });
          }
        }
      }

      const response = {
        isValid: errors.length === 0 && unknownFields.length === 0,
        validFields,
        unknownFields,
        warnings,
        errors,
        tableId: table.id,
        tableName: table.name,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
