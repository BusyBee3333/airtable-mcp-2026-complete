// Airtable Shares tools: list_base_shares, create_base_share, update_base_share,
//   delete_base_share, list_view_shares, create_view_share, delete_view_share,
//   get_share_metadata
// Uses Airtable Metadata API: https://api.airtable.com/v0/meta/bases/{baseId}/shares
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListBaseSharesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
});

const CreateBaseShareSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  type: z.enum(["form", "grid", "gallery", "kanban", "calendar", "view", "base"]).optional()
    .describe("Type of share link to create (default: base)"),
  is_password_protected: z.boolean().optional().describe("If true, the share link will require a password"),
  is_email_link: z.boolean().optional().describe("If true, restricts access to specific email addresses"),
  accepted_emails: z.array(z.string().email()).optional()
    .describe("List of email addresses that can access this share (used with is_email_link=true)"),
  effective_email_domain_allow_list: z.array(z.string()).optional()
    .describe("List of email domains allowed (e.g., ['company.com']). Anyone with that domain can access."),
});

const UpdateBaseShareSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  share_id: z.string().describe("Share ID to update"),
  is_enabled: z.boolean().optional().describe("Enable or disable the share link"),
  is_password_protected: z.boolean().optional().describe("Enable or disable password protection"),
  accepted_emails: z.array(z.string().email()).optional()
    .describe("Updated list of allowed email addresses"),
  effective_email_domain_allow_list: z.array(z.string()).optional()
    .describe("Updated list of allowed email domains"),
});

const DeleteBaseShareSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  share_id: z.string().describe("Share ID to delete/revoke"),
});

const GetShareMetadataSchema = z.object({
  share_id: z.string().describe("Share ID to get metadata for (does not require authentication)"),
});

const CreateViewShareSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  view_id: z.string().describe("View ID (starts with 'viw') to create a share link for"),
  is_password_protected: z.boolean().optional().describe("If true, the share link requires a password"),
});

const DeleteViewShareSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  share_id: z.string().describe("Share ID to delete/revoke"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_base_shares",
      title: "List Base Shares",
      description:
        "List all share links created for an Airtable base. Returns share IDs, URLs, types (view/base/form), and access settings including whether password protection or email restrictions are enabled. Use to audit sharing configurations.",
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
          shares: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                type: { type: "string" },
                shareUrl: { type: "string" },
                isEnabled: { type: "boolean" },
                isPasswordProtected: { type: "boolean" },
                createdTime: { type: "string" },
              },
            },
          },
        },
        required: ["shares"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_base_share",
      title: "Create Base Share",
      description:
        "Create a new share link for an Airtable base. Share links allow external access without an Airtable account. Supports optional password protection and email domain allow-lists. Returns the share URL and share ID.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          type: { type: "string", description: "Share type: form, grid, gallery, kanban, calendar, view, or base (default: base)" },
          is_password_protected: { type: "boolean", description: "Require password to access the share" },
          is_email_link: { type: "boolean", description: "Restrict access to specific email addresses" },
          accepted_emails: {
            type: "array",
            items: { type: "string" },
            description: "Allowed email addresses (requires is_email_link=true)",
          },
          effective_email_domain_allow_list: {
            type: "array",
            items: { type: "string" },
            description: "Allowed email domains (e.g., ['company.com'])",
          },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          shareUrl: { type: "string" },
          type: { type: "string" },
          isEnabled: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_base_share",
      title: "Update Base Share",
      description:
        "Update an existing base share link's settings. Can enable/disable the share, toggle password protection, or update email access restrictions. Use to temporarily disable a share or update allowed emails.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          share_id: { type: "string", description: "Share ID to update" },
          is_enabled: { type: "boolean", description: "Enable (true) or disable (false) the share link" },
          is_password_protected: { type: "boolean", description: "Enable or disable password protection" },
          accepted_emails: {
            type: "array",
            items: { type: "string" },
            description: "Updated list of allowed email addresses",
          },
          effective_email_domain_allow_list: {
            type: "array",
            items: { type: "string" },
            description: "Updated list of allowed email domains",
          },
        },
        required: ["base_id", "share_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          isEnabled: { type: "boolean" },
          isPasswordProtected: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_base_share",
      title: "Delete Base Share",
      description:
        "Permanently delete a share link for an Airtable base. The share URL becomes invalid immediately. Use to revoke external access to a base. Cannot be undone — a new share link would need to be created.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          share_id: { type: "string", description: "Share ID to delete/revoke" },
        },
        required: ["base_id", "share_id"],
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
      name: "get_share_metadata",
      title: "Get Share Metadata",
      description:
        "Get metadata for a share link using its share ID. Returns the base/table/view being shared, share type, and access settings. This endpoint is public and does not require authentication.",
      inputSchema: {
        type: "object",
        properties: {
          share_id: { type: "string", description: "Share ID (from share URL) to get metadata for" },
        },
        required: ["share_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          isPasswordProtected: { type: "boolean" },
          sharedTable: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "create_view_share",
      title: "Create View Share",
      description:
        "Create a share link for a specific view in an Airtable table. The shared view shows only the records visible in that view with any filters/sorts/hidden fields applied. Returns the share URL.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          view_id: { type: "string", description: "View ID (starts with 'viw') to share" },
          is_password_protected: { type: "boolean", description: "Require password to access the view share" },
        },
        required: ["base_id", "table_id", "view_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          shareUrl: { type: "string" },
          isEnabled: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_view_share",
      title: "Delete View Share",
      description:
        "Delete a share link for a view. The shared view URL becomes invalid. Use to revoke public access to a specific view.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          share_id: { type: "string", description: "Share ID to delete" },
        },
        required: ["base_id", "share_id"],
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
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_base_shares: async (args) => {
      const { base_id } = ListBaseSharesSchema.parse(args);

      const result = await logger.time("tool.list_base_shares", () =>
        client.get(`/v0/meta/bases/${base_id}/shares`)
      , { tool: "list_base_shares", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_base_share: async (args) => {
      const {
        base_id,
        type,
        is_password_protected,
        is_email_link,
        accepted_emails,
        effective_email_domain_allow_list,
      } = CreateBaseShareSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (type) body.type = type;
      if (is_password_protected !== undefined) body.isPasswordProtected = is_password_protected;
      if (is_email_link !== undefined) body.isEmailLink = is_email_link;
      if (accepted_emails) body.acceptedEmails = accepted_emails;
      if (effective_email_domain_allow_list) {
        body.effectiveEmailDomainAllowList = effective_email_domain_allow_list;
      }

      const result = await logger.time("tool.create_base_share", () =>
        client.post(`/v0/meta/bases/${base_id}/shares`, body)
      , { tool: "create_base_share", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_base_share: async (args) => {
      const {
        base_id,
        share_id,
        is_enabled,
        is_password_protected,
        accepted_emails,
        effective_email_domain_allow_list,
      } = UpdateBaseShareSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (is_enabled !== undefined) body.isEnabled = is_enabled;
      if (is_password_protected !== undefined) body.isPasswordProtected = is_password_protected;
      if (accepted_emails) body.acceptedEmails = accepted_emails;
      if (effective_email_domain_allow_list) {
        body.effectiveEmailDomainAllowList = effective_email_domain_allow_list;
      }

      if (Object.keys(body).length === 0) {
        throw new Error("update_base_share: at least one field to update must be provided");
      }

      const result = await logger.time("tool.update_base_share", () =>
        client.patch(`/v0/meta/bases/${base_id}/shares/${share_id}`, body)
      , { tool: "update_base_share", base_id, share_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_base_share: async (args) => {
      const { base_id, share_id } = DeleteBaseShareSchema.parse(args);

      const result = await logger.time("tool.delete_base_share", () =>
        client.delete(`/v0/meta/bases/${base_id}/shares/${share_id}`)
      , { tool: "delete_base_share", base_id, share_id });

      const response = { deleted: true, id: share_id, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_share_metadata: async (args) => {
      const { share_id } = GetShareMetadataSchema.parse(args);

      const result = await logger.time("tool.get_share_metadata", () =>
        client.get(`/v0/meta/shares/${share_id}`)
      , { tool: "get_share_metadata", share_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_view_share: async (args) => {
      const { base_id, table_id, view_id, is_password_protected } = CreateViewShareSchema.parse(args);

      const body: Record<string, unknown> = {
        type: "view",
        viewId: view_id,
        tableId: table_id,
      };
      if (is_password_protected !== undefined) body.isPasswordProtected = is_password_protected;

      const result = await logger.time("tool.create_view_share", () =>
        client.post(`/v0/meta/bases/${base_id}/shares`, body)
      , { tool: "create_view_share", base_id, view_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_view_share: async (args) => {
      const { base_id, share_id } = DeleteViewShareSchema.parse(args);

      const result = await logger.time("tool.delete_view_share", () =>
        client.delete(`/v0/meta/bases/${base_id}/shares/${share_id}`)
      , { tool: "delete_view_share", base_id, share_id });

      const response = { deleted: true, id: share_id, ...((result as Record<string, unknown>) || {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
