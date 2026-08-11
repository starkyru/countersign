# LangGraph interrupt/checkpointer spike

## Self-hosted flow

The runnable [`refund-agent`](../../examples/refund-agent) uses
`PostgresSaver` and a stable LangGraph `thread_id`. Its first invocation emits
the approval object under `__interrupt__`; its second invocation uses
`Command(resume=[HumanResponse])` with the same `thread_id`.

The implementation has one important safety property: the approval node does
not create IDs, write audit records, or make payments before calling
`interrupt()`. LangGraph restarts that entire node on resume. Stable IDs are
therefore created at the request producer before the graph invocation, and the
side effect lives in a separate post-approval node.

## Semantics confirmed by executable probes

| Situation | Resume rule | Product implication |
| --- | --- | --- |
| A normal interrupt | Re-invoke with `Command(resume=value)` and the same `thread_id`. | Persist the graph/thread/checkpoint reference with every approval. |
| A subgraph called as a node | The surfaced v1 `Interrupt` has an ID and payload; the parent state snapshot's child task holds its checkpoint namespace. Resume still goes through the parent graph/thread. | Store namespace/checkpoint metadata; do not model an interrupt as only a top-level node. |
| Two parallel branches pause | Resume with `{ interrupt_id: response }`, not a positional list or one shared answer. | An approval decision must refer to the LangGraph interrupt ID as well as the request ID. |
| Code before `interrupt()` | It runs again when resumed. | Make it pure/idempotent; move writes after approval or protect them with an idempotency key. |

The implementation tests in `examples/refund-agent/test_refund_agent.py` run
each of these flows with `InMemorySaver`; the CLI uses Postgres so the main
approval path has the production persistence shape.

## Platform delta

The Platform uses a REST thread/run lifecycle instead of importing a local
checkpointer:

1. `POST /threads` creates the durable thread.
2. `POST /threads/{thread_id}/runs/stream` starts the graph with `input` and
   an `assistant_id`.
3. The same endpoint resumes with `command: { resume: <HumanResponse list> }`.
4. Run output, including interruption state, travels over SSE rather than the
   local `graph.invoke()` return object.

`platform_spike.py --dry-run` emits those three concrete requests. A live
Platform deployment and credentials are intentionally not assumed in this
workspace, so the live portion remains a pre-launch validation step rather
than a fabricated result. The endpoint shape is based on the current official
[thread run streaming API](https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-run-stream-output).
