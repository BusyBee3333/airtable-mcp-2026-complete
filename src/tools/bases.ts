// Airtable Base tools: list_bases, get_base_schema, list_tables
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListBasesSchema = z.object({
  offset: z.string().optional().describe("Pagination offset token from previous response"),
});

const GetBaseSchemaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include: z.array(z.string()).optional().describe("Fields to include: visibleFieldIds, etc."),
});

const ListTablesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_bases",
      title: "List Bases",
      description:
        "List all Airtable bases accessible with the current token. Returns base IDs, names, and permission levels. Supports cursor pagination via offset. Use this first to find base IDs before working with tables or records.",
      inputSchema: {
        type: "object",
        properties: {
          offset: { type: "string", description: "Pagination offset token from previous response" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          bases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                permissionLevel: { type: "string" },
              },
            },
          },
          offset: { type: "string" },
        },
        required: ["bases"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_base_schema",
      title: "Get Base Schema",
      description:
        "Get the full schema of a base including all tables, fields, and their types. Use to understand the structure of a base before querying or writing records. Returns table IDs, field definitions, and views.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                primaryFieldId: { type: "string" },
                fields: { type: "array" },
                views: { type: "array" },
              },
            },
          },
        },
        required: ["tables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_tables",
      title: "List Tables",
      description:
        "List all tables in an Airtable base with their field definitions. Returns table IDs, names, and field schemas. Use to discover available tables before working with records.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                fields: { type: "array" },
              },
            },
          },
        },
        required: ["tables"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_bases: async (args) => {
      const params = ListBasesSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (params.offset) queryParams.set("offset", params.offset);

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_bases", () =>
        client.get(`/v0/meta/bases${qs ? `?${qs}` : ""}`)
      , { tool: "list_bases" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_base_schema: async (args) => {
      const { base_id } = GetBaseSchemaSchema.parse(args);
      const result = await logger.time("tool.get_base_schema", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_base_schema", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_tables: async (args) => {
      const { base_id } = ListTablesSchema.parse(args);
      const result = await logger.time("tool.list_tables", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_tables", base_id });

      // Return simplified table list (just name/id/fields)
      const raw = result as { tables?: Array<{ id: string; name: string; primaryFieldId: string; fields: unknown[]; views?: unknown[] }> };
      const simplified = {
        tables: (raw.tables || []).map((t) => ({
          id: t.id,
          name: t.name,
          primaryFieldId: t.primaryFieldId,
          fieldCount: t.fields?.length || 0,
          fields: t.fields,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(simplified, null, 2) }],
        structuredContent: simplified,
      };
    },
  };

  return { tools, handlers };
}
