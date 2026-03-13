// Airtable Linked Records tools: resolve_linked_records, get_linked_record_chain,
//   get_bidirectional_links, traverse_link_graph, batch_resolve_links, get_link_field_targets
import { z } from "zod";
import type { AirtableClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ResolveLinkedRecordsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name of the source record"),
  record_id: z.string().describe("Source record ID (starts with 'rec')"),
  linked_field_name: z.string().describe("Name of the linked record field to resolve"),
  linked_table_id_or_name: z.string().describe("Table where linked records live"),
  fields: z.array(z.string()).optional().describe("Fields to return from linked records (default: all)"),
  max_linked: z.number().min(1).max(100).optional().default(50).describe("Maximum linked records to resolve (default 50)"),
});

const GetLinkedRecordChainSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Starting table"),
  record_id: z.string().describe("Starting record ID (starts with 'rec')"),
  chain: z.array(z.object({
    linked_field_name: z.string().describe("Name of linked field in current table"),
    next_table_id_or_name: z.string().describe("Table the linked field points to"),
    fields: z.array(z.string()).optional().describe("Fields to return from this level"),
  })).min(1).max(5).describe("Chain of links to traverse. Each step: {linked_field_name, next_table_id_or_name, fields}. Max depth 5."),
});

const GetBidirectionalLinksSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
  record_id: z.string().describe("Record ID (starts with 'rec')"),
  outgoing_field: z.string().describe("Name of the outgoing linked field in this record"),
  outgoing_table: z.string().describe("Table the outgoing links point to"),
  incoming_field: z.string().describe("Name of the incoming linked field in the target table (reverse link field name)"),
  fields: z.array(z.string()).optional().describe("Fields to return from linked records"),
});

const TraverseLinkGraphSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  start_table_id_or_name: z.string().describe("Starting table"),
  start_record_id: z.string().describe("Starting record ID (starts with 'rec')"),
  link_field_name: z.string().describe("Name of the linked record field to follow"),
  linked_table_id_or_name: z.string().describe("Table linked records live in"),
  max_depth: z.number().min(1).max(4).default(2).describe("Maximum traversal depth (1-4, default 2)"),
  fields: z.array(z.string()).optional().describe("Fields to return at each node"),
});

const BatchResolveLinksSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table of source records"),
  record_ids: z.array(z.string()).min(1).max(20).describe("Source record IDs to resolve links for (max 20)"),
  linked_field_name: z.string().describe("Name of the linked field in source table"),
  linked_table_id_or_name: z.string().describe("Table linked records live in"),
  fields: z.array(z.string()).optional().describe("Fields to return from linked records"),
});

const GetLinkFieldTargetsSchema = z.object({
  base_id: z.string().describe("Airtable base ID (starts with 'app')"),
  table_id_or_name: z.string().describe("Table ID or name"),
});

// ============ Tool Definitions ============

