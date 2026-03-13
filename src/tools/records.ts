// Airtable Record tools: list_records, get_record, create_record, create_records,
//   update_record, update_records, delete_record, search_records,
//   bulk_create_records, bulk_update_records, bulk_delete_records,
//   get_record_with_linked, list_records_with_sort
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

const BulkCreateRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({ fields: z.record(z.unknown()) })).min(1).describe("Array of records to create. Batched automatically in groups of 10. Each: {fields:{Name:'Alice',Status:'Active'}}"),
  typecast: z.boolean().optional().describe("Attempt type coercion for string values"),
  return_fields_by_field_id: z.boolean().optional(),
});

const BulkUpdateRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({
    id: z.string(),
    fields: z.record(z.unknown()),
  })).min(1).describe("Array of records to update (PATCH). Batched automatically in groups of 10."),
  typecast: z.boolean().optional(),
});

const BulkDeleteRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_ids: z.array(z.string()).min(1).describe("Array of record IDs to delete. Batched automatically in groups of 10."),
});

const GetRecordWithLinkedSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  linked_fields: z.array(z.string()).optional().describe("Field names containing linked records to expand. Each linked record will be fetched and included."),
  linked_table_id_or_name: z.string().optional().describe("Table where linked records live (required when expanding linked fields)"),
});

const ListRecordsWithSortSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional().default("asc"),
  })).min(1).describe("Sort order. Example: [{field:'CreatedTime',direction:'desc'},{field:'Name',direction:'asc'}]"),
  fields: z.array(z.string()).optional().describe("Field names to return"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before sorting"),
  max_records: z.number().min(1).optional().describe("Maximum records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination offset from previous response"),
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
    {
      name: "bulk_create_records",
      title: "Bulk Create Records (Unlimited)",
      description:
        "Create any number of records in an Airtable table, automatically batched into groups of 10 API calls. Unlike create_records (max 10), this tool handles large datasets by splitting into batches and combining results. Returns all created records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: { type: "array", items: { type: "object" }, description: "Array of records to create (any size): [{fields:{Name:'Alice',Status:'Active'}},...]" },
          typecast: { type: "boolean", description: "Auto-convert string values to correct types" },
        },
        required: ["base_id", "table_id_or_name", "records"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          createdCount: { type: "number" },
          batchCount: { type: "number" },
        },
        required: ["records", "createdCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_update_records",
      title: "Bulk Update Records (Unlimited)",
      description:
        "Update any number of records in a single operation, automatically batched into groups of 10. Unlike update_records (max 10), this handles large update sets. Uses PATCH — only specified fields are changed. Returns all updated records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: { type: "array", items: { type: "object" }, description: "Array of {id:'recXXX',fields:{...}} to update (any size)" },
          typecast: { type: "boolean" },
        },
        required: ["base_id", "table_id_or_name", "records"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          updatedCount: { type: "number" },
          batchCount: { type: "number" },
        },
        required: ["records", "updatedCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_delete_records",
      title: "Bulk Delete Records (Unlimited)",
      description:
        "Delete any number of records by ID, automatically batched into groups of 10. Unlike delete_record (single), this handles bulk deletions. All deletions are permanent and cannot be undone. Use only when user explicitly requests deletion.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_ids: { type: "array", items: { type: "string" }, description: "Array of record IDs to delete: ['recXXX','recYYY',...]" },
        },
        required: ["base_id", "table_id_or_name", "record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "array", items: { type: "object" } },
          deletedCount: { type: "number" },
          batchCount: { type: "number" },
        },
        required: ["deleted", "deletedCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record_with_linked",
      title: "Get Record With Linked Records",
      description:
        "Fetch a record and automatically expand its linked record fields. Instead of just returning record IDs for linked fields, fetches the full data for each linked record. Useful for showing complete relational data. Specify which fields to expand via linked_fields.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          linked_fields: { type: "array", items: { type: "string" }, description: "Field names with linked records to expand" },
          linked_table_id_or_name: { type: "string", description: "Table where linked records live" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdTime: { type: "string" },
          fields: { type: "object" },
          linkedRecords: { type: "object" },
        },
        required: ["id", "fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_records_with_sort",
      title: "List Records With Sort",
      description:
        "List records from a table with mandatory multi-field sorting. Specify one or more sort fields and directions. Supports filtering, field selection, and pagination. Use when the order of results matters (e.g., latest first, alphabetical, by priority).",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          sort: { type: "array", items: { type: "object" }, description: "Sort order (required): [{field:'Date',direction:'desc'},{field:'Name',direction:'asc'}]" },
          fields: { type: "array", items: { type: "string" }, description: "Field names to return (default: all)" },
          filter_by_formula: { type: "string", description: "Optional formula filter. Example: {Status}='Active'" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100, default 100)" },
          offset: { type: "string", description: "Pagination offset from previous response" },
          view: { type: "string", description: "View name or ID" },
        },
        required: ["base_id", "table_id_or_name", "sort"],
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

    bulk_create_records: async (args) => {
      const { base_id, table_id_or_name, records, typecast } = BulkCreateRecordsSchema.parse(args);

      // Batch into groups of 10
      const BATCH_SIZE = 10;
      const allCreated: unknown[] = [];
      let batchCount = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== undefined) body.typecast = typecast;

        const result = await logger.time("tool.bulk_create_records.batch", () =>
          client.post(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
        , { tool: "bulk_create_records", base_id, batchIndex: batchCount, batchSize: batch.length });

        const batchResult = result as { records?: unknown[] };
        if (batchResult.records) {
          allCreated.push(...batchResult.records);
        }
        batchCount++;
      }

      const response = { records: allCreated, createdCount: allCreated.length, batchCount };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    bulk_update_records: async (args) => {
      const { base_id, table_id_or_name, records, typecast } = BulkUpdateRecordsSchema.parse(args);

      const BATCH_SIZE = 10;
      const allUpdated: unknown[] = [];
      let batchCount = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== undefined) body.typecast = typecast;

        const result = await logger.time("tool.bulk_update_records.batch", () =>
          client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
        , { tool: "bulk_update_records", base_id, batchIndex: batchCount, batchSize: batch.length });

        const batchResult = result as { records?: unknown[] };
        if (batchResult.records) {
          allUpdated.push(...batchResult.records);
        }
        batchCount++;
      }

      const response = { records: allUpdated, updatedCount: allUpdated.length, batchCount };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    bulk_delete_records: async (args) => {
      const { base_id, table_id_or_name, record_ids } = BulkDeleteRecordsSchema.parse(args);

      const BATCH_SIZE = 10;
      const allDeleted: unknown[] = [];
      let batchCount = 0;

      for (let i = 0; i < record_ids.length; i += BATCH_SIZE) {
        const batch = record_ids.slice(i, i + BATCH_SIZE);
        const queryParams = new URLSearchParams();
        batch.forEach((id) => queryParams.append("records[]", id));

        const result = await logger.time("tool.bulk_delete_records.batch", () =>
          client.delete(
            `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`
          )
        , { tool: "bulk_delete_records", base_id, batchIndex: batchCount, batchSize: batch.length });

        const batchResult = result as { records?: unknown[] };
        if (batchResult.records) {
          allDeleted.push(...batchResult.records);
        }
        batchCount++;
      }

      const response = { deleted: allDeleted, deletedCount: allDeleted.length, batchCount };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_record_with_linked: async (args) => {
      const { base_id, table_id_or_name, record_id, linked_fields, linked_table_id_or_name } =
        GetRecordWithLinkedSchema.parse(args);

      // Fetch the primary record
      const record = await logger.time("tool.get_record_with_linked", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
      , { tool: "get_record_with_linked", base_id, record_id });

      const primaryRecord = record as { id: string; createdTime: string; fields: Record<string, unknown> };
      const linkedRecordsMap: Record<string, unknown[]> = {};

      // Expand linked fields if requested
      if (linked_fields && linked_fields.length > 0 && linked_table_id_or_name) {
        for (const fieldName of linked_fields) {
          const linkedIds = primaryRecord.fields[fieldName];
          if (Array.isArray(linkedIds) && linkedIds.length > 0) {
            const linkedData: unknown[] = [];

            // Fetch each linked record
            for (const linkedId of linkedIds) {
              if (typeof linkedId === "string" && linkedId.startsWith("rec")) {
                try {
                  const linkedRecord = await client.get(
                    `/v0/${base_id}/${encodeURIComponent(linked_table_id_or_name)}/${linkedId}`
                  );
                  linkedData.push(linkedRecord);
                } catch {
                  linkedData.push({ id: linkedId, error: "Could not fetch linked record" });
                }
              }
            }
            linkedRecordsMap[fieldName] = linkedData;
          }
        }
      }

      const response = {
        ...primaryRecord,
        linkedRecords: linkedRecordsMap,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_records_with_sort: async (args) => {
      const { base_id, table_id_or_name, sort, fields, filter_by_formula, max_records, page_size, offset, view } =
        ListRecordsWithSortSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("pageSize", String(page_size));

      sort.forEach((s, i) => {
        queryParams.set(`sort[${i}][field]`, s.field);
        queryParams.set(`sort[${i}][direction]`, s.direction || "asc");
      });

      if (filter_by_formula) queryParams.set("filterByFormula", filter_by_formula);
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (view) queryParams.set("view", view);
      if (fields) {
        fields.forEach((f) => queryParams.append("fields[]", f));
      }

      const result = await logger.time("tool.list_records_with_sort", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "list_records_with_sort", base_id, sortFields: sort.map((s) => s.field) });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
