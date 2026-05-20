# Reference: The Architecture of Agent Harnesses

> **Saved:** 2026-05-05 as a reference doc for future work on yt-knowledge-base.
> **Why here:** yt-kb is itself an agent harness — a fixed architecture wrapping a local Ollama model into a YouTube-grounded knowledge agent. This article gives the vocabulary and the nine-component checklist that the architecture review (`docs/architecture-review/`) work draws on. When proposing new features or evaluating refactors, reach for these terms (compaction, sub-agent, lifecycle hook, permission tier) before inventing local jargon.

---

## TL;DR

- A harness is a fixed, pre-built architecture that transforms a standard language model into a functional agent, acting like the car around the engine.
- Unlike frameworks (like LangChain or AutoGen), which require a human architect to manually wire components together, a harness ships a working agent ready to execute a goal.
- The core of any modern harness is a continuous while loop that allows the agent to take actions, observe consequences, and iterate until the problem is solved.
- Critical components include robust context management (compaction), dynamic system prompt assembly, and a strict permission layer that enforces safety and controls tool usage.

## Defining the Agent Harness

When discussing AI agents, the term "harness" is used frequently, but it lacks a universally agreed-upon definition. In simple terms, a harness is a fixed architecture that turns a foundational model into a functional agent.

Modern Large Language Models (LLMs) are fundamentally one-shot text generators; they take a question and provide an answer, then stop. A harness provides the necessary scaffolding to give the model the ability to take action, observe the consequences of those actions, and continue iterating until the initial problem is fully resolved. To use an analogy, if the LLM is the engine, the harness is the entire car that makes the agent functional.

## Harnesses vs. Frameworks

It is crucial to distinguish between an agent harness and an AI framework, as these terms are often used interchangeably, causing confusion.

Frameworks (such as LangChain, LangGraph, or AutoGen) provide abstraction. They give the user components — like state graphs, chains, memory connections, and retrievers — and the fundamental assumption is that the human architect must manually wire these pieces together.

Harnesses, conversely, operate in the opposite direction. There is no assembly step required; the harness essentially ships a working agent. At its core, a harness is a sophisticated while loop combined with a tool registry and a permission layer. Everything is wired together automatically.

To summarize the difference: a framework is built for a human to assemble an agent, while a harness is built for the agent itself to execute a task. The user simply provides the goal, and the harness handles the rest.

## The Nine Components of a Modern Harness

While the specific implementation details can vary, a modern, robust agentic harness generally incorporates nine key architectural components. These components work together to manage the complexity and state required for multi-step reasoning.

### 1. The While Loop (The Foundation)

This is the operational core of the harness. The process begins when the model reads its system prompt, decides which tool to call, executes that tool, feeds the result back into the context, and then loops again. This cycle repeats until the model generates a text-only response or hits a predefined maximum iteration cap. This outer loop is the engine that drives the entire agentic process.

### 2. Context Management

As the agent progresses, the conversation history grows, leading to the inevitable context limit of the LLM. The harness must therefore intelligently decide what information to retain verbatim, what to summarize, and what to discard. For instance, in advanced tools like Cloud Code, when the context approaches a high utilization threshold (e.g., 80–90%), the system triggers a compaction process. The most recent messages are kept in full detail, while older history is summarized to conserve tokens. Proper context management is vital, as failure here can lead to significant operational failures.

### 3. Skills and Tools

The harness manages two types of capabilities:

- **Tools:** These are the low-level primitives — the concrete actions the agent can take, such as reading a file, editing a file, running a bash command, or searching code. Tools are universal.
- **Skills:** These are a higher layer of abstraction built on top of tools. They encode organizational knowledge and are specific to a team or workflow.

The harness maintains a registry that tracks what tools are available, what permissions are required for each, and how the calls are dispatched.

### 4. Sub-Agent Management

When a task becomes too large or requires parallel processing for a single conversational thread, the harness can spawn sub-agents. Each sub-agent operates in isolation, receiving its own dedicated session, a restricted set of tools, and a focused system prompt tailored to its specific task. The pattern here is to span, restrict, and collect the outputs from these specialized workers.

### 5. Built-in Skills

Beyond the user-provided tools, every modern harness ships with a baseline set of non-negotiable skills. These primitives include file operations (read, write, edit), code navigation, and cell execution. If an agent cannot read or edit files, it cannot function as a true coding agent. Furthermore, modern harnesses often include high-level skills, such as knowing how to execute a Git commit or open a pull request.

### 6. Session Persistence (Memory)

Since a long agent session is inherently stateful, the harness must write the state to disk to prevent data loss if the process crashes. The modern, elegant approach is to use append-only JSON or Markdown files. Every event — every message, every tool result, every compaction event — is written as a single line. This design ensures that the process can be resumed exactly where it left off, and because the file is append-only, multiple runs can share the same log without interfering with each other.

### 7. System Prompt Assembly

The system prompt is not a static string; it is a dynamic pipeline. A sophisticated harness can walk through ancestor directories, looking for specific instruction files (like `agents.md` or `cloud.md`), and inject that content into the system prompt. However, developers must be careful, as dynamically introducing components can break the underlying prefix caching mechanisms used by the LLM.

### 8. Life Cycle Hooks

Hooks provide the necessary extensibility layer. They allow developers to inject custom logic before or after a tool runs without having to modify the core harness code.

