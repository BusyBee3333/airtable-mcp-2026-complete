# Airtable MCP Server — 2026 Complete

Production-quality MCP (Model Context Protocol) server for the Airtable Web API v0. Implements 14 tools covering bases, tables, records, and schema management.

## Features

- **14 tools** — complete coverage of Airtable record and metadata APIs
- **Circuit breaker** — auto-pauses on repeated failures, self-heals
- **Retry with exponential backoff + jitter** — survives transient errors
- **30-second request timeout** — never hangs indefinitely
- **Per-base rate limiting** — respects Airtable's 5 req/sec per base limit (220ms spacing)
- **Offset pagination** — handles large tables with Airtable's `offset` parameter
- **Bulk operations** — create/update up to 10 records per call
- **Formula filtering** — full Airtable formula support in search_records and list_records
- **stdio + HTTP transport** — local and remote deployment
- **Structured logging** — JSON logs to stderr, never pollutes MCP protocol
- **Full TypeScript** — strict mode, ESM modules

## Setup

### 1. Get an Airtable Personal Access Token

1. Go to [https://airtable.com/account](https://airtable.com/account)
2. Navigate to **Developer Hub** → **Personal Access Tokens**
3. Create a new token with scopes:
   - `data.records:read` — read records
   - `data.records:write` — create/update/delete records
   - `schema.bases:read` — read table/field schemas
   - `schema.bases:write` — create tables and fields

### 2. Configure

```bash
cp .env.example .env
# Edit .env and set AIRTABLE_ACCESS_TOKEN=your_token_here
```

### 3. Build and Run

```bash
npm install
npm run build
AIRTABLE_ACCESS_TOKEN=your_token node dist/index.js
```

## Tools

### Base & Schema Tools
| Tool | Description |
|------|-------------|
| `list_bases` | List accessible Airtable bases |
| `get_base_schema` | Get full schema (tables, fields, views) for a base |
| `list_tables` | List tables in a base |
| `create_table` | Create a new table with fields |
| `create_field` | Add a field to an existing table |

### Record Tools
| Tool | Description |
|------|-------------|
| `list_records` | List records with optional filters and sorting |
| `get_record` | Get a single record by ID |
| `create_record` | Create one record |
| `create_records` | Bulk create up to 10 records |
| `update_record` | Update specific fields (PATCH) |
| `update_records` | Bulk update up to 10 records |
| `delete_record` | Delete a record |
| `search_records` | Filter records using Airtable formula |
| `health_check` | Validate config, connectivity, and auth |

## Formula Examples

```
{Status}='Active'
AND({Status}='Active', {Score}>80)
OR({Category}='A', {Category}='B')
SEARCH('Alice', {Name})>0
{Email}='user@example.com'
NOT({Archived})
```

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "airtable": {
      "command": "node",
      "args": ["/path/to/airtable-mcp-2026-complete/dist/index.js"],
      "env": {
        "AIRTABLE_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

## HTTP Transport

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 AIRTABLE_ACCESS_TOKEN=... node dist/index.js
```

Endpoints:
- `POST /mcp` — MCP protocol
- `GET /mcp` — SSE stream
- `DELETE /mcp` — Close session
- `GET /health` — Server health check

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AIRTABLE_ACCESS_TOKEN` | ✅ | Airtable personal access token |
| `MCP_TRANSPORT` | ❌ | `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | ❌ | HTTP port (default: 3000) |

## Rate Limiting

Airtable enforces a 5 requests/second limit per base. This server automatically spaces requests at 220ms intervals per base to stay within the limit. Retry-After headers from 429 responses are also respected.

## Resources

- [Airtable Web API Reference](https://airtable.com/developers/web/api/introduction)
- [Airtable Personal Access Tokens](https://airtable.com/account)
- [Airtable Field Types](https://airtable.com/developers/web/api/field-model)
- [MCP Protocol Spec](https://modelcontextprotocol.io)

## License

MIT
