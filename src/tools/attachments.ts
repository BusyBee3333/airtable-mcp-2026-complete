// Airtable Attachment tools: get_attachment_url, upload_attachment
// Attachments are stored in attachment fields — accessed via record fields
// Upload API: POST /v0/{baseId}/{tableId}/{recordId}/uploadAttachment/{fieldId}
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetAttachmentUrlSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  field_name_or_id: z.string().describe("Attachment field name or ID to retrieve URLs from"),
});

const UploadAttachmentSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  field_id: z.string().describe("Attachment field ID (starts with 'fld') — must use field ID, not name"),
  filename: z.string().describe("Filename including extension (e.g., 'report.pdf', 'photo.png')"),
  content_type: z.string().describe("MIME type of the file (e.g., 'image/png', 'application/pdf', 'text/plain')"),
  content_url: z.string().url().optional().describe("Public URL of the file to attach. Either provide content_url or content_base64."),
  content_base64: z.string().optional().describe("Base64-encoded file content. Either provide content_url or content_base64."),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_attachment_url",
      title: "Get Attachment URLs",
      description:
        "Get the download URLs and metadata for all attachments in a specific field of an Airtable record. Returns signed URLs (valid for 2 hours), filenames, MIME types, sizes, and dimensions for images. Use to access or display uploaded files.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          field_name_or_id: { type: "string", description: "Attachment field name or ID" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "field_name_or_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          attachments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                url: { type: "string" },
                filename: { type: "string" },
                size: { type: "number" },
                type: { type: "string" },
                width: { type: "number" },
                height: { type: "number" },
                thumbnails: { type: "object" },
              },
            },
          },
        },
        required: ["attachments"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "upload_attachment",
      title: "Upload Attachment",
      description:
        "Upload a file attachment to an Airtable record's attachment field. Provide either a public URL (content_url) or base64-encoded content (content_base64). The file is appended to existing attachments in the field. Returns the updated attachment list.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          field_id: { type: "string", description: "Attachment field ID (starts with 'fld')" },
          filename: { type: "string", description: "Filename with extension (e.g., 'report.pdf')" },
          content_type: { type: "string", description: "MIME type (e.g., 'image/png', 'application/pdf')" },
          content_url: { type: "string", description: "Public URL of the file to attach" },
          content_base64: { type: "string", description: "Base64-encoded file content (alternative to content_url)" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "field_id", "filename", "content_type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          createdTime: { type: "string" },
          fields: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_attachment_url: async (args) => {
      const { base_id, table_id_or_name, record_id, field_name_or_id } = GetAttachmentUrlSchema.parse(args);

      const result = await logger.time("tool.get_attachment_url", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`)
      , { tool: "get_attachment_url", base_id, record_id });

      const record = result as { id: string; fields: Record<string, unknown> };
      const fieldValue = record.fields[field_name_or_id];

      if (!fieldValue) {
        // Try to find by partial match across field names
        const allFields = record.fields;
        const matchedKey = Object.keys(allFields).find(
          (k) => k.toLowerCase() === field_name_or_id.toLowerCase()
        );
        const attachments = matchedKey ? allFields[matchedKey] : [];
        const response = { attachments: Array.isArray(attachments) ? attachments : [] };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
        };
      }

      const response = {
        attachments: Array.isArray(fieldValue) ? fieldValue : [],
        record_id: record.id,
        field: field_name_or_id,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    upload_attachment: async (args) => {
      const { base_id, table_id_or_name, record_id, field_id, filename, content_type, content_url, content_base64 } =
        UploadAttachmentSchema.parse(args);

      if (!content_url && !content_base64) {
        throw new Error("upload_attachment: either 'content_url' or 'content_base64' must be provided");
      }

      const body: Record<string, unknown> = {
        filename,
        contentType: content_type,
      };

      if (content_url) {
        body.url = content_url;
      } else if (content_base64) {
        body.contentBase64 = content_base64;
      }

      const result = await logger.time("tool.upload_attachment", () =>
        client.post(
          `/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}/uploadAttachment/${field_id}`,
          body
        )
      , { tool: "upload_attachment", base_id, record_id, field_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
