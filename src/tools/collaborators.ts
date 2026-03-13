// Airtable Collaborator tools: add_base_collaborator, update_base_collaborator,
//   remove_base_collaborator, list_interface_collaborators, add_interface_collaborator,
//   remove_interface_collaborator, add_base_invite, list_base_invites, delete_base_invite
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases/{baseId}/collaborators
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const AddBaseCollaboratorSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  email: z.string().email().optional().describe("Email address of the user to add as a collaborator"),
  user_id: z.string().optional().describe("User ID (starts with 'usr') of the collaborator to add. Use email OR user_id."),
  permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
    .describe("Permission level: owner (full control), create (add records), edit (modify records), comment (comment only), read (view only)"),
});

const UpdateBaseCollaboratorSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  user_id: z.string().describe("User ID (starts with 'usr') of the collaborator to update"),
  permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
    .describe("New permission level: owner, create, edit, comment, or read"),
});

const RemoveBaseCollaboratorSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  user_id: z.string().describe("User ID (starts with 'usr') of the collaborator to remove"),
});

const ListBaseInvitesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
});

const CreateBaseInviteSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  email: z.string().email().describe("Email address to invite"),
  permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
    .describe("Permission level for the invite: owner, create, edit, comment, or read"),
  message: z.string().optional().describe("Optional message to include with the invite email"),
});

const DeleteBaseInviteSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  invite_id: z.string().describe("Invite ID to delete/cancel"),
});

const ListInterfaceCollaboratorsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  interface_id: z.string().describe("Interface ID to list collaborators for"),
});

const AddInterfaceCollaboratorSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  interface_id: z.string().describe("Interface ID"),
  user_id: z.string().optional().describe("User ID (starts with 'usr') to add"),
  email: z.string().email().optional().describe("Email of user to add. Use email OR user_id."),
  permission_level: z.enum(["editor", "commenter", "viewer"])
    .describe("Interface permission: editor, commenter, or viewer"),
});

const RemoveInterfaceCollaboratorSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  interface_id: z.string().describe("Interface ID"),
  user_id: z.string().describe("User ID (starts with 'usr') to remove from the interface"),
});

const BulkAddBaseCollaboratorsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  collaborators: z.array(z.object({
    email: z.string().email().optional().describe("Email of user to add"),
    user_id: z.string().optional().describe("User ID of user to add"),
    permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
      .describe("Permission level for this collaborator"),
  })).min(1).max(100).describe("Array of collaborators to add (max 100). Each needs email or user_id plus permission_level."),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "add_base_collaborator",
      title: "Add Base Collaborator",
      description:
        "Add a user as a collaborator on an Airtable base with a specified permission level. Provide email OR user_id. Returns the updated collaborators list. The invited user gains immediate access at the specified permission level.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          email: { type: "string", description: "Email address of the user to add" },
          user_id: { type: "string", description: "User ID (starts with 'usr'). Use email OR user_id." },
          permission_level: { type: "string", description: "Permission: owner, create, edit, comment, or read" },
        },
        required: ["base_id", "permission_level"],
      },
      outputSchema: {
        type: "object",
        properties: {
          collaborators: { type: "array", items: { type: "object" } },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_base_collaborator",
      title: "Update Base Collaborator",
      description:
        "Change a collaborator's permission level on an Airtable base. Specify the user's ID and the new permission level. Use to promote (read → edit) or demote (owner → create) collaborators.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') of the collaborator to update" },
          permission_level: { type: "string", description: "New permission level: owner, create, edit, comment, or read" },
        },
        required: ["base_id", "user_id", "permission_level"],
      },
      outputSchema: {
        type: "object",
        properties: {
          userId: { type: "string" },
          permissionLevel: { type: "string" },
        },
        required: ["userId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "remove_base_collaborator",
      title: "Remove Base Collaborator",
      description:
        "Remove a collaborator's access to an Airtable base. The user will lose all access to the base and its records. They may still have workspace-level access if granted separately. Cannot remove the last owner.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') to remove" },
        },
        required: ["base_id", "user_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "boolean" },
          userId: { type: "string" },
        },
        required: ["deleted"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_base_invites",
      title: "List Base Invites",
      description:
        "List all pending invite links for an Airtable base. Returns invite IDs, invitation emails, permission levels, and expiry times. Use to audit outstanding invitations or manage pending access.",
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
          inviteLinks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                email: { type: "string" },
                permissionLevel: { type: "string" },
                createdTime: { type: "string" },
              },
            },
          },
        },
        required: ["inviteLinks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_base_invite",
      title: "Create Base Invite",
      description:
        "Send an email invitation to a user to collaborate on an Airtable base. The user receives an email with a link to accept. Returns the invite ID and details. Use for users who don't yet have an Airtable account.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          email: { type: "string", description: "Email address to invite" },
          permission_level: { type: "string", description: "Permission level: owner, create, edit, comment, or read" },
          message: { type: "string", description: "Optional message included in the invite email" },
        },
        required: ["base_id", "email", "permission_level"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
          permissionLevel: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_base_invite",
      title: "Delete Base Invite",
      description:
        "Cancel and delete a pending base invite. The invite link becomes invalid. Use to revoke invitations that haven't been accepted yet.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          invite_id: { type: "string", description: "Invite ID to cancel" },
        },
        required: ["base_id", "invite_id"],
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
      name: "list_interface_collaborators",
      title: "List Interface Collaborators",
      description:
        "List collaborators who have access to a specific Airtable interface (page) within a base. Returns user IDs, names, and permission levels for the interface.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          interface_id: { type: "string", description: "Interface ID to list collaborators for" },
        },
        required: ["base_id", "interface_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          collaborators: { type: "array", items: { type: "object" } },
        },
        required: ["collaborators"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_add_base_collaborators",
      title: "Bulk Add Base Collaborators",
      description:
        "Add multiple collaborators to an Airtable base in a single operation. Accepts up to 100 collaborators at once, each with an email or user_id and a permission level. More efficient than calling add_base_collaborator repeatedly.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          collaborators: {
            type: "array",
            items: {
              type: "object",
              properties: {
                email: { type: "string", description: "Email of user to add" },
                user_id: { type: "string", description: "User ID of user to add" },
                permission_level: { type: "string", description: "Permission level for this collaborator" },
              },
              required: ["permission_level"],
            },
            description: "Array of collaborators to add (max 100)",
          },
        },
        required: ["base_id", "collaborators"],
      },
      outputSchema: {
        type: "object",
        properties: {
          collaborators: { type: "array", items: { type: "object" } },
          addedCount: { type: "number" },
        },
        required: ["collaborators"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    add_base_collaborator: async (args) => {
      const { base_id, email, user_id, permission_level } = AddBaseCollaboratorSchema.parse(args);

      if (!email && !user_id) {
        throw new Error("add_base_collaborator: provide email or user_id");
      }

      const collaborator: Record<string, unknown> = { permissionLevel: permission_level };
      if (user_id) {
        collaborator.user = { id: user_id };
      } else if (email) {
        collaborator.user = { email };
      }

      const body = { collaborators: [collaborator] };

      const result = await logger.time("tool.add_base_collaborator", () =>
        client.post(`/v0/meta/bases/${base_id}/collaborators`, body)
      , { tool: "add_base_collaborator", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_base_collaborator: async (args) => {
      const { base_id, user_id, permission_level } = UpdateBaseCollaboratorSchema.parse(args);
      const body = { permissionLevel: permission_level };

      const result = await logger.time("tool.update_base_collaborator", () =>
        client.patch(`/v0/meta/bases/${base_id}/collaborators/${user_id}`, body)
      , { tool: "update_base_collaborator", base_id, user_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    remove_base_collaborator: async (args) => {
      const { base_id, user_id } = RemoveBaseCollaboratorSchema.parse(args);

      const result = await logger.time("tool.remove_base_collaborator", () =>
        client.delete(`/v0/meta/bases/${base_id}/collaborators/${user_id}`)
      , { tool: "remove_base_collaborator", base_id, user_id });

      const response = { deleted: true, userId: user_id, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_base_invites: async (args) => {
      const { base_id } = ListBaseInvitesSchema.parse(args);

      // Invites are returned via the collaborators endpoint with include=inviteLinks
      const result = await logger.time("tool.list_base_invites", () =>
        client.get(`/v0/meta/bases/${base_id}/collaborators?include[]=inviteLinks`)
      , { tool: "list_base_invites", base_id });

      const raw = result as { inviteLinks?: unknown[] };
      const response = { inviteLinks: raw.inviteLinks || [] };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    create_base_invite: async (args) => {
      const { base_id, email, permission_level, message } = CreateBaseInviteSchema.parse(args);

      const body: Record<string, unknown> = {
        inviteLinks: [
          {
            email,
            permissionLevel: permission_level,
            ...(message ? { message } : {}),
          },
        ],
      };

      const result = await logger.time("tool.create_base_invite", () =>
        client.post(`/v0/meta/bases/${base_id}/invites`, body)
      , { tool: "create_base_invite", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_base_invite: async (args) => {
      const { base_id, invite_id } = DeleteBaseInviteSchema.parse(args);

      const result = await logger.time("tool.delete_base_invite", () =>
        client.delete(`/v0/meta/bases/${base_id}/invites/${invite_id}`)
      , { tool: "delete_base_invite", base_id, invite_id });

      const response = { deleted: true, id: invite_id, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_interface_collaborators: async (args) => {
      const { base_id, interface_id } = ListInterfaceCollaboratorsSchema.parse(args);

      const result = await logger.time("tool.list_interface_collaborators", () =>
        client.get(`/v0/meta/bases/${base_id}/interfaces/${interface_id}/collaborators`)
      , { tool: "list_interface_collaborators", base_id, interface_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    bulk_add_base_collaborators: async (args) => {
      const { base_id, collaborators } = BulkAddBaseCollaboratorsSchema.parse(args);

      const collaboratorList = collaborators.map((c) => {
        const item: Record<string, unknown> = { permissionLevel: c.permission_level };
        if (c.user_id) {
          item.user = { id: c.user_id };
        } else if (c.email) {
          item.user = { email: c.email };
        }
        return item;
      });

      const body = { collaborators: collaboratorList };

      const result = await logger.time("tool.bulk_add_base_collaborators", () =>
        client.post(`/v0/meta/bases/${base_id}/collaborators`, body)
      , { tool: "bulk_add_base_collaborators", base_id, count: collaborators.length });

      const raw = result as { collaborators?: unknown[] };
      const response = {
        collaborators: raw.collaborators || [],
        addedCount: collaborators.length,
        ...((result as Record<string, unknown>) || {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