- **Pre-tool hook:** Fires before execution. It receives the tool name and input and can decide to allow, deny, or modify the intended call.
- **Post-tool hook:** Runs after the tool completes. It cannot block the process but is invaluable for auditing, logging, and observability.

### 9. Permissions and Safety

This layer is what differentiates a useful tool from a dangerous one. Modern harnesses enforce a hierarchy of permission modes (e.g., read-only, workspace, full access). Every tool must declare the minimum permission it requires. The harness enforces this at dispatch time. For dangerous tools like bash, the harness can dynamically classify commands: `list files` is classified as read-only, while `delete` requires full access. On top of these static rules, the harness can implement interactive approvals, pausing the agent to ask the user for explicit consent before executing anything destructive.

## Building a Minimal Reference Implementation

To truly understand the architecture, one must see it in practice. A minimal Python implementation serves as a template for building a harness, demonstrating how all nine components interact.

The main engine remains the controlling while loop, which orchestrates the entire process. Within this loop, the context is constantly checked and compacted if it grows too large.

The implementation details include:

- **Context Management:** A simple compaction function is used to summarize older conversations when the history exceeds a set threshold.
- **Tool and Skills Registry:** Tools are defined by a data class containing a name, required permissions, a handler function, and a description. The registry maps the tool name to this record.
- **Sub-Agents:** The code structure allows for multiple sub-agents (e.g., exploration, general, verification), each with its own restricted tool list and focused system prompt.
- **Built-in Primitives:** These must use pure standard libraries, ensuring that the agent's ability to act is not dependent on external framework dependencies.
- **Session Memory:** The persistence mechanism writes every agent event to disk as a single line of JSON. The append method ensures the file is updated safely, and the replay method reconstructs the full session history.
- **System Prompt Assembly:** The system prompt is dynamically assembled by reading and loading content from multiple memory files, ensuring the static content is loaded first to prevent breaking prefix caching.
- **Hooks:** The structure supports both pre-tool and post-tool hooks, allowing custom logic to intercept and audit the tool execution flow.
- **Permissions:** The system enforces permission checks, classifying commands dynamically. If a command is safe (like `grep`), it remains read-only; if it is dangerous (like `delete`), it immediately requires full access.

These nine components — the iteration loop, context management, skills and tools, sub-agents, built-in skills, session persistence, system prompt assembly, life cycle hooks, and permissions — represent the necessary architecture for any robust, modern agentic harness.

---

## How this maps to yt-knowledge-base (annotation, 2026-05-05)

Cross-reference for future work — which of the nine components yt-kb already has, and where each lives.

| # | Component | Where in yt-kb today | Maturity |
|---|---|---|---|
| 1 | The while loop | TanStack AI's `chat()` agent loop in `client/src/routes/api.chat.tsx`. Iterates until the model emits text-only with no tool calls. | Live, library-owned |
| 2 | Context management | None explicit. The chat history is sent verbatim every turn, no compaction. | **Gap** |
| 3 | Skills and tools | Tools: `webSearchTool` (`client/src/lib/services/chat-tools.ts`). Skills: `client/src/lib/skills/` (Q&A, Tutor, YouTube Script, Social Post, Note). | Live |
| 4 | Sub-agent management | Background generation runs as a detached IIFE (single track, not a sub-agent fan-out). No spawn/restrict/collect pattern yet. | **Gap** |
| 5 | Built-in skills | Per-video chat retrieval (`getChatEvidenceForVideo`), citation grounding (`extractCitationsWithEvidence`), section grounding (`groundSectionsToTranscript`). | Live |
| 6 | Session persistence | Strapi (Video / Transcript / Note / Digest) is the durable store. Background-generation in-memory state is non-persistent across restart (see `generation-state.ts`). | Live for content; in-memory for orchestration |
| 7 | System prompt assembly | `prepareChatPrompt` in `learning.ts` — composes persona (skill) + grounding context (sections, takeaways, retrieved chunks). Static composition, no dir-walked inheritance. | Live, simple |
| 8 | Life cycle hooks | None — no pre/post tool hooks. (Background-generation has `beforeStart` / `onTerminalThrow` hooks per the [#4 refactor](./architecture-review/04-background-generation.md), but those are state-machine hooks, not tool-loop hooks.) | **Gap** |
| 9 | Permissions and safety | MCP server has no permission tiering — every registered tool is callable by Claude Desktop. Local-first single-user means the threat model is light, but the gap is real. | **Gap** |

### Implications for future work

- **Compaction (#2)** is the most likely first gap to bite, especially in long Tutor sessions. Right now we send full history; once it overflows the model's context, the request just fails.
- **Sub-agents (#4)** would unlock cross-video reasoning (digest chat is currently a fan-out at the retrieval layer, not at the agent layer — each video's chunks are concatenated into one prompt rather than each being explored by a sub-agent).
- **Tool-loop hooks (#8)** would let us instrument retrieval / tool-call latency without editing core paths.
- **Permission tiering (#9)** matters most when MCP grows write-tools beyond `addVideo`/`saveNote`. Today the surface is small; if it grows, this becomes load-bearing.

Each of these is a candidate for a future architecture review pass. None are urgent given the local-first single-user threat model, but they're the natural next set of subsystems if the harness needs to grow.
