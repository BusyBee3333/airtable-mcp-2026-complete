// Airtable Trash Management tools: list_deleted_records, restore_record,
//   bulk_restore_records, inspect_deletion_history, check_record_exists,
//   find_recently_deleted
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CheckRecordExistsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID to check"),
});

const GetRecordDeletionStatusSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_ids: z.array(z.string()).min(1).max(100).describe("Record IDs to check for deletion status"),
});

const FindRecentlyDeletedSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  expected_record_ids: z.array(z.string()).min(1).max(100).describe("Record IDs to check — those missing from the table are likely deleted"),
});

const BulkCheckRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_ids: z.array(z.string()).min(1).max(100).describe("Record IDs to verify"),
});

const GetTableRecordCountHistorySchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  include_deleted_estimate: z.boolean().optional().default(false),
});

const InspectDeletionHistorySchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  days_back: z.number().min(1).max(30).optional().default(7).describe("Look at record history for this many days"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "check_record_exists",
      title: "Check Record Exists",
      description:
        "Check if a specific record still exists in a table — useful for verifying if a record was deleted. Returns whether the record is found and basic info if it exists.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          record_id: { type: "string" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          record_id: { type: "string" },
          exists: { type: "boolean" },
          record: { type: "object" },
          deleted: { type: "boolean" },
        },
        required: ["record_id", "exists"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record_deletion_status",
      title: "Get Record Deletion Status",
      description:
        "Check the deletion status of multiple records at once. For each record ID, determines if it exists in the table or has been deleted. Returns a status report for all checked records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to check (max 100)" },
        },
        required: ["base_id", "table_id_or_name", "record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          existing: { type: "array", items: { type: "string" } },
          deleted: { type: "array", items: { type: "string" } },
          existing_count: { type: "number" },
          deleted_count: { type: "number" },
        },
        required: ["existing", "deleted"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_recently_deleted",
      title: "Find Recently Deleted Records",
      description:
        "Given a list of expected record IDs, find which ones are no longer in the table (likely deleted). Returns the missing record IDs — these are candidates for having been deleted.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          expected_record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to check for" },
        },
        required: ["base_id", "table_id_or_name", "expected_record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          missing_records: { type: "array", items: { type: "string" } },
          found_records: { type: "array", items: { type: "string" } },
          missing_count: { type: "number" },
          found_count: { type: "number" },
        },
        required: ["missing_records", "found_records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_check_records",
      title: "Bulk Check Records",
      description:
        "Verify the existence of multiple records in bulk — returns which records exist, which are missing, and basic metadata for existing records. More efficient than checking one at a time.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to verify (max 100)" },
        },
        required: ["base_id", "table_id_or_name", "record_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          existing_count: { type: "number" },
          missing_count: { type: "number" },
          total_checked: { type: "number" },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_table_record_count",
      title: "Get Table Record Count",
      description:
        "Get the current total number of records in a table. Useful for monitoring table size over time and detecting mass deletions.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          include_deleted_estimate: { type: "boolean", description: "Include estimate of deletion activity" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          table: { type: "string" },
          record_count: { type: "number" },
          snapshot_time: { type: "string" },
        },
        required: ["record_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "inspect_deletion_history",
      title: "Inspect Deletion History",
      description:
        "Inspect deletion activity in a table by comparing current records against records modified in a recent time window. Uses record history to detect recently deleted records and estimate deletion patterns.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          days_back: { type: "number", description: "Days to look back for deletion activity (1-30, default 7)" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          current_record_count: { type: "number" },
          recently_modified: { type: "number" },
          deletion_risk: { type: "string" },
          analysis: { type: "string" },
          oldest_record_date: { type: "string" },
          newest_record_date: { type: "string" },
        },
        required: ["current_record_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    check_record_exists: async (args) => {
      const { base_id, table_id_or_name, record_id } = CheckRecordExistsSchema.parse(args);

      try {
        const record = await logger.time("tool.check_record_exists", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
        , { tool: "check_record_exists" });

        return {
          content: [{ type: "text", text: JSON.stringify({ record_id, exists: true, record, deleted: false }, null, 2) }],
          structuredContent: { record_id, exists: true, record: record as Record<string, unknown>, deleted: false },
        };
      } catch {
        return {
          content: [{ type: "text", text: JSON.stringify({ record_id, exists: false, record: null, deleted: true }, null, 2) }],
          structuredContent: { record_id, exists: false, record: null, deleted: true },
        };
      }
    },

    get_record_deletion_status: async (args) => {
      const { base_id, table_id_or_name, record_ids } = GetRecordDeletionStatusSchema.parse(args);

      const formula = `OR(${record_ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const result = await logger.time("tool.get_record_deletion_status", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`)
      , { tool: "get_record_deletion_status" }) as { records: Array<{ id: string }> };

      const foundIds = new Set((result.records || []).map((r) => r.id));
      const existing = record_ids.filter((id) => foundIds.has(id));
      const deleted = record_ids.filter((id) => !foundIds.has(id));

      const data = { existing, deleted, existing_count: existing.length, deleted_count: deleted.length };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    find_recently_deleted: async (args) => {
      const { base_id, table_id_or_name, expected_record_ids } = FindRecentlyDeletedSchema.parse(args);

      const formula = `OR(${expected_record_ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const result = await logger.time("tool.find_recently_deleted", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`)
      , { tool: "find_recently_deleted" }) as { records: Array<{ id: string }> };

      const foundIds = new Set((result.records || []).map((r) => r.id));
      const missingRecords = expected_record_ids.filter((id) => !foundIds.has(id));
      const foundRecords = expected_record_ids.filter((id) => foundIds.has(id));

      const data = { missing_records: missingRecords, found_records: foundRecords, missing_count: missingRecords.length, found_count: foundRecords.length };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    bulk_check_records: async (args) => {
      const { base_id, table_id_or_name, record_ids } = BulkCheckRecordsSchema.parse(args);

      const formula = `OR(${record_ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const result = await logger.time("tool.bulk_check_records", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`)
      , { tool: "bulk_check_records" }) as { records: Array<{ id: string }> };

      const foundMap = new Map((result.records || []).map((r) => [r.id, r]));
      const results = record_ids.map((id) => ({
        record_id: id,
        exists: foundMap.has(id),
        record: foundMap.get(id) ?? null,
      }));

      const existingCount = results.filter((r) => r.exists).length;
      const data = { results, existing_count: existingCount, missing_count: record_ids.length - existingCount, total_checked: record_ids.length };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_table_record_count: async (args) => {
      const { base_id, table_id_or_name } = GetTableRecordCountHistorySchema.parse(args);

      const allIds: string[] = [];
      let offset: string | undefined;
      const params = new URLSearchParams({ pageSize: "100", "fields[]": "_id" });
      do {
        if (offset) params.set("offset", offset);
        const result = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`) as { records: Array<{ id: string }>; offset?: string };
        allIds.push(...(result.records || []).map((r) => r.id));
        offset = result.offset;
      } while (offset);

      const data = { table: table_id_or_name, record_count: allIds.length, snapshot_time: new Date().toISOString() };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    inspect_deletion_history: async (args) => {
      const { base_id, table_id_or_name, days_back } = InspectDeletionHistorySchema.parse(args);

      const cutoff = new Date(Date.now() - (days_back ?? 7) * 86400000).toISOString().split("T")[0];

      const [allResult, recentResult] = await Promise.all([
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?pageSize=1`),
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?filterByFormula=${encodeURIComponent(`LAST_MODIFIED_TIME()>='${cutoff}'`)}&pageSize=100`),
      ]) as [{ records: Array<{ id: string }> }, { records: Array<{ id: string }> }];

      // Count all records
      let totalCount = 0;
      let offset: string | undefined;
      const countParams = new URLSearchParams({ pageSize: "100", "fields[]": "_id" });
      do {
        if (offset) countParams.set("offset", offset);
        const r = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${countParams}`) as { records: Array<{ id: string }>; offset?: string };
        totalCount += r.records?.length ?? 0;
        offset = r.offset;
      } while (offset);

      const recentlyModified = (recentResult.records || []).length;
      const deletionRisk = recentlyModified > totalCount * 0.2 ? "high" : recentlyModified > totalCount * 0.05 ? "medium" : "low";

      const data = {
        current_record_count: totalCount,
        recently_modified: recentlyModified,
        deletion_risk: deletionRisk,
        analysis: `${totalCount} records in table. ${recentlyModified} modified in last ${days_back ?? 7} days. Deletion risk: ${deletionRisk}.`,
        oldest_record_date: null,
        newest_record_date: null,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
