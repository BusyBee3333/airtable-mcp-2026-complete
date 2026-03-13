// Airtable Workspace tools: list_workspaces, get_workspace, create_workspace,
//   update_workspace, delete_workspace, list_workspace_collaborators,
//   add_workspace_collaborator, update_workspace_collaborator,
//   remove_workspace_collaborator, create_base_in_workspace
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/workspaces
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListWorkspacesSchema = z.object({});

const GetWorkspaceSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
});

const CreateWorkspaceSchema = z.object({
  name: z.string().describe("Name for the new workspace"),
});

const UpdateWorkspaceSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
  name: z.string().optional().describe("New workspace name"),
  restrict_invite_creation_to_workspace_admins: z.boolean().optional()
    .describe("If true, only workspace admins can invite new collaborators"),
  base_creation_restriction: z.enum(["unrestricted", "adminOnly"]).optional()
    .describe("Restrict base creation to admins only or leave unrestricted"),
});

const DeleteWorkspaceSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp') to permanently delete"),
});

const ListWorkspaceCollaboratorsSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
  include: z.array(z.enum(["collaborators", "inviteLinks", "groups"])).optional()
    .describe("Additional data to include: collaborators, inviteLinks, groups"),
});

const AddWorkspaceCollaboratorSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
  email: z.string().email().describe("Email address of the user to add as a collaborator"),
  permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
    .describe("Permission level: owner, create, edit, comment, or read"),
});

const UpdateWorkspaceCollaboratorSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
  user_id: z.string().describe("User ID (starts with 'usr') of the collaborator to update"),
  permission_level: z.enum(["owner", "create", "edit", "comment", "read"])
    .describe("New permission level: owner, create, edit, comment, or read"),
});

const RemoveWorkspaceCollaboratorSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp')"),
  user_id: z.string().describe("User ID (starts with 'usr') of the collaborator to remove"),
});

