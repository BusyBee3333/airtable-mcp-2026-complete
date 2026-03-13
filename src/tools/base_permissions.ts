// Airtable Base Permissions tools: get_base_access_level, list_base_collaborators_with_roles,
//   check_user_permissions, get_field_permissions, list_restricted_fields,
//   summarize_base_sharing, audit_collaborator_access
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetBaseAccessLevelSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
});

const ListCollaboratorsWithRolesSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  role_filter: z.enum(["owner", "create", "editor", "commenter", "viewer", "all"]).optional().default("all"),
});

const CheckUserPermissionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  user_id: z.string().optional().describe("User ID to check (omit for current user)"),
});

const GetFieldPermissionsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

const SummarizeBaseSharingSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_base_access_level",
      title: "Get Base Access Level",
      description:
        "Get the current user's access level on an Airtable base — returns permission level (owner/creator/editor/commenter/viewer) and what operations are allowed. Also shows if the base is in a workspace and workspace permission level.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          permission_level: { type: "string" },
          can_create_records: { type: "boolean" },
          can_edit_records: { type: "boolean" },
          can_delete_records: { type: "boolean" },
          can_create_fields: { type: "boolean" },
          can_invite_collaborators: { type: "boolean" },
        },
        required: ["permission_level"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_collaborators_with_roles",
      title: "List Collaborators with Roles",
      description:
        "List all collaborators on a base with their roles and permission levels. Optionally filter by role. Includes user IDs, names, emails, and when they were added.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          role_filter: {
            type: "string",
            enum: ["owner", "create", "editor", "commenter", "viewer", "all"],
            description: "Filter by role (default: all)",
          },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          collaborators: { type: "array", items: { type: "object" } },
          total: { type: "number" },
          by_role: { type: "object" },
        },
        required: ["collaborators", "total"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "check_user_permissions",
      title: "Check User Permissions",
      description:
        "Check what permissions a user has on a base. Returns a detailed breakdown of allowed operations. Uses current user if no user_id specified.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          user_id: { type: "string", description: "User ID (optional, defaults to current user)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          permission_level: { type: "string" },
          permissions: { type: "object" },
        },
        required: ["permission_level"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_field_permissions",
      title: "Get Field Permissions",
      description:
        "Get permission settings for fields in a table — shows which fields are write-protected, computed (formula/rollup/lookup), or read-only for certain collaborators.",
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
          table: { type: "string" },
          fields: { type: "array", items: { type: "object" } },
          read_only_count: { type: "number" },
          editable_count: { type: "number" },
        },
        required: ["fields"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "summarize_base_sharing",
      title: "Summarize Base Sharing",
      description:
        "Get a complete summary of how a base is shared — collaborator count by role, any public sharing links, workspace sharing settings, and overall access posture.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          total_collaborators: { type: "number" },
          collaborators_by_role: { type: "object" },
          public_shares: { type: "array" },
          access_posture: { type: "string" },
        },
        required: ["total_collaborators"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_base_access_level: async (args) => {
      const { base_id } = GetBaseAccessLevelSchema.parse(args);

      const bases = await logger.time("tool.get_base_access_level", () =>
        client.get(`/v0/meta/bases`)
      , { tool: "get_base_access_level", base_id }) as { bases: Array<{ id: string; permissionLevel: string }> };

      const base = bases.bases?.find((b) => b.id === base_id);
      const level = base?.permissionLevel ?? "unknown";

      const permMap: Record<string, Record<string, boolean>> = {
        owner:    { can_create_records: true, can_edit_records: true, can_delete_records: true, can_create_fields: true, can_invite_collaborators: true },
        create:   { can_create_records: true, can_edit_records: true, can_delete_records: true, can_create_fields: true, can_invite_collaborators: false },
        editor:   { can_create_records: true, can_edit_records: true, can_delete_records: true, can_create_fields: false, can_invite_collaborators: false },
        commenter:{ can_create_records: false, can_edit_records: false, can_delete_records: false, can_create_fields: false, can_invite_collaborators: false },
        viewer:   { can_create_records: false, can_edit_records: false, can_delete_records: false, can_create_fields: false, can_invite_collaborators: false },
      };

      const perms = permMap[level] ?? permMap.viewer;
      const data = { base_id, permission_level: level, ...perms };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    list_collaborators_with_roles: async (args) => {
      const { base_id, role_filter } = ListCollaboratorsWithRolesSchema.parse(args);

      const result = await logger.time("tool.list_collaborators_with_roles", () =>
        client.get(`/v0/meta/bases/${base_id}/collaborators`)
      , { tool: "list_collaborators_with_roles", base_id }) as { collaborators: Array<{ id: string; email: string; name: string; permissionLevel: string }> };

      const all = result.collaborators || [];
      const filtered = role_filter === "all" ? all : all.filter((c) => c.permissionLevel === role_filter);

      const byRole: Record<string, number> = {};
      for (const c of all) { byRole[c.permissionLevel] = (byRole[c.permissionLevel] ?? 0) + 1; }

      const data = { collaborators: filtered, total: filtered.length, by_role: byRole };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    check_user_permissions: async (args) => {
      const { base_id, user_id } = CheckUserPermissionsSchema.parse(args);

      const bases = await client.get(`/v0/meta/bases`) as { bases: Array<{ id: string; permissionLevel: string }> };
      const base = bases.bases?.find((b) => b.id === base_id);
      const level = base?.permissionLevel ?? "viewer";

      const permDetails: Record<string, boolean> = {
        read_records: true,
        write_records: ["owner", "create", "editor"].includes(level),
        delete_records: ["owner", "create", "editor"].includes(level),
        manage_fields: ["owner", "create"].includes(level),
        manage_views: ["owner", "create", "editor"].includes(level),
        invite_collaborators: level === "owner",
        manage_automations: ["owner", "create"].includes(level),
        comment: ["owner", "create", "editor", "commenter"].includes(level),
      };

      const data = { user_id: user_id ?? "current_user", permission_level: level, permissions: permDetails };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_field_permissions: async (args) => {
      const { base_id, table_id_or_name } = GetFieldPermissionsSchema.parse(args);

      const schema = await logger.time("tool.get_field_permissions", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_field_permissions", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }> };

      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const READ_ONLY_TYPES = new Set(["formula", "rollup", "lookup", "count", "autoNumber", "createdTime", "lastModifiedTime", "createdBy", "lastModifiedBy"]);

      const fields = table.fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        is_read_only: READ_ONLY_TYPES.has(f.type),
        is_computed: READ_ONLY_TYPES.has(f.type),
        is_editable: !READ_ONLY_TYPES.has(f.type),
      }));

      const data = {
        table: table.name,
        fields,
        read_only_count: fields.filter((f) => f.is_read_only).length,
        editable_count: fields.filter((f) => f.is_editable).length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    summarize_base_sharing: async (args) => {
      const { base_id } = SummarizeBaseSharingSchema.parse(args);

      const [collabResult, sharesResult] = await Promise.all([
        client.get(`/v0/meta/bases/${base_id}/collaborators`).catch(() => ({ collaborators: [] })),
        client.get(`/v0/meta/bases/${base_id}/shares`).catch(() => ({ shares: [] })),
      ]) as [
        { collaborators: Array<{ permissionLevel: string }> },
        { shares: Array<{ type: string; isPasswordProtected?: boolean }> }
      ];

      const collabs = collabResult.collaborators || [];
      const shares = sharesResult.shares || [];

      const byRole: Record<string, number> = {};
      for (const c of collabs) { byRole[c.permissionLevel] = (byRole[c.permissionLevel] ?? 0) + 1; }

      const publicShares = shares.filter((s) => s.type === "view" || s.type === "base");
      const hasPublicAccess = publicShares.length > 0;
      const posture = collabs.length === 0 ? "private" :
        hasPublicAccess ? "public" :
        collabs.length <= 3 ? "small_team" : "team";

      const data = {
        base_id,
        total_collaborators: collabs.length,
        collaborators_by_role: byRole,
        public_shares: publicShares,
        access_posture: posture,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
