// Airtable Audit Log tools: list_audit_log_events, get_audit_log_event_types
// Uses Airtable Enterprise Audit Log API:
//   https://api.airtable.com/v0/meta/enterpriseAccount/{accountId}/auditLog/events
// Note: Requires Enterprise plan and enterprise:manage scope
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListAuditLogEventsSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_id: z.string().optional().describe("Filter events by a specific user ID (starts with 'usr')"),
  event_type: z.string().optional().describe(
    "Filter by event type. Examples: createBase, deleteBase, inviteCollaborator, removeCollaborator, createField, deleteRecord, etc."
  ),
  model_id: z.string().optional().describe(
    "Filter by a resource ID (base, workspace, table, field, etc.) to see events related to a specific resource"
  ),
  start_time: z.string().optional().describe("ISO 8601 start time for the audit window (e.g., '2024-01-01T00:00:00.000Z')"),
  end_time: z.string().optional().describe("ISO 8601 end time for the audit window (e.g., '2024-12-31T23:59:59.999Z')"),
  offset: z.string().optional().describe("Pagination cursor from previous response"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Events per page (1-100, default 100)"),
  sort_direction: z.enum(["asc", "desc"]).optional().default("desc")
    .describe("Sort by event time: desc (newest first, default) or asc (oldest first)"),
});

const GetAuditLogEventTypesSchema = z.object({});

const GetAuditLogEventSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  event_id: z.string().describe("Audit log event ID to retrieve"),
});

const ListUserAuditLogSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  user_id: z.string().describe("User ID (starts with 'usr') to get audit history for"),
  start_time: z.string().optional().describe("ISO 8601 start time filter"),
  end_time: z.string().optional().describe("ISO 8601 end time filter"),
  offset: z.string().optional().describe("Pagination cursor"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Events per page (1-100)"),
});

