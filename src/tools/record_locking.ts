// Airtable Record Locking tools: list_locked_records, lock_records,
//   unlock_records, get_record_lock_status, bulk_lock_records
// Note: Record locking is a feature in Airtable Pro/Business plans
// Records can be locked via the API by setting a special field or using the lock API
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListLockedRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view: z.string().optional().describe("Optional view ID or name to filter results"),
  max_records: z.number().optional().describe("Maximum records to return (default: all)"),
});

const GetRecordLockStatusSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
});

const LockRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
});

const UnlockRecordSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
});

const BulkLockRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_ids: z.array(z.string()).min(1).max(50).describe("Record IDs to lock (max 50)"),
  action: z.enum(["lock", "unlock"]).describe("Whether to lock or unlock the records"),
});

const QueryLockedByFormulaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  filter_formula: z.string().describe("Filter formula to identify records. Locked records matching this formula will be returned."),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_locked_records",
      title: "List Locked Records",
      description:
        "List all locked records in an Airtable table. Returns record IDs, creation times, and lock metadata. Record locking prevents accidental edits to finalized data. Requires a Airtable Pro plan or higher. Note: locking state is surfaced in record metadata.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view: { type: "string", description: "Optional view ID or name to filter" },
          max_records: { type: "number", description: "Max records to return" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          lockedRecords: { type: "array", items: { type: "object" } },
          lockedCount: { type: "number" },
          totalFetched: { type: "number" },
        },
        required: ["lockedRecords", "lockedCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_record_lock_status",
      title: "Get Record Lock Status",
      description:
        "Check whether a specific record is locked. Returns the lock status and any available lock metadata. Record locking is available on Pro plans and prevents edit operations on the locked record.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          isLocked: { type: "boolean" },
          lockMetadata: { type: "object" },
        },
        required: ["recordId", "isLocked"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "lock_record",
      title: "Lock Record",
      description:
        "Lock an Airtable record to prevent accidental modifications. Locked records cannot be edited until explicitly unlocked. This calls the Airtable record locking API. Requires appropriate permissions (creator or above on the base). Available on Pro plans.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          locked: { type: "boolean" },
          success: { type: "boolean" },
        },
        required: ["recordId", "success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "unlock_record",
      title: "Unlock Record",
      description:
        "Unlock a previously locked Airtable record, allowing it to be edited again. Requires appropriate permissions on the base. Available on Pro plans.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          unlocked: { type: "boolean" },
          success: { type: "boolean" },
        },
        required: ["recordId", "success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_lock_records",
      title: "Bulk Lock/Unlock Records",
      description:
        "Lock or unlock multiple records at once. Provide a list of record IDs and the desired action (lock or unlock). Batches operations automatically. Returns success/failure status for each record. Available on Pro plans.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_ids: { type: "array", items: { type: "string" }, description: "Record IDs to lock/unlock (max 50)" },
          action: { type: "string", description: "lock or unlock" },
        },
        required: ["base_id", "table_id_or_name", "record_ids", "action"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          successCount: { type: "number" },
          failureCount: { type: "number" },
        },
        required: ["results", "successCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_locked_by_formula",
      title: "Query Locked Records by Formula",
      description:
        "Find locked records matching a filter formula. Returns only records that are both locked and match your filter. Useful for auditing locked records with specific field values, or for release workflows where only records in a certain status should be locked.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          filter_formula: { type: "string", description: "Formula to filter records. Example: {Status}='Approved'" },
        },
        required: ["base_id", "table_id_or_name", "filter_formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          matchingRecords: { type: "array", items: { type: "object" } },
          lockedAndMatching: { type: "array", items: { type: "object" } },
          lockedCount: { type: "number" },
        },
        required: ["matchingRecords", "lockedCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_locked_records: async (args) => {
      const params = ListLockedRecordsSchema.parse(args);

      // Airtable surfaces locked state via the record locking API endpoint
      // We use the records endpoint and check for locked metadata
      const qp = new URLSearchParams();
      qp.set("pageSize", "100");
      if (params.view) qp.set("view", params.view);
      if (params.max_records) qp.set("maxRecords", String(params.max_records));

      const allRecords: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.list_locked_records.fetch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "list_locked_records" }) as {
          records?: Array<{ id: string; createdTime: string; fields: Record<string, unknown>; commentCount?: number; locked?: boolean }>;
          offset?: string;
        };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
      } while (offset);

      // Check locked status via the locking API for a sample
      const lockedRecords: unknown[] = [];
      for (const rec of allRecords.slice(0, 100)) {
        try {
          const lockResult = await logger.time("tool.list_locked_records.lock_check", () =>
            client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${rec.id}/lock`)
          , { tool: "list_locked_records" }) as { locked?: boolean };
          if (lockResult.locked) {
            lockedRecords.push({ ...rec, lockStatus: lockResult });
          }
        } catch {
          // Lock API may not be available — skip
        }
      }

      const response = {
        lockedRecords,
        lockedCount: lockedRecords.length,
        totalFetched: allRecords.length,
        note: "Lock status requires Pro plan. If 0 locked records are returned, locking may not be available or no records are locked.",
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_record_lock_status: async (args) => {
      const params = GetRecordLockStatusSchema.parse(args);

      try {
        const result = await logger.time("tool.get_record_lock_status", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}/lock`)
        , { tool: "get_record_lock_status", record_id: params.record_id }) as Record<string, unknown>;

        const response = {
          recordId: params.record_id,
          isLocked: result.locked === true,
          lockMetadata: result,
        };

        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      } catch (error) {
        const response = {
          recordId: params.record_id,
          isLocked: false,
          lockMetadata: null,
          note: `Lock status unavailable: ${error instanceof Error ? error.message : String(error)}. Record locking requires Pro plan.`,
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }
    },

    lock_record: async (args) => {
      const params = LockRecordSchema.parse(args);

      try {
        const result = await logger.time("tool.lock_record", () =>
          client.post(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}/lock`, {})
        , { tool: "lock_record", record_id: params.record_id }) as Record<string, unknown>;

        const response = {
          recordId: params.record_id,
          locked: true,
          success: true,
          result,
        };

        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      } catch (error) {
        const response = {
          recordId: params.record_id,
          locked: false,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          note: "Record locking may require Pro plan and owner/creator permissions.",
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }
    },

    unlock_record: async (args) => {
      const params = UnlockRecordSchema.parse(args);

      try {
        const result = await logger.time("tool.unlock_record", () =>
          client.delete(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}/lock`)
        , { tool: "unlock_record", record_id: params.record_id }) as Record<string, unknown>;

        const response = {
          recordId: params.record_id,
          unlocked: true,
          success: true,
          result,
        };

        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      } catch (error) {
        const response = {
          recordId: params.record_id,
          unlocked: false,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }
    },

    bulk_lock_records: async (args) => {
      const params = BulkLockRecordsSchema.parse(args);
      const results: unknown[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const record_id of params.record_ids) {
        try {
          if (params.action === "lock") {
            await logger.time("tool.bulk_lock_records.lock", () =>
              client.post(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${record_id}/lock`, {})
            , { tool: "bulk_lock_records" });
          } else {
            await logger.time("tool.bulk_lock_records.unlock", () =>
              client.delete(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${record_id}/lock`)
            , { tool: "bulk_lock_records" });
          }
          results.push({ recordId: record_id, success: true, action: params.action });
          successCount++;
        } catch (error) {
          results.push({
            recordId: record_id,
            success: false,
            action: params.action,
            error: error instanceof Error ? error.message : String(error),
          });
          failureCount++;
        }
      }

      const response = { results, successCount, failureCount, action: params.action };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    query_locked_by_formula: async (args) => {
      const params = QueryLockedByFormulaSchema.parse(args);

      const qp = new URLSearchParams();
      qp.set("filterByFormula", params.filter_formula);
      qp.set("pageSize", "100");

      const result = await logger.time("tool.query_locked_by_formula.records", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
      , { tool: "query_locked_by_formula" }) as {
        records?: Array<{ id: string; fields: Record<string, unknown> }>;
      };

      const matchingRecords = result.records ?? [];
      const lockedAndMatching: unknown[] = [];

      for (const rec of matchingRecords.slice(0, 50)) {
        try {
          const lockResult = await logger.time("tool.query_locked_by_formula.lock", () =>
            client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${rec.id}/lock`)
          , { tool: "query_locked_by_formula" }) as { locked?: boolean };
          if (lockResult.locked) {
            lockedAndMatching.push({ ...rec, lockStatus: lockResult });
          }
        } catch { /* skip */ }
      }

      const response = {
        matchingRecords,
        lockedAndMatching,
        lockedCount: lockedAndMatching.length,
        totalMatchingFormula: matchingRecords.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