export function getTools(client: AirtableClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "resolve_linked_records",
      title: "Resolve Linked Records",
      description:
        "Fetch a record's linked field IDs and fully resolve them into complete record objects from the linked table. Instead of getting an array of record IDs, you get the full data for each linked record. Essential for displaying relational data without multiple manual API calls.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table of source record" },
          record_id: { type: "string", description: "Source record ID (starts with 'rec')" },
          linked_field_name: { type: "string", description: "Name of the linked record field" },
          linked_table_id_or_name: { type: "string", description: "Table where linked records live" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return from linked records" },
          max_linked: { type: "number", description: "Max linked records to resolve (default 50)" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "linked_field_name", "linked_table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sourceRecord: { type: "object" },
          linkedField: { type: "string" },
          linkedRecords: { type: "array", items: { type: "object" } },
          linkedCount: { type: "number" },
        },
        required: ["sourceRecord", "linkedRecords", "linkedCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_linked_record_chain",
      title: "Get Linked Record Chain",
      description:
        "Traverse a chain of linked record fields across multiple tables in one call. Example: Start from a Task, follow its Project link, then follow the Project's Client link — returning data at each level. Supports up to 5 levels deep. Great for building hierarchical views of relational data.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Starting table" },
          record_id: { type: "string", description: "Starting record ID (starts with 'rec')" },
          chain: {
            type: "array",
            items: { type: "object" },
            description: "Chain of links: [{linked_field_name:'Project',next_table_id_or_name:'Projects',fields:['Name','Status']},...]",
          },
        },
        required: ["base_id", "table_id_or_name", "record_id", "chain"],
      },
      outputSchema: {
        type: "object",
        properties: {
          rootRecord: { type: "object" },
          chain: { type: "array", items: { type: "object" } },
          depth: { type: "number" },
        },
        required: ["rootRecord", "chain"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_bidirectional_links",
      title: "Get Bidirectional Links",
      description:
        "Retrieve both outgoing and incoming linked records for a record. Airtable linked fields are bidirectional — when A links to B, B also shows A in a symmetric field. This tool returns both directions at once, showing the full relationship picture from a single record.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
          record_id: { type: "string", description: "Record ID (starts with 'rec')" },
          outgoing_field: { type: "string", description: "Outgoing linked field name in this record" },
          outgoing_table: { type: "string", description: "Table the outgoing links point to" },
          incoming_field: { type: "string", description: "Incoming/reverse link field name in the target table" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return from linked records" },
        },
        required: ["base_id", "table_id_or_name", "record_id", "outgoing_field", "outgoing_table", "incoming_field"],
      },
      outputSchema: {
        type: "object",
        properties: {
          sourceRecord: { type: "object" },
          outgoingLinks: { type: "array", items: { type: "object" } },
          incomingLinks: { type: "array", items: { type: "object" } },
        },
        required: ["sourceRecord", "outgoingLinks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "traverse_link_graph",
      title: "Traverse Link Graph",
      description:
        "Recursively traverse a linked record graph starting from one record, following a single link field at each level. Returns a tree structure showing all reachable records up to the specified depth. Useful for dependency chains, org charts, project hierarchies, and any tree-structured data in Airtable.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          start_table_id_or_name: { type: "string", description: "Starting table" },
          start_record_id: { type: "string", description: "Starting record ID (starts with 'rec')" },
          link_field_name: { type: "string", description: "Link field to follow at each level" },
          linked_table_id_or_name: { type: "string", description: "Table of linked records (can be same table for self-links)" },
          max_depth: { type: "number", description: "Max traversal depth 1-4 (default 2)" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return at each node" },
        },
        required: ["base_id", "start_table_id_or_name", "start_record_id", "link_field_name", "linked_table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          graph: { type: "object" },
          nodeCount: { type: "number" },
          maxDepthReached: { type: "number" },
        },
        required: ["graph", "nodeCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "batch_resolve_links",
      title: "Batch Resolve Links",
      description:
        "Resolve linked records for multiple source records at once. Instead of resolving links one record at a time, this tool fetches all source records' linked IDs and resolves them in batch. Returns a map of source record ID → resolved linked records. Much more efficient than sequential resolve_linked_records calls.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table of source records" },
          record_ids: { type: "array", items: { type: "string" }, description: "Source record IDs (max 20): ['recXXX','recYYY']" },
          linked_field_name: { type: "string", description: "Name of the linked field in source table" },
          linked_table_id_or_name: { type: "string", description: "Table linked records live in" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return from linked records" },
        },
        required: ["base_id", "table_id_or_name", "record_ids", "linked_field_name", "linked_table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          resolvedMap: { type: "object" },
          uniqueLinkedRecords: { type: "object" },
          totalResolved: { type: "number" },
        },
        required: ["resolvedMap", "totalResolved"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_link_field_targets",
      title: "Get Link Field Targets",
      description:
        "Inspect all linked record fields in a table and return the target table ID and name for each. Shows the complete link topology of a table — which fields link to which tables. Useful for understanding the data model and for planning multi-table traversals.",
      inputSchema: {
        type: "object",
        properties: {
          base_id: { type: "string", description: "Airtable base ID (starts with 'app')" },
          table_id_or_name: { type: "string", description: "Table ID or name" },
        },
        required: ["base_id", "table_id_or_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          table: { type: "string" },
          linkFields: { type: "array", items: { type: "object" } },
          linkCount: { type: "number" },
        },
        required: ["table", "linkFields", "linkCount"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    resolve_linked_records: async (args) => {
      const params = ResolveLinkedRecordsSchema.parse(args);

      // Fetch source record
      const sourceRecord = await logger.time("tool.resolve_linked_records.source", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}`)
      , { tool: "resolve_linked_records" }) as Record<string, unknown>;

      const fields = (sourceRecord.fields ?? {}) as Record<string, unknown>;
      const linkedIds = fields[params.linked_field_name];

      if (!Array.isArray(linkedIds) || linkedIds.length === 0) {
        const response = { sourceRecord, linkedField: params.linked_field_name, linkedRecords: [], linkedCount: 0 };
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
      }

      const idsToFetch = (linkedIds as string[]).slice(0, params.max_linked ?? 50);
      const idFormula = `OR(${idsToFetch.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const qp = new URLSearchParams();
      qp.set("filterByFormula", idFormula);
      if (params.fields) params.fields.forEach((f) => qp.append("fields[]", f));

      const linked = await logger.time("tool.resolve_linked_records.linked", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.linked_table_id_or_name)}?${qp}`)
      , { tool: "resolve_linked_records" }) as { records?: unknown[] };

      const response = {
        sourceRecord,
        linkedField: params.linked_field_name,
        linkedRecords: linked.records ?? [],
        linkedCount: (linked.records ?? []).length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_linked_record_chain: async (args) => {
      const params = GetLinkedRecordChainSchema.parse(args);

      // Fetch root record
      const rootRecord = await logger.time("tool.get_linked_record_chain.root", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}`)
      , { tool: "get_linked_record_chain" }) as Record<string, unknown>;

      const chainResults: unknown[] = [];
      let currentRecords = [rootRecord];
      let depth = 0;

      for (const step of params.chain) {
        depth++;
        const allLinkedIds: string[] = [];
        for (const rec of currentRecords) {
          const recFields = (rec as { fields?: Record<string, unknown> }).fields ?? {};
          const ids = recFields[step.linked_field_name];
          if (Array.isArray(ids)) allLinkedIds.push(...(ids as string[]));
        }

        if (allLinkedIds.length === 0) {
          chainResults.push({ step: depth, field: step.linked_field_name, table: step.next_table_id_or_name, records: [] });
          break;
        }

        const unique = [...new Set(allLinkedIds)].slice(0, 50);
        const idFormula = `OR(${unique.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
        const qp = new URLSearchParams();
        qp.set("filterByFormula", idFormula);
        if (step.fields) step.fields.forEach((f) => qp.append("fields[]", f));

        const linked = await logger.time("tool.get_linked_record_chain.step", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(step.next_table_id_or_name)}?${qp}`)
        , { tool: "get_linked_record_chain", depth }) as { records?: unknown[] };

        chainResults.push({
          step: depth,
          field: step.linked_field_name,
          table: step.next_table_id_or_name,
          records: linked.records ?? [],
          recordCount: (linked.records ?? []).length,
        });
        currentRecords = (linked.records ?? []) as Record<string, unknown>[];
      }

      const response = { rootRecord, chain: chainResults, depth };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_bidirectional_links: async (args) => {
      const params = GetBidirectionalLinksSchema.parse(args);

      const sourceRecord = await logger.time("tool.get_bidirectional_links.source", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}/${params.record_id}`)
      , { tool: "get_bidirectional_links" }) as Record<string, unknown>;

      const fields = (sourceRecord.fields ?? {}) as Record<string, unknown>;
      const outgoingIds = fields[params.outgoing_field];

      // Fetch outgoing links
      let outgoingLinks: unknown[] = [];
      if (Array.isArray(outgoingIds) && outgoingIds.length > 0) {
        const ids = (outgoingIds as string[]).slice(0, 50);
        const formula = `OR(${ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
        const qp = new URLSearchParams();
        qp.set("filterByFormula", formula);
        if (params.fields) params.fields.forEach((f) => qp.append("fields[]", f));
        const linked = await logger.time("tool.get_bidirectional_links.outgoing", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.outgoing_table)}?${qp}`)
        , { tool: "get_bidirectional_links" }) as { records?: unknown[] };
        outgoingLinks = linked.records ?? [];
      }

      // Fetch incoming links — records in target table that link back to this record
      const incomingQp = new URLSearchParams();
      incomingQp.set("filterByFormula", `FIND('${params.record_id}',ARRAYJOIN({${params.incoming_field}},','))>0`);
      if (params.fields) params.fields.forEach((f) => incomingQp.append("fields[]", f));
      const incoming = await logger.time("tool.get_bidirectional_links.incoming", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.outgoing_table)}?${incomingQp}`)
      , { tool: "get_bidirectional_links" }) as { records?: unknown[] };

      const response = {
        sourceRecord,
        outgoingLinks,
        incomingLinks: incoming.records ?? [],
        outgoingCount: outgoingLinks.length,
        incomingCount: (incoming.records ?? []).length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    traverse_link_graph: async (args) => {
      const params = TraverseLinkGraphSchema.parse(args);
      const maxDepth = params.max_depth ?? 2;
      const visited = new Set<string>();

      interface GraphNode {
        record: unknown;
        depth: number;
        children: GraphNode[];
      }

      const fetchChildren = async (recordId: string, depth: number): Promise<GraphNode[]> => {
        if (depth > maxDepth || visited.has(recordId)) return [];
        visited.add(recordId);

        const rec = await logger.time("tool.traverse_link_graph.fetch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.start_table_id_or_name)}/${recordId}`)
        , { tool: "traverse_link_graph", depth }) as Record<string, unknown>;

        const recFields = (rec.fields ?? {}) as Record<string, unknown>;
        const childIds = recFields[params.link_field_name];
        if (!Array.isArray(childIds) || childIds.length === 0) return [];

        const unique = [...new Set(childIds as string[])].slice(0, 20);
        const nodes: GraphNode[] = [];

        for (const childId of unique) {
          if (!visited.has(childId)) {
            const qp = new URLSearchParams();
            if (params.fields) params.fields.forEach((f) => qp.append("fields[]", f));
            const childRec = await logger.time("tool.traverse_link_graph.child", () =>
              client.get(`/v0/${params.base_id}/${encodeURIComponent(params.linked_table_id_or_name)}/${childId}${params.fields ? `?${qp}` : ""}`)
            , { tool: "traverse_link_graph", depth });
            const children = depth < maxDepth ? await fetchChildren(childId, depth + 1) : [];
            nodes.push({ record: childRec, depth, children });
          }
        }

        return nodes;
      };

      const qp = new URLSearchParams();
      if (params.fields) params.fields.forEach((f) => qp.append("fields[]", f));
      const rootRecord = await logger.time("tool.traverse_link_graph.root", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.start_table_id_or_name)}/${params.start_record_id}${params.fields ? `?${qp}` : ""}`)
      , { tool: "traverse_link_graph" });

      visited.add(params.start_record_id);
      const rootFields = ((rootRecord as Record<string, unknown>).fields ?? {}) as Record<string, unknown>;
      const rootChildIds = rootFields[params.link_field_name];
      const children: GraphNode[] = [];

      if (Array.isArray(rootChildIds)) {
        for (const childId of [...new Set(rootChildIds as string[])].slice(0, 20)) {
          const childRec = await logger.time("tool.traverse_link_graph.root_child", () =>
            client.get(`/v0/${params.base_id}/${encodeURIComponent(params.linked_table_id_or_name)}/${childId}`)
          , { tool: "traverse_link_graph" });
          const subChildren = maxDepth > 1 ? await fetchChildren(childId, 2) : [];
          children.push({ record: childRec, depth: 1, children: subChildren });
        }
      }

      const graph = { record: rootRecord, depth: 0, children };
      const response = { graph, nodeCount: visited.size, maxDepthReached: maxDepth };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    batch_resolve_links: async (args) => {
      const params = BatchResolveLinksSchema.parse(args);

      // Fetch all source records
      const idFormula = `OR(${params.record_ids.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      const srcQp = new URLSearchParams();
      srcQp.set("filterByFormula", idFormula);
      srcQp.append("fields[]", params.linked_field_name);

      const sourceResult = await logger.time("tool.batch_resolve_links.source", () =>
        client.get(`/v0/${params.base_id}/${encodeURIComponent(params.table_id_or_name)}?${srcQp}`)
      , { tool: "batch_resolve_links" }) as { records?: Array<{ id: string; fields: Record<string, unknown> }> };

      // Collect all unique linked IDs
      const allLinkedIds = new Set<string>();
      const sourceMap: Record<string, string[]> = {};
      for (const rec of sourceResult.records ?? []) {
        const ids = rec.fields[params.linked_field_name];
        const idList = Array.isArray(ids) ? (ids as string[]) : [];
        sourceMap[rec.id] = idList;
        idList.forEach((id) => allLinkedIds.add(id));
      }

      // Fetch all linked records in batches
      const uniqueIds = [...allLinkedIds];
      const linkedRecordMap: Record<string, unknown> = {};

      for (let i = 0; i < uniqueIds.length; i += 100) {
        const batch = uniqueIds.slice(i, i + 100);
        const batchFormula = `OR(${batch.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
        const lnkQp = new URLSearchParams();
        lnkQp.set("filterByFormula", batchFormula);
        if (params.fields) params.fields.forEach((f) => lnkQp.append("fields[]", f));

        const result = await logger.time("tool.batch_resolve_links.linked_batch", () =>
          client.get(`/v0/${params.base_id}/${encodeURIComponent(params.linked_table_id_or_name)}?${lnkQp}`)
        , { tool: "batch_resolve_links" }) as { records?: Array<{ id: string }> };

        for (const rec of result.records ?? []) {
          linkedRecordMap[rec.id] = rec;
        }
      }

      // Build resolved map
      const resolvedMap: Record<string, unknown[]> = {};
      for (const [srcId, linkedIds] of Object.entries(sourceMap)) {
        resolvedMap[srcId] = linkedIds.map((id) => linkedRecordMap[id]).filter(Boolean);
      }

      const response = {
        resolvedMap,
        uniqueLinkedRecords: linkedRecordMap,
        totalResolved: Object.values(resolvedMap).reduce((sum, arr) => sum + arr.length, 0),
        sourceCount: params.record_ids.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_link_field_targets: async (args) => {
      const params = GetLinkFieldTargetsSchema.parse(args);

      const schema = await logger.time("tool.get_link_field_targets", () =>
        client.get(`/v0/meta/bases/${params.base_id}/tables`)
      , { tool: "get_link_field_targets" }) as {
        tables?: Array<{ id: string; name: string; fields?: Array<{ id: string; name: string; type: string; options?: Record<string, unknown> }> }>;
      };

      const tables = schema.tables ?? [];

      // Find target table
      const table = tables.find(
        (t) => t.id === params.table_id_or_name || t.name === params.table_id_or_name
      );

      if (!table) throw new Error(`Table '${params.table_id_or_name}' not found`);

      const tableMap = Object.fromEntries(tables.map((t) => [t.id, t.name]));

      const linkFields = (table.fields ?? [])
        .filter((f) => f.type === "multipleRecordLinks" || f.type === "singleLineText")
        .filter((f) => f.type === "multipleRecordLinks")
        .map((f) => {
          const linkedTableId = (f.options?.linkedTableId as string) ?? null;
          return {
            fieldId: f.id,
            fieldName: f.name,
            linkedTableId,
            linkedTableName: linkedTableId ? (tableMap[linkedTableId] ?? linkedTableId) : null,
            isSymmetric: (f.options?.isReversed as boolean) ?? false,
            prefersSingleRecordLink: (f.options?.prefersSingleRecordLink as boolean) ?? false,
          };
        });

      const response = {
        table: table.name,
        tableId: table.id,
        linkFields,
        linkCount: linkFields.length,
      };

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };

  return { tools, handlers };
}
