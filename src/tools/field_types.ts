// Airtable Field Type tools: create_number_field, create_currency_field,
//   create_percent_field, create_date_field, create_datetime_field,
//   create_checkbox_field, create_rating_field, create_url_field,
//   create_email_field, create_phone_field, create_duration_field,
//   create_count_field, create_lookup_field, create_autonumber_field,
//   create_text_field, create_long_text_field, create_barcode_field,
//   get_field_type_schema
// Uses Airtable Metadata API: POST /v0/meta/bases/{baseId}/tables/{tableId}/fields
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CreateNumberFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name"),
  precision: z.number().min(0).max(8).optional().default(0)
    .describe("Decimal precision: 0 (integer), 1, 2, 3, 4, 5, 6, 7, or 8 decimal places"),
  description: z.string().optional().describe("Field description"),
});

const CreateCurrencyFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Price', 'Revenue', 'Cost')"),
  symbol: z.string().optional().default("$").describe("Currency symbol (e.g., '$', '€', '£', '¥', '₹')"),
  precision: z.number().min(0).max(7).optional().default(2)
    .describe("Decimal precision (default 2 for cents)"),
  description: z.string().optional().describe("Field description"),
});

const CreatePercentFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Completion %', 'Discount Rate')"),
  precision: z.number().min(0).max(8).optional().default(0)
    .describe("Decimal precision for the percentage value"),
  description: z.string().optional().describe("Field description"),
});

const CreateDateFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Due Date', 'Birthday', 'Start Date')"),
  date_format: z.enum(["local", "friendly", "us", "european", "iso"]).optional().default("local")
    .describe("Date display format: local (M/D/YYYY), friendly (January 1, 2024), us (MM/DD/YYYY), european (DD/MM/YYYY), iso (YYYY-MM-DD)"),
  time_zone: z.string().optional().describe("IANA time zone for display (e.g., 'America/New_York'). Used with GMT time zones."),
  description: z.string().optional().describe("Field description"),
});

const CreateDatetimeFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Created At', 'Meeting Time', 'Deadline')"),
  date_format: z.enum(["local", "friendly", "us", "european", "iso"]).optional().default("iso")
    .describe("Date format: local, friendly, us, european, or iso (default)"),
  time_format: z.enum(["12hour", "24hour"]).optional().default("24hour")
    .describe("Time format: '12hour' (3:30pm) or '24hour' (15:30)"),
  time_zone: z.string().optional().describe("IANA time zone (e.g., 'UTC', 'America/New_York', 'Europe/London')"),
  use_same_time_zone_for_all_collaborators: z.boolean().optional().default(false)
    .describe("If false, each user sees date in their local time zone"),
  description: z.string().optional().describe("Field description"),
});

const CreateCheckboxFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Done', 'Active', 'Verified')"),
  color: z.enum(["greenBright", "tealBright", "cyanBright", "blueBright", "pinkBright", "redBright", "orangeBright", "yellowBright", "purpleBright", "grayBright", "green", "teal", "cyan", "blue", "pink", "red", "orange", "yellow", "purple", "gray"]).optional().default("greenBright")
    .describe("Checkbox color (default: greenBright)"),
  icon: z.enum(["check", "xCheckbox", "star", "heart", "thumbsUp", "flag", "dot"]).optional().default("check")
    .describe("Checkbox icon style (default: check)"),
  description: z.string().optional().describe("Field description"),
});

const CreateRatingFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Priority', 'Score', 'Stars')"),
  max: z.number().min(1).max(10).optional().default(5).describe("Maximum rating value (1-10, default 5)"),
  icon: z.enum(["star", "heart", "thumbsUp", "flag", "dot"]).optional().default("star")
    .describe("Rating icon style (default: star)"),
  color: z.enum(["yellowBright", "orangeBright", "redBright", "pinkBright", "purpleBright", "blueBright", "cyanBright", "tealBright", "greenBright", "grayBright"]).optional().default("yellowBright")
    .describe("Rating icon color (default: yellowBright)"),
  description: z.string().optional().describe("Field description"),
});

const CreateUrlFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Website', 'Profile URL', 'Reference Link')"),
  description: z.string().optional().describe("Field description"),
});

const CreateEmailFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Email', 'Contact Email', 'Work Email')"),
  description: z.string().optional().describe("Field description"),
});

const CreatePhoneFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Phone', 'Mobile', 'Work Phone')"),
  description: z.string().optional().describe("Field description"),
});

const CreateDurationFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Duration', 'Time Spent', 'Length')"),
  duration_format: z.enum(["h:mm", "h:mm:ss", "h:mm:ss.SSS"]).optional().default("h:mm")
    .describe("Duration format: h:mm (hours:minutes), h:mm:ss, or h:mm:ss.SSS"),
  description: z.string().optional().describe("Field description"),
});

const CreateCountFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Number of Tags', 'Attachment Count')"),
  linked_field_id: z.string().describe("Field ID (starts with 'fld') of the linked record or multi-value field to count"),
  description: z.string().optional().describe("Field description"),
});

const CreateLookupFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl') where the lookup field will be added"),
  name: z.string().describe("Field name (e.g., 'Company Name', 'Manager Email')"),
  linked_field_id: z.string().describe("Field ID (starts with 'fld') of the linked record field in this table"),
  lookup_field_id: z.string().describe("Field ID (starts with 'fld') in the linked table to look up values from"),
  description: z.string().optional().describe("Field description"),
});

const CreateAutonumberFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Record ID', 'Ticket Number', 'Order Number')"),
  description: z.string().optional().describe("Field description"),
});

const CreateTextFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name"),
  description: z.string().optional().describe("Field description"),
});

const CreateLongTextFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Notes', 'Description', 'Comments')"),
  enable_rich_text: z.boolean().optional().default(false)
    .describe("Enable rich text formatting (markdown-style bold, italic, links, etc.)"),
  description: z.string().optional().describe("Field description"),
});

const CreateBarcodeFieldSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id: z.string().describe("Table ID (starts with 'tbl')"),
  name: z.string().describe("Field name (e.g., 'Barcode', 'QR Code', 'Product SKU')"),
  description: z.string().optional().describe("Field description"),
});

const GetFieldTypeSchemaSchema = z.object({
  field_type: z.string().describe(
    "Airtable field type name to get schema for. Examples: singleLineText, multilineText, number, currency, percent, email, url, phoneNumber, checkbox, rating, date, dateTime, duration, count, lookup, rollup, formula, singleSelect, multipleSelects, multipleRecordLinks, autoNumber, barcode, createdTime, lastModifiedTime, createdBy, lastModifiedBy, multipleAttachments, multipleLookupValues, singleCollaborator, multipleCollaborators, externalSyncSource, button"
  ),
});

// ============ Helper ============

