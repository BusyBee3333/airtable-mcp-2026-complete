// Airtable Interfaces tools: list_interfaces
// Airtable Interfaces are page-based views built on top of tables.
// The Airtable public REST API does not currently expose a dedicated interfaces endpoint.
// This tool surfaces interface metadata available via the Metadata API (interfaces appear
// as view types in some plans) and provides structured information.
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListInterfacesSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  include_page_details: z.boolean().optional().default(false).describe("If true, include detailed page/section metadata for each interface (if available via API)"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_interfaces",
      title: "List Interfaces",
      description:
        "List Airtable Interfaces associated with a base. Airtable Interfaces are collaborative, page-based UIs built on top of tables. This tool queries the Metadata API and identifies interface-type views across all tables in the base. Returns interface names, IDs, associated table, and type. Note: Full Interface management (create/edit/delete interface pages) is not yet available in the public Airtable API — this tool surfaces what is accessible.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          include_page_details: { type: "boolean", description: "Include detailed view metadata for each interface (default: false)" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          interfaces: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                tableId: { type: "string" },
                tableName: { type: "string" },
              },
            },
          },
          totalInterfaces: { type: "number" },
          baseTables: { type: "number" },
          apiNote: { type: "string" },
        },
        required: ["interfaces", "totalInterfaces"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_interfaces: async (args) => {
      const { base_id, include_page_details } = ListInterfacesSchema.parse(args);

      const result = await logger.time("tool.list_interfaces", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "list_interfaces", base_id });

      const raw = result as {
        tables?: Array<{
          id: string;
          name: string;
          views?: Array<{
            id: string;
            name: string;
            type: string;
            [key: string]: unknown;
          }>;
          [key: string]: unknown;
        }>;
      };

      const allTables = raw.tables ?? [];

      // Interface views surface as type "interface" in the Metadata API
      // (available in Airtable Pro/Business plans)
      const interfaceViews: Array<{
        id: string;
        name: string;
        type: string;
        tableId: string;
        tableName: string;
        details?: unknown;
      }> = [];

      for (const table of allTables) {
        const views = table.views ?? [];
        for (const view of views) {
          if (view.type === "interface") {
            interfaceViews.push({
              id: view.id,
              name: view.name,
              type: view.type,
              tableId: table.id,
              tableName: table.name,
              ...(include_page_details ? { details: view } : {}),
            });
          }
        }
      }

      const response = {
        interfaces: interfaceViews,
        totalInterfaces: interfaceViews.length,
        baseTables: allTables.length,
        apiNote:
          "Airtable Interfaces are returned as view type 'interface' from the Metadata API. Full Interface API (create/edit/delete interface pages) is not yet publicly available. For full Interface management, use the Airtable web app.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },
  };

  return { tools, handlers };
}