const CreateBaseInWorkspaceSchema = z.object({
  workspace_id: z.string().describe("Workspace ID (starts with 'wsp') where the base will be created"),
  name: z.string().describe("Name for the new base"),
  tables: z.array(z.object({
    name: z.string().describe("Table name"),
    description: z.string().optional().describe("Table description"),
    fields: z.array(z.object({
      name: z.string().describe("Field name"),
      type: z.string().describe("Field type (e.g., singleLineText, number, email, url, singleSelect, etc.)"),
      description: z.string().optional(),
      options: z.record(z.unknown()).optional().describe("Type-specific options"),
    })).optional().describe("Fields to create (primary field is created automatically)"),
  })).optional().describe("Tables to create in the base. If omitted, a default 'Table 1' is created."),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_workspaces",
      title: "List Workspaces",
      description:
        "List all Airtable workspaces accessible with the current token. Returns workspace IDs and names. Use to find workspace IDs for creating bases or managing workspace collaborators.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          workspaces: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
        required: ["workspaces"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_workspace",
      title: "Get Workspace",
      description:
        "Get metadata for a specific Airtable workspace including its name, collaborators, and settings. Returns workspace ID, name, permission levels, and billing plan information.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
        },
        required: ["workspace_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          permissionLevel: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_workspace",
      title: "Create Workspace",
      description:
        "Create a new Airtable workspace. Returns the created workspace's ID and name. Workspaces are top-level containers for bases.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the new workspace" },
        },
        required: ["name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_workspace",
      title: "Update Workspace",
      description:
        "Update an Airtable workspace's name or access restriction settings. Can rename a workspace or change who can invite new collaborators and create bases.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
          name: { type: "string", description: "New workspace name" },
          restrict_invite_creation_to_workspace_admins: { type: "boolean", description: "If true, only admins can invite collaborators" },
          base_creation_restriction: { type: "string", description: "'unrestricted' or 'adminOnly'" },
        },
        required: ["workspace_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_workspace",
      title: "Delete Workspace",
      description:
        "Permanently delete an Airtable workspace and all its bases. This action is irreversible and removes all bases, tables, records, and data in the workspace. Requires owner permission.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp') to permanently delete" },
        },
        required: ["workspace_id"],
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
      name: "list_workspace_collaborators",
      title: "List Workspace Collaborators",
      description:
        "List all collaborators with access to a workspace, including their user IDs, names, emails, and permission levels. Optionally include invite links and group memberships.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
          include: {
            type: "array",
            items: { type: "string" },
            description: "Additional data: ['collaborators', 'inviteLinks', 'groups']",
          },
        },
        required: ["workspace_id"],
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
    {
      name: "add_workspace_collaborator",
      title: "Add Workspace Collaborator",
      description:
        "Invite a user to a workspace by email with a specified permission level. Returns the updated collaborator list. The invited user will receive an email notification.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
          email: { type: "string", description: "Email of the user to invite" },
          permission_level: { type: "string", description: "Permission: owner, create, edit, comment, or read" },
        },
        required: ["workspace_id", "email", "permission_level"],
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
      name: "update_workspace_collaborator",
      title: "Update Workspace Collaborator",
      description:
        "Change a collaborator's permission level on a workspace. Use to promote/demote users (e.g., owner → edit, or read → create). Returns the updated collaborator object.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') of the collaborator" },
          permission_level: { type: "string", description: "New permission level: owner, create, edit, comment, or read" },
        },
        required: ["workspace_id", "user_id", "permission_level"],
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
      name: "remove_workspace_collaborator",
      title: "Remove Workspace Collaborator",
      description:
        "Remove a collaborator's access to a workspace. The user will lose access to all bases in the workspace (unless granted individual base access). Cannot remove the last owner.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') to remove" },
        },
        required: ["workspace_id", "user_id"],
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
      name: "create_base_in_workspace",
      title: "Create Base in Workspace",
      description:
        "Create a new Airtable base in a specific workspace, optionally with initial tables and fields. Returns the new base's ID and schema. Use to programmatically set up a new base with custom structure.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID (starts with 'wsp') where the base will be created" },
          name: { type: "string", description: "Name for the new base" },
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string" },
                      description: { type: "string" },
                      options: { type: "object" },
                    },
                    required: ["name", "type"],
                  },
                },
              },
              required: ["name"],
            },
            description: "Tables to create. If omitted, a default 'Table 1' is created.",
          },
        },
        required: ["workspace_id", "name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          tables: { type: "array", items: { type: "object" } },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_workspaces: async (args) => {
      ListWorkspacesSchema.parse(args);
      const result = await logger.time("tool.list_workspaces", () =>
        client.get("/v0/meta/workspaces")
      , { tool: "list_workspaces" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_workspace: async (args) => {
      const { workspace_id } = GetWorkspaceSchema.parse(args);
      const result = await logger.time("tool.get_workspace", () =>
        client.get(`/v0/meta/workspaces/${workspace_id}`)
      , { tool: "get_workspace", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_workspace: async (args) => {
      const { name } = CreateWorkspaceSchema.parse(args);
      const result = await logger.time("tool.create_workspace", () =>
        client.post("/v0/meta/workspaces", { name })
      , { tool: "create_workspace" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_workspace: async (args) => {
      const {
        workspace_id,
        name,
        restrict_invite_creation_to_workspace_admins,
        base_creation_restriction,
      } = UpdateWorkspaceSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (restrict_invite_creation_to_workspace_admins !== undefined) {
        body.restrictInviteCreationToWorkspaceAdmins = restrict_invite_creation_to_workspace_admins;
      }
      if (base_creation_restriction !== undefined) {
        body.baseCreationRestriction = base_creation_restriction;
      }

      if (Object.keys(body).length === 0) {
        throw new Error("update_workspace: at least one field to update must be provided");
      }

      const result = await logger.time("tool.update_workspace", () =>
        client.patch(`/v0/meta/workspaces/${workspace_id}`, body)
      , { tool: "update_workspace", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_workspace: async (args) => {
      const { workspace_id } = DeleteWorkspaceSchema.parse(args);
      const result = await logger.time("tool.delete_workspace", () =>
        client.delete(`/v0/meta/workspaces/${workspace_id}`)
      , { tool: "delete_workspace", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_workspace_collaborators: async (args) => {
      const { workspace_id, include } = ListWorkspaceCollaboratorsSchema.parse(args);
      const queryParams = new URLSearchParams();
      if (include) {
        include.forEach((item) => queryParams.append("include[]", item));
      }
      const qs = queryParams.toString();
      const result = await logger.time("tool.list_workspace_collaborators", () =>
        client.get(`/v0/meta/workspaces/${workspace_id}/collaborators${qs ? `?${qs}` : ""}`)
      , { tool: "list_workspace_collaborators", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    add_workspace_collaborator: async (args) => {
      const { workspace_id, email, permission_level } = AddWorkspaceCollaboratorSchema.parse(args);
      const body = {
        collaborators: [{ user: { email }, permissionLevel: permission_level }],
      };

      const result = await logger.time("tool.add_workspace_collaborator", () =>
        client.post(`/v0/meta/workspaces/${workspace_id}/collaborators`, body)
      , { tool: "add_workspace_collaborator", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_workspace_collaborator: async (args) => {
      const { workspace_id, user_id, permission_level } = UpdateWorkspaceCollaboratorSchema.parse(args);
      const body = { permissionLevel: permission_level };

      const result = await logger.time("tool.update_workspace_collaborator", () =>
        client.patch(`/v0/meta/workspaces/${workspace_id}/collaborators/${user_id}`, body)
      , { tool: "update_workspace_collaborator", workspace_id, user_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    remove_workspace_collaborator: async (args) => {
      const { workspace_id, user_id } = RemoveWorkspaceCollaboratorSchema.parse(args);
      const result = await logger.time("tool.remove_workspace_collaborator", () =>
        client.delete(`/v0/meta/workspaces/${workspace_id}/collaborators/${user_id}`)
      , { tool: "remove_workspace_collaborator", workspace_id, user_id });

      const response = { deleted: true, userId: user_id, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    create_base_in_workspace: async (args) => {
      const { workspace_id, name, tables } = CreateBaseInWorkspaceSchema.parse(args);
      const body: Record<string, unknown> = { workspaceId: workspace_id, name };
      if (tables) {
        body.tables = tables.map((t) => ({
          name: t.name,
          ...(t.description ? { description: t.description } : {}),
          ...(t.fields ? { fields: t.fields } : {}),
        }));
      }

      const result = await logger.time("tool.create_base_in_workspace", () =>
        client.post("/v0/meta/bases", body)
      , { tool: "create_base_in_workspace", workspace_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
