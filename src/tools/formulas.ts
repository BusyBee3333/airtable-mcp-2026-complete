// Airtable Formula tools: validate_formula, list_formula_functions, calculate_formula
// Validates by issuing a filterByFormula request — if Airtable accepts it, formula is valid.
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ValidateFormulaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name to validate the formula against"),
  formula: z.string().describe("Airtable formula expression to validate. Example: AND({Status}='Active',{Score}>80)"),
});

const ListFormulaFunctionsSchema = z.object({
  category: z.enum(["all", "text", "numeric", "date", "logical", "record", "array", "lookup", "regex"]).optional().default("all").describe("Category to filter functions (default: all)"),
});

const CalculateFormulaSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec') to evaluate the formula against"),
  formula: z.string().describe("Airtable formula expression. Use {FieldName} to reference fields. Example: CONCATENATE({First Name},' ',{Last Name})"),
  return_field_alias: z.string().optional().default("__result__").describe("Alias name for the formula result field (default: __result__)"),
});

// ============ Formula function reference ============

const FORMULA_FUNCTIONS = [
  // Text
  { name: "CONCATENATE", category: "text", signature: "CONCATENATE(str1, str2, ...)", description: "Joins text strings together. Example: CONCATENATE({First Name},' ',{Last Name})" },
  { name: "FIND", category: "text", signature: "FIND(searchFor, whereToSearch, [startFromPosition])", description: "Returns position of searchFor in whereToSearch (1-based). Returns 0 if not found." },
  { name: "SEARCH", category: "text", signature: "SEARCH(searchFor, whereToSearch, [startFromPosition])", description: "Like FIND but case-insensitive. Returns 0 if not found." },
  { name: "LEN", category: "text", signature: "LEN(string)", description: "Returns the number of characters in a string." },
  { name: "LEFT", category: "text", signature: "LEFT(string, numChars)", description: "Returns the first numChars characters of string." },
  { name: "RIGHT", category: "text", signature: "RIGHT(string, numChars)", description: "Returns the last numChars characters of string." },
  { name: "MID", category: "text", signature: "MID(string, startPos, numChars)", description: "Returns numChars characters from string starting at startPos." },
  { name: "LOWER", category: "text", signature: "LOWER(string)", description: "Converts string to lowercase." },
  { name: "UPPER", category: "text", signature: "UPPER(string)", description: "Converts string to uppercase." },
  { name: "TRIM", category: "text", signature: "TRIM(string)", description: "Removes leading and trailing spaces from string." },
  { name: "SUBSTITUTE", category: "text", signature: "SUBSTITUTE(string, oldText, newText, [occurrence])", description: "Replaces oldText with newText in string." },
  { name: "REPLACE", category: "text", signature: "REPLACE(string, startPos, numChars, replacement)", description: "Replaces part of a string with replacement text." },
  { name: "REPT", category: "text", signature: "REPT(string, times)", description: "Repeats string the specified number of times." },
  { name: "T", category: "text", signature: "T(value)", description: "Returns the value if it's text, empty string otherwise." },
  { name: "ENCODE_URL_COMPONENT", category: "text", signature: "ENCODE_URL_COMPONENT(string)", description: "URL-encodes a string." },
  { name: "REGEX_MATCH", category: "regex", signature: "REGEX_MATCH(string, regex)", description: "Returns 1 if string matches regex, 0 otherwise." },
  { name: "REGEX_EXTRACT", category: "regex", signature: "REGEX_EXTRACT(string, regex)", description: "Returns first match of regex in string." },
  { name: "REGEX_REPLACE", category: "regex", signature: "REGEX_REPLACE(string, regex, replacement)", description: "Replaces regex matches in string with replacement." },
  // Numeric
  { name: "ABS", category: "numeric", signature: "ABS(number)", description: "Returns the absolute value of a number." },
  { name: "CEILING", category: "numeric", signature: "CEILING(number, significance)", description: "Rounds number up to nearest multiple of significance." },
  { name: "FLOOR", category: "numeric", signature: "FLOOR(number, significance)", description: "Rounds number down to nearest multiple of significance." },
  { name: "ROUND", category: "numeric", signature: "ROUND(number, precision)", description: "Rounds number to precision decimal places." },
  { name: "ROUNDUP", category: "numeric", signature: "ROUNDUP(number, precision)", description: "Rounds number up to precision decimal places." },
  { name: "ROUNDDOWN", category: "numeric", signature: "ROUNDDOWN(number, precision)", description: "Rounds number down to precision decimal places." },
  { name: "INT", category: "numeric", signature: "INT(number)", description: "Returns the integer part of a number (floor for positives)." },
  { name: "MOD", category: "numeric", signature: "MOD(dividend, divisor)", description: "Returns the remainder of division." },
  { name: "POWER", category: "numeric", signature: "POWER(base, exponent)", description: "Returns base raised to exponent." },
  { name: "SQRT", category: "numeric", signature: "SQRT(number)", description: "Returns the square root of a number." },
  { name: "SUM", category: "numeric", signature: "SUM(num1, num2, ...)", description: "Returns the sum of all arguments." },
  { name: "AVERAGE", category: "numeric", signature: "AVERAGE(num1, num2, ...)", description: "Returns the average of all arguments." },
  { name: "MAX", category: "numeric", signature: "MAX(num1, num2, ...)", description: "Returns the largest value." },
  { name: "MIN", category: "numeric", signature: "MIN(num1, num2, ...)", description: "Returns the smallest value." },
  { name: "COUNT", category: "numeric", signature: "COUNT(num1, num2, ...)", description: "Returns count of numeric values." },
  { name: "COUNTA", category: "numeric", signature: "COUNTA(val1, val2, ...)", description: "Returns count of non-empty values." },
  { name: "COUNTALL", category: "numeric", signature: "COUNTALL(val1, val2, ...)", description: "Returns count of all values including empty." },
  { name: "LOG", category: "numeric", signature: "LOG(number, base)", description: "Returns logarithm of number in given base." },
  { name: "EXP", category: "numeric", signature: "EXP(number)", description: "Returns e raised to the power of number." },
  { name: "EVEN", category: "numeric", signature: "EVEN(number)", description: "Rounds number up to the nearest even integer." },
  { name: "ODD", category: "numeric", signature: "ODD(number)", description: "Rounds number up to the nearest odd integer." },
  { name: "VALUE", category: "numeric", signature: "VALUE(text)", description: "Converts text to number." },
  { name: "NUMBER_FORMAT", category: "numeric", signature: "NUMBER_FORMAT(number, format)", description: "Formats a number as text using a format string." },
  // Date/Time
  { name: "NOW", category: "date", signature: "NOW()", description: "Returns the current date and time." },
  { name: "TODAY", category: "date", signature: "TODAY()", description: "Returns today's date (midnight)." },
  { name: "YEAR", category: "date", signature: "YEAR(date)", description: "Returns the 4-digit year of a date." },
  { name: "MONTH", category: "date", signature: "MONTH(date)", description: "Returns the month (1-12) of a date." },
  { name: "DAY", category: "date", signature: "DAY(date)", description: "Returns the day of the month (1-31)." },
  { name: "HOUR", category: "date", signature: "HOUR(datetime)", description: "Returns the hour (0-23) of a datetime." },
  { name: "MINUTE", category: "date", signature: "MINUTE(datetime)", description: "Returns the minute (0-59) of a datetime." },
  { name: "SECOND", category: "date", signature: "SECOND(datetime)", description: "Returns the second (0-59) of a datetime." },
  { name: "WEEKDAY", category: "date", signature: "WEEKDAY(date, [startDayOfWeek])", description: "Returns day of week (0=Sunday by default)." },
  { name: "WEEKNUM", category: "date", signature: "WEEKNUM(date, [startDayOfWeek])", description: "Returns ISO week number of the year." },
  { name: "DATEADD", category: "date", signature: "DATEADD(date, amount, unit)", description: "Adds amount of unit to date. Units: 'days','weeks','months','years','hours','minutes','seconds'." },
  { name: "DATETIME_DIFF", category: "date", signature: "DATETIME_DIFF(date1, date2, unit)", description: "Returns the difference between two dates in the specified unit." },
  { name: "DATETIME_FORMAT", category: "date", signature: "DATETIME_FORMAT(date, format)", description: "Formats a date as text using a moment.js format string." },
  { name: "DATETIME_PARSE", category: "date", signature: "DATETIME_PARSE(date, [format], [locale])", description: "Parses a text string into a date using an optional format." },
  { name: "DATE_SAME", category: "date", signature: "DATE_SAME(date1, date2, unit)", description: "Returns 1 if two dates are the same in the given unit." },
  { name: "IS_AFTER", category: "date", signature: "IS_AFTER(date1, date2)", description: "Returns 1 if date1 is after date2." },
  { name: "IS_BEFORE", category: "date", signature: "IS_BEFORE(date1, date2)", description: "Returns 1 if date1 is before date2." },
  { name: "IS_SAME", category: "date", signature: "IS_SAME(date1, date2, unit)", description: "Returns 1 if the two dates are the same in the specified granularity." },
  { name: "CREATED_TIME", category: "date", signature: "CREATED_TIME()", description: "Returns the creation time of the record." },
  { name: "LAST_MODIFIED_TIME", category: "date", signature: "LAST_MODIFIED_TIME([field1,field2,...])", description: "Returns the last modification time of the record or specified fields." },
  // Logical
  { name: "IF", category: "logical", signature: "IF(condition, ifTrue, ifFalse)", description: "Returns ifTrue if condition is truthy, ifFalse otherwise." },
  { name: "AND", category: "logical", signature: "AND(condition1, condition2, ...)", description: "Returns 1 if all conditions are true." },
  { name: "OR", category: "logical", signature: "OR(condition1, condition2, ...)", description: "Returns 1 if any condition is true." },
  { name: "NOT", category: "logical", signature: "NOT(condition)", description: "Returns 1 if condition is false, 0 if true." },
  { name: "XOR", category: "logical", signature: "XOR(condition1, condition2, ...)", description: "Returns 1 if an odd number of conditions are true." },
  { name: "SWITCH", category: "logical", signature: "SWITCH(value, case1, result1, [case2, result2, ...], [default])", description: "Returns the result for the first matching case." },
  { name: "BLANK", category: "logical", signature: "BLANK()", description: "Returns an empty/blank value." },
  { name: "ERROR", category: "logical", signature: "ERROR(message)", description: "Returns an error with the given message." },
  { name: "ISERROR", category: "logical", signature: "ISERROR(value)", description: "Returns 1 if value is an error." },
  { name: "IFERROR", category: "logical", signature: "IFERROR(value, valueIfError)", description: "Returns valueIfError if value is an error, otherwise value." },
  { name: "IS_BEFORE", category: "logical", signature: "IS_BEFORE(date1, date2)", description: "Returns 1 if date1 is strictly before date2." },
  // Record/Lookup
  { name: "RECORD_ID", category: "record", signature: "RECORD_ID()", description: "Returns the record ID of the current record." },
  { name: "FIELD", category: "record", signature: "FIELD(fieldName)", description: "Returns the value of the field with the given name (dynamic lookup)." },
  { name: "LOOKUP", category: "lookup", signature: "LOOKUP(linkedRecordField, lookupField)", description: "Returns values from a field in linked records." },
  { name: "ROLLUP", category: "lookup", signature: "ROLLUP(linkedField, expression)", description: "Aggregates values from linked records using an expression." },
  // Array
  { name: "ARRAYJOIN", category: "array", signature: "ARRAYJOIN(array, [separator])", description: "Joins array elements into a string with optional separator." },
  { name: "ARRAYUNIQUE", category: "array", signature: "ARRAYUNIQUE(array)", description: "Returns unique elements of an array." },
  { name: "ARRAYFLAT", category: "array", signature: "ARRAYFLAT(array)", description: "Flattens nested arrays." },
  { name: "ARRAYCOMPACT", category: "array", signature: "ARRAYCOMPACT(array)", description: "Removes empty values from an array." },
  { name: "ARRAY_CONCAT", category: "array", signature: "ARRAY_CONCAT(array1, array2, ...)", description: "Concatenates multiple arrays." },
];

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "validate_formula",
      title: "Validate Airtable Formula",
      description:
        "Validate an Airtable formula expression by testing it against a real table. Sends the formula as a filterByFormula request — if Airtable accepts it without error, the formula is valid. Returns whether it's valid, any error message, and the number of matching records if valid. Use before storing or using formulas in fields or automations.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table to validate the formula against" },
          formula: { type: "string", description: "Formula to validate. Examples: {Status}='Active', AND({Score}>80,NOT(BLANK({Email})))" },
        },
        required: ["base_id", "table_id_or_name", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          valid: { type: "boolean" },
          formula: { type: "string" },
          matchingRecords: { type: "number" },
          error: { type: "string" },
        },
        required: ["valid", "formula"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_formula_functions",
      title: "List Airtable Formula Functions",
      description:
        "Returns a reference of all supported Airtable formula functions with their signatures, categories, and descriptions. Categories: text, numeric, date, logical, record, array, lookup, regex. Use when constructing formulas or to discover available functions.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Filter by category: all, text, numeric, date, logical, record, array, lookup, regex (default: all)" },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        properties: {
          functions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                signature: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          totalCount: { type: "number" },
        },
        required: ["functions", "totalCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "calculate_formula",
      title: "Calculate Formula Against Record",
      description:
        "Run an Airtable formula expression against a specific record and return the computed result. Works by using the formula as a filterByFormula on the specific record ID. Returns whether the formula evaluates to truthy/falsy for that record, useful for debugging formula logic. For actual computed values (like CONCATENATE), use create_formula_field.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec') to evaluate against" },
          formula: { type: "string", description: "Formula expression. Example: AND({Status}='Active',{Score}>80)" },
          return_field_alias: { type: "string", description: "Alias for result field name (default: __result__)" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "formula"],
      },
      outputSchema: {
        type: "object",
        properties: {
          recordId: { type: "string" },
          formula: { type: "string" },
          matchesFilter: { type: "boolean" },
          record: { type: "object" },
        },
        required: ["recordId", "formula", "matchesFilter"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    validate_formula: async (args) => {
      const { base_id, table_id_or_name, formula } = ValidateFormulaSchema.parse(args);

      // Test the formula by using it as filterByFormula — if API returns an error, it's invalid
      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", formula);
      queryParams.set("maxRecords", "1"); // We only need to check if it parses, not get all records
      queryParams.set("pageSize", "1");

      try {
        const result = await logger.time("tool.validate_formula", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
        , { tool: "validate_formula", base_id, formula: formula.substring(0, 80) });

        const raw = result as { records?: unknown[] };
        const response = {
          valid: true,
          formula,
          matchingRecords: raw.records?.length ?? 0,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const response = {
          valid: false,
          formula,
          error: errorMessage,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
        };
      }
    },

    list_formula_functions: async (args) => {
      const { category } = ListFormulaFunctionsSchema.parse(args);

      const filtered = category === "all"
        ? FORMULA_FUNCTIONS
        : FORMULA_FUNCTIONS.filter((f) => f.category === category);

      // Deduplicate by name (some appear in multiple categories)
      const seen = new Set<string>();
      const deduplicated = filtered.filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      });

      const response = {
        functions: deduplicated,
        totalCount: deduplicated.length,
        categories: ["text", "numeric", "date", "logical", "record", "array", "lookup", "regex"],
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    calculate_formula: async (args) => {
      const { base_id, table_id_or_name, record_id, formula } = CalculateFormulaSchema.parse(args);

      // Use RECORD_ID() to target the specific record and apply the formula as a compound filter
      const targetFormula = `AND(RECORD_ID()='${record_id}',${formula})`;
      const queryParams = new URLSearchParams();
      queryParams.set("filterByFormula", targetFormula);
      queryParams.set("maxRecords", "1");
      queryParams.set("pageSize", "1");

      try {
        const result = await logger.time("tool.calculate_formula", () =>
          client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${queryParams}`)
        , { tool: "calculate_formula", base_id, record_id, formula: formula.substring(0, 80) });

        const raw = result as { records?: Array<{ id: string; createdTime: string; fields: Record<string, unknown> }> };
        const matchesFilter = (raw.records?.length ?? 0) > 0;
        const record = raw.records?.[0] ?? null;

        const response = {
          recordId: record_id,
          formula,
          matchesFilter,
          record,
          explanation: matchesFilter
            ? "Formula evaluated to true/truthy for this record"
            : "Formula evaluated to false/falsy or zero for this record",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const response = {
          recordId: record_id,
          formula,
          matchesFilter: false,
          error: errorMessage,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
          structuredContent: response,
        };
      }
    },
  };

  return { tools, handlers };
}
