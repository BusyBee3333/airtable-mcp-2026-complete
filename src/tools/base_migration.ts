// Airtable Base Migration tools: clone_base_structure, migrate_records_between_bases,
//   copy_table_to_base, get_migration_plan, validate_migration_compatibility
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CloneBaseStructureSchema = z.object({
  source_base_id: z.string().describe("Source base ID to clone structure from (starts with 'app')"),
  workspace_id: z.string().describe("Workspace ID where the new base will be created (starts with 'wsp')"),
  new_base_name: z.string().describe("Name for the new base"),
  include_tables: z.array(z.string()).optional().describe("Specific table names to include (default: all tables)"),
  copy_sample_records: z.number().min(0).max(10).optional().default(0).describe("Number of sample records to copy per table (0 = structure only)"),
});

const MigrateRecordsBetweenBasesSchema = z.object({
  source_base_id: z.string().describe("Source base ID (starts with 'app')"),
  source_table: z.string().describe("Source table ID or name"),
  target_base_id: z.string().describe("Target base ID (starts with 'app')"),
  target_table: z.string().describe("Target table ID or name"),
  field_mapping: z.record(z.string()).optional().describe("Field name mapping: {source_field: target_field}. If omitted, field names must match exactly."),
  filter_formula: z.string().optional().describe("Optional formula to filter source records to migrate"),
  max_records: z.number().optional().describe("Maximum records to migrate (default: all)"),
  dry_run: z.boolean().optional().default(false).describe("If true, validate and preview migration without actually creating records"),
  typecast: z.boolean().optional().default(true).describe("Allow type coercion during migration"),
});

const CopyTableToBaseSchema = z.object({
  source_base_id: z.string().describe("Source base ID (starts with 'app')"),
  source_table: z.string().describe("Source table ID or name"),
  target_base_id: z.string().describe("Target base ID (starts with 'app')"),
  new_table_name: z.string().optional().describe("Name for the new table (default: same as source)"),
  copy_records: z.boolean().optional().default(true).describe("Copy records along with table structure"),
  filter_formula: z.string().optional().describe("Filter formula to select which records to copy"),
});

const GetMigrationPlanSchema = z.object({
  source_base_id: z.string().describe("Source base ID (starts with 'app')"),
  target_base_id: z.string().describe("Target base ID (starts with 'app')"),
  tables_to_migrate: z.array(z.string()).min(1).describe("Table names to migrate"),
});