const ListBaseAuditLogSchema = z.object({
  account_id: z.string().describe("Enterprise account ID (starts with 'ent')"),
  base_id: z.string().describe("Base ID (starts with 'app') to get audit history for"),
  start_time: z.string().optional().describe("ISO 8601 start time filter"),
  end_time: z.string().optional().describe("ISO 8601 end time filter"),
  offset: z.string().optional().describe("Pagination cursor"),
  page_size: z.number().min(1).max(100).optional().default(100).describe("Events per page (1-100)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_audit_log_events",
      title: "List Audit Log Events",
      description:
        "Retrieve enterprise audit log events showing all actions taken by users in the enterprise account. Filter by user, event type, resource, or time range. Events include record creation/deletion, field changes, sharing changes, user management, and more. Requires Enterprise plan.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_id: { type: "string", description: "Filter by specific user ID" },
          event_type: { type: "string", description: "Filter by event type (e.g., createBase, deleteRecord, inviteCollaborator)" },
          model_id: { type: "string", description: "Filter by resource ID (base, table, workspace, etc.)" },
          start_time: { type: "string", description: "ISO 8601 start time (e.g., '2024-01-01T00:00:00.000Z')" },
          end_time: { type: "string", description: "ISO 8601 end time (e.g., '2024-12-31T23:59:59.999Z')" },
          offset: { type: "string", description: "Pagination cursor from previous response" },
          page_size: { type: "number", description: "Events per page (1-100, default 100)" },
          sort_direction: { type: "string", description: "Sort by time: desc (newest first, default) or asc (oldest first)" },
        },
        required: ["account_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                timestamp: { type: "string" },
                eventType: { type: "string" },
                actor: { type: "object" },
                modelType: { type: "string" },
                modelId: { type: "string" },
                details: { type: "object" },
              },
            },
          },
          pagination: { type: "object" },
        },
        required: ["events"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_audit_log_event_types",
      title: "Get Audit Log Event Types",
      description:
        "Get the complete list of audit log event types available in Airtable's enterprise audit log. Returns event type names and descriptions, grouped by category (records, schema, sharing, users, automations, etc.).",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          eventTypes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                category: { type: "string" },
              },
            },
          },
          categories: { type: "array", items: { type: "string" } },
          total: { type: "number" },
        },
        required: ["eventTypes"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_audit_log_event",
      title: "Get Audit Log Event",
      description:
        "Retrieve the full details of a specific audit log event by its event ID. Returns complete actor information, resource details, changed fields, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          event_id: { type: "string", description: "Audit log event ID to retrieve" },
        },
        required: ["account_id", "event_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          timestamp: { type: "string" },
          eventType: { type: "string" },
          actor: { type: "object" },
          modelType: { type: "string" },
          modelId: { type: "string" },
          details: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_user_audit_log",
      title: "List User Audit Log",
      description:
        "Retrieve all audit log events for a specific user in an enterprise account. Shows every action the user has taken within the specified time range. Useful for user activity reports and compliance reviews.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          user_id: { type: "string", description: "User ID (starts with 'usr') whose activity to view" },
          start_time: { type: "string", description: "ISO 8601 start time filter" },
          end_time: { type: "string", description: "ISO 8601 end time filter" },
          offset: { type: "string", description: "Pagination cursor" },
          page_size: { type: "number", description: "Events per page (1-100)" },
        },
        required: ["account_id", "user_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          events: { type: "array", items: { type: "object" } },
          userId: { type: "string" },
          pagination: { type: "object" },
        },
        required: ["events"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_base_audit_log",
      title: "List Base Audit Log",
      description:
        "Retrieve all audit log events for a specific base. Shows every action taken on the base including record changes, schema modifications, sharing changes, and user access changes. Use for base-level compliance auditing.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Enterprise account ID (starts with 'ent')" },
          base_id: { type: "string", description: "Base ID (starts with 'app') to audit" },
          start_time: { type: "string", description: "ISO 8601 start time filter" },
          end_time: { type: "string", description: "ISO 8601 end time filter" },
          offset: { type: "string", description: "Pagination cursor" },
          page_size: { type: "number", description: "Events per page (1-100)" },
        },
        required: ["account_id", "base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          events: { type: "array", items: { type: "object" } },
          baseId: { type: "string" },
          pagination: { type: "object" },
        },
        required: ["events"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_audit_log_events: async (args) => {
      const {
        account_id,
        user_id,
        event_type,
        model_id,
        start_time,
        end_time,
        offset,
        page_size,
        sort_direction,
      } = ListAuditLogEventsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (user_id) queryParams.set("userId", user_id);
      if (event_type) queryParams.set("eventType", event_type);
      if (model_id) queryParams.set("modelId", model_id);
      if (start_time) queryParams.set("startTime", start_time);
      if (end_time) queryParams.set("endTime", end_time);
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (sort_direction) queryParams.set("sortDirection", sort_direction);
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_audit_log_events", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/auditLog/events${qs ? `?${qs}` : ""}`)
      , { tool: "list_audit_log_events", account_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_audit_log_event_types: async (args) => {
      GetAuditLogEventTypesSchema.parse(args);

      // Return comprehensive list of known Airtable audit event types
      const eventTypes = [
        // Record events
        { type: "createRecord", description: "A record was created", category: "records" },
        { type: "deleteRecord", description: "A record was deleted", category: "records" },
        { type: "updateRecord", description: "A record was updated", category: "records" },
        { type: "copyRecord", description: "A record was copied", category: "records" },
        // Schema events
        { type: "createBase", description: "A base was created", category: "schema" },
        { type: "deleteBase", description: "A base was deleted", category: "schema" },
        { type: "duplicateBase", description: "A base was duplicated", category: "schema" },
        { type: "renameBase", description: "A base was renamed", category: "schema" },
        { type: "createTable", description: "A table was created", category: "schema" },
        { type: "deleteTable", description: "A table was deleted", category: "schema" },
        { type: "renameTable", description: "A table was renamed", category: "schema" },
        { type: "createField", description: "A field was created", category: "schema" },
        { type: "deleteField", description: "A field was deleted", category: "schema" },
        { type: "updateField", description: "A field was updated", category: "schema" },
        { type: "createView", description: "A view was created", category: "schema" },
        { type: "deleteView", description: "A view was deleted", category: "schema" },
        // Sharing events
        { type: "inviteCollaborator", description: "A collaborator was invited", category: "sharing" },
        { type: "removeCollaborator", description: "A collaborator was removed", category: "sharing" },
        { type: "updateCollaboratorPermission", description: "A collaborator's permission was updated", category: "sharing" },
        { type: "createSharedLink", description: "A shared link was created", category: "sharing" },
        { type: "deleteSharedLink", description: "A shared link was deleted", category: "sharing" },
        { type: "enableSharedLink", description: "A shared link was enabled", category: "sharing" },
        { type: "disableSharedLink", description: "A shared link was disabled", category: "sharing" },
        // User events
        { type: "login", description: "User logged in", category: "users" },
        { type: "logout", description: "User logged out", category: "users" },
        { type: "createUser", description: "User account was created", category: "users" },
        { type: "deactivateUser", description: "User was deactivated", category: "users" },
        { type: "reactivateUser", description: "User was reactivated", category: "users" },
        { type: "updateUserRole", description: "User's enterprise role was updated", category: "users" },
        // Automation events
        { type: "createAutomation", description: "An automation was created", category: "automations" },
        { type: "deleteAutomation", description: "An automation was deleted", category: "automations" },
        { type: "updateAutomation", description: "An automation was updated", category: "automations" },
        { type: "runAutomation", description: "An automation was manually triggered", category: "automations" },
        // API events
        { type: "createPersonalAccessToken", description: "A personal access token was created", category: "api" },
        { type: "deletePersonalAccessToken", description: "A personal access token was deleted", category: "api" },
        { type: "createWebhook", description: "A webhook was created", category: "api" },
        { type: "deleteWebhook", description: "A webhook was deleted", category: "api" },
      ];

      const categories = [...new Set(eventTypes.map((e) => e.category))];
      const response = { eventTypes, categories, total: eventTypes.length };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_audit_log_event: async (args) => {
      const { account_id, event_id } = GetAuditLogEventSchema.parse(args);

      const result = await logger.time("tool.get_audit_log_event", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/auditLog/events/${event_id}`)
      , { tool: "get_audit_log_event", account_id, event_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_user_audit_log: async (args) => {
      const { account_id, user_id, start_time, end_time, offset, page_size } = ListUserAuditLogSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("userId", user_id);
      if (start_time) queryParams.set("startTime", start_time);
      if (end_time) queryParams.set("endTime", end_time);
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_user_audit_log", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/auditLog/events?${qs}`)
      , { tool: "list_user_audit_log", account_id, user_id });

      const raw = result as { events?: unknown[]; pagination?: unknown };
      const response = {
        events: raw.events || [],
        userId: user_id,
        pagination: raw.pagination || {},
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    list_base_audit_log: async (args) => {
      const { account_id, base_id, start_time, end_time, offset, page_size } = ListBaseAuditLogSchema.parse(args);

      const queryParams = new URLSearchParams();
      queryParams.set("modelId", base_id);
      if (start_time) queryParams.set("startTime", start_time);
      if (end_time) queryParams.set("endTime", end_time);
      if (offset) queryParams.set("offset", offset);
      if (page_size) queryParams.set("pageSize", String(page_size));
      const qs = queryParams.toString();

      const result = await logger.time("tool.list_base_audit_log", () =>
        client.get(`/v0/meta/enterpriseAccount/${account_id}/auditLog/events?${qs}`)
      , { tool: "list_base_audit_log", account_id, base_id });

      const raw = result as { events?: unknown[]; pagination?: unknown };
      const response = {
        events: raw.events || [],
        baseId: base_id,
        pagination: raw.pagination || {},
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
