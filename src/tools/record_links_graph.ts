// Airtable Record Links Graph tools: build_record_graph, get_dependency_tree,
//   find_orphaned_records, get_link_depth_map, analyze_link_patterns,
//   get_relationship_summary
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BuildRecordGraphSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Starting table ID or name"),
  max_records: z.number().min(1).max(200).optional().default(50).describe("Max records to include in graph"),
  include_linked_tables: z.boolean().optional().default(true).describe("Whether to fetch and include linked table records"),
});

const GetDependencyTreeSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Root record ID to build tree from"),
  link_field_names: z.array(z.string()).min(1).describe("List of link field names to traverse for dependencies"),
  max_depth: z.number().min(1).max(5).optional().default(3),
});

const FindOrphanedRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table to check for orphaned records"),
  required_link_field: z.string().describe("Link field that must have at least one linked record"),
});

const AnalyzeLinkPatternsSchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
  table_id_or_name: z.string().describe("Table to analyze"),
  link_field_name: z.string().describe("Link field to analyze"),
  max_records: z.number().optional().default(200),
});

const GetRelationshipSummarySchema = z.object({
  base_id: z.string().describe("Airtable base ID"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "build_record_graph",
      title: "Build Record Graph",
      description:
        "Build a relationship graph of records in a table, showing which records link to which. Returns nodes (records) and edges (links) in a graph structure. Useful for visualizing data relationships and detecting circular references.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          max_records: { type: "number", description: "Max records to include (default 50)" },
          include_linked_tables: { type: "boolean", description: "Include records from linked tables" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          nodes: { type: "array", items: { type: "object" } },
          edges: { type: "array", items: { type: "object" } },
          node_count: { type: "number" },
          edge_count: { type: "number" },
          link_fields: { type: "array", items: { type: "string" } },
        },
        required: ["nodes", "edges"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_dependency_tree",
      title: "Get Dependency Tree",
      description:
        "Build a dependency tree starting from a root record, traversing link fields recursively. Returns a hierarchical tree structure showing parent-child relationships. Useful for project dependencies, task hierarchies, or org charts.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          record_id: { type: "string" },
          link_field_names: { type: "array", items: { type: "string" }, description: "Link fields to traverse" },
          max_depth: { type: "number", description: "Max traversal depth (1-5, default 3)" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "link_field_names"],
      },
      outputSchema: {
        type: "object",
        properties: {
          root: { type: "object" },
          tree: { type: "object" },
          total_nodes: { type: "number" },
          max_depth_reached: { type: "number" },
        },
        required: ["root", "tree"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_orphaned_records",
      title: "Find Orphaned Records",
      description:
        "Find records that have no linked records in a specified link field — 'orphaned' records that should link to something but don't. Useful for data quality checks, finding tasks with no project, contacts with no account, etc.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          required_link_field: { type: "string", description: "Link field that should be non-empty" },
        },
        required: ["base_id", "table_id_or_name", "required_link_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          orphaned_records: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          link_field: { type: "string" },
        },
        required: ["orphaned_records", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "analyze_link_patterns",
      title: "Analyze Link Patterns",
      description:
        "Analyze how records use a link field — distribution of link counts, average links per record, records with most/fewest links, and overall link density statistics.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
          table_id_or_name: { type: "string" },
          link_field_name: { type: "string" },
          max_records: { type: "number", description: "Max records to analyze (default 200)" },
        },
        required: ["base_id", "table_id_or_name", "link_field_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          total_records: { type: "number" },
          records_with_links: { type: "number" },
          records_without_links: { type: "number" },
          avg_links_per_record: { type: "number" },
          max_links: { type: "number" },
          min_links: { type: "number" },
          link_count_distribution: { type: "object" },
          top_linked_records: { type: "array" },
        },
        required: ["total_records", "records_with_links"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_relationship_summary",
      title: "Get Relationship Summary",
      description:
        "Get a complete summary of all linked-record relationships across an entire Airtable base — which tables link to which, relationship types, and an overall relationship map.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string" },
        },
        required: ["base_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          relationships: { type: "array", items: { type: "object" } },
          table_count: { type: "number" },
          total_link_fields: { type: "number" },
          relationship_matrix: { type: "object" },
        },
        required: ["relationships"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    build_record_graph: async (args) => {
      const { base_id, table_id_or_name, max_records } = BuildRecordGraphSchema.parse(args);

      const schema = await client.get(`/v0/meta/bases/${base_id}/tables`) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }> };
      const table = schema.tables.find((t) => t.id === table_id_or_name || t.name === table_id_or_name);
      if (!table) throw new Error(`Table '${table_id_or_name}' not found`);

      const linkFields = table.fields.filter((f) => f.type === "multipleRecordLinks");
      const fieldNames = linkFields.map((f) => f.name);

      const params = new URLSearchParams({ pageSize: String(Math.min(max_records ?? 50, 100)) });
      fieldNames.forEach((fn) => params.append("fields[]", fn));

      const result = await logger.time("tool.build_record_graph", () =>
        client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`)
      , { tool: "build_record_graph" }) as { records: Array<{ id: string; fields: Record<string, unknown> }> };

      const nodes = result.records.map((r) => ({ id: r.id, table: table.name, fields: r.fields }));
      const edges: Array<{ source: string; target: string; field: string }> = [];

      for (const rec of result.records) {
        for (const f of linkFields) {
          const linked = (rec.fields[f.name] as string[] | undefined) ?? [];
          for (const lid of linked) {
            edges.push({ source: rec.id, target: lid, field: f.name });
          }
        }
      }

      const data = {
        nodes,
        edges,
        node_count: nodes.length,
        edge_count: edges.length,
        link_fields: fieldNames,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_dependency_tree: async (args) => {
      const { base_id, table_id_or_name, record_id, link_field_names, max_depth } = GetDependencyTreeSchema.parse(args);

      type TreeNode = { id: string; fields: Record<string, unknown>; children: Record<string, TreeNode[]> };

      async function buildTree(id: string, depth: number): Promise<TreeNode | null> {
        if (depth <= 0) return null;
        const rec = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${id}`) as { id: string; fields: Record<string, unknown> };
        const node: TreeNode = { id: rec.id, fields: rec.fields, children: {} };

        for (const fieldName of link_field_names) {
          const linkedIds = (rec.fields[fieldName] as string[] | undefined) ?? [];
          const children: TreeNode[] = [];
          for (const lid of linkedIds.slice(0, 10)) {
            const child = await buildTree(lid, depth - 1);
            if (child) children.push(child);
          }
          if (children.length > 0) node.children[fieldName] = children;
        }

        return node;
      }

      const rootRec = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}/${record_id}`) as { id: string; fields: Record<string, unknown> };
      const tree = await buildTree(record_id, max_depth ?? 3);

      let totalNodes = 0;
      function countNodes(node: TreeNode | null): void {
        if (!node) return;
        totalNodes++;
        for (const children of Object.values(node.children)) {
          for (const child of children) countNodes(child);
        }
      }
      countNodes(tree);

      const data = { root: rootRec, tree, total_nodes: totalNodes, max_depth_reached: max_depth ?? 3 };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    find_orphaned_records: async (args) => {
      const { base_id, table_id_or_name, required_link_field } = FindOrphanedRecordsSchema.parse(args);

      const formula = `{${required_link_field}}=''`;
      const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });

      const allOrphans: unknown[] = [];
      let offset: string | undefined;
      do {
        if (offset) params.set("offset", offset);
        const result = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`) as { records: unknown[]; offset?: string };
        allOrphans.push(...(result.records || []));
        offset = result.offset;
      } while (offset);

      const data = { orphaned_records: allOrphans, count: allOrphans.length, link_field: required_link_field };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    analyze_link_patterns: async (args) => {
      const { base_id, table_id_or_name, link_field_name, max_records } = AnalyzeLinkPatternsSchema.parse(args);

      const params = new URLSearchParams({ pageSize: "100", "fields[]": link_field_name });
      const allRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];
      let offset: string | undefined;
      let fetched = 0;

      do {
        if (offset) params.set("offset", offset);
        const result = await client.get(`/v0/${base_id}/${encodeURIComponent(table_id_or_name)}?${params}`) as { records: Array<{ id: string; fields: Record<string, unknown> }>; offset?: string };
        allRecords.push(...(result.records || []));
        offset = result.offset;
        fetched += result.records?.length ?? 0;
      } while (offset && fetched < (max_records ?? 200));

      const linkCounts = allRecords.map((r) => ((r.fields[link_field_name] as string[] | undefined) ?? []).length);
      const withLinks = linkCounts.filter((c) => c > 0);
      const distribution: Record<string, number> = {};
      linkCounts.forEach((c) => { distribution[String(c)] = (distribution[String(c)] ?? 0) + 1; });

      const sortedByLinks = allRecords
        .map((r) => ({ id: r.id, link_count: ((r.fields[link_field_name] as string[] | undefined) ?? []).length }))
        .sort((a, b) => b.link_count - a.link_count)
        .slice(0, 10);

      const data = {
        total_records: allRecords.length,
        records_with_links: withLinks.length,
        records_without_links: allRecords.length - withLinks.length,
        avg_links_per_record: withLinks.length > 0 ? Math.round(withLinks.reduce((a, b) => a + b, 0) / allRecords.length * 100) / 100 : 0,
        max_links: Math.max(...linkCounts, 0),
        min_links: Math.min(...linkCounts.filter((c) => c > 0), 0),
        link_count_distribution: distribution,
        top_linked_records: sortedByLinks,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },

    get_relationship_summary: async (args) => {
      const { base_id } = GetRelationshipSummarySchema.parse(args);

      const schema = await logger.time("tool.get_relationship_summary", () =>
        client.get(`/v0/meta/bases/${base_id}/tables`)
      , { tool: "get_relationship_summary", base_id }) as { tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }> };

      const tableNameMap = new Map(schema.tables.map((t) => [t.id, t.name]));
      const relationships: unknown[] = [];
      const matrix: Record<string, Record<string, number>> = {};
      let totalLinkFields = 0;

      for (const table of schema.tables) {
        matrix[table.name] = {};
        for (const field of table.fields) {
          if (field.type === "multipleRecordLinks") {
            totalLinkFields++;
            const targetId = (field.options as Record<string, unknown> | undefined)?.linkedTableId as string | undefined;
            const targetName = targetId ? (tableNameMap.get(targetId) ?? targetId) : "unknown";
            relationships.push({
              from_table: table.name,
              from_table_id: table.id,
              field_name: field.name,
              field_id: field.id,
              to_table: targetName,
              to_table_id: targetId,
            });
            matrix[table.name][targetName] = (matrix[table.name][targetName] ?? 0) + 1;
          }
        }
      }

      const data = {
        relationships,
        table_count: schema.tables.length,
        total_link_fields: totalLinkFields,
        relationship_matrix: matrix,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      };
    },
  };

  return { tools, handlers };
}
