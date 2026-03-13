// Airtable Gantt Views tools: list_gantt_views, get_gantt_config,
//   create_gantt_view, update_gantt_date_fields, get_gantt_tasks,
//   get_tasks_with_dependencies
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListGanttViewsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

const GetGanttConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id: z.string().describe("Gantt view ID"),
});

const CreateGanttViewSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  name: z.string().describe("Name for the Gantt view"),
  start_date_field_id: z.string().optional().describe("Field ID for task start dates"),
  end_date_field_id: z.string().optional().describe("Field ID for task end dates"),
});

const UpdateGanttDateFieldsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  view_id: z.string().describe("Gantt view ID"),
  start_date_field_id: z.string().describe("Start date field ID"),
  end_date_field_id: z.string().describe("End date field ID"),
  dependency_field_id: z.string().optional().describe("Dependency link field ID"),
});

const GetGanttTasksSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  start_date_field: z.string().describe("Start date field name"),
  end_date_field: z.string().describe("End date field name"),
  name_field: z.string().optional().describe("Field name to use as task name (default: primary field)"),
  dependency_field: z.string().optional().describe("Link field name for task dependencies"),
  filter_formula: z.string().optional(),
  max_records: z.number().min(1).max(200).optional().default(100),
});

const GetCriticalPathSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  start_date_field: z.string().describe("Start date field name"),
  end_date_field: z.string().describe("End date field name"),
  dependency_field: z.string().optional().describe("Link field for dependencies"),
  max_records: z.number().optional().default(100),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_gantt_views",
      title: "List Gantt Views",
      description:
        "List all Gantt chart views in an Airtable table. Gantt views visualize tasks on a timeline with start and end dates. Returns view IDs, names, and configuration.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          gantt_views: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["gantt_views", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_gantt_config",
      title: "Get Gantt Configuration",
      description:
        "Get the full configuration of a Gantt view — start/end date fields, dependency field, grouping, and any milestone configuration.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          view_id: { type: "string" },
        },
        required: ["base_id", "table_id_or_name", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          view_id: { type: "string" },
          name: { type: "string" },
          start_date_field_id: { type: "string" },
          end_date_field_id: { type: "string" },
          dependency_field_id: { type: "string" },
          gantt_config: { type: "object" },
        },
        required: ["view_id", "name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_gantt_view",
      title: "Create Gantt View",
      description:
        "Create a new Gantt chart view in an Airtable table. Optionally specify the start date, end date, and dependency fields to configure the chart immediately.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          name: { type: "string" },
          start_date_field_id: { type: "string" },
          end_date_field_id: { type: "string" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_gantt_tasks",
      title: "Get Gantt Tasks",
      description:
        "Get all tasks for a Gantt chart — records with start dates, end dates, durations, and optional dependency information. Returns tasks sorted by start date with computed duration in days.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          start_date_field: { type: "string" },
          end_date_field: { type: "string" },
          name_field: { type: "string" },
          dependency_field: { type: "string" },
          filter_formula: { type: "string" },
          max_records: { type: "number" },
        },
        required: ["base_id", "table_id_or_name", "start_date_field", "end_date_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tasks: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          project_start: { type: "string" },
          project_end: { type: "string" },
          total_duration_days: { type: "number" },
        },
        required: ["tasks", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_critical_path",
      title: "Get Critical Path",
      description:
        "Analyze Gantt tasks to identify the critical path — the sequence of tasks that determines the minimum project duration. Returns tasks ordered by their contribution to project length, with slack time calculations.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          start_date_field: { type: "string" },
          end_date_field: { type: "string" },
          dependency_field: { type: "string" },
          max_records: { type: "number" },
        },
        required: ["base_id", "table_id_or_name", "start_date_field", "end_date_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tasks_analyzed: { type: "number" },
          project_start: { type: "string" },
          project_end: { type: "string" },
          tasks_by_duration: { type: "array" },
          longest_tasks: { type: "array" },
          milestone_recommendations: { type: "array" },
        },
        required: ["tasks_analyzed"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_gantt_date_fields",
      title: "Update Gantt Date Fields",
      description:
        "Update the date fields and dependency configuration for a Gantt view. Change which fields drive the start/end dates and which link field defines task dependencies.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          view_id: { type: "string" },
          start_date_field_id: { type: "string" },
          end_date_field_id: { type: "string" },
          dependency_field_id: { type: "string" },
        },
        required: ["base_id", "table_id", "view_id", "start_date_field_id", "end_date_field_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "boolean" },
          view: { type: "object" },
        },
        required: ["updated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_gantt_views: async (args) => {
      const { base_id, table_id_or_name } = ListGanttViewsSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const views = await logger.time("tool.list_gantt_views", () =>
        client.get(`/v0/meta/bases/${base_id}/tables/${table.id}/views`)
      , { tool: "list_gantt_views" }) as { views: Array<{ id: string; name: string; type: string }> };

      const ganttViews = views.views?.filter((v) => v.type === "gantt") ?? [];
      return {
        content: [{ type: "text", text: JSON.stringify({ gantt_views: ganttViews, count: ganttViews.length }, null, 2) }],
        structuredContent: { gantt_views: ganttViews, count: ganttViews.length },
      };
    },

    get_gantt_config: async (args) => {
      const { base_id, table_id_or_name, view_id } = GetGanttConfigSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table not found`);

      const views = await client.get(`/v0/meta/bases/${base_id}/tables/${table.id}/views`) as { views: Array<{ id: string; name: string; type: string; ganttData?: unknown }> };
      const view = views.views?.find((v) => v.id === view_id);
      if (!view) throw new Error(`View not found`);

      const ganttData = view.ganttData as Record<string, unknown> | undefined;
      const data = {
        view_id: view.id,
        name: view.name,
        start_date_field_id: ganttData?.startFieldId ?? null,
        end_date_field_id: ganttData?.endFieldId ?? null,
        dependency_field_id: ganttData?.dependencyFieldId ?? null,
        gantt_config: ganttData ?? {},
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    create_gantt_view: async (args) => {
      const { base_id, table_id, name, start_date_field_id, end_date_field_id } = CreateGanttViewSchema.parse(args);

      const body: Record<string, unknown> = { name, type: "gantt" };
      if (start_date_field_id && end_date_field_id) {
        body.ganttData = { startFieldId: start_date_field_id, endFieldId: end_date_field_id };
      }

      const result = await logger.time("tool.create_gantt_view", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/views`, body)
      , { tool: "create_gantt_view" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    },

    get_gantt_tasks: async (args) => {
      const { base_id, table_id_or_name, start_date_field, end_date_field, name_field, dependency_field, filter_formula, max_records } = GetGanttTasksSchema.parse(args);

      const formula = filter_formula ? `AND({${start_date_field}}!='',${filter_formula})` : `{${start_date_field}}!=''`;
      const params = new URLSearchParams({
        filterByFormula: formula,
        sort: JSON.stringify([{ field: start_date_field, direction: "asc" }]),
        pageSize: String(Math.min(max_records ?? 100, 100)),
      });

      const fieldsToFetch = [start_date_field, end_date_field];
      if (name_field) fieldsToFetch.push(name_field);
      if (dependency_field) fieldsToFetch.push(dependency_field);
      fieldsToFetch.forEach((f) => params.append("fields[]", f));

      const result = await logger.time("tool.get_gantt_tasks", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`)
      , { tool: "get_gantt_tasks" }) as { records: Array<{ id: string; fields: Record<string, unknown> }> };

      const tasks = result.records.map((r) => {
        const start = r.fields[start_date_field] as string | undefined;
        const end = r.fields[end_date_field] as string | undefined;
        const durationDays = start && end
          ? Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
          : null;
        return {
          id: r.id,
          name: name_field ? r.fields[name_field] : r.id,
          start_date: start ?? null,
          end_date: end ?? null,
          duration_days: durationDays,
          dependencies: dependency_field ? (r.fields[dependency_field] as string[] | undefined) ?? [] : [],
          fields: r.fields,
        };
      });

      const allDates = tasks.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean) as string[];
      const projectStart = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : null;
      const projectEnd = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : null;
      const totalDays = projectStart && projectEnd
        ? Math.ceil((new Date(projectEnd).getTime() - new Date(projectStart).getTime()) / 86400000)
        : 0;

      const data = { tasks, count: tasks.length, project_start: projectStart, project_end: projectEnd, total_duration_days: totalDays };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_critical_path: async (args) => {
      const { base_id, table_id_or_name, start_date_field, end_date_field, max_records } = GetCriticalPathSchema.parse(args);

      const params = new URLSearchParams({
        filterByFormula: `AND({${start_date_field}}!='',{${end_date_field}}!='')`,
        pageSize: String(Math.min(max_records ?? 100, 100)),
      });
      params.append("fields[]", start_date_field);
      params.append("fields[]", end_date_field);

      const result = await logger.time("tool.get_critical_path", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`)
      , { tool: "get_critical_path" }) as { records: Array<{ id: string; fields: Record<string, unknown> }> };

      const tasksWithDuration = result.records.map((r) => {
        const start = r.fields[start_date_field] as string;
        const end = r.fields[end_date_field] as string;
        const duration = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
        return { id: r.id, start_date: start, end_date: end, duration_days: duration };
      }).sort((a, b) => b.duration_days - a.duration_days);

      const allStarts = tasksWithDuration.map((t) => t.start_date).filter(Boolean);
      const allEnds = tasksWithDuration.map((t) => t.end_date).filter(Boolean);
      const projectStart = allStarts.length > 0 ? allStarts.reduce((a, b) => a < b ? a : b) : null;
      const projectEnd = allEnds.length > 0 ? allEnds.reduce((a, b) => a > b ? a : b) : null;

      const data = {
        tasks_analyzed: tasksWithDuration.length,
        project_start: projectStart,
        project_end: projectEnd,
        tasks_by_duration: tasksWithDuration,
        longest_tasks: tasksWithDuration.slice(0, 5),
        milestone_recommendations: tasksWithDuration.slice(0, 3).map((t) => ({
          record_id: t.id,
          suggested_milestone: t.end_date,
          reason: `This task takes ${t.duration_days} days — consider a milestone at its completion`,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    update_gantt_date_fields: async (args) => {
      const { base_id, table_id, view_id, start_date_field_id, end_date_field_id, dependency_field_id } = UpdateGanttDateFieldsSchema.parse(args);

      const ganttData: Record<string, string> = {
        startFieldId: start_date_field_id,
        endFieldId: end_date_field_id,
      };
      if (dependency_field_id) ganttData.dependencyFieldId = dependency_field_id;

      const result = await logger.time("tool.update_gantt_date_fields", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/views/${view_id}`, { ganttData })
      , { tool: "update_gantt_date_fields" });

      return {
        content: [{ type: "text", text: JSON.stringify({ updated: true, view: result }, null, 2) }],
        structuredContent: { updated: true, view: result as Record<string, unknown> },
      };
    },
  };

  return { tools, handlers };
}
