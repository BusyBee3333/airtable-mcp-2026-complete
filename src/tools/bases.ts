// Airtable Base tools: list_bases, get_base_schema, list_tables,
//   update_base, delete_base, duplicate_base, list_base_collaborators
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

const UpdateBaseSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  name: z.string().optional().describe("New name for the base"),
  color: z.string().optional().describe("Base color: blueBright, tealBright, greenBright, yellowBright, orangeBright, redBright, pinkBright, purpleBright, grayBright, or cyanBright"),
});

const DeleteBaseSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app') to permanently delete"),
});

const DuplicateBaseSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app') to duplicate"),
  name: z.string().optional().describe("Name for the duplicated base (defaults to 'Copy of <original name>')"),
  workspace_id: z.string().optional().describe("Workspace ID to place the duplicate in (defaults to same workspace)"),
  time_zone: z.string().optional().describe("IANA time zone for the duplicate (e.g., 'America/New_York')"),
  locale: z.string().optional().describe("Locale for the duplicate (e.g., 'en-us')"),
  skip_billing_checks: z.boolean().optional().describe("Skip billing checks (enterprise only)"),
});

const ListBaseCollaboratorsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_base_collaborators: z.boolean().optional().describe("Include base-level collaborators (default true)"),
  include_workspace_collaborators: z.boolean().optional().describe("Include workspace-level collaborators"),
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
    {
      name: "update_base",
      title: "Update Base",
      description:
        "Update an Airtable base's name or color. Returns the updated base metadata. Use to rename a base or change its icon color.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          name: { type: "string", description: "New base name" },
          color: { type: "string", description: "Base color: blueBright, tealBright, greenBright, yellowBright, orangeBright, redBright, pinkBright, purpleBright, grayBright, cyanBright" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          color: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_base",
      title: "Delete Base",
      description:
        "Permanently delete an Airtable base and all its tables, records, and data. This action is irreversible. Requires owner-level permission. Use only when user explicitly requests deletion.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app') to permanently delete" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "boolean" },
          id: { type: "string" },
        },
        required: ["deleted"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "duplicate_base",
      title: "Duplicate Base",
      description:
        "Create a copy of an Airtable base including all its tables, fields, and structure. Optionally copy records as well. Returns the new base's ID and name. Use to create a template copy or backup of a base.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID to duplicate" },
          name: { type: "string", description: "Name for the new duplicate base" },
          workspace_id: { type: "string", description: "Destination workspace ID" },
          time_zone: { type: "string", description: "IANA time zone (e.g., 'America/New_York')" },
          locale: { type: "string", description: "Locale (e.g., 'en-us')" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "object" },
          createdTime: { type: "string" },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_base_collaborators",
      title: "List Base Collaborators",
      description:
        "List all collaborators with access to an Airtable base including their user IDs, names, emails, and permission levels (owner, create, edit, comment, read). Returns both base-specific and inherited workspace collaborators.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_base_collaborators: { type: "boolean", description: "Include base-level collaborators (default true)" },
          include_workspace_collaborators: { type: "boolean", description: "Include workspace-level collaborators" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          collaborators: {
            type: "array",
            items: {
              type: "object",
              properties: {
                userId: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                permissionLevel: { type: "string" },
              },
            },
          },
        },
        required: ["collaborators"],
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

    update_base: async (args) => {
      const { base_id, name, color } = UpdateBaseSchema.parse(args);

      if (!name && !color) {
        throw new Error("update_base: at least one of 'name' or 'color' must be provided");
      }

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (color) body.color = color;

      const result = await logger.time("tool.update_base", () =>
        client.patch(`/v0/meta/bases/${base_id}`, body)
      , { tool: "update_base", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_base: async (args) => {
      const { base_id } = DeleteBaseSchema.parse(args);

      const result = await logger.time("tool.delete_base", () =>
        client.delete(`/v0/meta/bases/${base_id}`)
      , { tool: "delete_base", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    duplicate_base: async (args) => {
      const { base_id, name, workspace_id, time_zone, locale } = DuplicateBaseSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (workspace_id) body.workspaceId = workspace_id;
      if (time_zone) body.timeZone = time_zone;
      if (locale) body.locale = locale;

      const result = await logger.time("tool.duplicate_base", () =>
        client.post(`/v0/meta/bases/${base_id}/duplicateBase`, body)
      , { tool: "duplicate_base", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_base_collaborators: async (args) => {
      const { base_id, include_base_collaborators, include_workspace_collaborators } =
        ListBaseCollaboratorsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (include_base_collaborators !== undefined) {
        queryParams.set("include[]", "collaborators");
      }
      if (include_workspace_collaborators) {
        queryParams.append("include[]", "workspaceCollaborators");
      }

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_base_collaborators", () =>
        client.get(`/v0/meta/bases/${base_id}/collaborators${qs ? `?${qs}` : ""}`)
      , { tool: "list_base_collaborators", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
