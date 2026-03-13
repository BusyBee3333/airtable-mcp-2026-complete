// Airtable View Filters tools: get_view_filter_config, build_view_filter,
//   list_filtered_views, apply_filter_to_view, get_records_matching_filter
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetViewFilterConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("View ID (starts with 'viw') or view name"),
});

const BuildViewFilterSchema = z.object({
  conditions: z.array(z.object({
    field: z.string().describe("Field name to filter on"),
    operator: z.enum([
      "=", "!=", ">", ">=", "<", "<=",
      "isEmpty", "isNotEmpty", "contains", "doesNotContain",
      "isAnyOf", "isNoneOf", "isWithin",
    ]).describe("Filter operator"),
    value: z.union([z.string(), z.number(), z.array(z.string())]).optional().describe("Filter value (string, number, or array for isAnyOf/isNoneOf)"),
  })).min(1).describe("Filter conditions to combine"),
  conjunction: z.enum(["and", "or"]).default("and").describe("How to combine conditions: and / or"),
});

const ListFilteredViewsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

const GetRecordsMatchingFilterSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  filter_formula: z.string().describe("Airtable filterByFormula expression. Example: AND({Status}='Active',{Priority}='High')"),
  fields: z.array(z.string()).optional().describe("Fields to return (default: all)"),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"]).optional(),
  })).optional().describe("Sort results"),
  max_records: z.number().optional().describe("Maximum records to return"),
  count_only: z.boolean().optional().default(false).describe("If true, only return the count of matching records, not the records themselves"),
});

const CompareViewFiltersSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name_a: z.string().describe("First view ID or name"),
  view_id_or_name_b: z.string().describe("Second view ID or name"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_view_filter_config",
      title: "Get View Filter Config",
      description:
        "Retrieve the filter configuration of an Airtable view including all filter conditions, field references, operators, and conjunction logic. Returns the raw filter object from the view schema. Useful for understanding how a view is configured or for replicating filter logic in code.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "View ID (starts with 'viw') or view name" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          viewName: { type: "string" },
          viewType: { type: "string" },
          filterByFormula: { type: "string" },
          hasFilters: { type: "boolean" },
        },
        required: ["viewName", "hasFilters"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_view_filter",
      title: "Build View Filter",
      description:
        "Build an Airtable filterByFormula expression from structured filter conditions. Supports all common operators including equality, comparison, emptiness, text contains, and multi-value filters (isAnyOf, isNoneOf). Returns a formula string ready for use with list_records or create_view.",
      inputSchema: {
        type: "object",
        properties: {
          conditions: {
            type: "array",
            items: { type: "object" },
            description: "Filter conditions: [{field:'Status',operator:'isAnyOf',value:['Active','Pending']},{field:'Score',operator:'>',value:80}]",
          },
          conjunction: { type: "string", description: "and (all conditions must match) or or (any condition matches). Default: and" },
        },
        required: ["conditions"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          humanReadable: { type: "string" },
          conditionCount: { type: "number" },
        },
        required: ["formula", "conditionCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_filtered_views",
      title: "List Filtered Views",
      description:
        "List all views in a table that have filters configured. Returns the view name, type, and a summary of its filter configuration. Useful for auditing which views have active filters and understanding the data governance setup.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          filteredViews: { type: "array", items: { type: "object" } },
          allViews: { type: "array", items: { type: "object" } },
          filteredCount: { type: "number" },
          totalCount: { type: "number" },
        },
        required: ["filteredViews", "filteredCount", "totalCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_records_matching_filter",
      title: "Get Records Matching Filter",
      description:
        "Fetch records matching a filter formula, with optional count-only mode. When count_only=true, returns just the count of matching records without the full data — much faster for large tables. Supports sorting, field selection, and pagination.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          filter_formula: { type: "string", description: "Airtable filterByFormula. Example: AND({Status}='Active',{Score}>80)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: all)" },
          sort: { type: "array", items: { type: "object" }, description: "Sort: [{field:'Score',direction:'desc'}]" },
          max_records: { type: "number", description: "Max records to return" },
          count_only: { type: "boolean", description: "If true, return only count (faster for large tables)" },
        },
        required: ["base_id", "table_id_or_name", "filter_formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          formula: { type: "string" },
          countOnly: { type: "boolean" },
        },
        required: ["count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "compare_view_filters",
      title: "Compare View Filters",
      description:
        "Compare the filter configurations of two views in the same table. Shows which fields and conditions are in each view, what they have in common, and how they differ. Useful for understanding how different views segment the same data.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name_a: { type: "string", description: "First view ID or name" },
          view_id_or_name_b: { type: "string", description: "Second view ID or name" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name_a", "view_id_or_name_b"],
      },
      outputSchema: {
        type: "object",
        properties: {
          viewA: { type: "object" },
          viewB: { type: "object" },
          differences: { type: "object" },
        },
        required: ["viewA", "viewB"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function getTableSchema(base_id: string, table_id_or_name: string) {
    const schema = await logger.time("tool.view_filters.get_schema", () =>
      client.get(`/v0/meta/bases/${base_id}/tables`)
    , { tool: "view_filters" }) as {
      tables?: Array<{
        id: string;
        name: string;
        views?: Array<{ id: string; name: string; type: string; [key: string]: unknown }>;
      }>;
    };
    const table = (schema.tables ?? []).find(
      (t) => t.id === table_id_or_name || t.name === table_id_or_name
    );
    if (!table) throw new Error(`Table '${table_id_or_name}' not found`);
    return table;
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_view_filter_config: async (args) => {
      const params = GetViewFilterConfigSchema.parse(args);
      const table = await getTableSchema(params.base_id, params.table_id_or_name);
      const view = (table.views ?? []).find(
        (v) => v.id === params.view_id_or_name || v.name === params.view_id_or_name
      );
      if (!view) throw new Error(`View '${params.view_id_or_name}' not found`);

      const filterByFormula = (view.filterByFormula as string) ?? null;
      const hasFilters = Boolean(filterByFormula);

      const response = {
        viewName: view.name,
        viewId: view.id,
        viewType: view.type,
        filterByFormula,
        hasFilters,
        rawViewConfig: view,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    build_view_filter: async (args) => {
      const params = BuildViewFilterSchema.parse(args);
      const conjunction = (params.conjunction ?? "and").toUpperCase();

      const conditionFormulas = params.conditions.map((c) => {
        const fieldRef = `{${c.field}}`;
        switch (c.operator) {
          case "=": return `${fieldRef}="${c.value ?? ""}"`;
          case "!=": return `${fieldRef}!="${c.value ?? ""}"`;
          case ">": return `${fieldRef}>${c.value ?? 0}`;
          case ">=": return `${fieldRef}>=${c.value ?? 0}`;
          case "<": return `${fieldRef}<${c.value ?? 0}`;
          case "<=": return `${fieldRef}<=${c.value ?? 0}`;
          case "isEmpty": return `BLANK(${fieldRef})`;
          case "isNotEmpty": return `NOT(BLANK(${fieldRef}))`;
          case "contains": return `FIND("${c.value ?? ""}",${fieldRef})>0`;
          case "doesNotContain": return `FIND("${c.value ?? ""}",${fieldRef})=0`;
          case "isAnyOf":
            return `OR(${(Array.isArray(c.value) ? c.value : [c.value]).map((v) => `${fieldRef}="${v}"`).join(",")})`;
          case "isNoneOf":
            return `AND(${(Array.isArray(c.value) ? c.value : [c.value]).map((v) => `${fieldRef}!="${v}"`).join(",")})`;
          case "isWithin":
            return `AND(IS_AFTER(${fieldRef},DATEADD(TODAY(),-${c.value ?? 7},"day")),IS_BEFORE(${fieldRef},TODAY()))`;
          default:
            return `${fieldRef}="${c.value ?? ""}"`;
        }
      });

      const formula = conditionFormulas.length === 1
        ? conditionFormulas[0]
        : `${conjunction}(${conditionFormulas.join(",")})`;

      const humanParts = params.conditions.map((c) => {
        const val = Array.isArray(c.value) ? c.value.join(" or ") : String(c.value ?? "");
        return `${c.field} ${c.operator} ${val}`;
      });
      const humanReadable = humanParts.join(` ${conjunction.toLowerCase()} `);

      const response = { formula, humanReadable, conditionCount: params.conditions.length, conjunction };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    list_filtered_views: async (args) => {
      const params = ListFilteredViewsSchema.parse(args);
      const table = await getTableSchema(params.base_id, params.table_id_or_name);
      const views = table.views ?? [];

      const allViewSummaries = views.map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        hasFilter: Boolean(v.filterByFormula),
        filterByFormula: (v.filterByFormula as string) ?? null,
      }));

      const filteredViews = allViewSummaries.filter((v) => v.hasFilter);

      const response = {
        filteredViews,
        allViews: allViewSummaries,
        filteredCount: filteredViews.length,
        totalCount: views.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_records_matching_filter: async (args) => {
      const params = GetRecordsMatchingFilterSchema.parse(args);
      const qp = new URLSearchParams();
      qp.set("filterByFormula", params.filter_formula);
      if (params.max_records) qp.set("maxRecords", String(params.max_records));

      if (params.count_only) {
        // Minimal fields for counting
        qp.append("fields[]", "Name");
        qp.set("pageSize", "100");
      } else {
        if (params.fields) params.fields.forEach((f) => qp.append("fields[]", f));
        if (params.sort) {
          params.sort.forEach((s, i) => {
            qp.set(`sort[${i}][field]`, s.field);
            if (s.direction) qp.set(`sort[${i}][direction]`, s.direction);
          });
        }
      }

      const allRecords: unknown[] = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.get_records_matching_filter", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "get_records_matching_filter" }) as { records?: unknown[]; offset?: string };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
        if (params.count_only && !result.offset) break;
      } while (offset);

      const response = {
        records: params.count_only ? [] : allRecords,
        count: allRecords.length,
        formula: params.filter_formula,
        countOnly: params.count_only ?? false,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    compare_view_filters: async (args) => {
      const params = CompareViewFiltersSchema.parse(args);
      const table = await getTableSchema(params.base_id, params.table_id_or_name);
      const views = table.views ?? [];

      const viewA = views.find((v) => v.id === params.view_id_or_name_a || v.name === params.view_id_or_name_a);
      const viewB = views.find((v) => v.id === params.view_id_or_name_b || v.name === params.view_id_or_name_b);

      if (!viewA) throw new Error(`View '${params.view_id_or_name_a}' not found`);
      if (!viewB) throw new Error(`View '${params.view_id_or_name_b}' not found`);

      const filterA = (viewA.filterByFormula as string) ?? null;
      const filterB = (viewB.filterByFormula as string) ?? null;

      const differences = {
        sameFilter: filterA === filterB,
        onlyInA: filterA && !filterB ? [filterA] : [],
        onlyInB: filterB && !filterA ? [filterB] : [],
        bothFiltered: Boolean(filterA && filterB),
        neitherFiltered: !filterA && !filterB,
      };

      const response = {
        viewA: { id: viewA.id, name: viewA.name, type: viewA.type, filterByFormula: filterA },
        viewB: { id: viewB.id, name: viewB.name, type: viewB.type, filterByFormula: filterB },
        differences,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
