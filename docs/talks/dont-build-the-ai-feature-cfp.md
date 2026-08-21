# CFP submission — copy/paste

React Summit · 7 min lightning

---

## Title

Don't Build the AI Feature, Build the Interface: React, TanStack AI, and MCP

## Abstract

**The question.** I wanted to find out how feasible local-first really is. Can an app run its AI on your own machine, against your own data, and still be worth using? Local may save on costs but is bounded by your hardware.


**The experiment.** Music KB is a React app that turns YouTube music tutorials
into a library I can search and ask questions of. Summaries, embeddings, chat
and lesson generation all run locally.

**What I found.** It got further than I expected. TanStack AI handles
streaming, server-side tools, structured output and provider swapping, so
Ollama drops in where a hosted API would go, and local carries most of the
work. 

That's where MCP comes in. It lets you move past your local hardware
constraints and take your data anywhere: expose a set of tools once, point
Claude Code or Claude Desktop at them, and a frontier model works your library
in place. Nothing leaves that you didn't choose to expose.

The lesson isn't local or cloud, it's that you can use both. You decide what
runs locally, what's worth offloading to a frontier model, and whether hosting
your own open-source model belongs in between. Pick by what the job actually
needs and what a model can actually do.

## What I'll show

- `chat()` streaming over AG-UI server-sent events
- Server-side tools via `toolDefinition().server()` — logic stays on the server
- Structured output with `outputSchema` + JSON-mode constrained decoding
- Per-call sampling options — why tool calls work or quietly don't
- `@tanstack/ai-ollama` — a local model as a first-class provider
- Two retrieval layers: BM25 inside a transcript, embeddings across the library
- 24 MCP tools — Claude Code / Desktop drives the same knowledge base
- `read` / `write` / `maintenance` tiers — exposing data isn't all-or-nothing
- Picking models by fit, not size — true between hosted tiers too
- Token cost as a design constraint, and how an MCP surface shifts it

*At seven minutes I'll name most of these and go deep on one or two.*

## Outline

| Time | Beat |
|---|---|
| 0:45 | The problem: using AI on your own data usually means giving it away. |
| 1:00 | Local pipeline: transcript → summary → key/chord extraction → embedding. |
| 1:30 | TanStack AI on screen: `chat()`, a server-side tool, streaming into React. |
| 1:15 | MCP: same data, frontier model, scoped exposure. |
| 1:15 | Demo: a lesson generated from the library, in-app then from Claude. |
| 1:15 | Takeaway + repo. |

## Takeaways

- Which TanStack AI primitives you actually need to ship something real
- How to expose an app over MCP without exposing all of it
- How to decide what runs locally and what needs a frontier model

## Speaker bio

*(fill in)*

## Notes for organisers

Demo is pre-recorded and narrated live — 7 minutes has no room to wait on
inference.
