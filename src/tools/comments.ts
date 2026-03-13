// Airtable Comment tools: list_record_comments, create_comment, update_comment, delete_comment
// Uses Airtable Comments API: https://api.airtable.com/v0/{baseId}/{tableId}/{recordId}/comments
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListRecordCommentsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  page_size: z.number().min(1).max(100).optional().describe("Number of comments per page (max 100)"),
  offset: z.string().optional().describe("Pagination offset token from previous response"),
});

const CreateCommentSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  text: z.string().min(1).describe("Comment text. Supports @mentions using collaborator name, e.g. '@Alice'"),
});

const UpdateCommentSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  comment_id: z.string().describe("Comment ID (starts with 'com') to update"),
  text: z.string().min(1).describe("New comment text"),
});

const DeleteCommentSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  comment_id: z.string().describe("Comment ID (starts with 'com') to delete"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_record_comments",
      title: "List Record Comments",
      description:
        "List all comments on an Airtable record. Returns comment IDs, author info, text content, and timestamps. Supports pagination via offset. Use to read discussion or audit trail on a record.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          page_size: { type: "number", description: "Comments per page (1-100)" },
          offset: { type: "string", description: "Pagination offset token" },
        },
        required: ["base_id", "table_id_or_name", "record_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          comments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                author: { type: "object" },
                createdTime: { type: "string" },
                lastUpdatedTime: { type: "string" },
              },
            },
          },
          offset: { type: "string" },
        },
        required: ["comments"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_comment",
      title: "Create Comment",
      description:
        "Add a comment to an Airtable record. The comment appears in the record's activity feed. Supports plain text. Returns the created comment with its ID, author, and timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          text: { type: "string", description: "Comment text content" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "text"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          author: { type: "object" },
          createdTime: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_comment",
      title: "Update Comment",
      description:
        "Edit an existing comment on an Airtable record. Only the author of the comment can edit it. Returns the updated comment. Use to correct or expand on a previous comment.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          comment_id: { type: "string", description: "Comment ID (starts with 'com')" },
          text: { type: "string", description: "New comment text" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "comment_id", "text"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          lastUpdatedTime: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_comment",
      title: "Delete Comment",
      description:
        "Permanently delete a comment from an Airtable record. Only the comment author or a base owner can delete comments. This action is irreversible.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          comment_id: { type: "string", description: "Comment ID (starts with 'com') to delete" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "comment_id"],
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
    list_record_comments: async (args) => {
      const { base_id, table_id_or_name, record_id, page_size, offset } = ListRecordCommentsSchema.parse(args);

      const queryParams = new URLSearchParams();
      if (page_size) queryParams.set("pageSize", String(page_size));
      if (offset) queryParams.set("offset", offset);

      const qs = queryParams.toString();
      const result = await logger.time("tool.list_record_comments", () =>
        client.get(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/comments${qs ? `?${qs}` : ""}`
        )
      , { tool: "list_record_comments", base_id, record_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_comment: async (args) => {
      const { base_id, table_id_or_name, record_id, text } = CreateCommentSchema.parse(args);

      const body = { text };

      const result = await logger.time("tool.create_comment", () =>
        client.post(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/comments`,
          body
        )
      , { tool: "create_comment", base_id, record_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_comment: async (args) => {
      const { base_id, table_id_or_name, record_id, comment_id, text } = UpdateCommentSchema.parse(args);

      const body = { text };

      const result = await logger.time("tool.update_comment", () =>
        client.patch(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/comments/${comment_id}`,
          body
        )
      , { tool: "update_comment", base_id, record_id, comment_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_comment: async (args) => {
      const { base_id, table_id_or_name, record_id, comment_id } = DeleteCommentSchema.parse(args);

      const result = await logger.time("tool.delete_comment", () =>
        client.delete(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/comments/${comment_id}`
        )
      , { tool: "delete_comment", base_id, record_id, comment_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
