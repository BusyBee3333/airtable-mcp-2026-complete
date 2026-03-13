#!/usr/bin/env node
/**
 * Airtable MCP Server — Production Quality
 * Implements 290+ tools across 50 modules for Airtable Web API v0
 *
 * Tool groups:
 *   health           : health_check
 *   bases            : list_bases, get_base_schema, list_tables, update_base, delete_base, duplicate_base, list_base_collaborators
 *   records          : list_records, get_record, create_record, create_records, update_record, update_records, delete_record, search_records,
 *                      bulk_create_records, bulk_update_records, bulk_delete_records, get_record_with_linked, list_records_with_sort,
 *                      list_records_by_view, list_records_with_formula, list_records_grouped, upsert_records,
 *                      list_records_changed_since, link_records, unlink_records
 *   metadata         : create_table, create_field, get_field_metadata, list_all_tables_with_schema
 *   tables           : get_table_schema, update_table, delete_table, list_tables_with_record_count, create_table_from_schema
 *   fields           : list_fields, update_field, delete_field, list_field_types, create_select_field, add_select_option,
 *                      create_formula_field, create_rollup_field, create_linked_field
 *   views            : list_views, get_view, create_view, delete_view, get_view_records, update_view_filter
 *   webhooks         : list_webhooks, create_webhook, delete_webhook, list_webhook_payloads
 *   automations      : list_automations, get_automation, run_automation
 *   attachments      : get_attachment_url, upload_attachment
 *   comments         : list_record_comments, create_comment, update_comment, delete_comment
 *   search           : search_records_fulltext, find_records_by_field, find_duplicate_records
 *   formulas         : validate_formula, list_formula_functions, calculate_formula
 *   sync             : list_sync_sources, get_sync_source_schema
 *   interfaces       : list_interfaces
 *   workspaces       : list_workspaces, get_workspace, create_workspace, update_workspace, delete_workspace,
 *                      list_workspace_collaborators, add_workspace_collaborator, update_workspace_collaborator,
 *                      remove_workspace_collaborator, create_base_in_workspace
 *   collaborators    : add_base_collaborator, update_base_collaborator, remove_base_collaborator,
 *                      list_base_invites, create_base_invite, delete_base_invite,
 *                      list_interface_collaborators, bulk_add_base_collaborators
 *   user_info        : get_current_user, check_token_scopes, list_user_bases
 *   shares           : list_base_shares, create_base_share, update_base_share, delete_base_share,
 *                      get_share_metadata, create_view_share, delete_view_share
 *   enterprise       : get_enterprise_account, list_enterprise_workspaces, list_enterprise_bases,
 *                      get_enterprise_user, list_enterprise_users, deactivate_enterprise_users,
 *                      reactivate_enterprise_users, manage_enterprise_user_admin, list_enterprise_groups,
 *                      get_enterprise_group, delete_enterprise_users, logout_enterprise_users
 *   audit_logs       : list_audit_log_events, get_audit_log_event_types, get_audit_log_event,
 *                      list_user_audit_log, list_base_audit_log
 *   field_types      : create_number_field, create_currency_field, create_percent_field, create_date_field,
 *                      create_datetime_field, create_checkbox_field, create_rating_field, create_url_field,
 *                      create_email_field, create_phone_field, create_duration_field, create_count_field,
 *                      create_lookup_field, create_autonumber_field, create_text_field, create_long_text_field,
 *                      create_barcode_field, get_field_type_schema
 *   record_aggregates: count_records, sum_field, average_field, min_field, max_field,
 *                      get_field_statistics, list_unique_values, count_records_by_group
 *   schema_management: bulk_create_fields, get_field_by_name, find_tables_with_field, get_linked_tables,
 *                      get_table_stats, copy_table_structure, rename_field, get_base_field_names,
 *                      validate_schema_compatibility
 *   table_utilities  : get_table_by_name, list_tables_summary, rename_table, get_table_field_names,
 *                      clear_table_records, get_table_primary_field, list_table_views_extended
 *   automation_runs  : list_automation_runs, get_automation_run, get_automation_run_stats,
 *                      toggle_automation, list_automations_with_run_count
 *   bulk_upsert      : bulk_upsert_records, replace_all_records, sync_records_from_data, diff_and_sync_records
 *   view_config      : update_view_metadata, get_view_field_config, list_view_fields_ordered,
 *                      get_view_summary, list_views_by_type, get_view_records_page, duplicate_view
 *   record_history   : list_record_revisions, get_record_revision, list_changed_records_in_range,
 *                      list_recently_modified_records, get_record_audit_trail
 *   data_export      : export_table_to_csv, export_table_to_json, export_multiple_tables,
 *                      export_records_by_formula, get_export_summary
 *   linked_records   : resolve_linked_records, traverse_link_chain, find_records_linking_to,
 *                      get_bidirectional_links, resolve_linked_field_values, list_all_linked_tables
 *   formula_builder  : build_formula, get_formula_templates, explain_formula, convert_to_formula, test_formula_on_records
 *   select_options   : list_select_options, add_select_option, update_select_option, reorder_select_options,
 *                      bulk_add_select_options, get_select_options_map
 *   view_filters     : get_view_filters, set_view_filter, build_filter_set, clear_view_filters,
 *                      apply_filter_preset, list_filter_presets
 *   view_sorts       : get_view_sorts, set_view_sorts, add_sort_level, clear_view_sorts, build_multi_level_sort
 *   view_groups      : get_view_groups, set_view_groups, clear_view_groups, get_grouped_record_counts, build_group_config
 *   record_links_graph: build_record_graph, get_dependency_tree, find_orphaned_records,
 *                      analyze_link_patterns, get_relationship_summary
 *   form_views       : list_form_views, get_form_config, create_form_view, get_form_prefill_url,
 *                      get_form_submission_records, update_form_settings
 *   calendar_views   : list_calendar_views, get_calendar_config, create_calendar_view,
 *                      get_calendar_events, get_events_by_month, update_calendar_date_field
 *   gantt_views      : list_gantt_views, get_gantt_config, create_gantt_view,
 *                      get_gantt_tasks, get_critical_path, update_gantt_date_fields
 *   base_permissions : get_base_access_level, list_collaborators_with_roles, check_user_permissions,
 *                      get_field_permissions, summarize_base_sharing
 *   base_schema_diff : get_schema_snapshot, compare_table_schemas, detect_schema_drift,
 *                      compare_base_fields, validate_schema
 *   ai_fields        : list_ai_fields, get_ai_field_config, create_ai_field, update_ai_field_prompt,
 *                      trigger_ai_generation, get_ai_field_templates
 *   webhook_payloads : get_latest_webhook_payloads, inspect_payload_changes, get_payload_statistics,
 *                      filter_payloads_by_table, get_payload_field_changes, refresh_webhook
 *   trash_management : check_record_exists, get_record_deletion_status, find_recently_deleted,
 *                      bulk_check_records, get_table_record_count, inspect_deletion_history
 *   sync_config      : list_sync_sources_detailed, get_sync_source_health, get_sync_status_summary,
 *                      list_sync_enabled_tables, get_sync_table_mapping, check_sync_conflicts
 *
 * Auth: AIRTABLE_ACCESS_TOKEN environment variable (personal access token)
 * Transport: stdio (default) or HTTP (MCP_TRANSPORT=http)
 * Rate limit: 5 req/sec per base — handled via per-base rate limiter
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AirtableClient } from "./client.js";
import { logger } from "./logger.js";
import type { ToolHandler } from "./types.js";

// ============================================
// SERVER SETUP
// ============================================

async function main() {
  const accessToken = process.env.AIRTABLE_ACCESS_TOKEN;
  if (!accessToken) {
    logger.error("startup.missing_env", { variable: "AIRTABLE_ACCESS_TOKEN" });
    console.error("Error: AIRTABLE_ACCESS_TOKEN environment variable required");
    console.error("Get your token from https://airtable.com/account");
    console.error("Required scopes: data.records:read, data.records:write, schema.bases:read, schema.bases:write");
    process.exit(1);
  }

  const client = new AirtableClient(accessToken);

  const server = new McpServer({
    name: "airtable-mcp",
    version: "1.0.0",
  });

  // Load all tool groups
  const toolGroups = await Promise.all([
    // Original 15 tool modules
    import("./tools/health.js").then((m) => m.getTools(client)),
    import("./tools/bases.js").then((m) => m.getTools(client)),
    import("./tools/records.js").then((m) => m.getTools(client)),
    import("./tools/metadata.js").then((m) => m.getTools(client)),
    import("./tools/tables.js").then((m) => m.getTools(client)),
    import("./tools/fields.js").then((m) => m.getTools(client)),
    import("./tools/views.js").then((m) => m.getTools(client)),
    import("./tools/webhooks.js").then((m) => m.getTools(client)),
    import("./tools/automations.js").then((m) => m.getTools(client)),
    import("./tools/attachments.js").then((m) => m.getTools(client)),
    import("./tools/comments.js").then((m) => m.getTools(client)),
    import("./tools/search.js").then((m) => m.getTools(client)),
    import("./tools/formulas.js").then((m) => m.getTools(client)),
    import("./tools/sync.js").then((m) => m.getTools(client)),
    import("./tools/interfaces.js").then((m) => m.getTools(client)),
    // V2 additions — 15 new tool modules
    import("./tools/workspaces.js").then((m) => m.getTools(client)),
    import("./tools/collaborators.js").then((m) => m.getTools(client)),
    import("./tools/user_info.js").then((m) => m.getTools(client)),
    import("./tools/shares.js").then((m) => m.getTools(client)),
    import("./tools/enterprise.js").then((m) => m.getTools(client)),
    import("./tools/audit_logs.js").then((m) => m.getTools(client)),
    import("./tools/field_types.js").then((m) => m.getTools(client)),
    import("./tools/record_aggregates.js").then((m) => m.getTools(client)),
    import("./tools/schema_management.js").then((m) => m.getTools(client)),
    import("./tools/table_utilities.js").then((m) => m.getTools(client)),
    import("./tools/automation_runs.js").then((m) => m.getTools(client)),
    import("./tools/bulk_upsert.js").then((m) => m.getTools(client)),
    import("./tools/view_configuration.js").then((m) => m.getTools(client)),
    import("./tools/record_history.js").then((m) => m.getTools(client)),
    import("./tools/data_export.js").then((m) => m.getTools(client)),
    // V3 additions — 19 new tool modules (50+ total)
    import("./tools/linked_records.js").then((m) => m.getTools(client)),
    import("./tools/formula_builder.js").then((m) => m.getTools(client)),
    import("./tools/select_options_management.js").then((m) => m.getTools(client)),
    import("./tools/view_filters.js").then((m) => m.getTools(client)),
    import("./tools/view_sorts.js").then((m) => m.getTools(client)),
    import("./tools/view_groups.js").then((m) => m.getTools(client)),
    import("./tools/record_links_graph.js").then((m) => m.getTools(client)),
    import("./tools/form_views.js").then((m) => m.getTools(client)),
    import("./tools/calendar_views.js").then((m) => m.getTools(client)),
    import("./tools/base_permissions.js").then((m) => m.getTools(client)),
    import("./tools/base_schema_diff.js").then((m) => m.getTools(client)),
    import("./tools/record_locking.js").then((m) => m.getTools(client)),
    import("./tools/ai_fields.js").then((m) => m.getTools(client)),
    import("./tools/webhook_payloads.js").then((m) => m.getTools(client)),
    import("./tools/trash_management.js").then((m) => m.getTools(client)),
    import("./tools/base_migration.js").then((m) => m.getTools(client)),
    import("./tools/rate_limit_management.js").then((m) => m.getTools(client)),
    import("./tools/gantt_views.js").then((m) => m.getTools(client)),
    import("./tools/select_options.js").then((m) => m.getTools(client)),
    import("./tools/sync_configuration.js").then((m) => m.getTools(client)),
  ]);

  // Build handler map
  const handlerMap = new Map<string, ToolHandler>();
  for (const group of toolGroups) {
    for (const [name, handler] of Object.entries(group.handlers)) {
      handlerMap.set(name, handler);
    }
  }

  // Register all tools with the MCP server
  for (const group of toolGroups) {
    for (const tool of group.tools) {
      const handler = handlerMap.get(tool.name);
      if (!handler) {
        logger.warn("tool.missing_handler", { tool: tool.name });
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>) => {
          const requestId = logger.requestId();
          const start = performance.now();
          logger.info("tool.call", { requestId, tool: tool.name });

          try {
            const result = await handler(args);
            const durationMs = Math.round(performance.now() - start);
            logger.info("tool.done", { requestId, tool: tool.name, durationMs });
            return result;
          } catch (error) {
            const durationMs = Math.round(performance.now() - start);
            let message: string;

            if (error instanceof z.ZodError) {
              message = `Validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`;
              logger.warn("tool.validation_error", { requestId, tool: tool.name, durationMs });
            } else {
              message = error instanceof Error ? error.message : String(error);
              logger.error("tool.error", { requestId, tool: tool.name, durationMs, error: message });
            }

            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              structuredContent: { error: message, tool: tool.name },
              isError: true,
            };
          }
        }
      );
    }
  }

  const totalTools = toolGroups.reduce((sum, g) => sum + g.tools.length, 0);
  logger.info("server.tools_registered", { count: totalTools });

  // === Transport Selection ===
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http") {
    await startHttpTransport(server);
  } else {
    await startStdioTransport(server);
  }
}

// === Stdio Transport (default) ===
async function startStdioTransport(server: McpServer) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server.started", { transport: "stdio", name: "airtable-mcp" });
}

// === Streamable HTTP Transport ===
async function startHttpTransport(server: McpServer) {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { createServer } = await import("http");
  const { randomUUID } = await import("crypto");

  const port = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
  const sessions = new Map<string, { transport: InstanceType<typeof StreamableHTTPServerTransport>; lastActivity: number }>();
  const MAX_SESSIONS = 100;
  const SESSION_TTL_MS = 30 * 60 * 1000;

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        logger.info("session.expired", { sessionId: id });
        sessions.delete(id);
      }
    }
  }, 60_000);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "airtable-mcp", activeSessions: sessions.size }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        let transport: InstanceType<typeof StreamableHTTPServerTransport>;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.lastActivity = Date.now();
          transport = session.transport;
        } else {
          if (sessions.size >= MAX_SESSIONS) {
            let oldest: string | null = null;
            let oldestTime = Infinity;
            for (const [id, s] of sessions.entries()) {
              if (s.lastActivity < oldestTime) { oldestTime = s.lastActivity; oldest = id; }
            }
            if (oldest) sessions.delete(oldest);
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          await server.connect(transport);
          const newId = (transport as unknown as { sessionId?: string }).sessionId;
          if (newId) sessions.set(newId, { transport, lastActivity: Date.now() });
        }

        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === "GET" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        sessions.delete(sessionId);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);
    sessions.clear();
  });

  httpServer.listen(port, () => {
    logger.info("server.started", { transport: "http", name: "airtable-mcp", port, endpoint: "/mcp" });
    console.error(`Airtable MCP HTTP server running on port ${port}`);
  });
}

main().catch((error) => {
  logger.error("server.fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
