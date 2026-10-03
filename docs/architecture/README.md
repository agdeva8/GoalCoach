# Architecture docs

System-design docs for Sutra. Derived from code; code is the source of truth.

| Doc | Level | Covers |
|---|---|---|
| [`HLD.md`](./HLD.md) | High-level | Context, containers, components, key flows, NFRs, decisions, invariants |
| [`agent-graphs.puml`](./agent-graphs.puml) | Diagrams | PlantUML surface map of the AI SDK + LangGraph graphs |
| `lld/` | Low-level | Per-module designs — **backlog**, see HLD §12 |

## Conventions

- Diagrams: **Mermaid** inline in Markdown (GitHub renders it); PlantUML kept as `.puml`.
- Every non-obvious claim cites a `file:line`. If the doc and code disagree, the code wins.
- Keep the HLD system-level; push module internals to `lld/`.
