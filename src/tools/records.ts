// Airtable Record tools: list_records, get_record, create_record, create_records,
//   update_record, update_records, delete_record, search_records
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  fields: z.array(z.string()).optional().describe("Field names to return (default: all fields)"),
  filter_by_formula: z.string().optional().describe("Airtable formula to filter records. Example: AND({Status}='Active',{Priority}='High')"),
  max_records: z.number().min(1).max(100).optional().describe("Maximum records to return (default: all, max 100 per page)"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100, default 100)"),
  offset: z.string().optional().describe("Pagination offset from previous response"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort array. Example: [{field:'Name',direction:'asc'}]"),
  view: z.string().optional().describe("View name or ID to use for filtering/sorting"),
  cell_format: z.enum(["json", "string"]).optional().default("json").describe("Cell format: json (default) or string"),
  time_zone: z.string().optional().describe("IANA time zone for date formatting (e.g., 'America/New_York')"),
  user_locale: z.string().optional().describe("User locale for number/date formatting (e.g., 'en-us')"),
});

const GetRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
});

const CreateRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  fields: z.record(z.unknown()).describe("Field values to set. Example: {Name:'Alice',Status:'Active',Score:95}"),
  typecast: z.boolean().optional().describe("If true, Airtable will attempt to convert string values to the correct field type"),
  return_fields_by_field_id: z.boolean().optional().describe("Return field IDs instead of names"),
});

const CreateRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({ fields: z.record(z.unknown()) })).min(1).max(10).describe("Array of records to create (max 10). Each: {fields:{Name:'Alice',Status:'Active'}}"),
  typecast: z.boolean().optional().describe("Attempt type coercion for string values"),
  return_fields_by_field_id: z.boolean().optional(),
});

const UpdateRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID to update"),
  fields: z.record(z.unknown()).describe("Fields to update (PATCH — only specified fields are changed)"),
  typecast: z.boolean().optional().describe("Attempt type coercion for string values"),
});

const UpdateRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({
    id: z.string(),
    fields: z.record(z.unknown()),
  })).min(1).max(10).describe("Array of records to update (max 10). Each: {id:'recXXX',fields:{Status:'Done'}}"),
  typecast: z.boolean().optional(),
});

const DeleteRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID to delete"),
});

const SearchRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  formula: z.string().describe("Airtable formula to filter records. Example: SEARCH('Alice',{Name})>0 or {Email}='user@example.com'"),
  fields: z.array(z.string()).optional().describe("Field names to return"),
  max_records: z.number().min(1).max(100).optional().describe("Maximum records to return"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort results"),
  view: z.string().optional().describe("View name or ID"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_records",
      title: "List Records",
      description:
        "List records from an Airtable table with optional field selection, filtering, and sorting. Returns records with their fields and values. Supports offset pagination. Use when browsing or exporting records. For keyword search, use search_records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          fields: { type: "array", items: { type: "string" }, description: "Field names to return (default: all)" },
          filter_by_formula: { type: "string", description: "Airtable formula to filter. Example: {Status}='Active'" },
          max_records: { type: "number", description: "Max records to return (1-100)" },
          page_size: { type: "number", description: "Records per page (1-100, default 100)" },
          offset: { type: "string", description: "Pagination offset from previous response" },
          sort: { type: "array", items: { type: "object" }, description: "Sort: [{field:'Name',direction:'asc'}]" },
          view: { type: "string", description: "View name or ID to apply" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record",
      title: "Get Record",
      description:
        "Get a single Airtable record by ID. Returns all field values. Use when you have a specific record ID and need its full data.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdTime: { type: "string" },
          fields: { type: "object" },
        },
        required: ["id", "fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_record",
      title: "Create Record",
      description:
        "Create a single new record in an Airtable table. Returns the created record with its assigned ID. Use when creating one entry. For multiple records, use create_records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          fields: { type: "object", description: "Field values: {Name:'Alice',Status:'Active',Score:95}" },
          typecast: { type: "boolean", description: "Auto-convert string values to correct types" },
        },
        required: ["base_id", "table_id_or_name", "fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdTime: { type: "string" },
          fields: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_records",
      title: "Bulk Create Records",
      description:
        "Create up to 10 records in a single Airtable API call. More efficient than calling create_record multiple times. Returns all created records with IDs.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: { type: "array", items: { type: "object" }, description: "Array of up to 10 records: [{fields:{Name:'Alice'}},{fields:{Name:'Bob'}}]" },
          typecast: { type: "boolean", description: "Auto-convert string values to correct types" },
        },
        required: ["base_id", "table_id_or_name", "records"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_record",
      title: "Update Record",
      description:
        "Update specific fields of an Airtable record (PATCH — unspecified fields unchanged). Returns updated record. Use for single record updates. For multiple, use update_records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID to update" },
          fields: { type: "object", description: "Fields to update (only specified fields change)" },
          typecast: { type: "boolean", description: "Auto-convert string values" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          fields: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_records",
      title: "Bulk Update Records",
      description:
        "Update up to 10 records in a single call (PATCH — unspecified fields unchanged). More efficient than multiple update_record calls. Each record needs its ID and fields to update.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: { type: "array", items: { type: "object" }, description: "Array of up to 10: [{id:'recXXX',fields:{Status:'Done'}}]" },
          typecast: { type: "boolean" },
        },
        required: ["base_id", "table_id_or_name", "records"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_record",
      title: "Delete Record",
      description:
        "Permanently delete an Airtable record by ID. Cannot be undone. Use only when user explicitly requests deletion.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID to delete" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "boolean" },
          id: { type: "string" },
        },
        required: ["deleted", "id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "search_records",
      title: "Search Records",
      description:
        "Search records using an Airtable formula. Useful for finding records by field values. Formula examples: SEARCH('Alice',{Name})>0 or {Email}='user@example.com' or AND({Status}='Active',{Score}>80). Returns matching records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          formula: { type: "string", description: "Airtable formula. Examples: {Status}='Active', AND({Score}>80,{Status}='Active'), SEARCH('Alice',{Name})>0" },
          fields: { type: "array", items: { type: "string" }, description: "Field names to return" },
          max_records: { type: "number", description: "Max records to return" },
          sort: { type: "array", items: { type: "object" }, description: "Sort results: [{field:'Score',direction:'desc'}]" },
          view: { type: "string", description: "View name or ID" },
        },
        required: ["base_id", "table_id_or_name", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_records: async (args) => {
      const params = ListRecordsSchema.parse(args);
      const queryParams = new URLSearchParams();
      queryParams.set("pageSize", String(params.page_size));
      if (params.filter_by_formula) queryParams.set("filterByFormula", params.filter_by_formula);
      if (params.max_records) queryParams.set("maxRecords", String(params.max_records));
      if (params.offset) queryParams.set("offset", params.offset);
      if (params.view) queryParams.set("view", params.view);
      if (params.cell_format) queryParams.set("cellFormat", params.cell_format);
      if (params.time_zone) queryParams.set("timeZone", params.time_zone);
      if (params.user_locale) queryParams.set("userLocale", params.user_locale);
      if (params.fields) {
        params.fields.forEach((f) => queryParams.append("fields[]", f));
      }
      if (params.sort) {
        params.sort.forEach((s, i) => {
          queryParams.set(`sort[${i}][field]`, s.field);
          if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
        });
      }

      const result = await logger.time("tool.list_records", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${queryParams}`)
      , { tool: "list_records", base_id: params.base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_record: async (args) => {
      const { base_id, table_id_or_name, record_id } = GetRecordSchema.parse(args);
      const result = await logger.time("tool.get_record", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
      , { tool: "get_record", base_id, record_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_record: async (args) => {
      const { base_id, table_id_or_name, fields, typecast } = CreateRecordSchema.parse(args);
      const body: Record<string, unknown> = { fields };
      if (typecast !== undefined) body.typecast = typecast;

      const result = await logger.time("tool.create_record", () =>
        client.post(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
      , { tool: "create_record", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_records: async (args) => {
      const { base_id, table_id_or_name, records, typecast } = CreateRecordsSchema.parse(args);
      if (records.length > 10) {
        throw new Error("create_records: maximum 10 records per call");
      }
      const body: Record<string, unknown> = { records };
      if (typecast !== undefined) body.typecast = typecast;

      const result = await logger.time("tool.create_records", () =>
        client.post(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
      , { tool: "create_records", base_id, count: records.length });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_record: async (args) => {
      const { base_id, table_id_or_name, record_id, fields, typecast } = UpdateRecordSchema.parse(args);
      const body: Record<string, unknown> = { fields };
      if (typecast !== undefined) body.typecast = typecast;

      const result = await logger.time("tool.update_record", () =>
        client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`, body)
      , { tool: "update_record", base_id, record_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_records: async (args) => {
      const { base_id, table_id_or_name, records, typecast } = UpdateRecordsSchema.parse(args);
      if (records.length > 10) {
        throw new Error("update_records: maximum 10 records per call");
      }
      const body: Record<string, unknown> = { records };
      if (typecast !== undefined) body.typecast = typecast;

      const result = await logger.time("tool.update_records", () =>
        client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
      , { tool: "update_records", base_id, count: records.length });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_record: async (args) => {
      const { base_id, table_id_or_name, record_id } = DeleteRecordSchema.parse(args);

      const result = await logger.time("tool.delete_record", () =>
        client.delete(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
      , { tool: "delete_record", base_id, record_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    search_records: async (args) => {
      const { base_id, table_id_or_name, formula, fields, max_records, sort, view } = SearchRecordsSchema.parse(args);
      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (view) queryParams.set("view", view);
      if (fields) {
        fields.forEach((f) => queryParams.append("fields[]", f));
      }
      if (sort) {
        sort.forEach((s, i) => {
          queryParams.set(`sort[${i}][field]`, s.field);
          if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
        });
      }

      const result = await logger.time("tool.search_records", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "search_records", base_id, formula });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
