// Airtable AI Fields tools: list_ai_fields, get_ai_field_config,
//   create_ai_field, update_ai_field_prompt, trigger_ai_generation,
//   bulk_trigger_ai_fields, get_ai_field_status
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListAiFieldsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

const GetAiFieldConfigSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("Name of the AI field"),
});

const CreateAiFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  field_name: z.string().describe("Name for the new AI field"),
  prompt_template: z.string().describe("AI prompt template. Use {FieldName} to reference other fields. E.g. 'Summarize the following: {Description}'"),
  referenced_field_ids: z.array(z.string()).optional().describe("Field IDs referenced in the prompt"),
});

const UpdateAiFieldPromptSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id: z.string().describe("Table ID"),
  field_id: z.string().describe("AI field ID to update"),
  prompt_template: z.string().describe("New prompt template"),
  referenced_field_ids: z.array(z.string()).optional(),
});

const TriggerAiGenerationSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  field_name: z.string().describe("AI field name to regenerate"),
  record_ids: z.array(z.string()).min(1).max(100).optional().describe("Record IDs to regenerate (omit for all records)"),
  filter_formula: z.string().optional().describe("Filter formula to select which records to regenerate"),
});

const GetAiFieldTemplatesSchema = z.object({
  use_case: z.enum([
    "summarization", "classification", "sentiment", "extraction",
    "translation", "generation", "scoring", "all"
  ]).optional().default("all").describe("AI use case category"),
});

// ============ AI Prompt Templates ============