async function createField(
  client: AirtableClient,
  base_id: string,
  table_id: string,
  type: string,
  name: string,
  options: Record<string, unknown>,
  description: string | undefined,
  toolName: string
): Promise<unknown> {
  const body: Record<string, unknown> = { type, name, options };
  if (description) body.description = description;

  return logger.time(`tool.${toolName}`, () =>
    client.post(`/v0/meta/bases/${base_id}/tables/${table_id}/fields`, body)
  , { tool: toolName, base_id, table_id });
}

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "create_number_field",
      title: "Create Number Field",
      description:
        "Create a number field in an Airtable table. Number fields store numeric values with configurable decimal precision. Supports 0 (integer) to 8 decimal places. Use for counts, scores, IDs, measurements, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name" },
          precision: { type: "number", description: "Decimal places: 0 (integer), 1-8 (default 0)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_currency_field",
      title: "Create Currency Field",
      description:
        "Create a currency field in an Airtable table. Displays numeric values as money with a currency symbol. Configurable symbol ($ € £ ¥ ₹ etc.) and decimal precision. Perfect for prices, costs, budgets, and revenue tracking.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Price', 'Cost')" },
          symbol: { type: "string", description: "Currency symbol: '$', '€', '£', '¥', '₹', etc. (default: $)" },
          precision: { type: "number", description: "Decimal places 0-7 (default 2)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_percent_field",
      title: "Create Percent Field",
      description:
        "Create a percent field in an Airtable table. Displays numeric values as percentages (e.g., 0.85 → 85%, or 85 → 85% depending on settings). Use for completion rates, discounts, tax rates, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Completion %', 'Discount Rate')" },
          precision: { type: "number", description: "Decimal places 0-8 (default 0)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_date_field",
      title: "Create Date Field",
      description:
        "Create a date-only field (no time) in an Airtable table. Configurable display format: local (M/D/YYYY), friendly (January 1, 2024), us (MM/DD/YYYY), european (DD/MM/YYYY), or iso (YYYY-MM-DD). Use for due dates, birthdays, deadlines.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Due Date', 'Birthday')" },
          date_format: { type: "string", description: "Format: local, friendly, us, european, or iso (default: local)" },
          time_zone: { type: "string", description: "IANA time zone (e.g., 'America/New_York')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_datetime_field",
      title: "Create Date+Time Field",
      description:
        "Create a date-and-time field in an Airtable table. Supports 12-hour or 24-hour time format, configurable date format, and time zone settings. Ideal for meeting times, event timestamps, deadlines with time.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Created At', 'Meeting Time')" },
          date_format: { type: "string", description: "Date format: local, friendly, us, european, or iso (default: iso)" },
          time_format: { type: "string", description: "Time format: '12hour' or '24hour' (default: 24hour)" },
          time_zone: { type: "string", description: "IANA time zone (e.g., 'UTC', 'America/New_York')" },
          use_same_time_zone_for_all_collaborators: { type: "boolean", description: "Use fixed time zone for all users (default: false)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_checkbox_field",
      title: "Create Checkbox Field",
      description:
        "Create a checkbox (boolean) field in an Airtable table. Configurable icon (check, x, star, heart, thumbsUp, flag, dot) and color. Use for yes/no states: Done, Active, Featured, Verified, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Done', 'Active', 'Verified')" },
          color: { type: "string", description: "Color: greenBright, redBright, blueBright, etc. (default: greenBright)" },
          icon: { type: "string", description: "Icon: check, xCheckbox, star, heart, thumbsUp, flag, or dot (default: check)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_rating_field",
      title: "Create Rating Field",
      description:
        "Create a rating field in an Airtable table. Records are rated on a scale from 1 to max (configurable 1-10). Configurable icon (star, heart, thumbsUp, flag, dot) and color. Use for priority, satisfaction, quality ratings.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Priority', 'Score', 'Stars')" },
          max: { type: "number", description: "Maximum rating value 1-10 (default 5)" },
          icon: { type: "string", description: "Icon: star, heart, thumbsUp, flag, or dot (default: star)" },
          color: { type: "string", description: "Icon color: yellowBright, orangeBright, etc. (default: yellowBright)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_url_field",
      title: "Create URL Field",
      description:
        "Create a URL field in an Airtable table. Stores web URLs as clickable links. Use for websites, profile links, documentation URLs, reference links, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Website', 'Profile URL')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_email_field",
      title: "Create Email Field",
      description:
        "Create an email field in an Airtable table. Stores email addresses as clickable mailto: links. Use for contact emails, user emails, notification addresses, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Email', 'Contact Email')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_phone_field",
      title: "Create Phone Field",
      description:
        "Create a phone number field in an Airtable table. Stores phone numbers as clickable tel: links. Use for contact phone numbers, mobile numbers, fax numbers, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Phone', 'Mobile', 'Work Phone')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_duration_field",
      title: "Create Duration Field",
      description:
        "Create a duration field in an Airtable table. Stores time durations in h:mm, h:mm:ss, or h:mm:ss.SSS format. Values are stored in seconds. Use for tracking time spent, meeting lengths, delivery times.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Duration', 'Time Spent')" },
          duration_format: { type: "string", description: "Format: 'h:mm', 'h:mm:ss', or 'h:mm:ss.SSS' (default: h:mm)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_count_field",
      title: "Create Count Field",
      description:
        "Create a count field that automatically counts the number of linked records or values in a linked record field. Computed field — read-only at record level. Use to display the number of related items (e.g., number of tasks per project).",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Number of Tasks', 'Attachment Count')" },
          linked_field_id: { type: "string", description: "Field ID (starts with 'fld') of the linked record or multi-value field to count" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name", "linked_field_id"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_lookup_field",
      title: "Create Lookup Field",
      description:
        "Create a lookup field that pulls values from a field in a linked table. For example, if a Tasks table has a linked Companies field, a lookup can show each company's 'Industry' value on the task record. Computed — read-only at record level.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl') where the lookup field will be added" },
          name: { type: "string", description: "Field name (e.g., 'Company Industry', 'Manager Email')" },
          linked_field_id: { type: "string", description: "Field ID (starts with 'fld') of the linked record field in this table" },
          lookup_field_id: { type: "string", description: "Field ID (starts with 'fld') in the linked table to look up values from" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name", "linked_field_id", "lookup_field_id"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_autonumber_field",
      title: "Create Auto-Number Field",
      description:
        "Create an auto-number field that automatically assigns sequential integers to records as they are created (1, 2, 3, ...). Read-only — cannot be manually set. Use for ticket IDs, order numbers, invoice numbers, sequential record IDs.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Record ID', 'Ticket Number')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_text_field",
      title: "Create Single-Line Text Field",
      description:
        "Create a single-line text field in an Airtable table. The most basic field type — stores plain text in a single line. Use for names, titles, short descriptions, codes, labels. Not suitable for long text (use create_long_text_field instead).",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Name', 'Title', 'Code')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_long_text_field",
      title: "Create Long Text Field",
      description:
        "Create a multi-line long text field in an Airtable table. Supports large text blocks. Optionally enable rich text formatting (bold, italic, lists, links, code blocks via markdown). Use for notes, descriptions, comments, content.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Notes', 'Description', 'Summary')" },
          enable_rich_text: { type: "boolean", description: "Enable rich text markdown formatting (default: false)" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_barcode_field",
      title: "Create Barcode Field",
      description:
        "Create a barcode field in an Airtable table. Stores barcode data (text/number) and can scan barcodes using the Airtable mobile app. Compatible with standard barcode formats (QR, EAN, UPC, etc.). Use for inventory management, product codes, asset tracking.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id: { type: "string", description: "Table ID (starts with 'tbl')" },
          name: { type: "string", description: "Field name (e.g., 'Barcode', 'QR Code', 'SKU')" },
          description: { type: "string", description: "Field description" },
        },
        required: ["base_id", "table_id", "name"],
      },
      outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, type: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_field_type_schema",
      title: "Get Field Type Schema",
      description:
        "Get the complete API schema for a specific Airtable field type including its options structure, required properties, and valid values. Use before creating or updating fields to understand required and optional options.",
      inputSchema: {
        type: "object",
        properties: {
          field_type: {
            type: "string",
            description: "Field type name (e.g., singleLineText, number, currency, date, checkbox, rating, singleSelect, multipleRecordLinks, etc.)",
          },
        },
        required: ["field_type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          type: { type: "string" },
          description: { type: "string" },
          optionsSchema: { type: "object" },
          example: { type: "object" },
          isComputed: { type: "boolean" },
          notes: { type: "string" },
        },
        required: ["type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    create_number_field: async (args) => {
      const { base_id, table_id, name, precision, description } = CreateNumberFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "number", name, { precision }, description, "create_number_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_currency_field: async (args) => {
      const { base_id, table_id, name, symbol, precision, description } = CreateCurrencyFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "currency", name, { symbol, precision }, description, "create_currency_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_percent_field: async (args) => {
      const { base_id, table_id, name, precision, description } = CreatePercentFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "percent", name, { precision }, description, "create_percent_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_date_field: async (args) => {
      const { base_id, table_id, name, date_format, time_zone, description } = CreateDateFieldSchema.parse(args);
      const dateFormatMap: Record<string, string> = {
        local: "l", friendly: "LL", us: "M/D/YYYY", european: "D/M/YYYY", iso: "YYYY-MM-DD",
      };
      const options: Record<string, unknown> = {
        dateFormat: { name: date_format || "local", format: dateFormatMap[date_format || "local"] || "l" },
      };
      if (time_zone) options.timeZone = time_zone;
      const result = await createField(client, base_id, table_id, "date", name, options, description, "create_date_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_datetime_field: async (args) => {
      const { base_id, table_id, name, date_format, time_format, time_zone, use_same_time_zone_for_all_collaborators, description } = CreateDatetimeFieldSchema.parse(args);
      const dateFormatMap: Record<string, string> = {
        local: "l", friendly: "LL", us: "M/D/YYYY", european: "D/M/YYYY", iso: "YYYY-MM-DD",
      };
      const timeFormatMap: Record<string, string> = { "12hour": "h:mma", "24hour": "HH:mm" };
      const options: Record<string, unknown> = {
        dateFormat: { name: date_format || "iso", format: dateFormatMap[date_format || "iso"] || "YYYY-MM-DD" },
        timeFormat: { name: time_format || "24hour", format: timeFormatMap[time_format || "24hour"] || "HH:mm" },
      };
      if (time_zone) options.timeZone = time_zone;
      if (use_same_time_zone_for_all_collaborators !== undefined) {
        options.useSameTimeZoneForAllCollaborators = use_same_time_zone_for_all_collaborators;
      }
      const result = await createField(client, base_id, table_id, "dateTime", name, options, description, "create_datetime_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_checkbox_field: async (args) => {
      const { base_id, table_id, name, color, icon, description } = CreateCheckboxFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "checkbox", name, { color, icon }, description, "create_checkbox_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_rating_field: async (args) => {
      const { base_id, table_id, name, max, icon, color, description } = CreateRatingFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "rating", name, { max, icon, color }, description, "create_rating_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_url_field: async (args) => {
      const { base_id, table_id, name, description } = CreateUrlFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "url", name, {}, description, "create_url_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_email_field: async (args) => {
      const { base_id, table_id, name, description } = CreateEmailFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "email", name, {}, description, "create_email_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_phone_field: async (args) => {
      const { base_id, table_id, name, description } = CreatePhoneFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "phoneNumber", name, {}, description, "create_phone_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_duration_field: async (args) => {
      const { base_id, table_id, name, duration_format, description } = CreateDurationFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "duration", name, { durationFormat: duration_format || "h:mm" }, description, "create_duration_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_count_field: async (args) => {
      const { base_id, table_id, name, linked_field_id, description } = CreateCountFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "count", name, { fieldIdInLinkedTable: linked_field_id }, description, "create_count_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_lookup_field: async (args) => {
      const { base_id, table_id, name, linked_field_id, lookup_field_id, description } = CreateLookupFieldSchema.parse(args);
      const options = {
        fieldIdInLinkedTable: lookup_field_id,
        recordLinkFieldId: linked_field_id,
      };
      const result = await createField(client, base_id, table_id, "multipleLookupValues", name, options, description, "create_lookup_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_autonumber_field: async (args) => {
      const { base_id, table_id, name, description } = CreateAutonumberFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "autoNumber", name, {}, description, "create_autonumber_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_text_field: async (args) => {
      const { base_id, table_id, name, description } = CreateTextFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "singleLineText", name, {}, description, "create_text_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_long_text_field: async (args) => {
      const { base_id, table_id, name, enable_rich_text, description } = CreateLongTextFieldSchema.parse(args);
      const options = enable_rich_text ? { enableRichText: true } : {};
      const result = await createField(client, base_id, table_id, "multilineText", name, options, description, "create_long_text_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    create_barcode_field: async (args) => {
      const { base_id, table_id, name, description } = CreateBarcodeFieldSchema.parse(args);
      const result = await createField(client, base_id, table_id, "barcode", name, {}, description, "create_barcode_field");
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    get_field_type_schema: async (args) => {
      const { field_type } = GetFieldTypeSchemaSchema.parse(args);

      const schemas: Record<string, unknown> = {
        singleLineText: {
          type: "singleLineText", description: "Single line of text. No options required.",
          optionsSchema: {}, isComputed: false,
          example: { type: "singleLineText", name: "Name" },
        },
        multilineText: {
          type: "multilineText", description: "Multi-line long text. Optionally enable rich text.",
          optionsSchema: { enableRichText: { type: "boolean", description: "Enable markdown rich text" } },
          isComputed: false,
          example: { type: "multilineText", name: "Notes", options: { enableRichText: true } },
        },
        number: {
          type: "number", description: "Numeric value with configurable precision.",
          optionsSchema: { precision: { type: "number", min: 0, max: 8, description: "Decimal places (0=integer)" } },
          isComputed: false,
          example: { type: "number", name: "Score", options: { precision: 2 } },
        },
        currency: {
          type: "currency", description: "Money value with currency symbol.",
          optionsSchema: { symbol: { type: "string", description: "Currency symbol ($, €, £, etc.)" }, precision: { type: "number", min: 0, max: 7 } },
          isComputed: false,
          example: { type: "currency", name: "Price", options: { symbol: "$", precision: 2 } },
        },
        percent: {
          type: "percent", description: "Percentage value.",
          optionsSchema: { precision: { type: "number", min: 0, max: 8 } },
          isComputed: false,
          example: { type: "percent", name: "Completion", options: { precision: 0 } },
        },
        date: {
          type: "date", description: "Date without time.",
          optionsSchema: {
            dateFormat: { name: { enum: ["local", "friendly", "us", "european", "iso"] }, format: { type: "string" } },
          },
          isComputed: false,
          example: { type: "date", name: "Due Date", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" } } },
        },
        dateTime: {
          type: "dateTime", description: "Date with time and time zone.",
          optionsSchema: {
            dateFormat: { name: { enum: ["local", "friendly", "us", "european", "iso"] } },
            timeFormat: { name: { enum: ["12hour", "24hour"] }, format: { type: "string" } },
            timeZone: { type: "string", description: "IANA time zone" },
          },
          isComputed: false,
          example: { type: "dateTime", name: "Created At", options: { dateFormat: { name: "iso", format: "YYYY-MM-DD" }, timeFormat: { name: "24hour", format: "HH:mm" }, timeZone: "UTC" } },
        },
        checkbox: {
          type: "checkbox", description: "Boolean checkbox.",
          optionsSchema: {
            color: { type: "string", description: "Icon color (greenBright, redBright, etc.)" },
            icon: { type: "string", description: "Icon: check, xCheckbox, star, heart, thumbsUp, flag, dot" },
          },
          isComputed: false,
          example: { type: "checkbox", name: "Done", options: { color: "greenBright", icon: "check" } },
        },
        rating: {
          type: "rating", description: "1-10 rating scale with configurable icon.",
          optionsSchema: {
            max: { type: "number", min: 1, max: 10 },
            icon: { type: "string", description: "star, heart, thumbsUp, flag, dot" },
            color: { type: "string" },
          },
          isComputed: false,
          example: { type: "rating", name: "Priority", options: { max: 5, icon: "star", color: "yellowBright" } },
        },
        singleSelect: {
          type: "singleSelect", description: "Pick one value from predefined choices.",
          optionsSchema: { choices: { type: "array", items: { name: "string", color: "string" } } },
          isComputed: false,
          example: { type: "singleSelect", name: "Status", options: { choices: [{ name: "Active", color: "greenBright" }, { name: "Inactive", color: "redBright" }] } },
        },
        multipleSelects: {
          type: "multipleSelects", description: "Pick multiple values from predefined choices.",
          optionsSchema: { choices: { type: "array", items: { name: "string", color: "string" } } },
          isComputed: false,
          example: { type: "multipleSelects", name: "Tags", options: { choices: [{ name: "Feature" }, { name: "Bug" }] } },
        },
        multipleRecordLinks: {
          type: "multipleRecordLinks", description: "Link to records in another (or same) table.",
          optionsSchema: {
            linkedTableId: { type: "string", description: "Table ID to link to" },
            isReversed: { type: "boolean" },
            prefersSingleRecordLink: { type: "boolean" },
          },
          isComputed: false,
          example: { type: "multipleRecordLinks", name: "Contacts", options: { linkedTableId: "tblXXXX" } },
        },
        autoNumber: { type: "autoNumber", description: "Auto-incrementing integer. No options required.", optionsSchema: {}, isComputed: true, notes: "Read-only field. Value is assigned automatically." },
        barcode: { type: "barcode", description: "Barcode scanner field. No options required.", optionsSchema: {}, isComputed: false },
        url: { type: "url", description: "URL field. No options required.", optionsSchema: {}, isComputed: false },
        email: { type: "email", description: "Email field. No options required.", optionsSchema: {}, isComputed: false },
        phoneNumber: { type: "phoneNumber", description: "Phone number field. No options required.", optionsSchema: {}, isComputed: false },
        count: { type: "count", description: "Counts linked records.", optionsSchema: { fieldIdInLinkedTable: { type: "string" } }, isComputed: true },
        multipleLookupValues: {
          type: "multipleLookupValues", description: "Look up values from a linked table.",
          optionsSchema: { recordLinkFieldId: { type: "string" }, fieldIdInLinkedTable: { type: "string" } },
          isComputed: true,
        },
        rollup: {
          type: "rollup", description: "Aggregate values from linked records.",
          optionsSchema: {
            recordLinkFieldId: { type: "string" },
            fieldIdInLinkedTable: { type: "string" },
            referencedFieldIds: { type: "array" },
            result: { type: "object" },
          },
          isComputed: true,
        },
        formula: {
          type: "formula", description: "Computed field using Airtable formula language.",
          optionsSchema: { formula: { type: "string" }, referencedFieldIds: { type: "array" }, result: { type: "object" } },
          isComputed: true,
          example: { type: "formula", name: "Full Name", options: { formula: "CONCATENATE({First Name},' ',{Last Name})" } },
        },
        duration: { type: "duration", description: "Time duration.", optionsSchema: { durationFormat: { enum: ["h:mm", "h:mm:ss", "h:mm:ss.SSS"] } }, isComputed: false },
        createdTime: { type: "createdTime", description: "Automatically set to record creation time. Read-only.", optionsSchema: {}, isComputed: true },
        lastModifiedTime: {
          type: "lastModifiedTime", description: "Last modification time. Optionally scope to specific fields.",
          optionsSchema: { fieldIds: { type: "array", description: "Watch specific field IDs. Empty = watch all fields." } },
          isComputed: true,
        },
        createdBy: { type: "createdBy", description: "User who created the record. Read-only.", optionsSchema: {}, isComputed: true },
        lastModifiedBy: { type: "lastModifiedBy", description: "User who last modified the record. Read-only.", optionsSchema: {}, isComputed: true },
        multipleAttachments: { type: "multipleAttachments", description: "File attachment field.", optionsSchema: { isReversed: { type: "boolean" } }, isComputed: false },
        singleCollaborator: { type: "singleCollaborator", description: "Pick one workspace collaborator.", optionsSchema: {}, isComputed: false },
        multipleCollaborators: { type: "multipleCollaborators", description: "Pick multiple workspace collaborators.", optionsSchema: {}, isComputed: false },
        button: { type: "button", description: "Clickable button that triggers URL or automation.", optionsSchema: { label: { type: "string" }, url: { type: "string" } }, isComputed: true },
        externalSyncSource: { type: "externalSyncSource", description: "Synced from external source. Read-only.", optionsSchema: {}, isComputed: true },
      };

      const schema = schemas[field_type];
      if (!schema) {
        const knownTypes = Object.keys(schemas);
        const response = {
          error: `Unknown field type: ${field_type}`,
          knownTypes,
          message: `Valid field types: ${knownTypes.join(", ")}`,
        };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }], structuredContent: schema };
    },
  };

  return { tools, handlers };
}
