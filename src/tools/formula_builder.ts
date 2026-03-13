// Airtable Formula Builder tools: build_filter_formula, build_date_formula,
//   build_text_formula, build_numeric_formula, build_lookup_formula,
//   get_formula_templates, explain_formula
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BuildFilterFormulaSchema = z.object({
  conditions: z.array(z.object({
    field: z.string().describe("Field name"),
    operator: z.enum(["=", "!=", ">", ">=", "<", "<=", "contains", "not_contains", "is_blank", "is_not_blank", "starts_with", "ends_with"]).describe("Comparison operator"),
    value: z.string().optional().describe("Value to compare against (not needed for is_blank/is_not_blank)"),
  })).min(1).describe("Array of filter conditions to combine"),
  logic: z.enum(["AND", "OR"]).default("AND").describe("How to combine conditions: AND (all must match) or OR (any must match)"),
});

const BuildDateFormulaSchema = z.object({
  operation: z.enum([
    "is_today", "is_before_today", "is_after_today", "is_this_week",
    "is_this_month", "is_this_year", "is_before_date", "is_after_date",
    "is_within_days", "days_until", "days_since", "format_date",
    "date_diff", "date_add",
  ]).describe("Date operation to build formula for"),
  field: z.string().optional().describe("Date field name (required for most operations)"),
  date_value: z.string().optional().describe("ISO date string for comparison operations (e.g., '2024-01-15')"),
  days: z.number().optional().describe("Number of days for within/add/subtract operations"),
  unit: z.enum(["days", "weeks", "months", "years"]).optional().describe("Time unit for date_diff/date_add"),
  format: z.string().optional().describe("Date format string for format_date (e.g., 'M/D/YYYY')"),
});

const BuildTextFormulaSchema = z.object({
  operation: z.enum([
    "concatenate", "search", "replace", "trim", "upper", "lower", "left", "right",
    "mid", "len", "contains_word", "regex_match", "is_email", "is_url",
  ]).describe("Text operation to build formula for"),
  fields: z.array(z.string()).optional().describe("Field names to operate on"),
  separator: z.string().optional().describe("Separator for concatenation"),
  search_text: z.string().optional().describe("Text to search for"),
  replace_text: z.string().optional().describe("Replacement text"),
  count: z.number().optional().describe("Character count for left/right/mid operations"),
  start: z.number().optional().describe("Start position for mid operation"),
  pattern: z.string().optional().describe("Regex pattern for regex_match"),
});

const BuildNumericFormulaSchema = z.object({
  operation: z.enum([
    "sum", "average", "min", "max", "round", "ceil", "floor", "abs",
    "power", "sqrt", "mod", "int", "percentage", "clamp",
  ]).describe("Numeric operation to build formula for"),
  fields: z.array(z.string()).optional().describe("Field names for multi-field operations"),
  field: z.string().optional().describe("Primary field name"),
  value: z.number().optional().describe("Numeric value for operations"),
  decimals: z.number().optional().describe("Decimal places for rounding"),
  min_value: z.number().optional().describe("Min value for clamp"),
  max_value: z.number().optional().describe("Max value for clamp"),
});

const GetFormulaTemplatesSchema = z.object({
  category: z.enum([
    "filtering", "dates", "text", "numeric", "lookups",
    "conditionals", "aggregations", "validation", "all",
  ]).default("all").describe("Formula template category"),
});

