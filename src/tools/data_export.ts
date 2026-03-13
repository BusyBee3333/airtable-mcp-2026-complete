// Airtable Data Export tools: export_table_to_csv, export_table_to_json,
//   export_multiple_tables, export_records_by_formula, get_export_summary
// These tools fetch all records and format them for export
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ExportTableToCsvSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  fields: z.array(z.string()).optional().describe("Fields to include in CSV (default: all fields)"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before export"),
  view: z.string().optional().describe("View ID or name to scope export (applies view's filters/sorts)"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort order for the CSV rows"),
  include_record_id: z.boolean().optional().default(false).describe("Include Airtable record ID as first column (default: false)"),
  include_created_time: z.boolean().optional().default(false).describe("Include record created time as a column (default: false)"),
  delimiter: z.enum([",", ";", "\t"]).optional().default(",").describe("CSV delimiter: comma (,), semicolon (;), or tab (\\t) (default: comma)"),
  max_records: z.number().min(1).optional().describe("Maximum records to export"),
});

const ExportTableToJsonSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  fields: z.array(z.string()).optional().describe("Fields to include (default: all)"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records"),
  view: z.string().optional().describe("View ID or name to scope export"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort order"),
  include_metadata: z.boolean().optional().default(false).describe("Include record ID and createdTime in each record (default: false)"),
  flatten_arrays: z.boolean().optional().default(true).describe("Flatten multi-select/linked record arrays to comma-separated strings (default: true)"),
  max_records: z.number().min(1).optional().describe("Maximum records to export"),
});

const ExportMultipleTablesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_ids_or_names: z.array(z.string()).min(1).max(10)
    .describe("Array of table IDs or names to export (max 10). Example: ['Contacts','Companies','Deals']"),
  include_metadata: z.boolean().optional().default(false).describe("Include record IDs and timestamps (default: false)"),
  max_records_per_table: z.number().min(1).optional().describe("Maximum records per table (optional)"),
});

const ExportRecordsByFormulaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  formula: z.string().describe("Airtable formula to filter records for export. Example: AND({Status}='Active',{Score}>80)"),
  format: z.enum(["json", "csv", "jsonl"]).optional().default("json")
    .describe("Output format: json (array), csv (text), or jsonl (one JSON object per line) (default: json)"),
  fields: z.array(z.string()).optional().describe("Fields to include (default: all)"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort order"),
  max_records: z.number().min(1).optional().describe("Maximum records to export"),
});

const GetExportSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_record_counts: z.boolean().optional().default(true)
    .describe("Estimate record counts for each table (makes N API calls, one per table) (default: true)"),
});

// ============ Helper: fetch all records ============

type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };

async function fetchAllRecordsForExport(
  client: AirtableClient,
  base_id: string,
  table_id_or_name: string,
  fields?: string[],
  filter_by_formula?: string,
  view?: string,
  sort?: Array<{ field: string; direction?: string }>,
  max_records?: number
): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const q = new URLSearchParams();
    q.set("pageSize", "100");
    if (filter_by_formula) q.set("filterByFormula", filter_by_formula);
    if (view) q.set("view", view);
    if (offset) q.set("offset", offset);
    if (max_records) q.set("maxRecords", String(max_records));
    if (fields) fields.forEach((f) => q.append("fields[]", f));
    if (sort) {
      sort.forEach((s, i) => {
        q.set(`sort[${i}][field]`, s.field);
        if (s.direction) q.set(`sort[${i}][direction]`, s.direction);
      });
    }

    const result = await client.get<{ records: AirtableRecord[]; offset?: string }>(
      `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q}`
    );

    all.push(...(result.records || []));
    offset = result.offset;

    if (max_records && all.length >= max_records) {
      return all.slice(0, max_records);
    }
  } while (offset);

  return all;
}

