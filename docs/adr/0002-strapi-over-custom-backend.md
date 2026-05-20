# 0002. Strapi 5 over a custom backend

**Status:** Accepted

## Context

The app needs persistent storage with a typed schema, REST API, an admin UI for inspecting data, auth, and API tokens. Two paths:

1. **Custom backend** — Express/Fastify + Prisma + a hand-rolled admin. Maximum control, every layer is bespoke, every feature (auth, tokens, migrations) is something we write.
2. **Headless CMS** — Strapi, Directus, Payload. Schema as data, admin UI free, REST/GraphQL free, auth + tokens free. Trade some control for surface area.

Other constraint: SQLite for dev (zero-config local-first), Postgres-ready for any future hosted deployment.

A late-arriving constraint: we wanted to expose the knowledge base as an MCP server so external clients (Claude Desktop, Code, Cursor) could drive it with frontier models. That means the data layer needs to be reachable both from the in-app client AND from a long-running HTTP MCP transport.

## Decision

**Strapi 5** with content types defined as JSON schema files in `server/src/api/<entity>/content-types/<entity>/schema.json`. SQLite for dev (`DATABASE_CLIENT=sqlite`, file at `.tmp/data.db`); switchable to Postgres via env without code changes.

**The MCP server lives inside Strapi**, at `/api/mcp` (Streamable HTTP transport, bearer-token auth via Strapi API tokens). Tools are defined once in `server/src/mcp/tools/` and consumed by external clients only — the in-app Ollama chat does not go through MCP.

## Consequences

**What we gain.**

- Admin UI for inspecting / editing data — saved enormous time during development.
- Schema migrations, lifecycles, components, relations, populate semantics — all free.
- API tokens free (with per-route scopes), used for both REST and the MCP `/api/mcp` route.
- The MCP server runs in the same process as the data layer, so tool implementations call internal services directly. No round-trip overhead, no duplicate auth.

**What we accept.**

- Strapi's REST query syntax is non-standard. The flatten/serialize logic in `client/src/lib/services/strapi-client.ts` (`buildQueryParams`, recursive descent) is non-trivial because of nested `populate` shapes, `filters` operators, and the array-vs-object encoding rules. Don't bypass it.
- Strapi 5 is a moving target. Type generation (`server/types/generated/contentTypes.d.ts`) is regenerated on dev startup; don't edit it.
- Coupling to Strapi means the data layer can't be lifted out without rewriting the schema → DB pipeline.

**What's enforced in code.**

- All Strapi reads/writes go through `strapiFetch<T>` in `client/src/lib/services/strapi-client.ts`. Inline `fetch('/api/...')` to Strapi has been removed and shouldn't be reintroduced.
- "No tool duplication" between MCP and in-app chat — see ADR 0001 and `docs/mcp.md`. Tools are defined in `server/src/mcp/tools/` and **only** there.

**Deferred.** Postgres deployment story. Code is ready (`DATABASE_CLIENT=postgres`); operationally untested.
