// Airtable Enterprise tools: get_enterprise_account, list_enterprise_workspaces,
//   list_enterprise_bases, get_enterprise_user, list_enterprise_users,
//   deactivate_enterprise_users, reactivate_enterprise_users,
//   manage_enterprise_user_admin, list_enterprise_groups, get_enterprise_group,
//   delete_enterprise_users, move_enterprise_users
// Uses Airtable Enterprise API: https://api.airtable.com/v0/meta/enterpriseAccount/{accountId}
// Note: Enterprise APIs require Enterprise plan and enterprise:manage scope
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetEnterpriseAccountSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  include: z.array(z.enum(["collaborators", "groups", "workspacesAndBases"])).optional()
    .describe("Additional data to include: collaborators, groups, workspacesAndBases"),
});

const ListEnterpriseWorkspacesSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  offset: z.string().optional().describe("Pagination offset"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Results per page (1-100)"),
});

const ListEnterpriseBasesSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  workspace_ids: z.array(z.string()).optional().describe("Filter by specific workspace IDs"),
  offset: z.string().optional().describe("Pagination offset"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Results per page (1-100)"),
});

const GetEnterpriseUserSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_id: z.string().optional().describe("User ID (starts with 'usr'). Provide user_id OR email."),
  email: z.string().email().optional().describe("User's email address. Provide user_id OR email."),
  include: z.array(z.enum(["collaborations", "groups"])).optional()
    .describe("Additional data: collaborations, groups"),
});

const ListEnterpriseUsersSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  filter: z.enum(["all", "active", "inactive", "managed"]).optional().default("all")
    .describe("Filter: all, active, inactive, or managed users"),
  include: z.array(z.enum(["collaborations", "groups"])).optional()
    .describe("Additional data to include per user: collaborations, groups"),
  offset: z.string().optional().describe("Pagination offset"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Results per page (1-100)"),
  sort: z.array(z.object({
    field: z.enum(["email", "name", "createdTime", "lastActivityTime"]),
    direction: z.enum(["asc", "desc"]).optional().default("asc"),
  })).optional().describe("Sort users: [{field:'email',direction:'asc'}]"),
});

const DeactivateEnterpriseUsersSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_ids: z.array(z.string()).min(1).describe("Array of user IDs (starts with 'usr') to deactivate"),
  replacement_owner_id: z.string().optional()
    .describe("User ID to transfer ownership of the deactivated users' resources to"),
});

const ReactivateEnterpriseUsersSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_ids: z.array(z.string()).min(1).describe("Array of user IDs (starts with 'usr') to reactivate"),
});

const ManageEnterpriseUserAdminSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_id: z.string().describe("User ID (starts with 'usr')"),
  is_admin: z.boolean().describe("true to grant admin, false to revoke admin"),
});

const ListEnterpriseGroupsSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  offset: z.string().optional().describe("Pagination offset"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Results per page (1-100)"),
});

const GetEnterpriseGroupSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  group_id: z.string().describe("Group ID (starts with 'grp')"),
  include: z.array(z.enum(["collaborations", "members"])).optional()
    .describe("Additional data to include: collaborations, members"),
});

const DeleteEnterpriseUsersSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_ids: z.array(z.string()).min(1).describe("Array of user IDs (starts with 'usr') to permanently delete"),
});

const LogoutEnterpriseUsersSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_ids: z.array(z.string()).min(1).describe("Array of user IDs to force-logout from all active sessions"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_enterprise_account",
      title: "Get Enterprise Account",
      description:
        "Get details for an Airtable Enterprise account including plan info, user count, workspace count, and settings. Requires enterprise:manage scope and Enterprise plan. Returns account metadata and optionally collaborators and groups.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Additional data: ['collaborators', 'groups', 'workspacesAndBases']",
          },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          userCount: { type: "number" },
          workspaceCount: { type: "number" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_enterprise_workspaces",
      title: "List Enterprise Workspaces",
      description:
        "List all workspaces in an Enterprise account with names, IDs, and member counts. Supports pagination. Useful for auditing workspace usage across the enterprise.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          offset: { type: "string", description: "Pagination offset" },
          page_size: { type: "number", description: "Results per page (1-100, default 100)" },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          workspaces: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["workspaces"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_enterprise_bases",
      title: "List Enterprise Bases",
      description:
        "List all bases in an Enterprise account, optionally filtered by workspace. Returns base IDs, names, workspace associations, and creation dates. Use for enterprise-wide base audits.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          workspace_ids: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific workspace IDs",
          },
          offset: { type: "string", description: "Pagination offset" },
          page_size: { type: "number", description: "Results per page (1-100, default 100)" },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          bases: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["bases"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_enterprise_user",
      title: "Get Enterprise User",
      description:
        "Get detailed information about a specific user in an Enterprise account. Lookup by user_id or email. Optionally include the user's collaborations (bases/workspaces they have access to) and group memberships.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_id: { type: "string", description: "User ID (starts with 'usr'). Use user_id OR email." },
          email: { type: "string", description: "User's email address. Use user_id OR email." },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Additional data: ['collaborations', 'groups']",
          },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          state: { type: "string" },
          createdTime: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_enterprise_users",
      title: "List Enterprise Users",
      description:
        "List all users in an Enterprise account with filtering, sorting, and pagination. Returns user IDs, names, emails, and account states. Filter by active/inactive/managed. Optionally include collaborations and group memberships.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          filter: { type: "string", description: "Filter: all, active, inactive, or managed (default: all)" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Include per user: ['collaborations', 'groups']",
          },
          offset: { type: "string", description: "Pagination offset" },
          page_size: { type: "number", description: "Results per page (1-100)" },
          sort: {
            type: "array",
            items: { type: "object" },
            description: "Sort: [{field:'email',direction:'asc'}]",
          },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          users: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["users"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "deactivate_enterprise_users",
      title: "Deactivate Enterprise Users",
      description:
        "Deactivate one or more users in an Enterprise account. Deactivated users cannot log in but their data is preserved. Optionally transfer their resource ownership to another user. Returns results per user.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of user IDs to deactivate",
          },
          replacement_owner_id: { type: "string", description: "Transfer ownership of resources to this user ID" },
        },
        required: ["account_id", "user_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deactivatedUserIds: { type: "array", items: { type: "string" } },
          errors: { type: "array", items: { type: "object" } },
        },
        required: ["deactivatedUserIds"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "reactivate_enterprise_users",
      title: "Reactivate Enterprise Users",
      description:
        "Reactivate previously deactivated users in an Enterprise account. Reactivated users can log in again and regain access to their resources. Returns results per user.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of user IDs to reactivate",
          },
        },
        required: ["account_id", "user_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          reactivatedUserIds: { type: "array", items: { type: "string" } },
          errors: { type: "array", items: { type: "object" } },
        },
        required: ["reactivatedUserIds"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "manage_enterprise_user_admin",
      title: "Manage Enterprise User Admin",
      description:
        "Grant or revoke enterprise admin privileges for a user. Enterprise admins can manage users, workspaces, and settings across the entire enterprise account.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') to modify" },
          is_admin: { type: "boolean", description: "true to grant admin, false to revoke admin" },
        },
        required: ["account_id", "user_id", "is_admin"],
      },
      outputSchema: {
        type: "object",
        properties: {
          userId: { type: "string" },
          isAdmin: { type: "boolean" },
        },
        required: ["userId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_enterprise_groups",
      title: "List Enterprise Groups",
      description:
        "List all user groups in an Enterprise account. Groups allow batch permission management across bases and workspaces. Returns group IDs, names, member counts, and creation times.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          offset: { type: "string", description: "Pagination offset" },
          page_size: { type: "number", description: "Results per page (1-100, default 100)" },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          groups: { type: "array", items: { type: "object" } },
          offset: { type: "string" },
        },
        required: ["groups"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_enterprise_group",
      title: "Get Enterprise Group",
      description:
        "Get detailed information about an enterprise user group including its members and collaborations (bases/workspaces the group has access to).",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          group_id: { type: "string", description: "Group ID (starts with 'grp')" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Additional data: ['collaborations', 'members']",
          },
        },
        required: ["account_id", "group_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          collaborations: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_enterprise_users",
      title: "Delete Enterprise Users",
      description:
        "Permanently delete users from an Enterprise account. This removes all their data and cannot be undone. Deactivate users first if you only need to revoke access. Use only when explicitly requested.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of user IDs to permanently delete",
          },
        },
        required: ["account_id", "user_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deletedUserIds: { type: "array", items: { type: "string" } },
          errors: { type: "array", items: { type: "object" } },
        },
        required: ["deletedUserIds"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "logout_enterprise_users",
      title: "Logout Enterprise Users",
      description:
        "Force logout one or more enterprise users from all active sessions. Users will need to sign in again. Use for security incidents or when offboarding users immediately.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of user IDs to force-logout",
          },
        },
        required: ["account_id", "user_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          loggedOutUserIds: { type: "array", items: { type: "string" } },
          errors: { type: "array", items: { type: "object" } },
        },
        required: ["loggedOutUserIds"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_enterprise_account: async (args) => {
      const { account_id, include } = GetEnterpriseAccountSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (include) {
        include.forEach((item) => queryParams.append("include[]", item));
      }
      const qs = queryParams.toString();

      const result = await logger.time("tool.get_enterprise_account", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}${qs ? `?${qs}` : ""}`)
      , { tool: "get_enterprise_account", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_enterprise_workspaces: async (args) => {
      const { account_id, offset, page_size } = ListEnterpriseWorkspacesSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_enterprise_workspaces", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/workspaces${qs ? `?${qs}` : ""}`)
      , { tool: "list_enterprise_workspaces", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_enterprise_bases: async (args) => {
      const { account_id, workspace_ids, offset, page_size } = ListEnterpriseBasesSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (workspace_ids) {
        workspace_ids.forEach((id) => queryParams.append("workspaceIds[]", id));
      }
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_enterprise_bases", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/bases${qs ? `?${qs}` : ""}`)
      , { tool: "list_enterprise_bases", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_enterprise_user: async (args) => {
      const { account_id, user_id, email, include } = GetEnterpriseUserSchema.parse(args);

      if (!user_id && !email) {
        throw new Error("get_enterprise_user: provide user_id or email");
      }

      const queryParams = new URLSearchParams();
      if (email) queryParams.set("email", email);
      if (include) {
        include.forEach((item) => queryParams.append("include[]", item));
      }
      const qs = queryParams.toString();

      let endpoint: string;
      if (user_id) {
        endpoint = `/v0/meta/enterpriseAccount/${account_id}/users/${user_id}${qs ? `?${qs}` : ""}`;
      } else {
        endpoint = `/v0/meta/enterpriseAccount/${account_id}/users${qs ? `?${qs}` : ""}`;
      }

      const result = await logger.time("tool.get_enterprise_user", () =>
        client.get(endpoint)
      , { tool: "get_enterprise_user", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_enterprise_users: async (args) => {
      const { account_id, filter, include, offset, page_size, sort } = ListEnterpriseUsersSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (filter && filter !== "all") queryParams.set("filter", filter);
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (include) {
        include.forEach((item) => queryParams.append("include[]", item));
      }
      if (sort) {
        sort.forEach((s, i) => {
          queryParams.set(`sort[${i}][field]`, s.field);
          if (s.direction) queryParams.set(`sort[${i}][direction]`, s.direction);
        });
      }
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_enterprise_users", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/users${qs ? `?${qs}` : ""}`)
      , { tool: "list_enterprise_users", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    deactivate_enterprise_users: async (args) => {
      const { account_id, user_ids, replacement_owner_id } = DeactivateEnterpriseUsersSchema.parse(args);
      const body: Record<string, unknown> = { users: user_ids.map((id) => ({ id })) };
      if (replacement_owner_id) body.replacementOwnerId = replacement_owner_id;

      const result = await logger.time("tool.deactivate_enterprise_users", () =>
        client.post(`/v0/meta/enterpriseAccount/${account_id}/users/deactivate`, body)
      , { tool: "deactivate_enterprise_users", account_id, count: user_ids.length });

      const response = { deactivatedUserIds: user_ids, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    reactivate_enterprise_users: async (args) => {
      const { account_id, user_ids } = ReactivateEnterpriseUsersSchema.parse(args);
      const body = { users: user_ids.map((id) => ({ id })) };

      const result = await logger.time("tool.reactivate_enterprise_users", () =>
        client.post(`/v0/meta/enterpriseAccount/${account_id}/users/reactivate`, body)
      , { tool: "reactivate_enterprise_users", account_id, count: user_ids.length });

      const response = { reactivatedUserIds: user_ids, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    manage_enterprise_user_admin: async (args) => {
      const { account_id, user_id, is_admin } = ManageEnterpriseUserAdminSchema.parse(args);
      const body = { isAdmin: is_admin };

      const result = await logger.time("tool.manage_enterprise_user_admin", () =>
        client.patch(`/v0/meta/enterpriseAccount/${account_id}/users/${user_id}`, body)
      , { tool: "manage_enterprise_user_admin", account_id, user_id });

      const response = { userId: user_id, isAdmin: is_admin, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_enterprise_groups: async (args) => {
      const { account_id, offset, page_size } = ListEnterpriseGroupsSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_enterprise_groups", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/groups${qs ? `?${qs}` : ""}`)
      , { tool: "list_enterprise_groups", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_enterprise_group: async (args) => {
      const { account_id, group_id, include } = GetEnterpriseGroupSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (include) {
        include.forEach((item) => queryParams.append("include[]", item));
      }
      const qs = queryParams.toString();

      const result = await logger.time("tool.get_enterprise_group", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/groups/${group_id}${qs ? `?${qs}` : ""}`)
      , { tool: "get_enterprise_group", account_id, group_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_enterprise_users: async (args) => {
      const { account_id, user_ids } = DeleteEnterpriseUsersSchema.parse(args);

      // Delete users one by one (API typically requires individual DELETE calls)
      const deletedUserIds: string[] = [];
      const errors: Array<{ userId: string; error: string }> = [];

      for (const user_id of user_ids) {
        try {
          await logger.time("tool.delete_enterprise_users.single", () =>
            client.delete(`/v0/meta/enterpriseAccount/${account_id}/users/${user_id}`)
          , { tool: "delete_enterprise_users", account_id, user_id });
          deletedUserIds.push(user_id);
        } catch (e) {
          errors.push({ userId: user_id, error: e instanceof Error ? e.message : String(e) });
        }
      }

      const response = { deletedUserIds, errors, deletedCount: deletedUserIds.length };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    logout_enterprise_users: async (args) => {
      const { account_id, user_ids } = LogoutEnterpriseUsersSchema.parse(args);
      const body = { users: user_ids.map((id) => ({ id })) };

      const result = await logger.time("tool.logout_enterprise_users", () =>
        client.post(`/v0/meta/enterpriseAccount/${account_id}/users/logout`, body)
      , { tool: "logout_enterprise_users", account_id, count: user_ids.length });

      const response = { loggedOutUserIds: user_ids, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
