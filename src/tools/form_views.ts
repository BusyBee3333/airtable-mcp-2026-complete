// Airtable Form Views tools: list_form_views, get_form_config,
//   get_form_prefill_url, analyze_form_submissions, get_form_field_config
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListFormViewsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().optional().describe("Optional: filter to a specific table"),
});

const GetFormConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("Form view ID (starts with 'viw') or view name"),
});

const GetFormPrefillUrlSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("Form view ID or name"),
  prefill_values: z.record(z.string()).describe("Field name → value pairs to pre-fill. Values must be strings. Example: {'Name':'John','Status':'Active','Email':'john@example.com'}"),
});

const AnalyzeFormSubmissionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table associated with the form"),
  since_date: z.string().optional().describe("ISO 8601 date to analyze submissions from (e.g., '2024-01-01')"),
  group_by_field: z.string().optional().describe("Field to group submission counts by (e.g., 'Status', 'Source')"),
});

const GetFormFieldConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  view_id_or_name: z.string().describe("Form view ID or name"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_form_views",
      title: "List Form Views",
      description:
        "List all form views across a base (or a specific table). Form views in Airtable allow external data collection via shareable forms. Returns form view IDs, names, and associated tables. Use to discover all forms in a base for management or linking.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Optional: filter to a specific table" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          forms: { type: "array", items: { type: "object" } },
          formCount: { type: "number" },
          tableCount: { type: "number" },
        },
        required: ["forms", "formCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_form_config",
      title: "Get Form Config",
      description:
        "Get the configuration of an Airtable form view including visible fields, field labels, field descriptions, required fields, and form metadata. Returns the complete form configuration as defined in the view schema. Use to understand form structure before generating pre-fill URLs or analyzing submissions.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "Form view ID or name" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formId: { type: "string" },
          formName: { type: "string" },
          visibleFields: { type: "array", items: { type: "object" } },
          fieldCount: { type: "number" },
          shareUrl: { type: "string" },
        },
        required: ["formName", "visibleFields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_form_prefill_url",
      title: "Get Form Prefill URL",
      description:
        "Generate an Airtable form URL with pre-filled field values. Pre-filled forms send users to the form with certain fields already populated. Useful for magic links in emails, contextual form links, or automating form workflows. Field values are URL-encoded into the shareable form URL.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "Form view ID or name" },
          prefill_values: {
            type: "object",
            description: "Field name → value pairs to pre-fill: {'Name':'John','Status':'Active'}",
          },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name", "prefill_values"],
      },
      outputSchema: {
        type: "object",
        properties: {
          prefillUrl: { type: "string" },
          baseShareUrl: { type: "string" },
          prefillParams: { type: "object" },
          fieldCount: { type: "number" },
        },
        required: ["prefillUrl"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "analyze_form_submissions",
      title: "Analyze Form Submissions",
      description:
        "Analyze records in a table to understand form submission patterns. Returns submission count, submission rate by date, most recent submissions, and optional grouping by a field value. Use to monitor form activity and identify submission trends.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table associated with the form" },
          since_date: { type: "string", description: "ISO 8601 start date: '2024-01-01'" },
          group_by_field: { type: "string", description: "Field to group counts by: 'Status', 'Source'" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          totalSubmissions: { type: "number" },
          recentSubmissions: { type: "array", items: { type: "object" } },
          submissionsByDate: { type: "object" },
          groupedCounts: { type: "object" },
        },
        required: ["totalSubmissions"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_form_field_config",
      title: "Get Form Field Config",
      description:
        "Get detailed field configuration for a form view — including which fields are shown, their order, labels, descriptions, and whether they are required. Returns the form's field list in display order with all configuration options from the view schema.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          view_id_or_name: { type: "string", description: "Form view ID or name" },
        },
        required: ["base_id", "table_id_or_name", "view_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formName: { type: "string" },
          fields: { type: "array", items: { type: "object" } },
          hiddenFields: { type: "array", items: { type: "string" } },
          fieldCount: { type: "number" },
        },
        required: ["formName", "fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function getTableWithViews(base_id: string, table_id_or_name?: string) {
    const schema = await logger.time("tool.form_views.get_schema", () =>
      client.get(`/v0/meta/bases/${base_id}/tables`)
    , { tool: "form_views" }) as {
      tables?: Array<{
        id: string;
        name: string;
        fields?: Array<{ id: string; name: string; type: string }>;
        views?: Array<{ id: string; name: string; type: string; [key: string]: unknown }>;
      }>;
    };

    const tables = schema.tables ?? [];
    if (table_id_or_name) {
      const table = tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);
      return [table];
    }
    return tables;
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_form_views: async (args) => {
      const params = ListFormViewsSchema.parse(args);
      const tables = await getTableWithViews(params.base_id, params.table_id_or_name);

      const forms: unknown[] = [];
      const tableNames = new Set<string>();

      for (const table of tables) {
        const formViews = (table.views ?? []).filter((v) => v.type === "form");
        for (const view of formViews) {
          forms.push({ id: view.id, name: view.name, tableId: table.id, tableName: table.name });
          tableNames.add(table.name);
        }
      }

      const response = { forms, formCount: forms.length, tableCount: tableNames.size };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_form_config: async (args) => {
      const params = GetFormConfigSchema.parse(args);
      const [table] = await getTableWithViews(params.base_id, params.table_id_or_name);
      const view = (table.views ?? []).find(
        (v) => (v.id === params.view_id_or_name || v.name === params.view_id_or_name) && v.type === "form"
      );
      if (!view) throw new Error(`Form view '${params.view_id_or_name}' not found or is not a form type`);

      const fieldMap = new Map((table.fields ?? []).map((f) => [f.id, f]));
      const visibleFieldIds = (view.visibleFieldIds as string[] | undefined) ?? (table.fields ?? []).map((f) => f.id);
      const visibleFields = visibleFieldIds.map((id) => fieldMap.get(id)).filter(Boolean);

      const response = {
        formId: view.id,
        formName: view.name,
        tableId: table.id,
        tableName: table.name,
        visibleFields: visibleFields.map((f) => ({ id: (f as { id: string }).id, name: (f as { name: string }).name, type: (f as { type: string }).type })),
        fieldCount: visibleFields.length,
        rawConfig: view,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_form_prefill_url: async (args) => {
      const params = GetFormPrefillUrlSchema.parse(args);

      // Get the share URL for the form
      const sharesResult = await logger.time("tool.get_form_prefill_url.shares", () =>
        client.get(`/v0/meta/bases/${params.base_id}/shares`)
      , { tool: "get_form_prefill_url" }).catch(() => ({ shares: [] })) as {
        shares?: Array<{ shareId?: string; type?: string; shareUrl?: string; isEnabled?: boolean }>;
      };

      const [table] = await getTableWithViews(params.base_id, params.table_id_or_name);
      const view = (table.views ?? []).find(
        (v) => v.id === params.view_id_or_name || v.name === params.view_id_or_name
      );
      if (!view) throw new Error(`View '${params.view_id_or_name}' not found`);

      // Build prefill URL — Airtable format: https://airtable.com/shrXXXXX?prefill_FieldName=value
      const formShare = (sharesResult.shares ?? []).find((s) => s.type === "form" && s.isEnabled !== false);
      const baseShareUrl = formShare?.shareUrl ?? `https://airtable.com/${params.base_id}/${view.id}`;

      const prefillParams: Record<string, string> = {};
      const urlParams = new URLSearchParams();
      for (const [fieldName, value] of Object.entries(params.prefill_values)) {
        const key = `prefill_${fieldName}`;
        urlParams.set(key, String(value));
        prefillParams[key] = String(value);
      }

      const prefillUrl = `${baseShareUrl}?${urlParams.toString()}`;

      const response = {
        prefillUrl,
        baseShareUrl,
        prefillParams,
        fieldCount: Object.keys(params.prefill_values).length,
        note: "The base share URL is constructed from available share data. For the exact shareable form URL, get the form share from list_base_shares.",
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    analyze_form_submissions: async (args) => {
      const params = AnalyzeFormSubmissionsSchema.parse(args);
      const qp = new URLSearchParams();
      qp.set("pageSize", "100");

      if (params.since_date) {
        qp.set("filterByFormula", `IS_AFTER(CREATED_TIME(),"${params.since_date}")`);
      }

      if (params.group_by_field) {
        qp.append("fields[]", params.group_by_field);
      }

      const allRecords: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;

      do {
        if (offset) qp.set("offset", offset);
        const result = await logger.time("tool.analyze_form_submissions.fetch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${qp}`)
        , { tool: "analyze_form_submissions" }) as {
          records?: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }>;
          offset?: string;
        };
        allRecords.push(...(result.records ?? []));
        offset = result.offset;
        if (allRecords.length >= 1000) break; // safety limit
      } while (offset);

      // Group by date
      const byDate: Record<string, number> = {};
      for (const rec of allRecords) {
        const date = rec.createdTime.split("T")[0];
        byDate[date] = (byDate[date] ?? 0) + 1;
      }

      // Group by field
      const groupedCounts: Record<string, number> = {};
      if (params.group_by_field) {
        for (const rec of allRecords) {
          const val = String(rec.fields[params.group_by_field] ?? "Unknown");
          groupedCounts[val] = (groupedCounts[val] ?? 0) + 1;
        }
      }

      const response = {
        totalSubmissions: allRecords.length,
        recentSubmissions: allRecords.slice(0, 5).map((r) => ({ id: r.id, createdTime: r.createdTime })),
        submissionsByDate: byDate,
        groupedCounts: params.group_by_field ? groupedCounts : {},
        groupByField: params.group_by_field ?? null,
        dateRange: allRecords.length > 0 ? {
          earliest: allRecords[allRecords.length - 1]?.createdTime,
          latest: allRecords[0]?.createdTime,
        } : null,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_form_field_config: async (args) => {
      const params = GetFormFieldConfigSchema.parse(args);
      const [table] = await getTableWithViews(params.base_id, params.table_id_or_name);
      const view = (table.views ?? []).find(
        (v) => v.id === params.view_id_or_name || v.name === params.view_id_or_name
      );
      if (!view) throw new Error(`View '${params.view_id_or_name}' not found`);

      const allFields = table.fields ?? [];
      const visibleFieldIds = (view.visibleFieldIds as string[] | undefined) ?? allFields.map((f) => f.id);
      const visibleSet = new Set(visibleFieldIds);
      const hiddenFields = allFields.filter((f) => !visibleSet.has(f.id)).map((f) => f.name);

      const fieldMap = new Map(allFields.map((f) => [f.id, f]));
      const visibleFields = visibleFieldIds.map((id) => {
        const f = fieldMap.get(id);
        if (!f) return null;
        return { id: f.id, name: f.name, type: f.type, order: visibleFieldIds.indexOf(id) };
      }).filter(Boolean);

      const response = {
        formName: view.name,
        formId: view.id,
        fields: visibleFields,
        hiddenFields,
        fieldCount: visibleFields.length,
        hiddenCount: hiddenFields.length,
        totalTableFields: allFields.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
