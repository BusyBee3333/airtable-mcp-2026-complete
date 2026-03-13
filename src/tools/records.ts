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

// ============ New Schemas (round 2) ============

const ListRecordsByViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("View ID (starts with 'viw') or view name to filter by"),
  fields: z.array(z.string()).optional().describe("Field names to return (default: all)"),
  max_records: z.number().min(1).max(100000).optional().describe("Maximum records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination offset from previous response"),
});

const ListRecordsWithFormulaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  formula: z.string().describe("Airtable filterByFormula expression. Supports any valid formula: AND({Status}='Active',{Score}>80), OR({Priority}='High',{Priority}='Critical'), NOT(BLANK({Email})), etc."),
  fields: z.array(z.string()).optional().describe("Field names to return (default: all)"),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional().describe("Sort results: [{field:'Score',direction:'desc'}]"),
  max_records: z.number().min(1).max(100000).optional().describe("Maximum records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination offset"),
});

const ListRecordsGroupedSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  group_by_field: z.string().describe("Field name to group records by (e.g., 'Status', 'Priority', 'Assignee')"),
  fields: z.array(z.string()).optional().describe("Field names to return (always includes group_by_field)"),
  filter_by_formula: z.string().optional().describe("Optional formula to pre-filter records before grouping"),
  sort_groups: z.enum(["asc", "desc", "none"]).optional().default("asc").describe("Sort group keys alphabetically (default: asc)"),
  sort_within_groups: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional().describe("Sort records within each group"),
  max_records: z.number().min(1).max(10000).optional().describe("Max records to fetch before grouping"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page while fetching"),
});

const UpsertRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({ fields: z.record(z.unknown()) })).min(1).max(10).describe("Records to upsert (max 10 per call). Each: {fields:{Name:'Alice',Email:'a@b.com'}}"),
  fields_to_merge_on: z.array(z.string()).min(1).describe("Field name(s) used as the unique key for matching existing records. Example: ['Email'] or ['First Name','Last Name']. If a record exists with the same value(s), it will be updated; otherwise a new record is created."),
  typecast: z.boolean().optional().describe("Auto-convert string values to correct types"),
  return_fields_by_field_id: z.boolean().optional().describe("Return field IDs instead of names"),
});

const ListRecordsChangedSinceSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  since_datetime: z.string().describe("ISO 8601 datetime string. Returns records modified after this time. Example: '2024-01-15T10:00:00.000Z'"),
  fields: z.array(z.string()).optional().describe("Specific field names to watch for modification (optional — if omitted, any field modification counts)"),
  return_fields: z.array(z.string()).optional().describe("Field names to return in results (default: all)"),
  max_records: z.number().min(1).max(100000).optional().describe("Max records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination offset"),
});

const LinkRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name of the source record"),
  record_id: z.string().describe("Source record ID (starts with 'rec') — the record whose linked field you are updating"),
  linked_field_name: z.string().describe("Name of the linked record field in the source table"),
  target_record_ids: z.array(z.string()).min(1).describe("Record IDs to link (starts with 'rec'). These are added to the linked field."),
  replace: z.boolean().optional().default(false).describe("If true, replaces the entire linked field with target_record_ids. If false (default), appends to existing links."),
});

const UnlinkRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name of the source record"),
  record_id: z.string().describe("Source record ID (starts with 'rec')"),
  linked_field_name: z.string().describe("Name of the linked record field"),
  target_record_ids: z.array(z.string()).min(1).describe("Record IDs to remove from the linked field"),
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
    // ── Round 2 additions ──
    {
      name: "list_records_by_view",
      title: "List Records By View",
      description:
        "Return records from a specific Airtable view. The view's built-in filters, hidden fields, and sort order are applied by Airtable automatically. Use when you need records as configured in a particular view (e.g., 'Active Projects', 'My Tasks'). Supports pagination. View can be specified by ID or name.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "View ID (starts with 'viw') or view name" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all visible in view)" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100, default 100)" },
          offset: { type: "string", description: "Pagination offset" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          view: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_records_with_formula",
      title: "List Records With Formula",
      description:
        "List records filtered by any Airtable filterByFormula expression. Provides full formula flexibility — compound conditions, date math, text functions, etc. Examples: AND({Status}='Active',{Score}>80), OR({Priority}='High',IS_BEFORE({Due Date},TODAY())), NOT(BLANK({Email})). Supports sorting and pagination.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          formula: { type: "string", description: "Airtable formula. Examples: AND({Status}='Active',{Score}>80), IS_BEFORE({Due Date},TODAY())" },
          fields: { type: "array", items: { type: "string" }, description: "Field names to return (default: all)" },
          sort: { type: "array", items: { type: "object" }, description: "Sort: [{field:'Score',direction:'desc'}]" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100)" },
          offset: { type: "string", description: "Pagination offset" },
        },
        required: ["base_id", "table_id_or_name", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          formula: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_records_grouped",
      title: "List Records Grouped",
      description:
        "Fetch records from a table and organize them into groups by a field value. Returns a map of group key → records array, plus group statistics (count, unique groups). Useful for dashboards: e.g., group Tasks by Status, group Contacts by Company, group Orders by Region. Supports pre-filtering and intra-group sorting.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          group_by_field: { type: "string", description: "Field to group by (e.g., 'Status', 'Priority', 'Category')" },
          fields: { type: "array", items: { type: "string" }, description: "Additional fields to return" },
          filter_by_formula: { type: "string", description: "Optional pre-filter formula" },
          sort_groups: { type: "string", description: "Sort group keys: 'asc', 'desc', or 'none' (default: asc)" },
          sort_within_groups: { type: "array", items: { type: "object" }, description: "Sort within each group: [{field:'Name',direction:'asc'}]" },
          max_records: { type: "number", description: "Max records to fetch before grouping" },
          page_size: { type: "number", description: "Records per page while fetching" },
        },
        required: ["base_id", "table_id_or_name", "group_by_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          groups: { type: "object" },
          groupKeys: { type: "array", items: { type: "string" } },
          groupCounts: { type: "object" },
          totalGroups: { type: "number" },
          totalRecords: { type: "number" },
          groupByField: { type: "string" },
        },
        required: ["groups", "totalGroups", "totalRecords"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "upsert_records",
      title: "Upsert Records",
      description:
        "Bulk upsert records using Airtable's native upsert feature. Matches records by one or more fields (fieldsToMergeOn) — if a matching record exists it is updated; if not, a new record is created. Max 10 records per call. Example: upsert by Email field to sync a contacts list without creating duplicates. Returns created and updated records separately.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: { type: "array", items: { type: "object" }, description: "Records to upsert (max 10): [{fields:{Email:'a@b.com',Name:'Alice'}}]" },
          fields_to_merge_on: { type: "array", items: { type: "string" }, description: "Fields used as unique key for matching: ['Email'] or ['First Name','Last Name']" },
          typecast: { type: "boolean", description: "Auto-convert string values to correct types" },
        },
        required: ["base_id", "table_id_or_name", "records", "fields_to_merge_on"],
      },
      outputSchema: {
        type: "object",
        properties: {
          createdRecords: { type: "array", items: { type: "string" } },
          updatedRecords: { type: "array", items: { type: "string" } },
          records: { type: "array", items: { type: "object" } },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_records_changed_since",
      title: "List Records Changed Since",
      description:
        "Return records that were modified after a specified datetime. Uses Airtable's LAST_MODIFIED_TIME() formula to filter records. Optionally specify which fields to watch — if omitted, any field change counts. Ideal for incremental sync, change detection, and audit trails. Returns modified records sorted newest first.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          since_datetime: { type: "string", description: "ISO 8601 datetime. Records modified after this are returned. Example: '2024-01-15T10:00:00.000Z'" },
          fields: { type: "array", items: { type: "string" }, description: "Watch specific fields for changes (optional — omit to watch all fields)" },
          return_fields: { type: "array", items: { type: "string" }, description: "Fields to return in results (default: all)" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100)" },
          offset: { type: "string", description: "Pagination offset" },
        },
        required: ["base_id", "table_id_or_name", "since_datetime"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          sinceDatetime: { type: "string" },
          formula: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "link_records",
      title: "Link Records",
      description:
        "Create a linked record relationship between two records by adding record ID(s) to a linked record field. By default appends to existing links (non-destructive). Set replace=true to overwrite the entire linked field. Use to establish relationships in relational Airtable databases (e.g., link a Contact to a Company, link a Task to a Project).",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name of the source record" },
          record_id: { type: "string", description: "Source record ID (starts with 'rec')" },
          linked_field_name: { type: "string", description: "Name of the linked record field to update" },
          target_record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to link: ['recXXX','recYYY']" },
          replace: { type: "boolean", description: "If true, replace all existing links. If false (default), append." },
        },
        required: ["base_id", "table_id_or_name", "record_id", "linked_field_name", "target_record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          fields: { type: "object" },
          linkedField: { type: "string" },
          linkedRecordIds: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "unlink_records",
      title: "Unlink Records",
      description:
        "Remove linked record relationship(s) from a linked record field. Fetches the current linked record IDs, removes the specified ones, and updates the record. Non-destructive for links not specified — only the listed target_record_ids are removed. Use to clean up relationships without deleting records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name of the source record" },
          record_id: { type: "string", description: "Source record ID (starts with 'rec')" },
          linked_field_name: { type: "string", description: "Name of the linked record field" },
          target_record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to remove from the linked field: ['recXXX']" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "linked_field_name", "target_record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          fields: { type: "object" },
          linkedField: { type: "string" },
          removedCount: { type: "number" },
          remainingLinkedIds: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

    // ── Round 2 handlers ──

    list_records_by_view: async (args) => {
      const { base_id, table_id_or_name, view_id_or_name, fields, max_records, page_size, offset } =
        ListRecordsByViewSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("view", view_id_or_name);
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (fields) fields.forEach((f) => queryParams.append("fields[]", f));

      const result = await logger.time("tool.list_records_by_view", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "list_records_by_view", base_id, view: view_id_or_name });

      const raw = result as { records?: unknown[]; offset?: string };
      const response = { records: raw.records ?? [], offset: raw.offset, view: view_id_or_name };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_records_with_formula: async (args) => {
      const { base_id, table_id_or_name, formula, fields, sort, max_records, page_size, offset } =
        ListRecordsWithFormulaSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (fields) fields.forEach((f) => queryParams.append("fields[]", f));
      if (sort) sort.forEach((s, i) => {
        queryParams.set(`sort[${i}][field]`, s.field);
        if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
      });

      const result = await logger.time("tool.list_records_with_formula", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "list_records_with_formula", base_id, formula: formula.substring(0, 80) });

      const raw = result as { records?: unknown[]; offset?: string };
      const response = { records: raw.records ?? [], offset: raw.offset, formula };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_records_grouped: async (args) => {
      const { base_id, table_id_or_name, group_by_field, fields, filter_by_formula, sort_groups, sort_within_groups, max_records, page_size } =
        ListRecordsGroupedSchema.parse(args);

      // Always include the group_by_field in returned fields
      const returnFields = fields ? Array.from(new Set([group_by_field, ...fields])) : undefined;

      // Paginate through all records
      const allRecords: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }> = [];
      let currentOffset: string | undefined;
      const qp = new URLSearchParams();
      qp.set("pageSize", String(page_size ?? 100));
      if (max_records) qp.set("maxRecords", String(max_records));
      if (filter_by_formula) qp.set("filterByFormula", filter_by_formula);
      if (returnFields) returnFields.forEach((f) => qp.append("fields[]", f));
      if (sort_within_groups) sort_within_groups.forEach((s, i) => {
        qp.set(`sort[${i}][field]`, s.field);
        if (s.direction) qp.set(`sort[${i}][direction]`, s.direction);
      });

      do {
        const pageParams = new URLSearchParams(qp);
        if (currentOffset) pageParams.set("offset", currentOffset);

        const result = await logger.time("tool.list_records_grouped.page", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${pageParams}`)
        , { tool: "list_records_grouped", base_id, fetched: allRecords.length });

        const raw = result as { records?: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>; offset?: string };
        if (raw.records) allRecords.push(...raw.records);
        currentOffset = raw.offset;
      } while (currentOffset && (!max_records || allRecords.length < max_records));

      // Group records by field value
      const groups = new Map<string, Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>>();
      for (const record of allRecords) {
        const val = record.fields[group_by_field];
        const key = val === null || val === undefined ? "(empty)" : Array.isArray(val) ? val.join(", ") : String(val);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(record);
      }

      // Sort group keys
      let groupKeys = Array.from(groups.keys());
      if (sort_groups === "asc") groupKeys.sort();
      else if (sort_groups === "desc") groupKeys.sort().reverse();

      const groupsObj: Record<string, unknown[]> = {};
      const groupCounts: Record<string, number> = {};
      for (const key of groupKeys) {
        groupsObj[key] = groups.get(key)!;
        groupCounts[key] = groups.get(key)!.length;
      }

      const response = {
        groups: groupsObj,
        groupKeys,
        groupCounts,
        totalGroups: groupKeys.length,
        totalRecords: allRecords.length,
        groupByField: group_by_field,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    upsert_records: async (args) => {
      const { base_id, table_id_or_name, records, fields_to_merge_on, typecast } = UpsertRecordsSchema.parse(args);

      const body: Record<string, unknown> = {
        records,
        performUpsert: { fieldsToMergeOn: fields_to_merge_on },
      };
      if (typecast !== undefined) body.typecast = typecast;

      const result = await logger.time("tool.upsert_records", () =>
        client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
      , { tool: "upsert_records", base_id, count: records.length, mergeOn: fields_to_merge_on });

      const raw = result as { records?: unknown[]; createdRecords?: string[]; updatedRecords?: string[] };
      const response = {
        records: raw.records ?? [],
        createdRecords: raw.createdRecords ?? [],
        updatedRecords: raw.updatedRecords ?? [],
        createdCount: (raw.createdRecords ?? []).length,
        updatedCount: (raw.updatedRecords ?? []).length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_records_changed_since: async (args) => {
      const { base_id, table_id_or_name, since_datetime, fields, return_fields, max_records, page_size, offset } =
        ListRecordsChangedSinceSchema.parse(args);

      // Build LAST_MODIFIED_TIME formula
      const fieldArgs = fields && fields.length > 0
        ? fields.map((f) => `{${f}}`).join(",")
        : "";
      const modifiedTimeExpr = fieldArgs ? `LAST_MODIFIED_TIME(${fieldArgs})` : "LAST_MODIFIED_TIME()";
      const formula = `IS_AFTER(${modifiedTimeExpr},'${since_datetime}')`;

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("pageSize", String(page_size ?? 100));
      // Sort newest first by default
      queryParams.set("sort[0][field]", modifiedTimeExpr.includes("(") ? "Last Modified" : `${modifiedTimeExpr}`);
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (return_fields) return_fields.forEach((f) => queryParams.append("fields[]", f));

      let result: unknown;
      try {
        result = await logger.time("tool.list_records_changed_since", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
        , { tool: "list_records_changed_since", base_id, since: since_datetime });
      } catch {
        // Retry without sort (field may not be named "Last Modified")
        const qp2 = new URLSearchParams();
        qp2.set("filterByFormula", formula);
        qp2.set("pageSize", String(page_size ?? 100));
        if (max_records) qp2.set("maxRecords", String(max_records));
        if (offset) qp2.set("offset", offset);
        if (return_fields) return_fields.forEach((f) => qp2.append("fields[]", f));

        result = await logger.time("tool.list_records_changed_since.retry", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${qp2}`)
        , { tool: "list_records_changed_since.retry", base_id });
      }

      const raw = result as { records?: unknown[]; offset?: string };
      const response = {
        records: raw.records ?? [],
        offset: raw.offset,
        sinceDatetime: since_datetime,
        formula,
        watchedFields: fields ?? "all fields",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    link_records: async (args) => {
      const { base_id, table_id_or_name, record_id, linked_field_name, target_record_ids, replace } =
        LinkRecordsSchema.parse(args);

      let existingIds: string[] = [];

      if (!replace) {
        // Fetch the current record to get existing linked IDs
        const existing = await logger.time("tool.link_records.fetch", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
        , { tool: "link_records.fetch", base_id, record_id });

        const existingRecord = existing as { fields: Record<string, unknown> };
        const currentLinked = existingRecord.fields[linked_field_name];
        if (Array.isArray(currentLinked)) {
          existingIds = currentLinked.filter((id): id is string => typeof id === "string");
        }
      }

      // Merge existing + new (deduplicate)
      const toSet = replace
        ? target_record_ids
        : Array.from(new Set([...existingIds, ...target_record_ids]));

      const body = { fields: { [linked_field_name]: toSet } };

      const result = await logger.time("tool.link_records", () =>
        client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`, body)
      , { tool: "link_records", base_id, record_id, field: linked_field_name, count: toSet.length });

      const updated = result as { id: string; fields: Record<string, unknown> };
      const response = {
        id: updated.id,
        fields: updated.fields,
        linkedField: linked_field_name,
        linkedRecordIds: toSet,
        addedCount: replace ? target_record_ids.length : target_record_ids.filter((id) => !existingIds.includes(id)).length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    unlink_records: async (args) => {
      const { base_id, table_id_or_name, record_id, linked_field_name, target_record_ids } =
        UnlinkRecordsSchema.parse(args);

      // Fetch current record to get existing linked IDs
      const existing = await logger.time("tool.unlink_records.fetch", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
      , { tool: "unlink_records.fetch", base_id, record_id });

      const existingRecord = existing as { fields: Record<string, unknown> };
      const currentLinked = existingRecord.fields[linked_field_name];
      let existingIds: string[] = [];
      if (Array.isArray(currentLinked)) {
        existingIds = currentLinked.filter((id): id is string => typeof id === "string");
      }

      const removeSet = new Set(target_record_ids);
      const remaining = existingIds.filter((id) => !removeSet.has(id));
      const removedCount = existingIds.length - remaining.length;

      const body = { fields: { [linked_field_name]: remaining } };

      const result = await logger.time("tool.unlink_records", () =>
        client.patch(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`, body)
      , { tool: "unlink_records", base_id, record_id, field: linked_field_name, removedCount });

      const updated = result as { id: string; fields: Record<string, unknown> };
      const response = {
        id: updated.id,
        fields: updated.fields,
        linkedField: linked_field_name,
        removedCount,
        remainingLinkedIds: remaining,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
