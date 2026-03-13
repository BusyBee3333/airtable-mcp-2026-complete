// Airtable Bulk Upsert tools: bulk_upsert_records (unlimited, auto-batched),
//   replace_all_records, sync_records_from_data, diff_and_sync_records
// Uses Airtable Records API with fieldsToMergeOn upsert parameter
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BulkUpsertRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  records: z.array(z.object({ fields: z.record(z.unknown()) })).min(1)
    .describe("Records to upsert (any number — auto-batched into groups of 10). Each: {fields:{Email:'a@b.com',Name:'Alice'}}"),
  fields_to_merge_on: z.array(z.string()).min(1)
    .describe("Field name(s) used as unique match key. Example: ['Email'] or ['First Name','Last Name']. Records with matching values are updated; others are created."),
  typecast: z.boolean().optional().describe("Auto-convert string values to correct types"),
  return_fields_by_field_id: z.boolean().optional().describe("Return field IDs instead of names in responses"),
});

const ReplaceAllRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  new_records: z.array(z.object({ fields: z.record(z.unknown()) })).min(1)
    .describe("The complete new set of records that should exist in the table. All current records will be deleted first, then these records created. WARNING: destroys all existing data."),
  fields_to_preserve: z.array(z.string()).optional()
    .describe("Fields to preserve from existing records (not deleted). Leave empty to delete all."),
  typecast: z.boolean().optional().describe("Auto-convert string values to correct types"),
  confirm_replace_all: z.boolean().describe("Must be true to confirm destructive replacement of all records"),
});

const SyncRecordsFromDataSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  source_records: z.array(z.record(z.unknown())).min(1)
    .describe("Source data to sync. Each element is a flat object of field values (not wrapped in {fields:...}). Example: [{Email:'a@b.com',Name:'Alice',Status:'Active'}]"),
  match_field: z.string().describe("Field name to use as unique key for matching records. Example: 'Email' or 'ID'"),
  create_new: z.boolean().optional().default(true).describe("Create records that don't exist in Airtable (default: true)"),
  update_existing: z.boolean().optional().default(true).describe("Update records that already exist in Airtable (default: true)"),
  fields_to_sync: z.array(z.string()).optional()
    .describe("Only sync these specific fields (by name). Omit to sync all fields in source_records."),
  typecast: z.boolean().optional().default(true).describe("Auto-convert string values to correct types (default: true)"),
});

const DiffAndSyncRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  target_records: z.array(z.record(z.unknown())).min(1)
    .describe("Desired state of records. Each: flat object of field values. Example: [{Email:'a@b.com',Name:'Alice'}]"),
  match_field: z.string().describe("Field used to identify records (must be unique). Example: 'Email'"),
  dry_run: z.boolean().optional().default(false)
    .describe("If true (default: false), return the planned diff without actually applying changes"),
  delete_unmatched: z.boolean().optional().default(false)
    .describe("If true, delete existing Airtable records that are NOT in target_records (default: false)"),
  typecast: z.boolean().optional().default(true).describe("Auto-convert string values (default: true)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "bulk_upsert_records",
      title: "Bulk Upsert Records (Unlimited)",
      description:
        "Upsert any number of records using Airtable's native upsert. Automatically batches into groups of 10. Matches records by one or more key fields — existing records are updated, new ones are created. Ideal for data syncs, imports, and keeping tables up to date without duplicates. Returns totals for created and updated records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          records: {
            type: "array",
            items: { type: "object" },
            description: "Records to upsert (any number): [{fields:{Email:'a@b.com',Name:'Alice'}},...]",
          },
          fields_to_merge_on: {
            type: "array",
            items: { type: "string" },
            description: "Match key fields: ['Email'] or ['First Name','Last Name']",
          },
          typecast: { type: "boolean", description: "Auto-convert string values to correct types" },
        },
        required: ["base_id", "table_id_or_name", "records", "fields_to_merge_on"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          createdRecords: { type: "array", items: { type: "string" } },
          updatedRecords: { type: "array", items: { type: "string" } },
          createdCount: { type: "number" },
          updatedCount: { type: "number" },
          totalProcessed: { type: "number" },
          batchCount: { type: "number" },
        },
        required: ["createdCount", "updatedCount", "totalProcessed"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "replace_all_records",
      title: "Replace All Records",
      description:
        "DESTRUCTIVE: Delete all existing records in a table and replace with a new set. Use for complete data refreshes where the entire dataset changes. Requires confirm_replace_all=true. Records are deleted first, then new ones created in batches. Returns counts of deleted and created records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          new_records: {
            type: "array",
            items: { type: "object" },
            description: "Complete new set of records: [{fields:{Name:'Alice',Status:'Active'}},...]",
          },
          typecast: { type: "boolean", description: "Auto-convert string values" },
          confirm_replace_all: { type: "boolean", description: "Must be true to confirm destructive operation" },
        },
        required: ["base_id", "table_id_or_name", "new_records", "confirm_replace_all"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deletedCount: { type: "number" },
          createdCount: { type: "number" },
          createdRecords: { type: "array", items: { type: "object" } },
        },
        required: ["deletedCount", "createdCount"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "sync_records_from_data",
      title: "Sync Records From Data",
      description:
        "Sync a flat array of data objects into an Airtable table. Handles create and update intelligently: looks up each record by match_field value, creates missing ones, updates existing ones. Accepts flat field objects (not wrapped in {fields:...}). Supports syncing only specific fields. Returns detailed sync statistics.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          source_records: {
            type: "array",
            items: { type: "object" },
            description: "Flat data objects to sync: [{Email:'a@b.com',Name:'Alice',Status:'Active'},...]",
          },
          match_field: { type: "string", description: "Field used to match existing records (unique key). Example: 'Email'" },
          create_new: { type: "boolean", description: "Create records not in Airtable (default: true)" },
          update_existing: { type: "boolean", description: "Update records that already exist (default: true)" },
          fields_to_sync: {
            type: "array",
            items: { type: "string" },
            description: "Only sync these fields (omit for all fields in source_records)",
          },
          typecast: { type: "boolean", description: "Auto-convert string values (default: true)" },
        },
        required: ["base_id", "table_id_or_name", "source_records", "match_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          created: { type: "number" },
          updated: { type: "number" },
          skipped: { type: "number" },
          total: { type: "number" },
          batchesRun: { type: "number" },
          createdIds: { type: "array", items: { type: "string" } },
          updatedIds: { type: "array", items: { type: "string" } },
        },
        required: ["created", "updated", "total"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "diff_and_sync_records",
      title: "Diff and Sync Records",
      description:
        "Compare a desired state against Airtable and apply minimal changes. Computes a diff: which records to create, update, or optionally delete. Supports dry_run=true to preview changes without applying them. Perfect for idempotent data pipelines and change-minimal syncs.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          target_records: {
            type: "array",
            items: { type: "object" },
            description: "Desired state: flat objects [{Email:'a@b.com',Name:'Alice'},...]",
          },
          match_field: { type: "string", description: "Unique key field for matching. Example: 'Email'" },
          dry_run: { type: "boolean", description: "Preview diff without applying (default: false)" },
          delete_unmatched: { type: "boolean", description: "Delete existing records not in target_records (default: false)" },
          typecast: { type: "boolean", description: "Auto-convert string values (default: true)" },
        },
        required: ["base_id", "table_id_or_name", "target_records", "match_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          isDryRun: { type: "boolean" },
          toCreate: { type: "number" },
          toUpdate: { type: "number" },
          toDelete: { type: "number" },
          unchanged: { type: "number" },
          created: { type: "number" },
          updated: { type: "number" },
          deleted: { type: "number" },
          changes: { type: "array", items: { type: "object" } },
        },
        required: ["toCreate", "toUpdate", "toDelete"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  const BATCH_SIZE = 10;

  async function upsertBatch(
    client: AirtableClient,
    base_id: string,
    table_id_or_name: string,
    records: Array<{ fields: Record<string, unknown> }>,
    fieldsToMergeOn: string[],
    typecast?: boolean
  ): Promise<{ records: unknown[]; createdRecords: string[]; updatedRecords: string[] }> {
    const body: Record<string, unknown> = {
      records,
      fieldsToMergeOn,
    };
    if (typecast !== undefined) body.typecast = typecast;

    const result = await client.patch<{
      records?: unknown[];
      createdRecords?: string[];
      updatedRecords?: string[];
    }>(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body);

    return {
      records: result.records || [],
      createdRecords: result.createdRecords || [],
      updatedRecords: result.updatedRecords || [],
    };
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    bulk_upsert_records: async (args) => {
      const { base_id, table_id_or_name, records, fields_to_merge_on, typecast } = BulkUpsertRecordsSchema.parse(args);

      const allRecords: unknown[] = [];
      const allCreatedIds: string[] = [];
      const allUpdatedIds: string[] = [];
      let batchCount = 0;

      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);

        const result = await logger.time("tool.bulk_upsert_records.batch", () =>
          upsertBatch(client, base_id, table_id_or_name, batch, fields_to_merge_on, typecast)
        , { tool: "bulk_upsert_records", base_id, batchIndex: batchCount, batchSize: batch.length });

        allRecords.push(...result.records);
        allCreatedIds.push(...result.createdRecords);
        allUpdatedIds.push(...result.updatedRecords);
        batchCount++;
      }

      const response = {
        records: allRecords,
        createdRecords: allCreatedIds,
        updatedRecords: allUpdatedIds,
        createdCount: allCreatedIds.length,
        updatedCount: allUpdatedIds.length,
        totalProcessed: records.length,
        batchCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    replace_all_records: async (args) => {
      const { base_id, table_id_or_name, new_records, typecast, confirm_replace_all } = ReplaceAllRecordsSchema.parse(args);

      if (!confirm_replace_all) {
        throw new Error("replace_all_records: set confirm_replace_all=true to confirm this destructive operation");
      }

      // Step 1: Fetch all existing record IDs
      const existingIds: string[] = [];
      let offset: string | undefined;
      do {
        const q = new URLSearchParams();
        q.set("pageSize", "100");
        if (offset) q.set("offset", offset);
        const result = await client.get<{ records: Array<{ id: string }>; offset?: string }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
        );
        existingIds.push(...(result.records || []).map((r) => r.id));
        offset = result.offset;
      } while (offset);

      // Step 2: Delete all existing records in batches of 10
      let deletedCount = 0;
      for (let i = 0; i < existingIds.length; i += BATCH_SIZE) {
        const batch = existingIds.slice(i, i + BATCH_SIZE);
        const q = new URLSearchParams();
        batch.forEach((id) => q.append("records[]", id));
        await logger.time("tool.replace_all_records.delete_batch", () =>
          client.delete(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`)
        , { tool: "replace_all_records", base_id, phase: "delete" });
        deletedCount += batch.length;
      }

      // Step 3: Create new records in batches of 10
      const createdRecords: unknown[] = [];
      for (let i = 0; i < new_records.length; i += BATCH_SIZE) {
        const batch = new_records.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== undefined) body.typecast = typecast;
        const result = await logger.time("tool.replace_all_records.create_batch", () =>
          client.post<{ records?: unknown[] }>(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body)
        , { tool: "replace_all_records", base_id, phase: "create" });
        createdRecords.push(...(result.records || []));
      }

      const response = { deletedCount, createdCount: createdRecords.length, createdRecords };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    sync_records_from_data: async (args) => {
      const {
        base_id, table_id_or_name, source_records, match_field,
        create_new, update_existing, fields_to_sync, typecast,
      } = SyncRecordsFromDataSchema.parse(args);

      // Fetch existing records to build a lookup map by match_field value
      const existingMap = new Map<string, string>(); // matchValue → recordId
      let offset: string | undefined;
      do {
        const q = new URLSearchParams();
        q.set("pageSize", "100");
        q.append("fields[]", match_field);
        if (offset) q.set("offset", offset);
        const result = await client.get<{ records: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
        );
        for (const rec of result.records || []) {
          const key = String(rec.fields[match_field] ?? "");
          if (key) existingMap.set(key, rec.id);
        }
        offset = result.offset;
      } while (offset);

      const toCreate: Array<{ fields: Record<string, unknown> }> = [];
      const toUpdate: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let skipped = 0;

      for (const src of source_records) {
        const matchVal = String(src[match_field] ?? "");
        const fields: Record<string, unknown> = {};

        // Build field set (filter if fields_to_sync provided)
        for (const [k, v] of Object.entries(src)) {
          if (!fields_to_sync || fields_to_sync.includes(k)) {
            fields[k] = v;
          }
        }

        const existingId = existingMap.get(matchVal);
        if (existingId) {
          if (update_existing !== false) {
            toUpdate.push({ id: existingId, fields });
          } else {
            skipped++;
          }
        } else {
          if (create_new !== false) {
            toCreate.push({ fields });
          } else {
            skipped++;
          }
        }
      }

      // Execute creates and updates in batches
      const createdIds: string[] = [];
      const updatedIds: string[] = [];
      let batchesRun = 0;

      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const batch = toCreate.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== false) body.typecast = true;
        const result = await client.post<{ records?: Array<{ id: string }> }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body
        );
        for (const r of result.records || []) createdIds.push(r.id);
        batchesRun++;
      }

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== false) body.typecast = true;
        const result = await client.patch<{ records?: Array<{ id: string }> }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body
        );
        for (const r of result.records || []) updatedIds.push(r.id);
        batchesRun++;
      }

      const response = {
        created: createdIds.length,
        updated: updatedIds.length,
        skipped,
        total: source_records.length,
        batchesRun,
        createdIds,
        updatedIds,
        matchField: match_field,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    diff_and_sync_records: async (args) => {
      const {
        base_id, table_id_or_name, target_records, match_field,
        dry_run, delete_unmatched, typecast,
      } = DiffAndSyncRecordsSchema.parse(args);

      // Fetch all existing records
      const existingMap = new Map<string, { id: string; fields: Record<string, unknown> }>();
      let offset: string | undefined;
      do {
        const q = new URLSearchParams();
        q.set("pageSize", "100");
        if (offset) q.set("offset", offset);
        const result = await client.get<{ records: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
        );
        for (const rec of result.records || []) {
          const key = String(rec.fields[match_field] ?? "");
          if (key) existingMap.set(key, { id: rec.id, fields: rec.fields });
        }
        offset = result.offset;
      } while (offset);

      const targetKeys = new Set(target_records.map((r) => String(r[match_field] ?? "")));

      const toCreate: Array<{ fields: Record<string, unknown> }> = [];
      const toUpdate: Array<{ id: string; fields: Record<string, unknown>; matchValue: string }> = [];
      const toDelete: string[] = [];
      const changes: Array<{ action: string; matchValue: string; fields?: Record<string, unknown> }> = [];
      let unchanged = 0;

      // Determine creates and updates
      for (const targetRec of target_records) {
        const matchVal = String(targetRec[match_field] ?? "");
        const existing = existingMap.get(matchVal);

        if (!existing) {
          toCreate.push({ fields: targetRec as Record<string, unknown> });
          changes.push({ action: "create", matchValue: matchVal, fields: targetRec as Record<string, unknown> });
        } else {
          // Check if any fields differ
          let hasDiff = false;
          for (const [k, v] of Object.entries(targetRec)) {
            if (JSON.stringify(existing.fields[k]) !== JSON.stringify(v)) {
              hasDiff = true;
              break;
            }
          }
          if (hasDiff) {
            toUpdate.push({ id: existing.id, fields: targetRec as Record<string, unknown>, matchValue: matchVal });
            changes.push({ action: "update", matchValue: matchVal, fields: targetRec as Record<string, unknown> });
          } else {
            unchanged++;
          }
        }
      }

      // Determine deletes
      if (delete_unmatched) {
        for (const [key, existing] of existingMap.entries()) {
          if (!targetKeys.has(key)) {
            toDelete.push(existing.id);
            changes.push({ action: "delete", matchValue: key });
          }
        }
      }

      if (dry_run) {
        const response = {
          isDryRun: true,
          toCreate: toCreate.length,
          toUpdate: toUpdate.length,
          toDelete: toDelete.length,
          unchanged,
          created: 0,
          updated: 0,
          deleted: 0,
          changes,
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      // Apply changes
      let created = 0;
      let updated = 0;
      let deleted = 0;

      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const batch = toCreate.slice(i, i + BATCH_SIZE);
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== false) body.typecast = true;
        const result = await client.post<{ records?: Array<{ id: string }> }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body
        );
        created += (result.records || []).length;
      }

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE).map(({ id, fields }) => ({ id, fields }));
        const body: Record<string, unknown> = { records: batch };
        if (typecast !== false) body.typecast = true;
        const result = await client.patch<{ records?: Array<{ id: string }> }>(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}`, body
        );
        updated += (result.records || []).length;
      }

      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = toDelete.slice(i, i + BATCH_SIZE);
        const q = new URLSearchParams();
        batch.forEach((id) => q.append("records[]", id));
        await client.delete(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`);
        deleted += batch.length;
      }

      const response = {
        isDryRun: false,
        toCreate: toCreate.length,
        toUpdate: toUpdate.length,
        toDelete: toDelete.length,
        unchanged,
        created,
        updated,
        deleted,
        changes,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
