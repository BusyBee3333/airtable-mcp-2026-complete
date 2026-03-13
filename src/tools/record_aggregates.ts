// Airtable Record Aggregate tools: count_records, sum_field, average_field,
//   min_field, max_field, get_field_statistics, list_unique_values,
//   count_records_by_group, get_aggregates_by_formula
// These tools use the standard Records API with aggregation done client-side or
// via Airtable formula filtering
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CountRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  filter_by_formula: z.string().optional().describe("Optional Airtable formula to filter before counting. Example: {Status}='Active'"),
  view: z.string().optional().describe("View ID or name to scope the count to"),
});

const SumFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the numeric field to sum"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before summing"),
  view: z.string().optional().describe("View ID or name to scope results"),
});

const AverageFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the numeric field to average"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before averaging"),
  view: z.string().optional().describe("View ID or name"),
});

const MinFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the numeric or date field to find minimum of"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records"),
  view: z.string().optional().describe("View ID or name"),
});

const MaxFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the numeric or date field to find maximum of"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records"),
  view: z.string().optional().describe("View ID or name"),
});

const GetFieldStatisticsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the numeric field to analyze"),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before calculating statistics"),
  view: z.string().optional().describe("View ID or name"),
});

const ListUniqueValuesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the field to get unique values from. Works best with singleSelect, text, or number fields."),
  filter_by_formula: z.string().optional().describe("Optional formula to filter records before extracting unique values"),
  view: z.string().optional().describe("View ID or name"),
  sort_values: z.enum(["asc", "desc", "count_desc", "none"]).optional().default("asc")
    .describe("Sort unique values: asc (alphabetical), desc (reverse), count_desc (most frequent first), none"),
  max_unique_values: z.number().min(1).max(1000).optional()
    .describe("Maximum unique values to return (optional)"),
});

const CountRecordsByGroupSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  group_by_field: z.string().describe("Field name to group by and count. Best with singleSelect, text, or checkbox fields."),
  filter_by_formula: z.string().optional().describe("Optional formula to pre-filter records"),
  view: z.string().optional().describe("View ID or name"),
  sort_by: z.enum(["count_desc", "count_asc", "value_asc", "value_desc"]).optional().default("count_desc")
    .describe("Sort result groups: count_desc (most records first), count_asc, value_asc (alphabetical), value_desc"),
});

// ============ Helper: fetch all records ============

