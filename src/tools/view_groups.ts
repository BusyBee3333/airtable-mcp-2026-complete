// Airtable View Groups tools: get_view_groups, set_view_groups,
//   add_group_level, clear_view_groups, get_grouped_record_counts,
//   build_group_config
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetViewGroupsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("View ID"),
});

const SetViewGroupsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("View ID"),
  groups: z.array(z.object({
    field_id: z.string().describe("Field ID to group by"),
    order: z.enum(["ascending", "descending"]).optional().default("ascending"),
  })).max(5).describe("Group levels (up to 5). Earlier entries are outer groups."),
});

const ClearViewGroupsSchema = z.object({
  base_id: z.string(),
  table_id: z.string(),
  view_id: z.string(),
});

const GetGroupedRecordCountsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  group_by_field: z.string().describe("Field name to group by"),
  filter_formula: z.string().optional().describe("Optional formula to filter records before grouping"),
  max_records: z.number().min(1).max(1000).optional().default(500),
});

const BuildGroupConfigSchema = z.object({
  group_fields: z.array(z.object({
    field_name: z.string(),
    order: z.enum(["ascending", "descending"]).optional().default("ascending"),
  })).min(1).max(5),
  base_id: z.string().optional(),
  table_id_or_name: z.string().optional(),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_view_groups",
      title: "Get View Groups",
      description:
        "Get the grouping configuration for an Airtable view — returns all group levels, field IDs, and sort orders. Shows how records are organized into groups.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          view_id: { type: "string" },
          groups: { type: "array", items: { type: "object" } },
          group_count: { type: "number" },
          has_grouping: { type: "boolean" },
        },
        required: ["groups", "has_grouping"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_view_groups",
      title: "Set View Groups",
      description:
        "Set the grouping for an Airtable view — define up to 5 group levels with field IDs and sort order. Replaces any existing groups. Creates hierarchical grouping for galleries, grids, and kanban views.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
          groups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_id: { type: "string" },
                order: { type: "string", enum: ["ascending", "descending"] },
              },
              required: ["field_id"],
            },
            description: "Group levels (outer to inner)",
          },
        },
        required: ["base_id", "table_id", "view_id", "groups"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "boolean" },
          group_levels: { type: "number" },
        },
        required: ["updated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "clear_view_groups",
      title: "Clear View Groups",
      description:
        "Remove all grouping from an Airtable view. Records will no longer be organized into groups — they display as a flat list.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          cleared: { type: "boolean" },
          view_id: { type: "string" },
        },
        required: ["cleared"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_grouped_record_counts",
      title: "Get Grouped Record Counts",
      description:
        "Count records grouped by a specific field value — shows how many records have each unique value in the field. Great for dashboards, KPI summaries, and understanding data distributions.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          group_by_field: { type: "string", description: "Field name to group by" },
          filter_formula: { type: "string", description: "Optional filter formula" },
          max_records: { type: "number", description: "Max records to scan (default 500)" },
        },
        required: ["base_id", "table_id_or_name", "group_by_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          group_by_field: { type: "string" },
          groups: { type: "array", items: { type: "object" } },
          total_records: { type: "number" },
          group_count: { type: "number" },
        },
        required: ["groups", "total_records"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_group_config",
      title: "Build Group Configuration",
      description:
        "Build a view group configuration from field names — resolves field names to IDs if base/table are provided. Returns the group config array ready to use with set_view_groups.",
      inputSchema: {
        type: "object",
        properties: {
          group_fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_name: { type: "string" },
                order: { type: "string", enum: ["ascending", "descending"] },
              },
              required: ["field_name"],
            },
          },
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
        },
        required: ["group_fields"],
      },
      outputSchema: {
        type: "object",
        properties: {
          groups: { type: "array", items: { type: "object" } },
          description: { type: "string" },
        },
        required: ["groups"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_view_groups: async (args) => {
      const { base_id, table_id, view_id } = GetViewGroupsSchema.parse(args);

      const result = await logger.time("tool.get_view_groups", () =>
        client.get(`/v0/meta/bases/${base_id}/tables/${table_id}/views`)
      , { tool: "get_view_groups" }) as { views: Array<{ id: string; groupSet?: unknown[] }> };

      const view = result.views?.find((v) => v.id === view_id);
      const groups = view?.groupSet ?? [];

      const data = { view_id, groups, group_count: groups.length, has_grouping: groups.length > 0 };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    set_view_groups: async (args) => {
      const { base_id, table_id, view_id, groups } = SetViewGroupsSchema.parse(args);

      const groupSet = groups.map((g) => ({ fieldId: g.field_id, order: g.order }));

      await logger.time("tool.set_view_groups", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { groupSet })
      , { tool: "set_view_groups" });

      return {
        content: [{ type: "text", text: JSON.stringify({ updated: true, group_levels: groups.length }, null, 2) }],
        structuredContent: { updated: true, group_levels: groups.length },
      };
    },

    clear_view_groups: async (args) => {
      const { base_id, table_id, view_id } = ClearViewGroupsSchema.parse(args);

      await logger.time("tool.clear_view_groups", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { groupSet: [] })
      , { tool: "clear_view_groups" });

      return {
        content: [{ type: "text", text: JSON.stringify({ cleared: true, view_id }, null, 2) }],
        structuredContent: { cleared: true, view_id },
      };
    },

    get_grouped_record_counts: async (args) => {
      const { base_id, table_id_or_name, group_by_field, filter_formula, max_records } = GetGroupedRecordCountsSchema.parse(args);

      const params = new URLSearchParams({
        fields: group_by_field,
        pageSize: "100",
      });
      if (filter_formula) params.set("filterByFormula", filter_formula);

      const allRecords: Array<{ fields: Record<string, unknown> }> = [];
      let offset: string | undefined;
      let fetched = 0;

      do {
        if (offset) params.set("offset", offset);
        const result = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`) as { records: Array<{ fields: Record<string, unknown> }>; offset?: string };
        allRecords.push(...(result.records || []));
        offset = result.offset;
        fetched += result.records?.length ?? 0;
      } while (offset && fetched < (max_records ?? 500));

      const countMap: Record<string, number> = {};
      for (const rec of allRecords) {
        const val = rec.fields[group_by_field];
        const key = val == null ? "(empty)" : Array.isArray(val) ? val.join(", ") : String(val);
        countMap[key] = (countMap[key] ?? 0) + 1;
      }

      const groups = Object.entries(countMap)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);

      const data = { group_by_field, groups, total_records: allRecords.length, group_count: groups.length };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    build_group_config: async (args) => {
      const { group_fields, base_id, table_id_or_name } = BuildGroupConfigSchema.parse(args);

      let fieldMap: Record<string, string> = {};
      if (base_id && table_id_or_name) {
        const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }> };
        const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
        if (table) for (const f of table.fields) fieldMap[f.name] = f.id;
      }

      const groups = group_fields.map((g) => ({
        field_id: fieldMap[g.field_name] ?? g.field_name,
        order: g.order ?? "ascending",
      }));

      const description = groups.map((g, i) => `Level ${i + 1}: ${g.field_id} (${g.order})`).join(", ");

      return {
        content: [{ type: "text", text: JSON.stringify({ groups, description }, null, 2) }],
        structuredContent: { groups, description },
      };
    },
  };

  return { tools, handlers };
}
