// Airtable Record History tools: list_record_revisions, get_record_revision,
//   list_changed_records_in_range, get_record_audit_trail, list_recently_modified_records
// Uses Airtable Record History API and Records API with LAST_MODIFIED_TIME formulas
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListRecordRevisionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec') to get revision history for"),
  offset: z.string().optional().describe("Pagination cursor from previous response"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Revisions per page (1-100, default 25)"),
});

const GetRecordRevisionSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  revision_id: z.string().describe("Revision ID or number to retrieve"),
});

const ListChangedRecordsInRangeSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  start_time: z.string().describe("ISO 8601 start datetime. Returns records modified at or after this time. Example: '2024-01-01T00:00:00.000Z'"),
  end_time: z.string().optional().describe("ISO 8601 end datetime. Returns records modified before this time. Defaults to now."),
  fields: z.array(z.string()).optional().describe("Watch specific fields for modification (omit to watch any field)"),
  return_fields: z.array(z.string()).optional().describe("Fields to include in results (default: all)"),
  max_records: z.number().min(1).optional().describe("Maximum records to return"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Records per page (1-100)"),
  offset: z.string().optional().describe("Pagination cursor"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort by last-modified time: desc (newest first) or asc (oldest first)"),
});

const ListRecentlyModifiedRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  within_hours: z.number().min(0.1).max(8760).optional().default(24)
    .describe("Return records modified in the last N hours (default: 24 hours). Use 0.5 for last 30 minutes, 168 for last week."),
  fields_to_watch: z.array(z.string()).optional().describe("Watch only these specific fields (omit to watch all fields)"),
  return_fields: z.array(z.string()).optional().describe("Fields to include in results (default: all)"),
  max_records: z.number().min(1).max(1000).optional().default(100).describe("Max records to return (default 100)"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc").describe("Sort by modification time: desc (newest first, default) or asc"),
});

const GetRecordAuditTrailSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec') to get full audit trail for"),
  include_current: z.boolean().optional().default(true).describe("Include the current state of the record (default: true)"),
});

const CompareRecordVersionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  revision_a_id: z.string().describe("First revision ID to compare"),
  revision_b_id: z.string().describe("Second revision ID to compare (use 'current' to compare against the current state)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_record_revisions",
      title: "List Record Revisions",
      description:
        "List the revision history for a specific record. Each revision shows what changed, who changed it, and when. Returns revisions in reverse chronological order (newest first). Use to audit changes or debug unexpected data modifications.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          offset: { type: "string", description: "Pagination cursor from previous response" },
          page_size: { type: "number", description: "Revisions per page (1-100, default 25)" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          revisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                createdTime: { type: "string" },
                cellValuesByFieldId: { type: "object" },
                author: { type: "object" },
              },
            },
          },
          offset: { type: "string" },
          recordId: { type: "string" },
        },
        required: ["revisions"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record_revision",
      title: "Get Record Revision",
      description:
        "Get the data for a specific revision of a record. Returns the field values as they were at that point in time, who made the change, and when it occurred.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          revision_id: { type: "string", description: "Revision ID to retrieve" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "revision_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdTime: { type: "string" },
          fields: { type: "object" },
          author: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_changed_records_in_range",
      title: "List Changed Records In Time Range",
      description:
        "Return records that were modified within a specific time range. Supports watching specific fields. Returns records sorted by modification time. Use for incremental sync, change detection, and ETL pipelines.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          start_time: { type: "string", description: "ISO 8601 start time. Example: '2024-01-01T00:00:00.000Z'" },
          end_time: { type: "string", description: "ISO 8601 end time (defaults to now)" },
          fields: { type: "array", items: { type: "string" }, description: "Watch specific fields (omit for any field change)" },
          return_fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all)" },
          max_records: { type: "number", description: "Max records to return" },
          page_size: { type: "number", description: "Records per page (1-100)" },
          offset: { type: "string", description: "Pagination cursor" },
          sort_direction: { type: "string", description: "Sort by time: desc (newest first) or asc (default: desc)" },
        },
        required: ["base_id", "table_id_or_name", "start_time"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
          startTime: { type: "string" },
          endTime: { type: "string" },
          formula: { type: "string" },
          count: { type: "number" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_recently_modified_records",
      title: "List Recently Modified Records",
      description:
        "Return records modified in the last N hours (default 24h). Quick shortcut for recent change detection. Optionally watch only specific fields. Returns records sorted newest-first. Useful for dashboards, notifications, and daily change reports.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          within_hours: { type: "number", description: "Hours to look back (default 24). Use 0.5=30min, 168=1 week." },
          fields_to_watch: { type: "array", items: { type: "string" }, description: "Watch only these fields (omit = any field)" },
          return_fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all)" },
          max_records: { type: "number", description: "Max records to return (default 100)" },
          sort_direction: { type: "string", description: "Sort: desc (newest first, default) or asc" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          withinHours: { type: "number" },
          sinceTime: { type: "string" },
          formula: { type: "string" },
        },
        required: ["records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record_audit_trail",
      title: "Get Record Audit Trail",
      description:
        "Get a comprehensive audit trail for a record including all revisions (who changed what, when) plus the current state. Returns revision history in chronological order with a summary of total changes. Use for compliance auditing and debugging.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          include_current: { type: "boolean", description: "Include current record state (default: true)" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          currentState: { type: "object" },
          revisions: { type: "array", items: { type: "object" } },
          revisionCount: { type: "number" },
          createdTime: { type: "string" },
          lastModifiedTime: { type: "string" },
        },
        required: ["recordId", "revisionCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_record_revisions: async (args) => {
      const { base_id, table_id_or_name, record_id, offset, page_size } = ListRecordRevisionsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_record_revisions", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/revisions${qs ? `?${qs}` : ""}`)
      , { tool: "list_record_revisions", base_id, record_id });

      const response = { ...(result as Record<string, unknown>), recordId: record_id };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_record_revision: async (args) => {
      const { base_id, table_id_or_name, record_id, revision_id } = GetRecordRevisionSchema.parse(args);

      const result = await logger.time("tool.get_record_revision", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/revisions/${revision_id}`)
      , { tool: "get_record_revision", base_id, record_id, revision_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_changed_records_in_range: async (args) => {
      const {
        base_id, table_id_or_name, start_time, end_time, fields,
        return_fields, max_records, page_size, offset, sort_direction,
      } = ListChangedRecordsInRangeSchema.parse(args);

      const endTimeStr = end_time || new Date().toISOString();

      // Build LAST_MODIFIED_TIME formula with optional field scope
      let lastModifiedExpr: string;
      if (fields && fields.length > 0) {
        const fieldRefs = fields.map((f) => `{${f}}`).join(", ");
        lastModifiedExpr = `LAST_MODIFIED_TIME(${fieldRefs})`;
      } else {
        lastModifiedExpr = "LAST_MODIFIED_TIME()";
      }

      const formula = `AND(IS_AFTER(${lastModifiedExpr}, "${start_time}"), IS_BEFORE(${lastModifiedExpr}, "${endTimeStr}"))`;

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (max_records) queryParams.set("maxRecords", String(max_records));
      if (offset) queryParams.set("offset", offset);
      if (return_fields) return_fields.forEach((f) => queryParams.append("fields[]", f));

      const sd = sort_direction || "desc";
      queryParams.set("sort[0][field]", "Last Modified");
      queryParams.set("sort[0][direction]", sd);

      const result = await logger.time("tool.list_changed_records_in_range", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "list_changed_records_in_range", base_id, start_time });

      const raw = result as { records?: unknown[]; offset?: string };
      const response = {
        records: raw.records || [],
        ...(raw.offset ? { offset: raw.offset } : {}),
        startTime: start_time,
        endTime: endTimeStr,
        formula,
        count: (raw.records || []).length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_recently_modified_records: async (args) => {
      const {
        base_id, table_id_or_name, within_hours, fields_to_watch,
        return_fields, max_records, sort_direction,
      } = ListRecentlyModifiedRecordsSchema.parse(args);

      const hoursBack = within_hours || 24;
      const sinceTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

      let lastModifiedExpr: string;
      if (fields_to_watch && fields_to_watch.length > 0) {
        const fieldRefs = fields_to_watch.map((f) => `{${f}}`).join(", ");
        lastModifiedExpr = `LAST_MODIFIED_TIME(${fieldRefs})`;
      } else {
        lastModifiedExpr = "LAST_MODIFIED_TIME()";
      }

      const formula = `IS_AFTER(${lastModifiedExpr}, "${sinceTime}")`;

      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("pageSize", "100");
      if (max_records) queryParams.set("maxRecords", String(max_records || 100));
      if (return_fields) return_fields.forEach((f) => queryParams.append("fields[]", f));

      const sd = sort_direction || "desc";
      queryParams.set("sort[0][field]", "Last Modified");
      queryParams.set("sort[0][direction]", sd);

      const result = await logger.time("tool.list_recently_modified_records", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
      , { tool: "list_recently_modified_records", base_id, withinHours: hoursBack });

      const raw = result as { records?: unknown[] };
      const response = {
        records: raw.records || [],
        count: (raw.records || []).length,
        withinHours: hoursBack,
        sinceTime,
        formula,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_record_audit_trail: async (args) => {
      const { base_id, table_id_or_name, record_id, include_current } = GetRecordAuditTrailSchema.parse(args);

      // Fetch current record state
      let currentState: unknown = null;
      if (include_current !== false) {
        currentState = await logger.time("tool.get_record_audit_trail.current", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
        , { tool: "get_record_audit_trail", base_id, record_id });
      }

      // Fetch revision history
      let allRevisions: unknown[] = [];
      let revisionOffset: string | undefined;

      do {
        const q = new URLSearchParams();
        q.set("pageSize", "100");
        if (revisionOffset) q.set("offset", revisionOffset);

        const revResult = await logger.time("tool.get_record_audit_trail.revisions", () =>
          client.get<{ revisions?: unknown[]; offset?: string }>(
            `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/revisions?${q}`
          )
        , { tool: "get_record_audit_trail", base_id, record_id });

        allRevisions.push(...(revResult.revisions || []));
        revisionOffset = revResult.offset;
      } while (revisionOffset);

      // Sort chronologically
      allRevisions = allRevisions.reverse();

      const currentRaw = currentState as { createdTime?: string; fields?: Record<string, unknown> } | null;

      const response = {
        recordId: record_id,
        currentState: include_current !== false ? currentState : undefined,
        revisions: allRevisions,
        revisionCount: allRevisions.length,
        createdTime: currentRaw?.createdTime || null,
        lastModifiedTime: null, // Would need lastModifiedTime field to determine this
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
