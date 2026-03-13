// Airtable Base Schema Diff tools: compare_base_schemas, detect_schema_drift,
//   get_schema_snapshot, compare_table_schemas, list_schema_changes,
//   validate_schema_against_spec
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetSchemaSnapshotSchema = z.object({
  base_id: z.string().describe("Airtable base ID to snapshot"),
  include_field_options: z.boolean().optional().default(true).describe("Include field options like select choices"),
});

const CompareTableSchemasSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_a: z.string().describe("First table ID or name"),
  table_b: z.string().describe("Second table ID or name"),
});

const DetectSchemaChangesSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  expected_schema: z.object({
    tables: z.array(z.object({
      name: z.string(),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string().optional(),
      })),
    })),
  }).describe("Expected schema specification to compare against"),
});

const CompareBaseFieldsSchema = z.object({
  base_id_a: z.string().describe("First base ID"),
  base_id_b: z.string().describe("Second base ID"),
  table_name: z.string().describe("Table name to compare across bases"),
});

const ValidateSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  required_tables: z.array(z.string()).optional().describe("Table names that must exist"),
  required_fields: z.record(z.array(z.string())).optional().describe("Map of table name to required field names"),
  field_type_requirements: z.record(z.record(z.string())).optional().describe("Map of tableName -> fieldName -> requiredType"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_schema_snapshot",
      title: "Get Schema Snapshot",
      description:
        "Capture a complete schema snapshot of an Airtable base — all tables, fields, types, and options. Use as a baseline to compare against later or to document the current schema state.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          include_field_options: { type: "boolean", description: "Include select options and other field config" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          captured_at: { type: "string" },
          tables: { type: "array", items: { type: "object" } },
          table_count: { type: "number" },
          total_fields: { type: "number" },
        },
        required: ["tables", "table_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "compare_table_schemas",
      title: "Compare Table Schemas",
      description:
        "Compare two tables' schemas within the same base — find fields that exist in one but not the other, fields with different types, and common fields. Useful for ensuring consistency across similar tables.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_a: { type: "string", description: "First table ID or name" },
          table_b: { type: "string", description: "Second table ID or name" },
        },
        required: ["base_id", "table_a", "table_b"],
      },
      outputSchema: {
        type: "object",
        properties: {
          only_in_a: { type: "array", items: { type: "object" } },
          only_in_b: { type: "array", items: { type: "object" } },
          in_both: { type: "array", items: { type: "object" } },
          type_mismatches: { type: "array", items: { type: "object" } },
          similarity_score: { type: "number" },
        },
        required: ["only_in_a", "only_in_b", "in_both"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "detect_schema_drift",
      title: "Detect Schema Drift",
      description:
        "Compare a base's actual schema against an expected schema specification. Detects missing tables, missing fields, wrong field types, and unexpected additions. Returns a drift report with severities.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          expected_schema: {
            type: "object",
            properties: {
              tables: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    fields: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { name: { type: "string" }, type: { type: "string" } },
                        required: ["name"],
                      },
                    },
                  },
                  required: ["name", "fields"],
                },
              },
            },
            required: ["tables"],
          },
        },
        required: ["base_id", "expected_schema"],
      },
      outputSchema: {
        type: "object",
        properties: {
          drifted: { type: "boolean" },
          missing_tables: { type: "array", items: { type: "string" } },
          extra_tables: { type: "array", items: { type: "string" } },
          field_issues: { type: "array", items: { type: "object" } },
          summary: { type: "string" },
        },
        required: ["drifted", "missing_tables", "field_issues"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "compare_base_fields",
      title: "Compare Base Fields",
      description:
        "Compare a specific table's fields across two different Airtable bases — find differences in field names, types, and configuration. Useful when you have staging/production environments.",
      inputSchema: {
        type: "object",
        properties: {
          base_id_a: { type: "string", description: "First base ID" },
          base_id_b: { type: "string", description: "Second base ID" },
          table_name: { type: "string", description: "Table name to compare in both bases" },
        },
        required: ["base_id_a", "base_id_b", "table_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          table_name: { type: "string" },
          only_in_base_a: { type: "array" },
          only_in_base_b: { type: "array" },
          in_both: { type: "array" },
          type_differences: { type: "array" },
        },
        required: ["only_in_base_a", "only_in_base_b", "in_both"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "validate_schema",
      title: "Validate Schema",
      description:
        "Validate a base schema against requirements — check for required tables, required fields in each table, and correct field types. Returns a validation report with pass/fail status for each check.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          required_tables: { type: "array", items: { type: "string" }, description: "Table names that must exist" },
          required_fields: { type: "object", description: "tableName -> [fieldName, ...] that must exist" },
          field_type_requirements: { type: "object", description: "tableName -> fieldName -> requiredType" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          valid: { type: "boolean" },
          checks: { type: "array", items: { type: "object" } },
          passed: { type: "number" },
          failed: { type: "number" },
        },
        required: ["valid", "checks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_schema_snapshot: async (args) => {
      const { base_id, include_field_options } = GetSchemaSnapshotSchema.parse(args);

      const schema = await logger.time("tool.get_schema_snapshot", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_schema_snapshot", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: unknown }> }> };

      const tables = schema.tables.map((t) => ({
        id: t.id,
        name: t.name,
        field_count: t.fields.length,
        fields: t.fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(include_field_options && f.options ? { options: f.options } : {}),
        })),
      }));

      const totalFields = tables.reduce((sum, t) => sum + t.field_count, 0);

      const data = {
        base_id,
        captured_at: new Date().toISOString(),
        tables,
        table_count: tables.length,
        total_fields: totalFields,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    compare_table_schemas: async (args) => {
      const { base_id, table_a, table_b } = CompareTableSchemasSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };
      const tA = schema.tables.find((t) => t.id === table_a || t.name === table_a);
      const tB = schema.tables.find((t) => t.id === table_b || t.name === table_b);
      if (!tA) throw new Error(`Table '${table_a}' not found`);
      if (!tB) throw new Error(`Table '${table_b}' not found`);

      const mapA = new Map(tA.fields.map((f) => [f.name, f]));
      const mapB = new Map(tB.fields.map((f) => [f.name, f]));

      const onlyInA = tA.fields.filter((f) => !mapB.has(f.name));
      const onlyInB = tB.fields.filter((f) => !mapA.has(f.name));
      const inBoth: Array<{ name: string; type_a: string; type_b: string }> = [];
      const typeMismatches: Array<{ name: string; type_a: string; type_b: string }> = [];

      for (const [name, fa] of mapA) {
        const fb = mapB.get(name);
        if (fb) {
          inBoth.push({ name, type_a: fa.type, type_b: fb.type });
          if (fa.type !== fb.type) typeMismatches.push({ name, type_a: fa.type, type_b: fb.type });
        }
      }

      const maxFields = Math.max(tA.fields.length, tB.fields.length);
      const similarityScore = maxFields > 0 ? Math.round(inBoth.length / maxFields * 100) : 100;

      const data = { only_in_a: onlyInA, only_in_b: onlyInB, in_both: inBoth, type_mismatches: typeMismatches, similarity_score: similarityScore };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    detect_schema_drift: async (args) => {
      const { base_id, expected_schema } = DetectSchemaChangesSchema.parse(args);

      const actual = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };
      const actualTableMap = new Map(actual.tables.map((t) => [t.name, t]));
      const expectedTableNames = new Set(expected_schema.tables.map((t) => t.name));

      const missingTables = expected_schema.tables.map((t) => t.name).filter((n) => !actualTableMap.has(n));
      const extraTables = actual.tables.map((t) => t.name).filter((n) => !expectedTableNames.has(n));

      const fieldIssues: unknown[] = [];

      for (const expectedTable of expected_schema.tables) {
        const actualTable = actualTableMap.get(expectedTable.name);
        if (!actualTable) continue;
        const actualFieldMap = new Map(actualTable.fields.map((f) => [f.name, f]));

        for (const ef of expectedTable.fields) {
          const af = actualFieldMap.get(ef.name);
          if (!af) {
            fieldIssues.push({ table: expectedTable.name, field: ef.name, issue: "missing", severity: "error" });
          } else if (ef.type && af.type !== ef.type) {
            fieldIssues.push({ table: expectedTable.name, field: ef.name, issue: "type_mismatch", expected: ef.type, actual: af.type, severity: "warning" });
          }
        }
      }

      const drifted = missingTables.length > 0 || fieldIssues.length > 0;
      const summary = drifted
        ? `Schema drift detected: ${missingTables.length} missing tables, ${fieldIssues.length} field issues`
        : "Schema matches expected specification";

      const data = { drifted, missing_tables: missingTables, extra_tables: extraTables, field_issues: fieldIssues, summary };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    compare_base_fields: async (args) => {
      const { base_id_a, base_id_b, table_name } = CompareBaseFieldsSchema.parse(args);

      const [schemaA, schemaB] = await Promise.all([
        client.get(`/v0/meta/bases/${base_id_a}/tables`),
        client.get(`/v0/meta/bases/${base_id_b}/tables`),
      ]) as [
        { tables: Array<{ name: string; fields: Array<{ name: string; type: string }> }> },
        { tables: Array<{ name: string; fields: Array<{ name: string; type: string }> }> }
      ];

      const tA = schemaA.tables.find((t) => t.name === table_name);
      const tB = schemaB.tables.find((t) => t.name === table_name);

      if (!tA) throw new Error(`Table '${table_name}' not found in base_id_a`);
      if (!tB) throw new Error(`Table '${table_name}' not found in base_id_b`);

      const mapA = new Map(tA.fields.map((f) => [f.name, f]));
      const mapB = new Map(tB.fields.map((f) => [f.name, f]));

      const onlyInA = tA.fields.filter((f) => !mapB.has(f.name));
      const onlyInB = tB.fields.filter((f) => !mapA.has(f.name));
      const inBoth = tA.fields.filter((f) => mapB.has(f.name)).map((f) => ({ name: f.name, type_a: f.type, type_b: mapB.get(f.name)!.type }));
      const typeDifferences = inBoth.filter((f) => f.type_a !== f.type_b);

      const data = { table_name, only_in_base_a: onlyInA, only_in_base_b: onlyInB, in_both: inBoth, type_differences: typeDifferences };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    validate_schema: async (args) => {
      const { base_id, required_tables, required_fields, field_type_requirements } = ValidateSchemaSchema.parse(args);

      const schema = await logger.time("tool.validate_schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "validate_schema", base_id }) as { tables: Array<{ name: string; fields: Array<{ name: string; type: string }> }> };

      const checks: Array<{ check: string; passed: boolean; details: string }> = [];
      const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

      if (required_tables) {
        for (const tn of required_tables) {
          const exists = tableMap.has(tn);
          checks.push({ check: `Table '${tn}' exists`, passed: exists, details: exists ? "OK" : `Table '${tn}' is missing` });
        }
      }

      if (required_fields) {
        for (const [tableName, fields] of Object.entries(required_fields)) {
          const table = tableMap.get(tableName);
          if (!table) {
            checks.push({ check: `Fields in '${tableName}'`, passed: false, details: `Table '${tableName}' not found` });
            continue;
          }
          const fieldMap = new Map(table.fields.map((f) => [f.name, f]));
          for (const fn of fields) {
            const exists = fieldMap.has(fn);
            checks.push({ check: `Field '${fn}' in '${tableName}'`, passed: exists, details: exists ? "OK" : `Field '${fn}' missing from '${tableName}'` });
          }
        }
      }

      if (field_type_requirements) {
        for (const [tableName, fieldTypes] of Object.entries(field_type_requirements)) {
          const table = tableMap.get(tableName);
          if (!table) continue;
          const fieldMap = new Map(table.fields.map((f) => [f.name, f]));
          for (const [fieldName, requiredType] of Object.entries(fieldTypes)) {
            const field = fieldMap.get(fieldName);
            if (!field) {
              checks.push({ check: `Type of '${fieldName}' in '${tableName}'`, passed: false, details: `Field not found` });
            } else {
              const correct = field.type === requiredType;
              checks.push({ check: `Type of '${fieldName}' in '${tableName}'`, passed: correct, details: correct ? "OK" : `Expected ${requiredType}, got ${field.type}` });
            }
          }
        }
      }

      const passed = checks.filter((c) => c.passed).length;
      const failed = checks.filter((c) => !c.passed).length;

      const data = { valid: failed === 0, checks, passed, failed };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