const ExplainFormulaSchema = z.object({
  formula: z.string().describe("Airtable formula to explain (e.g., 'IF(AND({Status}=\"Active\",{Score}>80),\"High Priority\",\"Normal\")')"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  // Suppress unused variable warning — client is required by the interface
  void client;

  const tools: ToolDefinition[] = [
    {
      name: "build_filter_formula",
      title: "Build Filter Formula",
      description:
        "Build an Airtable filterByFormula expression from simple conditions without needing to know formula syntax. Supports common operators (=, !=, >, <, contains, is_blank, etc.) and combines conditions with AND/OR logic. Returns a ready-to-use formula string for use with list_records or search_records.",
      inputSchema: {
        type: "object",
        properties: {
          conditions: {
            type: "array",
            items: { type: "object" },
            description: "Conditions: [{field:'Status',operator:'=',value:'Active'},{field:'Score',operator:'>',value:'80'}]",
          },
          logic: { type: "string", description: "AND (all must match) or OR (any must match). Default: AND" },
        },
        required: ["conditions"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          description: { type: "string" },
        },
        required: ["formula"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_date_formula",
      title: "Build Date Formula",
      description:
        "Generate Airtable date formulas for common date operations without knowing formula syntax. Supports filtering by date ranges, calculating days between dates, formatting dates, and date arithmetic. Returns a ready-to-use formula string.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", description: "Date operation: is_today, is_before_today, is_this_week, is_within_days, days_until, format_date, etc." },
          field: { type: "string", description: "Date field name (required for most operations)" },
          date_value: { type: "string", description: "ISO date for comparison: '2024-01-15'" },
          days: { type: "number", description: "Number of days for within/add operations" },
          unit: { type: "string", description: "Time unit: days, weeks, months, years" },
          format: { type: "string", description: "Date format string: 'M/D/YYYY'" },
        },
        required: ["operation"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          description: { type: "string" },
          example: { type: "string" },
        },
        required: ["formula"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_text_formula",
      title: "Build Text Formula",
      description:
        "Generate Airtable text manipulation formulas — concatenation, search, replace, case conversion, substring extraction, length, regex matching, and validation. Returns a ready-to-use formula string.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", description: "Operation: concatenate, search, replace, trim, upper, lower, left, right, mid, len, contains_word, regex_match, is_email, is_url" },
          fields: { type: "array", items: { type: "string" }, description: "Field names to operate on" },
          separator: { type: "string", description: "Separator for concatenation (e.g., ' ', ', ')" },
          search_text: { type: "string", description: "Text to search for" },
          replace_text: { type: "string", description: "Replacement text" },
          count: { type: "number", description: "Character count for left/right" },
          start: { type: "number", description: "Start position for mid" },
          pattern: { type: "string", description: "Regex pattern for regex_match" },
        },
        required: ["operation"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          description: { type: "string" },
        },
        required: ["formula"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_numeric_formula",
      title: "Build Numeric Formula",
      description:
        "Generate Airtable numeric formulas — sum, average, min, max, rounding, percentages, clamping, power, sqrt, and more. Returns a ready-to-use formula string for use in formula fields or filterByFormula.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", description: "Operation: sum, average, min, max, round, ceil, floor, abs, power, sqrt, mod, int, percentage, clamp" },
          fields: { type: "array", items: { type: "string" }, description: "Field names for multi-field operations" },
          field: { type: "string", description: "Primary field name" },
          value: { type: "number", description: "Numeric value" },
          decimals: { type: "number", description: "Decimal places for rounding" },
          min_value: { type: "number", description: "Min value for clamp" },
          max_value: { type: "number", description: "Max value for clamp" },
        },
        required: ["operation"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          description: { type: "string" },
        },
        required: ["formula"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_formula_templates",
      title: "Get Formula Templates",
      description:
        "Get a curated library of Airtable formula templates organized by category. Covers filtering, dates, text manipulation, numeric operations, lookups, conditionals, aggregations, and validation patterns. Each template includes the formula, description, and example usage. Great for learning or finding the right formula quickly.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Category: filtering, dates, text, numeric, lookups, conditionals, aggregations, validation, all" },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          templates: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          category: { type: "string" },
        },
        required: ["templates", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "explain_formula",
      title: "Explain Formula",
      description:
        "Parse and explain an Airtable formula in plain English. Breaks down the formula into its components, identifies functions used, describes what it computes, and points out potential issues. Useful for understanding existing formulas or debugging formula errors.",
      inputSchema: {
        type: "object",
        properties: {
          formula: { type: "string", description: "Airtable formula to explain, e.g. IF(AND({Status}='Active',{Score}>80),'High','Normal')" },
        },
        required: ["formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          formula: { type: "string" },
          explanation: { type: "string" },
          functions: { type: "array", items: { type: "string" } },
          fields: { type: "array", items: { type: "string" } },
          complexity: { type: "string" },
        },
        required: ["formula", "explanation"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  function fieldRef(name: string): string {
    return `{${name}}`;
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    build_filter_formula: async (args) => {
      const params = BuildFilterFormulaSchema.parse(args);

      const conditionFormulas = params.conditions.map((c) => {
        const f = fieldRef(c.field);
        switch (c.operator) {
          case "=": return `${f}="${c.value ?? ""}"`;
          case "!=": return `${f}!="${c.value ?? ""}"`;
          case ">": return `${f}>${c.value ?? 0}`;
          case ">=": return `${f}>=${c.value ?? 0}`;
          case "<": return `${f}<${c.value ?? 0}`;
          case "<=": return `${f}<=${c.value ?? 0}`;
          case "contains": return `FIND("${c.value ?? ""}",${f})>0`;
          case "not_contains": return `FIND("${c.value ?? ""}",${f})=0`;
          case "is_blank": return `BLANK(${f})`;
          case "is_not_blank": return `NOT(BLANK(${f}))`;
          case "starts_with": return `LEFT(${f},${(c.value ?? "").length})="${c.value ?? ""}"`;
          case "ends_with": return `RIGHT(${f},${(c.value ?? "").length})="${c.value ?? ""}"`;
          default: return `${f}="${c.value ?? ""}"`;
        }
      });

      const logic = params.logic ?? "AND";
      const formula = conditionFormulas.length === 1
        ? conditionFormulas[0]
        : `${logic}(${conditionFormulas.join(",")})`;

      const description = `${logic} of ${params.conditions.length} condition(s): ${params.conditions.map((c) => `${c.field} ${c.operator} ${c.value ?? ""}`).join(`, ${logic} `)}`;

      const response = { formula, description };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    build_date_formula: async (args) => {
      const params = BuildDateFormulaSchema.parse(args);
      const f = params.field ? fieldRef(params.field) : "TODAY()";
      let formula = "";
      let description = "";

      switch (params.operation) {
        case "is_today":
          formula = `IS_SAME(${f},TODAY(),"day")`;
          description = `Records where ${params.field} is today`;
          break;
        case "is_before_today":
          formula = `IS_BEFORE(${f},TODAY())`;
          description = `Records where ${params.field} is in the past`;
          break;
        case "is_after_today":
          formula = `IS_AFTER(${f},TODAY())`;
          description = `Records where ${params.field} is in the future`;
          break;
        case "is_this_week":
          formula = `AND(IS_AFTER(${f},DATEADD(TODAY(),-WEEKDAY(TODAY())+1,"day")),IS_BEFORE(${f},DATEADD(TODAY(),7-WEEKDAY(TODAY()),"day")))`;
          description = `Records where ${params.field} is this week`;
          break;
        case "is_this_month":
          formula = `AND(MONTH(${f})=MONTH(TODAY()),YEAR(${f})=YEAR(TODAY()))`;
          description = `Records where ${params.field} is this month`;
          break;
        case "is_this_year":
          formula = `YEAR(${f})=YEAR(TODAY())`;
          description = `Records where ${params.field} is this year`;
          break;
        case "is_before_date":
          formula = `IS_BEFORE(${f},"${params.date_value ?? "2024-01-01"}")`;
          description = `Records where ${params.field} is before ${params.date_value}`;
          break;
        case "is_after_date":
          formula = `IS_AFTER(${f},"${params.date_value ?? "2024-01-01"}")`;
          description = `Records where ${params.field} is after ${params.date_value}`;
          break;
        case "is_within_days":
          formula = `AND(IS_AFTER(${f},DATEADD(TODAY(),-(${params.days ?? 7}),"day")),IS_BEFORE(${f},DATEADD(TODAY(),${params.days ?? 7},"day")))`;
          description = `Records where ${params.field} is within ±${params.days ?? 7} days of today`;
          break;
        case "days_until":
          formula = `DATETIME_DIFF(${f},TODAY(),"day")`;
          description = `Days from today until ${params.field}`;
          break;
        case "days_since":
          formula = `DATETIME_DIFF(TODAY(),${f},"day")`;
          description = `Days since ${params.field}`;
          break;
        case "format_date":
          formula = `DATETIME_FORMAT(${f},"${params.format ?? "M/D/YYYY"}")`;
          description = `Format ${params.field} as ${params.format ?? "M/D/YYYY"}`;
          break;
        case "date_diff":
          formula = `DATETIME_DIFF(${fieldRef("End Date")},${fieldRef("Start Date")},"${params.unit ?? "day"}")`;
          description = `Difference between two date fields in ${params.unit ?? "day"}s`;
          break;
        case "date_add":
          formula = `DATEADD(${f},${params.days ?? 7},"${params.unit ?? "day"}")`;
          description = `Add ${params.days ?? 7} ${params.unit ?? "day"}s to ${params.field}`;
          break;
        default:
          formula = `IS_SAME(${f},TODAY(),"day")`;
          description = "Date comparison";
      }

      const response = { formula, description, operation: params.operation };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    build_text_formula: async (args) => {
      const params = BuildTextFormulaSchema.parse(args);
      const fields = params.fields ?? [];
      let formula = "";
      let description = "";

      switch (params.operation) {
        case "concatenate":
          formula = `CONCATENATE(${fields.map((f) => fieldRef(f)).join(`,"${params.separator ?? " "}",`)})`;
          description = `Concatenate ${fields.join(", ")} with "${params.separator ?? " "}"`;
          break;
        case "search":
          formula = `SEARCH("${params.search_text ?? ""}",${fieldRef(fields[0] ?? "Name")})`;
          description = `Find position of "${params.search_text}" in ${fields[0] ?? "Name"}`;
          break;
        case "replace":
          formula = `SUBSTITUTE(${fieldRef(fields[0] ?? "Name")},"${params.search_text ?? ""}","${params.replace_text ?? ""}")`;
          description = `Replace "${params.search_text}" with "${params.replace_text}" in ${fields[0]}`;
          break;
        case "trim":
          formula = `TRIM(${fieldRef(fields[0] ?? "Name")})`;
          description = `Remove leading/trailing whitespace from ${fields[0]}`;
          break;
        case "upper":
          formula = `UPPER(${fieldRef(fields[0] ?? "Name")})`;
          description = `Convert ${fields[0]} to uppercase`;
          break;
        case "lower":
          formula = `LOWER(${fieldRef(fields[0] ?? "Name")})`;
          description = `Convert ${fields[0]} to lowercase`;
          break;
        case "left":
          formula = `LEFT(${fieldRef(fields[0] ?? "Name")},${params.count ?? 5})`;
          description = `First ${params.count ?? 5} characters of ${fields[0]}`;
          break;
        case "right":
          formula = `RIGHT(${fieldRef(fields[0] ?? "Name")},${params.count ?? 5})`;
          description = `Last ${params.count ?? 5} characters of ${fields[0]}`;
          break;
        case "mid":
          formula = `MID(${fieldRef(fields[0] ?? "Name")},${params.start ?? 1},${params.count ?? 5})`;
          description = `${params.count ?? 5} chars from position ${params.start ?? 1} in ${fields[0]}`;
          break;
        case "len":
          formula = `LEN(${fieldRef(fields[0] ?? "Name")})`;
          description = `Length of ${fields[0]}`;
          break;
        case "contains_word":
          formula = `FIND("${params.search_text ?? ""}",LOWER(${fieldRef(fields[0] ?? "Name")}))>0`;
          description = `Check if ${fields[0]} contains word "${params.search_text}"`;
          break;
        case "regex_match":
          formula = `REGEX_MATCH(${fieldRef(fields[0] ?? "Name")},"${params.pattern ?? ".*"}")`;
          description = `Match ${fields[0]} against regex pattern "${params.pattern}"`;
          break;
        case "is_email":
          formula = `REGEX_MATCH(${fieldRef(fields[0] ?? "Email")},"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$")`;
          description = `Validate ${fields[0]} is a valid email address`;
          break;
        case "is_url":
          formula = `REGEX_MATCH(${fieldRef(fields[0] ?? "URL")},"^https?://")`;
          description = `Validate ${fields[0]} starts with http:// or https://`;
          break;
        default:
          formula = `TRIM(${fieldRef(fields[0] ?? "Name")})`;
          description = "Text operation";
      }

      const response = { formula, description };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    build_numeric_formula: async (args) => {
      const params = BuildNumericFormulaSchema.parse(args);
      const fields = params.fields ?? [];
      const f = fieldRef(params.field ?? fields[0] ?? "Value");
      let formula = "";
      let description = "";

      switch (params.operation) {
        case "sum":
          formula = fields.length > 1 ? `${fields.map((fld) => fieldRef(fld)).join("+")}` : f;
          description = `Sum of ${fields.join(" + ")}`;
          break;
        case "average":
          formula = fields.length > 1
            ? `(${fields.map((fld) => fieldRef(fld)).join("+")})/${fields.length}`
            : f;
          description = `Average of ${fields.join(", ")}`;
          break;
        case "min":
          formula = `MIN(${fields.map((fld) => fieldRef(fld)).join(",")})`;
          description = `Minimum of ${fields.join(", ")}`;
          break;
        case "max":
          formula = `MAX(${fields.map((fld) => fieldRef(fld)).join(",")})`;
          description = `Maximum of ${fields.join(", ")}`;
          break;
        case "round":
          formula = `ROUND(${f},${params.decimals ?? 2})`;
          description = `Round ${params.field} to ${params.decimals ?? 2} decimal places`;
          break;
        case "ceil":
          formula = `CEILING(${f},1)`;
          description = `Round ${params.field} up to nearest integer`;
          break;
        case "floor":
          formula = `FLOOR(${f},1)`;
          description = `Round ${params.field} down to nearest integer`;
          break;
        case "abs":
          formula = `ABS(${f})`;
          description = `Absolute value of ${params.field}`;
          break;
        case "power":
          formula = `POWER(${f},${params.value ?? 2})`;
          description = `${params.field} raised to the power of ${params.value ?? 2}`;
          break;
        case "sqrt":
          formula = `SQRT(${f})`;
          description = `Square root of ${params.field}`;
          break;
        case "mod":
          formula = `MOD(${f},${params.value ?? 2})`;
          description = `${params.field} modulo ${params.value ?? 2}`;
          break;
        case "int":
          formula = `INT(${f})`;
          description = `Integer part of ${params.field}`;
          break;
        case "percentage":
          formula = `ROUND(${f}/100*${params.value ?? 100},${params.decimals ?? 2})`;
          description = `${params.value ?? 100}% of ${params.field}`;
          break;
        case "clamp":
          formula = `MIN(MAX(${f},${params.min_value ?? 0}),${params.max_value ?? 100})`;
          description = `Clamp ${params.field} between ${params.min_value ?? 0} and ${params.max_value ?? 100}`;
          break;
        default:
          formula = f;
          description = "Numeric operation";
      }

      const response = { formula, description };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_formula_templates: async (args) => {
      const params = GetFormulaTemplatesSchema.parse(args);

      const allTemplates: { category: string; name: string; formula: string; description: string; example: string }[] = [
        // Filtering
        { category: "filtering", name: "Active records", formula: "{Status}=\"Active\"", description: "Filter records where Status is Active", example: "list_records with filterByFormula" },
        { category: "filtering", name: "Non-blank field", formula: "NOT(BLANK({Email}))", description: "Records where Email is filled", example: "Find contacts with email addresses" },
        { category: "filtering", name: "Multiple conditions", formula: "AND({Status}=\"Active\",{Score}>80)", description: "Records matching all conditions", example: "Active records with high score" },
        { category: "filtering", name: "Any of multiple values", formula: "OR({Priority}=\"High\",{Priority}=\"Critical\")", description: "Records matching any value", example: "High or critical priority items" },
        { category: "filtering", name: "Text contains", formula: "FIND(\"keyword\",LOWER({Name}))>0", description: "Case-insensitive text search", example: "Search by keyword in name" },
        // Dates
        { category: "dates", name: "Due today", formula: "IS_SAME({Due Date},TODAY(),\"day\")", description: "Records due today", example: "Daily tasks" },
        { category: "dates", name: "Overdue", formula: "AND(IS_BEFORE({Due Date},TODAY()),NOT(BLANK({Due Date})))", description: "Past due records", example: "Overdue tasks filter" },
        { category: "dates", name: "Due this week", formula: "AND(IS_AFTER({Due Date},DATEADD(TODAY(),-1,\"day\")),IS_BEFORE({Due Date},DATEADD(TODAY(),7,\"day\")))", description: "Due within next 7 days", example: "Weekly planning" },
        { category: "dates", name: "Created this month", formula: "AND(MONTH(CREATED_TIME())=MONTH(TODAY()),YEAR(CREATED_TIME())=YEAR(TODAY()))", description: "Records created this month", example: "Monthly reporting" },
        { category: "dates", name: "Days until due", formula: "DATETIME_DIFF({Due Date},TODAY(),\"day\")", description: "Days remaining until due date", example: "Days remaining countdown" },
        // Text
        { category: "text", name: "Full name", formula: "CONCATENATE({First Name},\" \",{Last Name})", description: "Combine first and last name", example: "Display full name" },
        { category: "text", name: "Email domain", formula: "MID({Email},FIND(\"@\",{Email})+1,LEN({Email}))", description: "Extract domain from email", example: "Group by company domain" },
        { category: "text", name: "Truncate text", formula: "IF(LEN({Description})>100,LEFT({Description},97)&\"...\",{Description})", description: "Truncate long text with ellipsis", example: "Card preview text" },
        { category: "text", name: "Title case", formula: "PROPER({Name})", description: "Convert to title case", example: "Normalize names" },
        { category: "text", name: "Slug from name", formula: "LOWER(SUBSTITUTE(SUBSTITUTE(TRIM({Name}),\" \",\"-\"),\"&\",\"and\"))", description: "URL-friendly slug", example: "Generate URL slugs" },
        // Numeric
        { category: "numeric", name: "Percentage complete", formula: "ROUND({Completed}/{Total}*100,1)&\"%\"", description: "Completion percentage", example: "Progress display" },
        { category: "numeric", name: "Grade letter", formula: "IF({Score}>=90,\"A\",IF({Score}>=80,\"B\",IF({Score}>=70,\"C\",IF({Score}>=60,\"D\",\"F\"))))", description: "Convert score to letter grade", example: "Grade calculation" },
        { category: "numeric", name: "Revenue estimate", formula: "ROUND({Probability}/100*{Deal Value},2)", description: "Weighted revenue estimate", example: "CRM deal scoring" },
        { category: "numeric", name: "Age from birthdate", formula: "DATETIME_DIFF(TODAY(),{Birth Date},\"year\")", description: "Calculate age in years", example: "Customer age" },
        // Conditionals
        { category: "conditionals", name: "Status badge", formula: "IF({Done},\"✓ Complete\",IF({In Progress},\"⟳ In Progress\",\"○ Not Started\"))", description: "Multi-state status display", example: "Task status icon" },
        { category: "conditionals", name: "Priority score", formula: "IF({Priority}=\"Critical\",4,IF({Priority}=\"High\",3,IF({Priority}=\"Medium\",2,1)))", description: "Convert priority to numeric", example: "Sort by priority number" },
        { category: "conditionals", name: "Null coalesce", formula: "IF(BLANK({Preferred Name}),{First Name},{Preferred Name})", description: "Use fallback when field is blank", example: "Display preferred or default" },
        // Validation
        { category: "validation", name: "Valid email", formula: "REGEX_MATCH({Email},\"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$\")", description: "Validate email format", example: "Data quality check" },
        { category: "validation", name: "Valid US phone", formula: "REGEX_MATCH(REGEX_REPLACE({Phone},\"[^0-9]\",\"\"),\"^[0-9]{10}$\")", description: "Validate 10-digit US phone", example: "Phone validation" },
        { category: "validation", name: "Required fields filled", formula: "AND(NOT(BLANK({Name})),NOT(BLANK({Email})),NOT(BLANK({Status}))", description: "Check all required fields", example: "Completeness check" },
        // Aggregations
        { category: "aggregations", name: "Count linked", formula: "COUNT({Related Tasks})", description: "Count linked records", example: "Number of related tasks" },
        { category: "aggregations", name: "Sum linked values", formula: "SUM({Line Items})", description: "Sum values from linked/rollup field", example: "Total order value" },
      ];

      const category = params.category ?? "all";
      const filtered = category === "all" ? allTemplates : allTemplates.filter((t) => t.category === category);

      const response = { templates: filtered, count: filtered.length, category };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    explain_formula: async (args) => {
      const params = ExplainFormulaSchema.parse(args);
      const formula = params.formula;

      // Extract Airtable functions
      const functionMatches = formula.match(/[A-Z_]+(?=\()/g) ?? [];
      const functions = [...new Set(functionMatches)];

      // Extract field references
      const fieldMatches = formula.match(/\{([^}]+)\}/g) ?? [];
      const fields = [...new Set(fieldMatches.map((f) => f.slice(1, -1)))];

      // Determine complexity
      const nestedDepth = (formula.match(/\(/g) ?? []).length;
      const complexity = nestedDepth <= 2 ? "simple" : nestedDepth <= 5 ? "moderate" : "complex";

      // Build explanation
      const parts: string[] = [];
      if (functions.includes("IF")) parts.push("contains conditional logic (IF)");
      if (functions.includes("AND") || functions.includes("OR")) parts.push(`uses ${functions.filter((f) => ["AND", "OR", "NOT"].includes(f)).join("/")} logical operators`);
      if (functions.includes("DATETIME_DIFF") || functions.includes("DATEADD") || functions.includes("TODAY")) parts.push("performs date calculations");
      if (functions.includes("FIND") || functions.includes("SEARCH") || functions.includes("SUBSTITUTE") || functions.includes("CONCATENATE")) parts.push("manipulates text");
      if (functions.includes("SUM") || functions.includes("COUNT") || functions.includes("AVERAGE")) parts.push("aggregates values");
      if (functions.includes("ROUND") || functions.includes("FLOOR") || functions.includes("CEILING")) parts.push("rounds numbers");
      if (fields.length > 0) parts.push(`references ${fields.length} field(s): ${fields.join(", ")}`);

      const explanation = parts.length > 0
        ? `This formula ${parts.join("; ")}.`
        : `This formula applies ${functions.join(", ")} operations.`;

      const response = {
        formula,
        explanation,
        functions,
        fields,
        complexity,
        functionCount: functions.length,
        fieldCount: fields.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