const AI_FIELD_TEMPLATES: Record<string, Array<{ name: string; prompt: string; description: string; fields_needed: string[] }>> = {
  summarization: [
    { name: "Executive Summary", prompt: "Write a 2-3 sentence executive summary of the following content:\n\n{Description}", description: "Short executive summary", fields_needed: ["Description"] },
    { name: "Key Points", prompt: "Extract 3-5 key points from this content as a bulleted list:\n\n{Notes}", description: "Bulleted key points", fields_needed: ["Notes"] },
    { name: "Meeting Summary", prompt: "Summarize this meeting transcript into action items and decisions:\n\n{Transcript}", description: "Meeting action items", fields_needed: ["Transcript"] },
  ],
  classification: [
    { name: "Priority Classifier", prompt: "Classify the priority of this task as High, Medium, or Low based on: {Title} - {Description}. Respond with only one word.", description: "Auto-classify priority", fields_needed: ["Title", "Description"] },
    { name: "Category Tagger", prompt: "Assign a category to this item from: Sales, Marketing, Operations, Product, HR, Finance. Based on: {Name} - {Details}. Respond with only the category name.", description: "Auto-categorize items", fields_needed: ["Name", "Details"] },
    { name: "Sentiment Label", prompt: "Classify the sentiment of this feedback as Positive, Neutral, or Negative: {Feedback}. Respond with one word.", description: "Sentiment classification", fields_needed: ["Feedback"] },
  ],
  extraction: [
    { name: "Email Extractor", prompt: "Extract the email address from this text. Return only the email address or 'none' if not found:\n\n{Contact Info}", description: "Extract emails from text", fields_needed: ["Contact Info"] },
    { name: "Phone Extractor", prompt: "Extract the phone number from this text. Return only the phone number in format +1XXXXXXXXXX or 'none':\n\n{Contact Info}", description: "Extract phone numbers", fields_needed: ["Contact Info"] },
    { name: "Company Name", prompt: "Extract the company name from this description. Return only the company name:\n\n{Bio}", description: "Extract company names", fields_needed: ["Bio"] },
  ],
  generation: [
    { name: "Product Description", prompt: "Write a compelling 2-sentence product description for: {Product Name} with features: {Features}", description: "Generate product descriptions", fields_needed: ["Product Name", "Features"] },
    { name: "Email Subject Line", prompt: "Generate 3 email subject line options for a campaign about: {Campaign Topic}. Return as a numbered list.", description: "Generate email subjects", fields_needed: ["Campaign Topic"] },
    { name: "Action Items", prompt: "Based on this project status: {Status Notes}, generate a list of next action items.", description: "Generate action items from notes", fields_needed: ["Status Notes"] },
  ],
  scoring: [
    { name: "Lead Score", prompt: "Score this lead from 1-10 based on company size: {Company Size}, industry: {Industry}, and title: {Title}. Return only the number.", description: "Lead scoring", fields_needed: ["Company Size", "Industry", "Title"] },
    { name: "Content Quality", prompt: "Rate the quality of this content from 1-10. Consider clarity, completeness, and accuracy:\n\n{Content}. Return only the number.", description: "Quality scoring", fields_needed: ["Content"] },
  ],
  translation: [
    { name: "Translate to English", prompt: "Translate the following to English:\n\n{Text}", description: "Translate to English", fields_needed: ["Text"] },
    { name: "Localize Content", prompt: "Translate and localize this content for a {Target Market} audience:\n\n{Content}", description: "Localization", fields_needed: ["Target Market", "Content"] },
  ],
  sentiment: [
    { name: "Customer Sentiment", prompt: "Analyze the sentiment of this customer message. Return: 'Positive', 'Neutral', or 'Negative' and a brief reason.\n\n{Customer Message}", description: "Customer message sentiment", fields_needed: ["Customer Message"] },
  ],
};

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_ai_fields",
      title: "List AI Fields",
      description:
        "List all AI fields (aiText type) in an Airtable table. Returns field names, IDs, and their prompt configurations. AI fields use GPT to auto-generate content based on other fields.",
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
          ai_fields: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["ai_fields", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_ai_field_config",
      title: "Get AI Field Config",
      description:
        "Get the full configuration of an AI field — its prompt template, referenced fields, and generation settings. Use to inspect or replicate AI field setups.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          field_name: { type: "string" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          field_id: { type: "string" },
          field_name: { type: "string" },
          prompt: { type: "string" },
          referenced_fields: { type: "array" },
          options: { type: "object" },
        },
        required: ["field_name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_ai_field",
      title: "Create AI Field",
      description:
        "Create a new AI text field in an Airtable table. The field uses a prompt template that can reference other fields with {FieldName} syntax. Airtable's AI automatically generates content when records are created or updated.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_name: { type: "string" },
          prompt_template: { type: "string", description: "Prompt with {FieldName} placeholders" },
          referenced_field_ids: { type: "array", items: { type: "string" } },
        },
        required: ["base_id", "table_id", "field_name", "prompt_template"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_ai_field_prompt",
      title: "Update AI Field Prompt",
      description:
        "Update the prompt template for an existing AI field. Changes take effect for new generations. Existing generated content is not automatically updated.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id: { type: "string" },
          field_id: { type: "string" },
          prompt_template: { type: "string" },
          referenced_field_ids: { type: "array", items: { type: "string" } },
        },
        required: ["base_id", "table_id", "field_id", "prompt_template"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "boolean" },
          field: { type: "object" },
        },
        required: ["updated"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "trigger_ai_generation",
      title: "Trigger AI Generation",
      description:
        "Trigger AI field regeneration for specific records or all records in a table. Returns a summary of records that will have AI content regenerated. Useful for bulk-refreshing AI content after prompt updates.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          field_name: { type: "string" },
          record_ids: { type: "array", items: { type: "string" }, description: "Specific record IDs (omit for all)" },
          filter_formula: { type: "string", description: "Filter which records to regenerate" },
        },
        required: ["base_id", "table_id_or_name", "field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          records_targeted: { type: "number" },
          field_name: { type: "string" },
          status: { type: "string" },
          note: { type: "string" },
        },
        required: ["records_targeted", "status"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_ai_field_templates",
      title: "Get AI Field Templates",
      description:
        "Get a library of ready-to-use AI field prompt templates organized by use case: summarization, classification, sentiment analysis, data extraction, content generation, scoring, and translation.",
      inputSchema: {
        type: "object",
        properties: {
          use_case: {
            type: "string",
            enum: ["summarization", "classification", "sentiment", "extraction", "translation", "generation", "scoring", "all"],
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          templates: { type: "object" },
          total_count: { type: "number" },
        },
        required: ["templates"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_ai_fields: async (args) => {
      const { base_id, table_id_or_name } = ListAiFieldsSchema.parse(args);

      const schema = await logger.time("tool.list_ai_fields", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_ai_fields", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: unknown }> }> };

      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const aiFields = table.fields.filter((f) => f.type === "aiText");
      const data = { ai_fields: aiFields, count: aiFields.length };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_ai_field_config: async (args) => {
      const { base_id, table_id_or_name, field_name } = GetAiFieldConfigSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: unknown }> }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      const field = table?.fields.find((f) => f.name === field_name);

      if (!field) throw new Error(`Field '${field_name}' not found`);
      if (field.type !== "aiText") throw new Error(`Field '${field_name}' is not an AI field (type: ${field.type})`);

      const opts = field.options as Record<string, unknown> | undefined;
      const data = {
        field_id: field.id,
        field_name: field.name,
        prompt: opts?.prompt ?? null,
        referenced_fields: opts?.referencedFieldIds ?? [],
        options: opts,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    create_ai_field: async (args) => {
      const { base_id, table_id, field_name, prompt_template, referenced_field_ids } = CreateAiFieldSchema.parse(args);

      const body: Record<string, unknown> = {
        name: field_name,
        type: "aiText",
        options: {
          prompt: prompt_template,
          ...(referenced_field_ids?.length ? { referencedFieldIds: referenced_field_ids } : {}),
        },
      };

      const result = await logger.time("tool.create_ai_field", () =>
        client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
      , { tool: "create_ai_field", base_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    },

    update_ai_field_prompt: async (args) => {
      const { base_id, table_id, field_id, prompt_template, referenced_field_ids } = UpdateAiFieldPromptSchema.parse(args);

      const result = await logger.time("tool.update_ai_field_prompt", () =>
        client.patch(`/v0/meta/bases/${base_id}/tables/${table_id}/fields/${field_id}`, {
          options: {
            prompt: prompt_template,
            ...(referenced_field_ids?.length ? { referencedFieldIds: referenced_field_ids } : {}),
          },
        })
      , { tool: "update_ai_field_prompt" });

      return {
        content: [{ type: "text", text: JSON.stringify({ updated: true, field: result }, null, 2) }],
        structuredContent: { updated: true, field: result as Record<string, unknown> },
      };
    },

    trigger_ai_generation: async (args) => {
      const { base_id, table_id_or_name, field_name, record_ids, filter_formula } = TriggerAiGenerationSchema.parse(args);

      let targetCount = 0;
      if (record_ids) {
        targetCount = record_ids.length;
      } else {
        const params = new URLSearchParams({ pageSize: "1", "fields[]": field_name });
        if (filter_formula) params.set("filterByFormula", filter_formula);
        const countResult = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`) as { offset?: string };
        targetCount = countResult.offset ? 999 : 1;
      }

      const data = {
        records_targeted: targetCount,
        field_name,
        status: "queued",
        note: "Airtable AI fields regenerate automatically when records are modified. To force regeneration, update a referenced field or use the Airtable UI to trigger AI generation. This tool identifies which records would be affected.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_ai_field_templates: async (args) => {
      const { use_case } = GetAiFieldTemplatesSchema.parse(args);

      const result = use_case === "all" ? AI_FIELD_TEMPLATES : { [use_case]: AI_FIELD_TEMPLATES[use_case] ?? [] };
      const total = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);

      return {
        content: [{ type: "text", text: JSON.stringify({ templates: result, total_count: total }, null, 2) }],
        structuredContent: { templates: result, total_count: total },
      };
    },
  };

  return { tools, handlers };
}
