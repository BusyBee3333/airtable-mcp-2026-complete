// Airtable View Sorts tools: get_view_sorts, set_view_sorts,
//   add_sort_level, clear_view_sorts, reverse_sort_direction, apply_sort_preset
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetViewSortsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("View ID"),
});

const SetViewSortsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("View ID"),
  sorts: z.array(z.object({
    field_id: z.string().describe("Field ID to sort by"),
    direction: z.enum(["asc", "desc"]).default("asc"),
  })).min(1).max(10).describe("Sort levels (up to 10). Earlier entries take priority."),
});

const AddSortLevelSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("View ID"),
  field_id: z.string().describe("Field ID to add as sort level"),
  direction: z.enum(["asc", "desc"]).optional().default("asc"),
  position: z.enum(["first", "last"]).optional().default("last").describe("Add this sort level at the start or end"),
});

const ClearViewSortsSchema = z.object({
  base_id: z.string(),
  table_id: z.string(),
  view_id: z.string(),
});

const BuildMultiLevelSortSchema = z.object({
  sort_levels: z.array(z.object({
    field_name: z.string(),
    direction: z.enum(["asc", "desc"]).optional().default("asc"),
    priority: z.number().optional().describe("Priority order (1 = highest priority)"),
  })).min(1).max(10).describe("Sort levels by field name"),
  base_id: z.string().optional().describe("Base ID for field name lookup"),
  table_id_or_name: z.string().optional().describe("Table for field name lookup"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_view_sorts",
      title: "Get View Sorts",
      description:
        "Get the current sort configuration for an Airtable view — returns all sort levels, field IDs, and directions. Use to inspect how a view is sorted or to replicate sorting elsewhere.",
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
          sorts: { type: "array", items: { type: "object" } },
          sort_count: { type: "number" },
          is_sorted: { type: "boolean" },
        },
        required: ["sorts", "is_sorted"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_view_sorts",
      title: "Set View Sorts",
      description:
        "Set the sort order for an Airtable view. Provide multiple sort levels — earlier levels take priority. Replaces all existing sorts on the view. Supports up to 10 sort levels.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
          sorts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_id: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] },
              },
              required: ["field_id"],
            },
            description: "Sort levels in priority order",
          },
        },
        required: ["base_id", "table_id", "view_id", "sorts"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "boolean" },
          sort_count: { type: "number" },
        },
        required: ["updated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_sort_level",
      title: "Add Sort Level",
      description:
        "Add a new sort level to an existing view without removing current sorts. You can add the new sort at the beginning (highest priority) or end (lowest priority) of the sort stack.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
          field_id: { type: "string" },
          direction: { type: "string", enum: ["asc", "desc"] },
          position: { type: "string", enum: ["first", "last"] },
        },
        required: ["base_id", "table_id", "view_id", "field_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          added: { type: "boolean" },
          total_sort_levels: { type: "number" },
        },
        required: ["added"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "clear_view_sorts",
      title: "Clear View Sorts",
      description:
        "Remove all sort levels from an Airtable view. Records will display in their natural creation order. This affects all users who see the view.",
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
      name: "build_multi_level_sort",
      title: "Build Multi-Level Sort",
      description:
        "Build a multi-level sort configuration from field names — converts human-readable sort specs into the field-ID-based format needed for view configuration. Optionally resolves field names to IDs if base_id and table are provided.",
      inputSchema: {
        type: "object",
        properties: {
          sort_levels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_name: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] },
                priority: { type: "number" },
              },
              required: ["field_name"],
            },
          },
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
        },
        required: ["sort_levels"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sorts: { type: "array", items: { type: "object" } },
          sort_description: { type: "string" },
        },
        required: ["sorts"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_view_sorts: async (args) => {
      const { base_id, table_id, view_id } = GetViewSortsSchema.parse(args);

      const result = await logger.time("tool.get_view_sorts", () =>
        client.get(`/v0/meta/bases/${base_id}/tables/${table_id}/views`)
      , { tool: "get_view_sorts" }) as { views: Array<{ id: string; sortSet?: Array<{ fieldId: string; direction: string }> }> };

      const view = result.views?.find((v) => v.id === view_id);
      const sorts = view?.sortSet ?? [];

      const data = { view_id, sorts, sort_count: sorts.length, is_sorted: sorts.length > 0 };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    set_view_sorts: async (args) => {
      const { base_id, table_id, view_id, sorts } = SetViewSortsSchema.parse(args);

      const sortSet = sorts.map((s) => ({ fieldId: s.field_id, direction: s.direction }));

      await logger.time("tool.set_view_sorts", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { sortSet })
      , { tool: "set_view_sorts" });

      return {
        content: [{ type: "text", text: JSON.stringify({ updated: true, sort_count: sorts.length }, null, 2) }],
        structuredContent: { updated: true, sort_count: sorts.length },
      };
    },

    add_sort_level: async (args) => {
      const { base_id, table_id, view_id, field_id, direction, position } = AddSortLevelSchema.parse(args);

      const result = await client.get(`/v0/meta/bases/${base_id}/tables/${table_id}/views`) as { views: Array<{ id: string; sortSet?: Array<{ fieldId: string; direction: string }> }> };
      const view = result.views?.find((v) => v.id === view_id);
      const existingSorts = view?.sortSet ?? [];
      const newSort = { fieldId: field_id, direction };
      const updatedSorts = position === "first" ? [newSort, ...existingSorts] : [...existingSorts, newSort];

      await client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { sortSet: updatedSorts });

      return {
        content: [{ type: "text", text: JSON.stringify({ added: true, total_sort_levels: updatedSorts.length }, null, 2) }],
        structuredContent: { added: true, total_sort_levels: updatedSorts.length },
      };
    },

    clear_view_sorts: async (args) => {
      const { base_id, table_id, view_id } = ClearViewSortsSchema.parse(args);

      await logger.time("tool.clear_view_sorts", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { sortSet: [] })
      , { tool: "clear_view_sorts" });

      return {
        content: [{ type: "text", text: JSON.stringify({ cleared: true, view_id }, null, 2) }],
        structuredContent: { cleared: true, view_id },
      };
    },

    build_multi_level_sort: async (args) => {
      const { sort_levels, base_id, table_id_or_name } = BuildMultiLevelSortSchema.parse(args);

      let fieldMap: Record<string, string> = {};
      if (base_id && table_id_or_name) {
        const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }> };
        const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
        if (table) {
          for (const f of table.fields) fieldMap[f.name] = f.id;
        }
      }

      const sorted = [...sort_levels].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
      const sorts = sorted.map((s) => ({
        field_id: fieldMap[s.field_name] ?? s.field_name,
        direction: s.direction ?? "asc",
      }));

      const description = sorts.map((s, i) => `${i + 1}. ${s.field_id} (${s.direction})`).join(", ");

      return {
        content: [{ type: "text", text: JSON.stringify({ sorts, sort_description: description }, null, 2) }],
        structuredContent: { sorts, sort_description: description },
      };
    },
  };

  return { tools, handlers };
}
