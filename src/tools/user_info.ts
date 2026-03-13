// Airtable User Info tools: get_current_user, check_token_scopes, list_user_bases
// Uses Airtable User Info API: https://api.airtable.com/v0/meta/whoami
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetCurrentUserSchema = z.object({});

const CheckTokenScopesSchema = z.object({
  required_scopes: z.array(z.string()).optional().describe(
    "List of scopes to check against. Example: ['data.records:read','schema.bases:write']. Returns which are granted and which are missing."
  ),
});

const ListUserBasesSchema = z.object({
  permission_level: z.enum(["owner", "create", "edit", "comment", "read", "any"]).optional().default("any")
    .describe("Filter bases by minimum permission level. 'any' returns all accessible bases (default)."),
  offset: z.string().optional().describe("Pagination offset from previous response"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_current_user",
      title: "Get Current User",
      description:
        "Get information about the currently authenticated Airtable user. Returns user ID, name, email, and granted token scopes. Use to verify authentication and understand what the current API token can access.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "User ID (starts with 'usr')" },
          name: { type: "string", description: "Full display name" },
          email: { type: "string", description: "Email address" },
          scopes: {
            type: "array",
            items: { type: "string" },
            description: "List of OAuth scopes granted to this token",
          },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "check_token_scopes",
      title: "Check Token Scopes",
      description:
        "Check which OAuth scopes are granted to the current access token. Optionally verify that specific required scopes are available. Returns a breakdown of all granted scopes, and (if required_scopes provided) which are present vs missing.",
      inputSchema: {
        type: "object",
        properties: {
          required_scopes: {
            type: "array",
            items: { type: "string" },
            description: "Scopes to verify. Example: ['data.records:read','schema.bases:write','webhook.manage:read']",
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          grantedScopes: { type: "array", items: { type: "string" } },
          requiredScopes: { type: "array", items: { type: "string" } },
          presentScopes: { type: "array", items: { type: "string" } },
          missingScopes: { type: "array", items: { type: "string" } },
          allPresent: { type: "boolean" },
        },
        required: ["grantedScopes"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_user_bases",
      title: "List User Bases",
      description:
        "List all Airtable bases accessible to the current user, with optional filtering by permission level. Returns base IDs, names, and permission levels. Supports pagination. This is equivalent to list_bases but includes permission-level filtering.",
      inputSchema: {
        type: "object",
        properties: {
          permission_level: {
            type: "string",
            description: "Filter by permission: owner, create, edit, comment, read, or 'any' for all (default: any)",
          },
          offset: { type: "string", description: "Pagination offset from previous response" },
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
          filteredByPermission: { type: "string" },
          totalCount: { type: "number" },
        },
        required: ["bases"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_current_user: async (args) => {
      GetCurrentUserSchema.parse(args);
      const result = await logger.time("tool.get_current_user", () =>
        client.get("/v0/meta/whoami")
      , { tool: "get_current_user" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    check_token_scopes: async (args) => {
      const { required_scopes } = CheckTokenScopesSchema.parse(args);

      const result = await logger.time("tool.check_token_scopes", () =>
        client.get("/v0/meta/whoami")
      , { tool: "check_token_scopes" });

      const raw = result as { scopes?: string[] };
      const grantedScopes = raw.scopes || [];

      let response: Record<string, unknown> = { grantedScopes };

      if (required_scopes && required_scopes.length > 0) {
        const presentScopes = required_scopes.filter((s) => grantedScopes.includes(s));
        const missingScopes = required_scopes.filter((s) => !grantedScopes.includes(s));

        response = {
          ...response,
          requiredScopes: required_scopes,
          presentScopes,
          missingScopes,
          allPresent: missingScopes.length === 0,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_user_bases: async (args) => {
      const { permission_level, offset } = ListUserBasesSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (offset) queryParams.set("offset", offset);

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_user_bases", () =>
        client.get(`/v0/meta/bases${qs ? `?${qs}` : ""}`)
      , { tool: "list_user_bases" });

      const raw = result as { bases?: Array<{ id: string; name: string; permissionLevel: string }>; offset?: string };

      let bases = raw.bases || [];

      // Filter by permission level if specified
      const permLevels = ["read", "comment", "edit", "create", "owner"];
      if (permission_level && permission_level !== "any") {
        const minIndex = permLevels.indexOf(permission_level);
        bases = bases.filter((b) => {
          const idx = permLevels.indexOf(b.permissionLevel);
          return idx >= minIndex;
        });
      }

      const response = {
        bases,
        totalCount: bases.length,
        filteredByPermission: permission_level || "any",
        ...(raw.offset ? { offset: raw.offset } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
