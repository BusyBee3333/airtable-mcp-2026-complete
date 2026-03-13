// Airtable Search tools: search_records_fulltext, find_records_by_field, find_duplicate_records
// Uses Airtable filterByFormula with SEARCH(), exact match, and duplicate detection
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const SearchRecordsFulltextSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  search_text: z.string().describe("Text to search for across the specified field(s)"),
  fields: z.array(z.string()).min(1).describe("Field names to search within. Each field is searched with SEARCH() for case-insensitive partial match."),
  return_fields: z.array(z.string()).optional().describe("Field names to include in results (default: all)"),
  max_records: z.number().min(1).max(1000).optional().describe("Maximum records to return (default: 100)"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100, default 100)"),
  offset: z.string().optional().describe("Pagination offset from previous response"),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional().describe("Sort results: [{field:'Name',direction:'asc'}]"),
});

const FindRecordsByFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Field name to match against"),
  field_value: z.string().describe("Exact value to match (case-sensitive for text, use typecast for numbers)"),
  return_fields: z.array(z.string()).optional().describe("Field names to return (default: all)"),
  max_records: z.number().min(1).max(1000).optional().describe("Max records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination offset"),
  sort: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional().describe("Sort results"),
});

const FindDuplicateRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Field name to check for duplicate values"),
  return_fields: z.array(z.string()).optional().describe("Additional fields to return with each record (field_name is always included)"),
  max_records: z.number().min(1).max(1000).optional().describe("Max records to scan for duplicates (default: 1000)"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page while scanning"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "search_records_fulltext",
      title: "Full-Text Search Records",
      description:
        "Full-text search across one or more fields using Airtable's SEARCH() function. Case-insensitive partial matching — finds records where any of the specified fields contains the search text as a substring. Returns matching records with pagination. Example: search for 'alice' in Name and Email fields finds 'Alice Smith', 'alice@example.com', etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          search_text: { type: "string", description: "Text to search for (case-insensitive, partial match)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to search in (e.g., ['Name','Email','Notes'])" },
          return_fields: { type: "array", items: { type: "string" }, description: "Fields to return in results (default: all)" },
          max_records: { type: "number", description: "Max records to return (default: 100, max: 1000)" },
          page_size: { type: "number", description: "Records per page (1-100, default 100)" },
          offset: { type: "string", description: "Pagination offset from previous response" },
          sort: { type: "array", items: { type: "object" }, description: "Sort: [{field:'Name',direction:'asc'}]" },
        },
        required: ["base_id", "table_id_or_name", "search_text", "fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          searchText: { type: "string" },
          fieldsSearched: { type: "array", items: { type: "string" } },
          formula: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_records_by_field",
      title: "Find Records By Field Value",
      description:
        "Find records where a specific field matches an exact value. Uses Airtable filterByFormula for precise matching. Examples: find all records where Status='Active', or Email='user@example.com'. Returns matching records. For partial/fuzzy matching use search_records_fulltext instead.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Field name to match" },
          field_value: { type: "string", description: "Exact value to find (e.g., 'Active', 'user@example.com', '42')" },
          return_fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all)" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100)" },
          offset: { type: "string", description: "Pagination offset" },
          sort: { type: "array", items: { type: "object" }, description: "Sort results" },
        },
        required: ["base_id", "table_id_or_name", "field_name", "field_value"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          matchCount: { type: "number" },
          formula: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_duplicate_records",
      title: "Find Duplicate Records",
      description:
        "Detect duplicate values in a field across all records. Fetches all records and groups them by field value, then returns groups with more than one record — i.e., duplicates. Useful for data quality checks (e.g., find duplicate emails, names, IDs). Returns duplicate groups with all records in each group.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Field to check for duplicates (e.g., 'Email', 'Name', 'Order ID')" },
          return_fields: { type: "array", items: { type: "string" }, description: "Additional fields to include in results" },
          max_records: { type: "number", description: "Max records to scan (default: 1000)" },
          page_size: { type: "number", description: "Records per page while scanning (1-100)" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          duplicateGroups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                count: { type: "number" },
                records: { type: "array", items: { type: "object" } },
              },
            },
          },
          totalDuplicateGroups: { type: "number" },
          totalDuplicateRecords: { type: "number" },
          scannedRecords: { type: "number" },
        },
        required: ["duplicateGroups", "totalDuplicateGroups"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    search_records_fulltext: async (args) => {
      const { base_id, table_id_or_name, search_text, fields, return_fields, max_records, page_size, offset, sort } =
        SearchRecordsFulltextSchema.parse(args);

      // Build OR formula: SEARCH('text',{Field1})>0, SEARCH('text',{Field2})>0
      const escaped = search_text.replace(/'/g, "\\'");
      const clauses = fields.map((f) => `SEARCH('${escaped}',{${f}})>0`);
      const formula = clauses.length === 1 ? clauses[0] : `OR(${clauses.join(",")})`;

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (return_fields) return_fields.forEach((f) => queryParams.append("fields[]", f));
      if (sort) sort.forEach((s, i) => {
        queryParams.set(`sort[${i}][field]`, s.field);
        if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
      });

      const result = await logger.time("tool.search_records_fulltext", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "search_records_fulltext", base_id, search_text, fields });

      const raw = result as { records?: unknown[]; offset?: string };
      const response = {
        records: raw.records ?? [],
        offset: raw.offset,
        searchText: search_text,
        fieldsSearched: fields,
        formula,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    find_records_by_field: async (args) => {
      const { base_id, table_id_or_name, field_name, field_value, return_fields, max_records, page_size, offset, sort } =
        FindRecordsByFieldSchema.parse(args);

      // Use string comparison (works for text, select, etc.); numeric fields also work via Airtable coercion
      const escaped = field_value.replace(/'/g, "\\'");
      const formula = `{${field_name}}='${escaped}'`;

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (return_fields) return_fields.forEach((f) => queryParams.append("fields[]", f));
      if (sort) sort.forEach((s, i) => {
        queryParams.set(`sort[${i}][field]`, s.field);
        if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
      });

      const result = await logger.time("tool.find_records_by_field", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "find_records_by_field", base_id, field_name, field_value });

      const raw = result as { records?: unknown[]; offset?: string };
      const records = raw.records ?? [];
      const response = {
        records,
        offset: raw.offset,
        matchCount: records.length,
        formula,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    find_duplicate_records: async (args) => {
      const { base_id, table_id_or_name, field_name, return_fields, max_records, page_size } =
        FindDuplicateRecordsSchema.parse(args);

      // Fetch all records (up to max_records), always include the target field
      const fieldsToFetch = return_fields ? Array.from(new Set([field_name, ...return_fields])) : [field_name];
      const queryParams = new URLSearchParams();
      queryParams.set("pageSize", String(page_size ?? 100));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      fieldsToFetch.forEach((f) => queryParams.append("fields[]", f));

      // Paginate through all records
      const allRecords: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }> = [];
      let currentOffset: string | undefined;

      do {
        const qp = new URLSearchParams(queryParams);
        if (currentOffset) qp.set("offset", currentOffset);

        const result = await logger.time("tool.find_duplicate_records.page", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${qp}`)
        , { tool: "find_duplicate_records", base_id, page: allRecords.length });

        const raw = result as { records?: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>; offset?: string };
        if (raw.records) allRecords.push(...raw.records);
        currentOffset = raw.offset;
      } while (currentOffset && (!max_records || allRecords.length < max_records));

      // Group by field value
      const groups = new Map<string, Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>>();
      for (const record of allRecords) {
        const value = record.fields[field_name];
        const key = value === null || value === undefined ? "__empty__" : String(value);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(record);
      }

      // Filter to groups with duplicates
      const duplicateGroups: Array<{ value: string; count: number; records: unknown[] }> = [];
      let totalDuplicateRecords = 0;

      for (const [value, records] of groups.entries()) {
        if (records.length > 1) {
          duplicateGroups.push({ value, count: records.length, records });
          totalDuplicateRecords += records.length;
        }
      }

      // Sort groups by count descending
      duplicateGroups.sort((a, b) => b.count - a.count);

      const response = {
        duplicateGroups,
        totalDuplicateGroups: duplicateGroups.length,
        totalDuplicateRecords,
        scannedRecords: allRecords.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