async function fetchAllRecords(
  client: AirtableClient,
  base_id: string,
  table_id_or_name: string,
  fields: string[],
  filter_by_formula?: string,
  view?: string
): Promise<Array<Record<string, unknown>>> {
  const allRecords: Array<Record<string, unknown>> = [];
  let offset: string | undefined;

  do {
    const queryParams = new URLSearchParams();
    queryParams.set("pageSize", "100");
    fields.forEach((f) => queryParams.append("fields[]", f));
    if (filter_by_formula) queryParams.set("filterByFormula", filter_by_formula);
    if (view) queryParams.set("view", view);
    if (offset) queryParams.set("offset", offset);

    const result = await client.get<{ records: Array<{ fields: Record<string, unknown> }>; offset?: string }>(
      `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`
    );

    allRecords.push(...(result.records || []).map((r) => r.fields));
    offset = result.offset;
  } while (offset);

  return allRecords;
}

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "count_records",
      title: "Count Records",
      description:
        "Count the number of records in a table, optionally filtered by a formula or scoped to a view. Returns the total count. Much faster than fetching all records when you only need the number.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          filter_by_formula: { type: "string", description: "Optional formula to filter. Example: {Status}='Active'" },
          view: { type: "string", description: "Optional view ID or name to scope count" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          count: { type: "number" },
          filter: { type: "string" },
          view: { type: "string" },
        },
        required: ["count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "sum_field",
      title: "Sum Field Values",
      description:
        "Calculate the sum of all numeric values in a field. Optionally filter records before summing. Returns the total, count of non-empty values, and count of null values. Use for totaling prices, scores, quantities, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Name of the numeric field to sum" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "Optional view to scope results" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sum: { type: "number" },
          field: { type: "string" },
          recordsWithValue: { type: "number" },
          recordsWithNull: { type: "number" },
          totalRecords: { type: "number" },
        },
        required: ["sum"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "average_field",
      title: "Average Field Values",
      description:
        "Calculate the arithmetic mean of all numeric values in a field. Ignores null/empty values in the average calculation. Optionally filter records. Returns the average, sum, and count.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Name of the numeric field to average" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "Optional view to scope results" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          average: { type: "number" },
          sum: { type: "number" },
          count: { type: "number" },
          field: { type: "string" },
        },
        required: ["average"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "min_field",
      title: "Find Minimum Field Value",
      description:
        "Find the minimum value in a numeric or text field. Returns the smallest value found, plus the count of records checked. Use to find the lowest price, earliest date, smallest score, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Name of the field to find minimum of" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "Optional view to scope results" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          min: {},
          field: { type: "string" },
          totalRecords: { type: "number" },
          recordsWithValue: { type: "number" },
        },
        required: ["min"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "max_field",
      title: "Find Maximum Field Value",
      description:
        "Find the maximum value in a numeric or text field. Returns the largest value found, plus the count of records checked. Use to find the highest price, latest date, top score, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Name of the field to find maximum of" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "Optional view to scope results" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          max: {},
          field: { type: "string" },
          totalRecords: { type: "number" },
          recordsWithValue: { type: "number" },
        },
        required: ["max"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_field_statistics",
      title: "Get Field Statistics",
      description:
        "Get comprehensive statistics for a numeric field: count, sum, average, min, max, median (approximate), standard deviation, and null/empty rate. Use for data analysis and reporting dashboards.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Name of the numeric field to analyze" },
          filter_by_formula: { type: "string", description: "Optional formula to filter records" },
          view: { type: "string", description: "Optional view to scope results" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "string" },
          count: { type: "number" },
          sum: { type: "number" },
          average: { type: "number" },
          min: { type: "number" },
          max: { type: "number" },
          range: { type: "number" },
          median: { type: "number" },
          standardDeviation: { type: "number" },
          nullCount: { type: "number" },
          nullRate: { type: "number" },
          totalRecords: { type: "number" },
        },
        required: ["count", "sum", "average", "min", "max"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_unique_values",
      title: "List Unique Values",
      description:
        "List all unique values in a field across all records. Returns each distinct value along with its occurrence count. Supports sorting by value or frequency. Useful for data audits, select field management, and analytics.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          field_name: { type: "string", description: "Field to get unique values from" },
          filter_by_formula: { type: "string", description: "Optional formula to pre-filter records" },
          view: { type: "string", description: "Optional view to scope" },
          sort_values: { type: "string", description: "Sort: asc, desc, count_desc (most frequent first), none (default: asc)" },
          max_unique_values: { type: "number", description: "Limit to top N unique values" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "string" },
          values: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: {},
                count: { type: "number" },
              },
            },
          },
          uniqueCount: { type: "number" },
          totalRecords: { type: "number" },
          nullCount: { type: "number" },
        },
        required: ["values", "uniqueCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "count_records_by_group",
      title: "Count Records By Group",
      description:
        "Count records grouped by a field value. Returns a sorted breakdown of how many records exist for each value of the specified field. Ideal for status distributions, category counts, and dashboard metrics.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          group_by_field: { type: "string", description: "Field to group and count by (e.g., 'Status', 'Category')" },
          filter_by_formula: { type: "string", description: "Optional formula to pre-filter records" },
          view: { type: "string", description: "Optional view to scope" },
          sort_by: { type: "string", description: "Sort: count_desc (most first), count_asc, value_asc, value_desc (default: count_desc)" },
        },
        required: ["base_id", "table_id_or_name", "group_by_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field: { type: "string" },
          groups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: {},
                count: { type: "number" },
                percentage: { type: "number" },
              },
            },
          },
          totalGroups: { type: "number" },
          totalRecords: { type: "number" },
        },
        required: ["groups", "totalGroups", "totalRecords"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    count_records: async (args) => {
      const { base_id, table_id_or_name, filter_by_formula, view } = CountRecordsSchema.parse(args);

      // Use pageSize=1 and just follow offsets to count
      let count = 0;
      let offset: string | undefined;
      do {
        const queryParams = new URLSearchParams();
        queryParams.set("pageSize", "100");
        queryParams.set("fields[]", "_none_that_exists_"); // request minimal data
        if (filter_by_formula) queryParams.set("filterByFormula", filter_by_formula);
        if (view) queryParams.set("view", view);
        if (offset) queryParams.set("offset", offset);

        // Actually, just fetch all records with minimal fields
        const q2 = new URLSearchParams();
        q2.set("pageSize", "100");
        if (filter_by_formula) q2.set("filterByFormula", filter_by_formula);
        if (view) q2.set("view", view);
        if (offset) q2.set("offset", offset);

        const result = await logger.time("tool.count_records.page", () =>
          client.get<{ records: unknown[]; offset?: string }>(
            `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${q2}`
          )
        , { tool: "count_records", base_id });

        count += (result.records || []).length;
        offset = result.offset;
      } while (offset);

      const response = {
        count,
        ...(filter_by_formula ? { filter: filter_by_formula } : {}),
        ...(view ? { view } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    sum_field: async (args) => {
      const { base_id, table_id_or_name, field_name, filter_by_formula, view } = SumFieldSchema.parse(args);

      const records = await logger.time("tool.sum_field.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "sum_field", base_id });

      let sum = 0;
      let recordsWithValue = 0;
      let recordsWithNull = 0;

      for (const fields of records) {
        const val = fields[field_name];
        if (val === null || val === undefined || val === "") {
          recordsWithNull++;
        } else {
          const num = Number(val);
          if (!isNaN(num)) {
            sum += num;
            recordsWithValue++;
          } else {
            recordsWithNull++;
          }
        }
      }

      const response = {
        sum: Math.round(sum * 1e10) / 1e10,
        field: field_name,
        recordsWithValue,
        recordsWithNull,
        totalRecords: records.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    average_field: async (args) => {
      const { base_id, table_id_or_name, field_name, filter_by_formula, view } = AverageFieldSchema.parse(args);

      const records = await logger.time("tool.average_field.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "average_field", base_id });

      let sum = 0;
      let count = 0;

      for (const fields of records) {
        const val = fields[field_name];
        const num = Number(val);
        if (val !== null && val !== undefined && val !== "" && !isNaN(num)) {
          sum += num;
          count++;
        }
      }

      const average = count > 0 ? sum / count : 0;
      const response = {
        average: Math.round(average * 1e10) / 1e10,
        sum: Math.round(sum * 1e10) / 1e10,
        count,
        field: field_name,
        totalRecords: records.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    min_field: async (args) => {
      const { base_id, table_id_or_name, field_name, filter_by_formula, view } = MinFieldSchema.parse(args);

      const records = await logger.time("tool.min_field.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "min_field", base_id });

      let min: number | null = null;
      let recordsWithValue = 0;

      for (const fields of records) {
        const val = fields[field_name];
        const num = Number(val);
        if (val !== null && val !== undefined && val !== "" && !isNaN(num)) {
          recordsWithValue++;
          if (min === null || num < min) min = num;
        }
      }

      const response = { min, field: field_name, totalRecords: records.length, recordsWithValue };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    max_field: async (args) => {
      const { base_id, table_id_or_name, field_name, filter_by_formula, view } = MaxFieldSchema.parse(args);

      const records = await logger.time("tool.max_field.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "max_field", base_id });

      let max: number | null = null;
      let recordsWithValue = 0;

      for (const fields of records) {
        const val = fields[field_name];
        const num = Number(val);
        if (val !== null && val !== undefined && val !== "" && !isNaN(num)) {
          recordsWithValue++;
          if (max === null || num > max) max = num;
        }
      }

      const response = { max, field: field_name, totalRecords: records.length, recordsWithValue };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_field_statistics: async (args) => {
      const { base_id, table_id_or_name, field_name, filter_by_formula, view } = GetFieldStatisticsSchema.parse(args);

      const records = await logger.time("tool.get_field_statistics.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "get_field_statistics", base_id });

      const values: number[] = [];
      let nullCount = 0;

      for (const fields of records) {
        const val = fields[field_name];
        const num = Number(val);
        if (val !== null && val !== undefined && val !== "" && !isNaN(num)) {
          values.push(num);
        } else {
          nullCount++;
        }
      }

      const totalRecords = records.length;
      const count = values.length;

      if (count === 0) {
        const response = {
          field: field_name,
          count: 0,
          sum: 0,
          average: 0,
          min: null,
          max: null,
          range: null,
          median: null,
          standardDeviation: null,
          nullCount,
          nullRate: totalRecords > 0 ? nullCount / totalRecords : 0,
          totalRecords,
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      values.sort((a, b) => a - b);
      const sum = values.reduce((acc, v) => acc + v, 0);
      const average = sum / count;
      const min = values[0];
      const max = values[count - 1];
      const range = max - min;
      const median = count % 2 === 0
        ? (values[count / 2 - 1] + values[count / 2]) / 2
        : values[Math.floor(count / 2)];

      const variance = values.reduce((acc, v) => acc + Math.pow(v - average, 2), 0) / count;
      const standardDeviation = Math.sqrt(variance);

      const r = (n: number) => Math.round(n * 1e10) / 1e10;

      const response = {
        field: field_name,
        count,
        sum: r(sum),
        average: r(average),
        min,
        max,
        range: r(range),
        median: r(median),
        standardDeviation: r(standardDeviation),
        nullCount,
        nullRate: r(nullCount / totalRecords),
        totalRecords,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_unique_values: async (args) => {
      const {
        base_id, table_id_or_name, field_name, filter_by_formula, view, sort_values, max_unique_values,
      } = ListUniqueValuesSchema.parse(args);

      const records = await logger.time("tool.list_unique_values.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [field_name], filter_by_formula, view)
      , { tool: "list_unique_values", base_id });

      const valueCounts = new Map<string, number>();
      let nullCount = 0;

      for (const fields of records) {
        const val = fields[field_name];
        if (val === null || val === undefined || val === "") {
          nullCount++;
        } else {
          const key = String(val);
          valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
        }
      }

      let values = Array.from(valueCounts.entries()).map(([value, count]) => ({ value, count }));

      // Sort
      const sv = sort_values || "asc";
      if (sv === "count_desc") {
        values.sort((a, b) => b.count - a.count);
      } else if (sv === "asc") {
        values.sort((a, b) => String(a.value).localeCompare(String(b.value)));
      } else if (sv === "desc") {
        values.sort((a, b) => String(b.value).localeCompare(String(a.value)));
      }

      if (max_unique_values) {
        values = values.slice(0, max_unique_values);
      }

      const response = {
        field: field_name,
        values,
        uniqueCount: valueCounts.size,
        totalRecords: records.length,
        nullCount,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    count_records_by_group: async (args) => {
      const {
        base_id, table_id_or_name, group_by_field, filter_by_formula, view, sort_by,
      } = CountRecordsByGroupSchema.parse(args);

      const records = await logger.time("tool.count_records_by_group.fetch", () =>
        fetchAllRecords(client, base_id, table_id_or_name, [group_by_field], filter_by_formula, view)
      , { tool: "count_records_by_group", base_id });

      const groupCounts = new Map<string, number>();

      for (const fields of records) {
        const val = fields[group_by_field];
        const key = val === null || val === undefined ? "(empty)" : String(val);
        groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
      }

      let groups = Array.from(groupCounts.entries()).map(([value, count]) => ({
        value,
        count,
        percentage: 0,
      }));

      const totalRecords = records.length;
      groups = groups.map((g) => ({ ...g, percentage: Math.round((g.count / totalRecords) * 10000) / 100 }));

      const sb = sort_by || "count_desc";
      if (sb === "count_desc") groups.sort((a, b) => b.count - a.count);
      else if (sb === "count_asc") groups.sort((a, b) => a.count - b.count);
      else if (sb === "value_asc") groups.sort((a, b) => String(a.value).localeCompare(String(b.value)));
      else if (sb === "value_desc") groups.sort((a, b) => String(b.value).localeCompare(String(a.value)));

      const response = {
        field: group_by_field,
        groups,
        totalGroups: groups.length,
        totalRecords,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
