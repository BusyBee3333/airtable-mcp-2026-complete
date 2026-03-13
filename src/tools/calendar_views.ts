// Airtable Calendar Views tools: list_calendar_views, get_calendar_config,
//   get_events_in_range, get_upcoming_events, get_calendar_summary
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListCalendarViewsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().optional().describe("Optional: filter to a specific table"),
});

const GetCalendarConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("Calendar view ID or name"),
});

const GetEventsInRangeSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  date_field: z.string().describe("Name of the date or datetime field that drives the calendar"),
  start_date: z.string().describe("Start of date range (ISO 8601: '2024-01-01')"),
  end_date: z.string().describe("End of date range (ISO 8601: '2024-01-31')"),
  fields: z.array(z.string()).optional().describe("Additional fields to return with each event"),
  end_date_field: z.string().optional().describe("Optional end date field for events with duration"),
  view: z.string().optional().describe("Optional view ID or name to filter events"),
});

const GetUpcomingEventsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  date_field: z.string().describe("Name of the date field"),
  days_ahead: z.number().min(1).max(365).optional().default(7).describe("Days ahead to look for events (default: 7)"),
  fields: z.array(z.string()).optional().describe("Fields to return with events"),
  max_events: z.number().optional().default(20).describe("Maximum events to return (default: 20)"),
});

const GetCalendarSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  date_field: z.string().describe("Name of the date field"),
  group_by: z.enum(["day", "week", "month"]).optional().default("month").describe("Grouping period for summary (default: month)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_calendar_views",
      title: "List Calendar Views",
      description:
        "List all calendar views in a base or specific table. Calendar views display records with a date field on a calendar layout. Returns view IDs, names, and associated tables. Use to discover all calendar views for navigation or configuration.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Optional: filter to specific table" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          calendarViews: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["calendarViews", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_calendar_config",
      title: "Get Calendar Config",
      description:
        "Get the configuration of a calendar view including the date field driving the calendar, color field, and any filters applied. Returns the view's schema configuration. Use to understand how a calendar is set up before querying its events.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "Calendar view ID or name" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          viewName: { type: "string" },
          dateField: { type: "string" },
          colorField: { type: "string" },
          config: { type: "object" },
        },
        required: ["viewName"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_events_in_range",
      title: "Get Events In Range",
      description:
        "Fetch all records (events) from a table that fall within a specified date range. Uses a date field to filter records. Optionally supports events with a start and end date for duration-based filtering. Returns events sorted by date. Perfect for building calendar displays, scheduling reports, or date-range analytics.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          date_field: { type: "string", description: "Date field name driving the calendar" },
          start_date: { type: "string", description: "Start of range: '2024-01-01'" },
          end_date: { type: "string", description: "End of range: '2024-01-31'" },
          fields: { type: "array", items: { type: "string" }, description: "Additional fields to return" },
          end_date_field: { type: "string", description: "Optional end date field for duration events" },
          view: { type: "string", description: "Optional view ID or name" },
        },
        required: ["base_id", "table_id_or_name", "date_field", "start_date", "end_date"],
      },
      outputSchema: {
        type: "object",
        properties: {
          events: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          dateRange: { type: "object" },
        },
        required: ["events", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_upcoming_events",
      title: "Get Upcoming Events",
      description:
        "Get events (records) scheduled in the next N days from a date field. Returns events sorted chronologically by date, with their field values. Use for 'upcoming' widgets, daily briefings, deadline trackers, or notification triggers.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          date_field: { type: "string", description: "Date field name" },
          days_ahead: { type: "number", description: "Days to look ahead (1-365, default: 7)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return with events" },
          max_events: { type: "number", description: "Max events to return (default: 20)" },
        },
        required: ["base_id", "table_id_or_name", "date_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          events: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          lookAheadDays: { type: "number" },
          nextEvent: { type: "object" },
        },
        required: ["events", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_calendar_summary",
      title: "Get Calendar Summary",
      description:
        "Get an aggregated summary of events grouped by day, week, or month. Returns event counts per period, busiest periods, and an overview of the calendar density. Use for analytics dashboards, capacity planning, or understanding event distribution over time.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          date_field: { type: "string", description: "Date field name" },
          group_by: { type: "string", description: "Grouping: day, week, or month (default: month)" },
        },
        required: ["base_id", "table_id_or_name", "date_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          summary: { type: "object" },
          busiestPeriod: { type: "string" },
          totalEvents: { type: "number" },
          groupBy: { type: "string" },
        },
        required: ["summary", "totalEvents"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_calendar_views: async (args) => {
      const params = ListCalendarViewsSchema.parse(args);

      const schema = await logger.time("tool.list_calendar_views.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "list_calendar_views" }) as {
        tables?: Array<{
          id: string;
          name: string;
          views?: Array<{ id: string; name: string; type: string }>;
        }>;
      };

      const tables = schema.tables ?? [];
      const filtered = params.table_id_or_name
        ? tables.filter((t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name)
        : tables;

      const calendarViews: unknown[] = [];
      for (const table of filtered) {
        for (const view of (table.views ?? []).filter((v) => v.type === "calendar")) {
          calendarViews.push({ id: view.id, name: view.name, tableId: table.id, tableName: table.name });
        }
      }

      const response = { calendarViews, count: calendarViews.length };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_calendar_config: async (args) => {
      const params = GetCalendarConfigSchema.parse(args);

      const schema = await logger.time("tool.get_calendar_config.schema", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "get_calendar_config" }) as {
        tables?: Array<{
          id: string;
          name: string;
          fields?: Array<{ id: string; name: string; type: string }>;
          views?: Array<{ id: string; name: string; type: string; [key: string]: unknown }>;
        }>;
      };

      const table = (schema.tables ?? []).find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );
      if (!table) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const view = (table.views ?? []).find(
        (v) => (v.id === params.view_id_or_name || v.name === params.view_id_or_name)
      );
      if (!view) throw new Error(`View '${params.view_id_or_name}' not found`);

      const fieldMap = new Map((table.fields ?? []).map((f) => [f.id, f.name]));
      const dateFieldId = view.dateFieldId as string | undefined;
      const colorFieldId = view.colorFieldId as string | undefined;

      const response = {
        viewName: view.name,
        viewId: view.id,
        dateField: dateFieldId ? (fieldMap.get(dateFieldId) ?? dateFieldId) : null,
        colorField: colorFieldId ? (fieldMap.get(colorFieldId) ?? colorFieldId) : null,
        config: view,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_events_in_range: async (args) => {
      const params = GetEventsInRangeSchema.parse(args);

      let formula: string;
      if (params.end_date_field) {
        formula = `AND(IS_BEFORE({${params.date_field}},"${params.end_date}"),IS_AFTER({${params.end_date_field}},"${params.start_date}"))`;
      } else {
        formula = `AND(IS_AFTER({${params.date_field}},"${params.start_date}"),IS_BEFORE({${params.date_field}},"${params.end_date}"))`;
      }

      const qp = new URLSearchParams();
      qp.set("filterByFormula", formula);
      qp.set(`sort[0][field]`, params.date_field);
      qp.set(`sort[0][direction]`, "asc");
      if (params.view) qp.set("view", params.view);

      const fields = [...(params.fields ?? []), params.date_field];
      if (params.end_date_field) fields.push(params.end_date_field);
      [...new Set(fields)].forEach((f) => qp.append("fields[]", f));

      const allEvents: unknown[] = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.get_events_in_range.fetch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "get_events_in_range" }) as { records?: unknown[]; offset?: string };
        allEvents.push(...(result.records ?? []));
        offset = result.offset;
        if (allEvents.length >= 500) break;
      } while (offset);

      const response = {
        events: allEvents,
        count: allEvents.length,
        dateRange: { start: params.start_date, end: params.end_date },
        dateField: params.date_field,
        formula,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_upcoming_events: async (args) => {
      const params = GetUpcomingEventsSchema.parse(args);
      const daysAhead = params.days_ahead ?? 7;

      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + daysAhead);

      const startISO = today.toISOString().split("T")[0];
      const endISO = endDate.toISOString().split("T")[0];

      const formula = `AND(IS_AFTER({${params.date_field}},"${startISO}"),IS_BEFORE({${params.date_field}},"${endISO}"))`;

      const qp = new URLSearchParams();
      qp.set("filterByFormula", formula);
      qp.set(`sort[0][field]`, params.date_field);
      qp.set(`sort[0][direction]`, "asc");
      qp.set("maxRecords", String(params.max_events ?? 20));

      const fields = [...(params.fields ?? []), params.date_field];
      [...new Set(fields)].forEach((f) => qp.append("fields[]", f));

      const result = await logger.time("tool.get_upcoming_events.fetch", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
      , { tool: "get_upcoming_events" }) as { records?: unknown[] };

      const events = result.records ?? [];

      const response = {
        events,
        count: events.length,
        lookAheadDays: daysAhead,
        dateRange: { start: startISO, end: endISO },
        nextEvent: events[0] ?? null,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_calendar_summary: async (args) => {
      const params = GetCalendarSummarySchema.parse(args);
      const groupBy = params.group_by ?? "month";

      const qp = new URLSearchParams();
      qp.set("pageSize", "100");
      qp.append("fields[]", params.date_field);

      const allRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.get_calendar_summary.fetch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "get_calendar_summary" }) as { records?: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
        if (allRecords.length >= 2000) break;
      } while (offset);

      const summary: Record<string, number> = {};
      for (const rec of allRecords) {
        const dateVal = rec.fields[params.date_field];
        if (!dateVal) continue;
        const date = new Date(String(dateVal));
        if (isNaN(date.getTime())) continue;

        let key: string;
        if (groupBy === "day") {
          key = date.toISOString().split("T")[0];
        } else if (groupBy === "week") {
          const startOfWeek = new Date(date);
          startOfWeek.setDate(date.getDate() - date.getDay());
          key = `week-${startOfWeek.toISOString().split("T")[0]}`;
        } else {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        }
        summary[key] = (summary[key] ?? 0) + 1;
      }

      const busiestPeriod = Object.entries(summary).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

      const response = {
        summary,
        busiestPeriod,
        totalEvents: allRecords.length,
        groupBy,
        periodCount: Object.keys(summary).length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