function recordsToCsv(
  records: AirtableRecord[],
  fields: string[],
  includeRecordId: boolean,
  includeCreatedTime: boolean,
  delimiter: string,
  flattenArrays: boolean = true
): string {
  if (records.length === 0) return "";

  const escapeField = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    let str: string;
    if (Array.isArray(val)) {
      if (flattenArrays) {
        str = val.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("; ");
      } else {
        str = JSON.stringify(val);
      }
    } else if (typeof val === "object") {
      str = JSON.stringify(val);
    } else {
      str = String(val);
    }
    // Escape delimiter, quotes, newlines
    if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const headers: string[] = [];
  if (includeRecordId) headers.push("_record_id");
  if (includeCreatedTime) headers.push("_created_time");
  headers.push(...fields);

  const rows: string[] = [headers.map(escapeField).join(delimiter)];

  for (const rec of records) {
    const row: string[] = [];
    if (includeRecordId) row.push(escapeField(rec.id));
    if (includeCreatedTime) row.push(escapeField(rec.createdTime));
    for (const f of fields) {
      row.push(escapeField(rec.fields[f]));
    }
    rows.push(row.join(delimiter));
  }

  return rows.join("\n");
}

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "export_table_to_csv",
      title: "Export Table to CSV",
      description:
        "Export all records from a table as CSV text. Automatically fetches all pages. Supports field selection, formula filtering, view scoping, custom sort, and configurable delimiter. Optionally include record IDs and created times. Returns CSV as a string.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to include (default: all)" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "View ID or name to scope export" },
          sort: { type: "array", items: { type: "object" }, description: "Sort: [{field:'Name',direction:'asc'}]" },
          include_record_id: { type: "boolean", description: "Include record ID as first column (default: false)" },
          include_created_time: { type: "boolean", description: "Include created time column (default: false)" },
          delimiter: { type: "string", description: "CSV delimiter: ',' (default), ';', or '\\t' (tab)" },
          max_records: { type: "number", description: "Max records to export" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          csv: { type: "string" },
          rowCount: { type: "number" },
          columnCount: { type: "number" },
          columns: { type: "array", items: { type: "string" } },
        },
        required: ["csv", "rowCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "export_table_to_json",
      title: "Export Table to JSON",
      description:
        "Export all records from a table as a JSON array of plain objects. Optionally include record IDs and timestamps. Optionally flatten arrays (multi-select/linked record) to comma-separated strings. Returns clean, flat JSON ready for further processing.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to include (default: all)" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "View ID or name" },
          sort: { type: "array", items: { type: "object" }, description: "Sort order" },
          include_metadata: { type: "boolean", description: "Include _id and _createdTime in each record (default: false)" },
          flatten_arrays: { type: "boolean", description: "Flatten arrays to strings (default: true)" },
          max_records: { type: "number", description: "Max records to export" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          data: { type: "array", items: { type: "object" } },
          recordCount: { type: "number" },
          fields: { type: "array", items: { type: "string" } },
        },
        required: ["data", "recordCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "export_multiple_tables",
      title: "Export Multiple Tables",
      description:
        "Export records from multiple tables in one operation. Returns a map of table name → records array. Useful for full-base exports, backups, or cross-table data analysis. Fetches up to max_records_per_table records from each table.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_ids_or_names: {
            type: "array",
            items: { type: "string" },
            description: "Tables to export (max 10): ['Contacts','Companies','Deals']",
          },
          include_metadata: { type: "boolean", description: "Include record IDs and timestamps (default: false)" },
          max_records_per_table: { type: "number", description: "Max records per table (optional)" },
        },
        required: ["base_id", "table_ids_or_names"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tables: { type: "object" },
          tableSummary: {
            type: "array",
            items: { type: "object", properties: { table: { type: "string" }, recordCount: { type: "number" } } },
          },
          totalRecords: { type: "number" },
        },
        required: ["tables", "totalRecords"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "export_records_by_formula",
      title: "Export Records By Formula",
      description:
        "Export records filtered by a formula in JSON, CSV, or JSONL format. JSONL (newline-delimited JSON) is ideal for streaming large datasets and BigQuery/Spark imports. Supports all standard filtering, sorting, and field selection.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          formula: { type: "string", description: "Formula to filter records. Example: AND({Status}='Active',{Score}>80)" },
          format: { type: "string", description: "Output format: json, csv, or jsonl (default: json)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to include (default: all)" },
          sort: { type: "array", items: { type: "object" }, description: "Sort order" },
          max_records: { type: "number", description: "Max records to export" },
        },
        required: ["base_id", "table_id_or_name", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          data: {},
          format: { type: "string" },
          recordCount: { type: "number" },
          formula: { type: "string" },
        },
        required: ["data", "recordCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_export_summary",
      title: "Get Export Summary",
      description:
        "Get a summary of a base suitable for planning an export: all tables, their field counts, and optionally estimated record counts. Returns a complete overview of what data can be exported from the base.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_record_counts: { type: "boolean", description: "Fetch record counts for each table (default: true, requires N API calls)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          baseId: { type: "string" },
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                fieldCount: { type: "number" },
                fieldNames: { type: "array", items: { type: "string" } },
                recordCount: { type: "number" },
              },
            },
          },
          totalTables: { type: "number" },
          totalFields: { type: "number" },
          totalRecords: { type: "number" },
        },
        required: ["tables", "totalTables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    export_table_to_csv: async (args) => {
      const {
        base_id, table_id_or_name, fields, filter_by_formula, view, sort,
        include_record_id, include_created_time, delimiter, max_records,
      } = ExportTableToCsvSchema.parse(args);

      const records = await logger.time("tool.export_table_to_csv.fetch", () =>
        fetchAllRecordsForExport(client, base_id, table_id_or_name, fields, filter_by_formula, view, sort, max_records)
      , { tool: "export_table_to_csv", base_id });

      // Determine columns from fields or first record
      let columns = fields || [];
      if (columns.length === 0 && records.length > 0) {
        const allKeys = new Set<string>();
        for (const rec of records.slice(0, 10)) {
          Object.keys(rec.fields).forEach((k) => allKeys.add(k));
        }
        columns = Array.from(allKeys);
      }

      const del = delimiter || ",";
      const csv = recordsToCsv(records, columns, include_record_id || false, include_created_time || false, del);

      const totalColumns = columns.length + (include_record_id ? 1 : 0) + (include_created_time ? 1 : 0);
      const columnHeaders = [
        ...(include_record_id ? ["_record_id"] : []),
        ...(include_created_time ? ["_created_time"] : []),
        ...columns,
      ];

      const response = { csv, rowCount: records.length, columnCount: totalColumns, columns: columnHeaders };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    export_table_to_json: async (args) => {
      const {
        base_id, table_id_or_name, fields, filter_by_formula, view, sort,
        include_metadata, flatten_arrays, max_records,
      } = ExportTableToJsonSchema.parse(args);

      const records = await logger.time("tool.export_table_to_json.fetch", () =>
        fetchAllRecordsForExport(client, base_id, table_id_or_name, fields, filter_by_formula, view, sort, max_records)
      , { tool: "export_table_to_json", base_id });

      const flattenVal = (val: unknown): unknown => {
        if (flatten_arrays !== false && Array.isArray(val)) {
          return val.map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(", ");
        }
        return val;
      };

      const data = records.map((rec) => {
        const item: Record<string, unknown> = {};
        if (include_metadata) {
          item._id = rec.id;
          item._createdTime = rec.createdTime;
        }
        for (const [k, v] of Object.entries(rec.fields)) {
          if (!fields || fields.includes(k)) {
            item[k] = flattenVal(v);
          }
        }
        return item;
      });

      let fieldNames = fields || [];
      if (fieldNames.length === 0 && records.length > 0) {
        const allKeys = new Set<string>();
        records.slice(0, 5).forEach((r) => Object.keys(r.fields).forEach((k) => allKeys.add(k)));
        fieldNames = Array.from(allKeys);
      }

      const response = { data, recordCount: records.length, fields: fieldNames };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    export_multiple_tables: async (args) => {
      const { base_id, table_ids_or_names, include_metadata, max_records_per_table } = ExportMultipleTablesSchema.parse(args);

      const tablesData: Record<string, unknown[]> = {};
      const tableSummary: Array<{ table: string; recordCount: number }> = [];
      let totalRecords = 0;

      for (const tableIdOrName of table_ids_or_names) {
        const records = await logger.time("tool.export_multiple_tables.fetch", () =>
          fetchAllRecordsForExport(client, base_id, tableIdOrName, undefined, undefined, undefined, undefined, max_records_per_table)
        , { tool: "export_multiple_tables", base_id, table: tableIdOrName });

        const data = records.map((rec) => {
          const item: Record<string, unknown> = {};
          if (include_metadata) {
            item._id = rec.id;
            item._createdTime = rec.createdTime;
          }
          return { ...item, ...rec.fields };
        });

        tablesData[tableIdOrName] = data;
        tableSummary.push({ table: tableIdOrName, recordCount: data.length });
        totalRecords += data.length;
      }

      const response = { tables: tablesData, tableSummary, totalRecords };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    export_records_by_formula: async (args) => {
      const { base_id, table_id_or_name, formula, format, fields, sort, max_records } = ExportRecordsByFormulaSchema.parse(args);

      const records = await logger.time("tool.export_records_by_formula.fetch", () =>
        fetchAllRecordsForExport(client, base_id, table_id_or_name, fields, formula, undefined, sort, max_records)
      , { tool: "export_records_by_formula", base_id, formula });

      const fmt = format || "json";
      let data: unknown;

      if (fmt === "csv") {
        let columns = fields || [];
        if (columns.length === 0 && records.length > 0) {
          const allKeys = new Set<string>();
          records.slice(0, 10).forEach((r) => Object.keys(r.fields).forEach((k) => allKeys.add(k)));
          columns = Array.from(allKeys);
        }
        data = recordsToCsv(records, columns, false, false, ",");
      } else if (fmt === "jsonl") {
        data = records.map((r) => JSON.stringify({ ...r.fields })).join("\n");
      } else {
        // json
        data = records.map((r) => ({ ...r.fields }));
      }

      const response = { data, format: fmt, recordCount: records.length, formula };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_export_summary: async (args) => {
      const { base_id, include_record_counts } = GetExportSummarySchema.parse(args);

      const schemaResult = await logger.time("tool.get_export_summary.schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_export_summary", base_id });

      const raw = schemaResult as { tables?: Array<{ id: string; name: string; fields: Array<{ name: string }> }> };
      const tables = raw.tables || [];

      let totalFields = 0;
      let totalRecords = 0;

      const tableSummaries = await Promise.all(
        tables.map(async (t) => {
          const fieldNames = (t.fields || []).map((f) => f.name);
          totalFields += fieldNames.length;

          let recordCount: number | null = null;
          if (include_record_counts !== false) {
            try {
              let count = 0;
              let offset: string | undefined;
              do {
                const q = new URLSearchParams();
                q.set("pageSize", "100");
                if (offset) q.set("offset", offset);
                const result = await client.get<{ records: unknown[]; offset?: string }>(
                  `/v0/${base_id}/${encodeURIComponent(t.name)}?${q}`
                );
                count += (result.records || []).length;
                offset = result.offset;
              } while (offset);
              recordCount = count;
              totalRecords += count;
            } catch {
              recordCount = null;
            }
          }

          return {
            id: t.id,
            name: t.name,
            fieldCount: fieldNames.length,
            fieldNames,
            ...(recordCount !== null ? { recordCount } : {}),
          };
        })
      );

      const response = {
        baseId: base_id,
        tables: tableSummaries,
        totalTables: tables.length,
        totalFields,
        ...(include_record_counts !== false ? { totalRecords } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