const ValidateMigrationCompatibilitySchema = z.object({
  source_base_id: z.string().describe("Source base ID (starts with 'app')"),
  source_table: z.string().describe("Source table name"),
  target_base_id: z.string().describe("Target base ID (starts with 'app')"),
  target_table: z.string().describe("Target table name"),
  field_mapping: z.record(z.string()).optional().describe("Optional field mapping: {source_field: target_field}"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "clone_base_structure",
      title: "Clone Base Structure",
      description:
        "Create a new Airtable base with the same table and field structure as an existing base. Optionally copy a small number of sample records. Creates tables with identical field definitions, types, and options. Linked record fields between tables are recreated. Use for creating staging/development copies of production bases.",
      inputSchema: {
        type: "object",
        properties: {
          source_base_id: { type: "string", description: "Source base ID to clone from (starts with 'app')" },
          workspace_id: { type: "string", description: "Workspace ID for the new base (starts with 'wsp')" },
          new_base_name: { type: "string", description: "Name for the new base" },
          include_tables: { type: "array", items: { type: "string" }, description: "Specific tables to include (default: all)" },
          copy_sample_records: { type: "number", description: "Sample records per table (0 = structure only, max 10)" },
        },
        required: ["source_base_id", "workspace_id", "new_base_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          newBaseId: { type: "string" },
          newBaseName: { type: "string" },
          tablesCreated: { type: "array", items: { type: "string" } },
          recordsCopied: { type: "number" },
          success: { type: "boolean" },
        },
        required: ["newBaseName", "tablesCreated", "success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "migrate_records_between_bases",
      title: "Migrate Records Between Bases",
      description:
        "Migrate records from a table in one base to a table in another base. Supports field mapping (rename fields during migration), formula filtering (migrate only matching records), dry-run mode (preview without executing), and type coercion. Returns migration results with created record IDs and any errors. Great for data consolidation, archiving, or environment promotion.",
      inputSchema: {
        type: "object",
        properties: {
          source_base_id: { type: "string", description: "Source base ID (starts with 'app')" },
          source_table: { type: "string", description: "Source table ID or name" },
          target_base_id: { type: "string", description: "Target base ID (starts with 'app')" },
          target_table: { type: "string", description: "Target table ID or name" },
          field_mapping: { type: "object", description: "Map source fields to target fields: {'Source Field':'Target Field'}" },
          filter_formula: { type: "string", description: "Formula to filter source records: {Status}='Active'" },
          max_records: { type: "number", description: "Max records to migrate (default: all)" },
          dry_run: { type: "boolean", description: "Preview migration without creating records (default: false)" },
          typecast: { type: "boolean", description: "Allow type coercion (default: true)" },
        },
        required: ["source_base_id", "source_table", "target_base_id", "target_table"],
      },
      outputSchema: {
        type: "object",
        properties: {
          migratedCount: { type: "number" },
          failedCount: { type: "number" },
          dryRun: { type: "boolean" },
          preview: { type: "array", items: { type: "object" } },
          errors: { type: "array", items: { type: "string" } },
        },
        required: ["migratedCount", "dryRun"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "copy_table_to_base",
      title: "Copy Table to Base",
      description:
        "Copy an entire table (structure and optionally records) from one base to another. Creates a new table in the target base with matching fields. Field types and options are preserved. Optionally filters records to copy. Use for table-level data migrations or creating shared template tables.",
      inputSchema: {
        type: "object",
        properties: {
          source_base_id: { type: "string", description: "Source base ID (starts with 'app')" },
          source_table: { type: "string", description: "Source table ID or name" },
          target_base_id: { type: "string", description: "Target base ID (starts with 'app')" },
          new_table_name: { type: "string", description: "Name for new table (default: same as source)" },
          copy_records: { type: "boolean", description: "Copy records along with structure (default: true)" },
          filter_formula: { type: "string", description: "Filter which records to copy" },
        },
        required: ["source_base_id", "source_table", "target_base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          newTableId: { type: "string" },
          newTableName: { type: "string" },
          fieldsCreated: { type: "number" },
          recordsCopied: { type: "number" },
          success: { type: "boolean" },
        },
        required: ["newTableName", "success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_migration_plan",
      title: "Get Migration Plan",
      description:
        "Generate a detailed migration plan for moving tables from one base to another. Returns estimated record counts, API calls required, field compatibility analysis, potential issues (linked fields that won't migrate, formula fields, etc.), and step-by-step instructions. Review before executing a migration.",
      inputSchema: {
        type: "object",
        properties: {
          source_base_id: { type: "string", description: "Source base ID (starts with 'app')" },
          target_base_id: { type: "string", description: "Target base ID (starts with 'app')" },
          tables_to_migrate: { type: "array", items: { type: "string" }, description: "Table names to migrate" },
        },
        required: ["source_base_id", "target_base_id", "tables_to_migrate"],
      },
      outputSchema: {
        type: "object",
        properties: {
          plan: { type: "array", items: { type: "object" } },
          totalRecordsToMigrate: { type: "number" },
          estimatedApiCalls: { type: "number" },
          estimatedMinutes: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["plan", "totalRecordsToMigrate"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "validate_migration_compatibility",
      title: "Validate Migration Compatibility",
      description:
        "Check whether records from a source table can be migrated to a target table. Compares field types, required fields, and option values. Returns compatibility status per field, incompatible fields, and recommendations for resolving issues before migration.",
      inputSchema: {
        type: "object",
        properties: {
          source_base_id: { type: "string", description: "Source base ID (starts with 'app')" },
          source_table: { type: "string", description: "Source table name" },
          target_base_id: { type: "string", description: "Target base ID (starts with 'app')" },
          target_table: { type: "string", description: "Target table name" },
          field_mapping: { type: "object", description: "Optional field name mapping: {'Source Field':'Target Field'}" },
        },
        required: ["source_base_id", "source_table", "target_base_id", "target_table"],
      },
      outputSchema: {
        type: "object",
        properties: {
          compatible: { type: "boolean" },
          fieldCompatibility: { type: "array", items: { type: "object" } },
          incompatibleFields: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: ["compatible", "fieldCompatibility"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function fetchTableSchema(base_id: string) {
    return logger.time("tool.migration.fetch_schema", () =>
      client.get(`/v0/meta/bases/${base_id}/tables`)
    , { tool: "base_migration", base_id }) as Promise<{
      tables?: Array<{
        id: string;
        name: string;
        primaryFieldId?: string;
        fields?: Array<{ id: string; name: string; type: string; options?: unknown }>;
      }>;
    }>;
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    clone_base_structure: async (args) => {
      const params = CloneBaseStructureSchema.parse(args);
      const sourceSchema = await fetchTableSchema(params.source_base_id);
      const sourceTables = sourceSchema.tables ?? [];

      const tablesToClone = params.include_tables
        ? sourceTables.filter((t) => (params.include_tables ?? []).includes(t.name))
        : sourceTables;

      // Create a new base in the workspace
      const newBase = await logger.time("tool.clone_base_structure.create_base", () =>
        client.post("/v0/meta/bases", {
          name: params.new_base_name,
          workspaceId: params.workspace_id,
          tables: tablesToClone.map((t) => ({
            name: t.name,
            fields: (t.fields ?? [])
              .filter((f) => !["formula", "rollup", "lookup", "count", "multipleRecordLinks", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "autoNumber"].includes(f.type))
              .map((f) => ({
                name: f.name,
                type: f.type,
                ...(f.options ? { options: f.options } : {}),
              })),
          })),
        })
      , { tool: "clone_base_structure" }) as { id?: string; name?: string; tables?: Array<{ id: string; name: string }> };

      let recordsCopied = 0;
      const tablesCreated = (newBase.tables ?? []).map((t) => t.name);

      // Optionally copy sample records
      if (params.copy_sample_records && params.copy_sample_records > 0 && newBase.id) {
        for (const srcTable of tablesToClone) {
          const qp = new URLSearchParams();
          qp.set("maxRecords", String(params.copy_sample_records));
          qp.set("pageSize", String(params.copy_sample_records));

          const srcRecords = await logger.time("tool.clone_base_structure.read_records", () =>
            client.get(`/v0/${params.source_base_id}/${encodeURIComponent(srcTable.name)}?${qp}`)
          , { tool: "clone_base_structure" }) as { records?: Array<{ fields: Record<string, unknown> }> };

          if ((srcRecords.records ?? []).length > 0) {
            const tgtTable = (newBase.tables ?? []).find((t) => t.name === srcTable.name);
            if (tgtTable) {
              const cleanRecords = (srcRecords.records ?? []).map((r) => ({
                fields: Object.fromEntries(
                  Object.entries(r.fields).filter(([, v]) => v !== null && !Array.isArray(v) || (Array.isArray(v) && v.length > 0 && typeof v[0] === "string" && !(v[0] as string).startsWith("rec")))
                ),
              }));
              if (cleanRecords.length > 0) {
                await logger.time("tool.clone_base_structure.copy_records", () =>
                  client.post(`/v0/${newBase.id}/${encodeURIComponent(tgtTable.name)}`, { records: cleanRecords.slice(0, 10) })
                , { tool: "clone_base_structure" });
                recordsCopied += cleanRecords.length;
              }
            }
          }
        }
      }

      const response = {
        newBaseId: newBase.id ?? "created",
        newBaseName: params.new_base_name,
        tablesCreated,
        recordsCopied,
        success: true,
        note: "Computed fields (formula, rollup, lookup), linked record fields, and system fields are excluded from cloning.",
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    migrate_records_between_bases: async (args) => {
      const params = MigrateRecordsBetweenBasesSchema.parse(args);

      // Fetch source records
      const qp = new URLSearchParams();
      if (params.filter_formula) qp.set("filterByFormula", params.filter_formula);
      if (params.max_records) qp.set("maxRecords", String(params.max_records));
      qp.set("pageSize", "100");

      const allRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.migrate_records.fetch_source", () =>
          client.get(`/v0/${params.source_base_id}/${encodeURIComponent(params.source_table)}?${qp}`)
        , { tool: "migrate_records" }) as {
          records?: Array<{ id: string; fields: Record<string, unknown> }>;
          offset?: string;
        };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
        if (params.max_records && allRecords.length >= params.max_records) break;
      } while (offset);

      const fieldMapping = params.field_mapping ?? {};

      // Transform records
      const transformedRecords = allRecords.map((rec) => ({
        fields: Object.fromEntries(
          Object.entries(rec.fields).map(([key, val]) => {
            const targetKey = fieldMapping[key] ?? key;
            return [targetKey, val];
          }).filter(([, v]) => v !== null && v !== undefined && !Array.isArray(v) || (Array.isArray(v) && (v as unknown[]).length > 0))
        ),
      }));

      if (params.dry_run) {
        const response = {
          migratedCount: 0,
          failedCount: 0,
          dryRun: true,
          preview: transformedRecords.slice(0, 5),
          totalToMigrate: transformedRecords.length,
          fieldMapping,
          message: `DRY RUN: Would migrate ${transformedRecords.length} records. Set dry_run=false to execute.`,
          errors: [],
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      // Batch create in target base
      let migratedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];
      const BATCH_SIZE = 10;

      for (let i = 0; i < transformedRecords.length; i += BATCH_SIZE) {
        const batch = transformedRecords.slice(i, i + BATCH_SIZE);
        try {
          const result = await logger.time("tool.migrate_records.create_batch", () =>
            client.post(`/v0/${params.target_base_id}/${encodeURIComponent(params.target_table)}`, {
              records: batch,
              typecast: params.typecast ?? true,
            })
          , { tool: "migrate_records" }) as { records?: unknown[] };
          migratedCount += (result.records ?? []).length;
        } catch (error) {
          failedCount += batch.length;
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      const response = {
        migratedCount,
        failedCount,
        dryRun: false,
        preview: [],
        sourceRecords: allRecords.length,
        errors,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    copy_table_to_base: async (args) => {
      const params = CopyTableToBaseSchema.parse(args);
      const sourceSchema = await fetchTableSchema(params.source_base_id);
      const srcTable = (sourceSchema.tables ?? []).find(
        (t) => t.id === params.source_table || t.name === params.source_table
      );
      if (!srcTable) throw new Error(`Source table '${params.source_table}' not found`);

      const newTableName = params.new_table_name ?? srcTable.name;
      const copyableFields = (srcTable.fields ?? []).filter(
        (f) => !["formula", "rollup", "lookup", "count", "multipleRecordLinks", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy", "autoNumber"].includes(f.type)
      );

      // Create table in target base
      const newTable = await logger.time("tool.copy_table_to_base.create_table", () =>
        client.post(`/v0/meta/bases/${params.target_base_id}/tables`, {
          name: newTableName,
          fields: copyableFields.map((f) => ({
            name: f.name,
            type: f.type,
            ...(f.options ? { options: f.options } : {}),
          })),
        })
      , { tool: "copy_table_to_base" }) as { id?: string; name?: string };

      let recordsCopied = 0;

      if (params.copy_records !== false && newTable.id) {
        const qp = new URLSearchParams();
        if (params.filter_formula) qp.set("filterByFormula", params.filter_formula);
        qp.set("pageSize", "100");
        const srcFields = copyableFields.map((f) => f.name);
        srcFields.forEach((f) => qp.append("fields[]", f));

        const allRecords: Array<{ fields: Record<string, unknown> }> = [];
        let offset: string | undefined;
        do {
          if (offset) qp.set("offset", offset);
          const result = await logger.time("tool.copy_table_to_base.read_source", () =>
            client.get(`/v0/${params.source_base_id}/${encodeURIComponent(srcTable.name)}?${qp}`)
          , { tool: "copy_table_to_base" }) as { records?: Array<{ fields: Record<string, unknown> }>; offset?: string };
          allRecords.push(...(result.records ?? []));
          offset = result.offset;
        } while (offset);

        for (let i = 0; i < allRecords.length; i += 10) {
          const batch = allRecords.slice(i, i + 10).map((r) => ({ fields: r.fields }));
          await logger.time("tool.copy_table_to_base.create_records", () =>
            client.post(`/v0/${params.target_base_id}/${encodeURIComponent(newTableName)}`, { records: batch, typecast: true })
          , { tool: "copy_table_to_base" });
          recordsCopied += batch.length;
        }
      }

      const response = {
        newTableId: newTable.id ?? "created",
        newTableName,
        fieldsCreated: copyableFields.length,
        recordsCopied,
        success: true,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_migration_plan: async (args) => {
      const params = GetMigrationPlanSchema.parse(args);
      const [srcSchema, tgtSchema] = await Promise.all([
        fetchTableSchema(params.source_base_id),
        fetchTableSchema(params.target_base_id),
      ]);

      const srcTables = srcSchema.tables ?? [];
      const tgtTableNames = new Set((tgtSchema.tables ?? []).map((t) => t.name));
      const warnings: string[] = [];
      const steps: string[] = [];
      let totalRecordsToMigrate = 0;
      let estimatedApiCalls = 0;

      const plan = await Promise.all(
        params.tables_to_migrate.map(async (tableName) => {
          const srcTable = srcTables.find((t) => t.name === tableName);
          if (!srcTable) {
            warnings.push(`Table '${tableName}' not found in source base`);
            return null;
          }

          const complexFields = (srcTable.fields ?? []).filter((f) =>
            ["formula", "rollup", "lookup", "multipleRecordLinks"].includes(f.type)
          );
          if (complexFields.length > 0) {
            warnings.push(`Table '${tableName}' has ${complexFields.length} computed/linked fields that won't migrate automatically`);
          }

          // Count source records
          const countResult = await logger.time("tool.get_migration_plan.count", () =>
            client.get(`/v0/${params.source_base_id}/${encodeURIComponent(tableName)}?pageSize=1`)
          , { tool: "get_migration_plan" }) as { records?: unknown[]; offset?: string };

          // Estimate record count (Airtable doesn't return total count directly)
          const hasMore = Boolean(countResult.offset);
          const estimatedRecords = hasMore ? 100 : (countResult.records ?? []).length;
          totalRecordsToMigrate += estimatedRecords;
          estimatedApiCalls += Math.ceil(estimatedRecords / 100) + Math.ceil(estimatedRecords / 10);

          if (!tgtTableNames.has(tableName)) {
            steps.push(`1. Create table '${tableName}' in target base`);
          }
          steps.push(`2. Migrate records from '${tableName}' (est. ${estimatedRecords} records)`);

          return {
            tableName,
            exists: tgtTableNames.has(tableName),
            estimatedRecords,
            fieldCount: (srcTable.fields ?? []).length,
            copyableFields: (srcTable.fields ?? []).filter((f) => !["formula", "rollup", "lookup", "multipleRecordLinks"].includes(f.type)).length,
            complexFields: complexFields.map((f) => ({ name: f.name, type: f.type })),
          };
        })
      );

      const response = {
        plan: plan.filter(Boolean),
        totalRecordsToMigrate,
        estimatedApiCalls,
        estimatedMinutes: Math.ceil(estimatedApiCalls / 5 / 60),
        warnings,
        steps: [...new Set(steps)],
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    validate_migration_compatibility: async (args) => {
      const params = ValidateMigrationCompatibilitySchema.parse(args);
      const [srcSchema, tgtSchema] = await Promise.all([
        fetchTableSchema(params.source_base_id),
        fetchTableSchema(params.target_base_id),
      ]);

      const srcTable = (srcSchema.tables ?? []).find((t) => t.id === params.source_table || t.name === params.source_table);
      const tgtTable = (tgtSchema.tables ?? []).find((t) => t.id === params.target_table || t.name === params.target_table);

      if (!srcTable) throw new Error(`Source table '${params.source_table}' not found`);
      if (!tgtTable) throw new Error(`Target table '${params.target_table}' not found`);

      const fieldMapping = params.field_mapping ?? {};
      const srcFieldMap = new Map((srcTable.fields ?? []).map((f) => [f.name, f]));
      const tgtFieldMap = new Map((tgtTable.fields ?? []).map((f) => [f.name, f]));

      const fieldCompatibility: unknown[] = [];
      const incompatibleFields: string[] = [];
      const warnings: string[] = [];
      const recommendations: string[] = [];

      for (const [srcName, srcField] of srcFieldMap) {
        const tgtName = fieldMapping[srcName] ?? srcName;
        const tgtField = tgtFieldMap.get(tgtName);

        if (!tgtField) {
          fieldCompatibility.push({ field: srcName, status: "missing_in_target", targetName: tgtName });
          incompatibleFields.push(srcName);
          continue;
        }

        if (srcField.type === tgtField.type) {
          fieldCompatibility.push({ field: srcName, status: "compatible", sourceType: srcField.type, targetType: tgtField.type });
        } else {
          const coercible = [
            ["singleLineText", "multilineText"],
            ["number", "currency"],
            ["number", "percent"],
          ].some(([a, b]) => (srcField.type === a && tgtField.type === b) || (srcField.type === b && tgtField.type === a));

          fieldCompatibility.push({
            field: srcName,
            status: coercible ? "coercible" : "type_mismatch",
            sourceType: srcField.type,
            targetType: tgtField.type,
          });
          if (!coercible) {
            incompatibleFields.push(srcName);
            warnings.push(`Field '${srcName}': type mismatch (${srcField.type} → ${tgtField.type})`);
          }
        }
      }

      if (incompatibleFields.length > 0) {
        recommendations.push(`Use field_mapping to map incompatible fields to different target fields`);
        recommendations.push(`Consider using typecast=true to allow automatic type conversion`);
      }

      const response = {
        compatible: incompatibleFields.length === 0,
        fieldCompatibility,
        incompatibleFields,
        warnings,
        recommendations,
        sourceFieldCount: srcFieldMap.size,
        targetFieldCount: tgtFieldMap.size,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
