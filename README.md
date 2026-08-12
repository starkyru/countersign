# Countersign

Open-source human approval primitives for LangGraph agents.

Countersign provides a typed Python SDK, reusable React approval components,
and an Agent Inbox-compatible wire schema. Use it to pause a consequential
tool call, show a reviewer a structured diff, and resume the graph with an
approve, reject, edit, or response decision.

*A countersignature is the second human signature that authorizes an action.*

Website: [countersign.cloud](https://countersign.cloud)

## Python SDK

The distribution is named `countersign-ai`; the import package is
`countersign`.

```sh
pip install countersign-ai
```

```python
from countersign import require_approval


@require_approval(action="issue_refund", description="Approve this refund")
def issue_refund(order_id: str, amount_usd: float) -> str:
    return payments.refund(order_id, amount_usd)
```

The decorator emits a typed request through LangGraph `interrupt()` and only
executes the wrapped action after a compatible resume decision. See
[`packages/sdk-python`](packages/sdk-python) and the
[`refund-agent`](examples/refund-agent) example.

## React components

The npm organization is `countersign-ai`; the React package will be published
under the `@countersign-ai` scope.

```sh
npm install @countersign-ai/react
```

```tsx
import { ApprovalInbox, HttpApprovalStore } from "@countersign-ai/react";
import "@countersign-ai/react/styles.css";

const store = new HttpApprovalStore({ baseUrl: "/api/countersign" });

export function ReviewQueue() {
  return <ApprovalInbox store={store} />;
}
```

The package includes the inbox, approval cards, structured action diffs,
schema-validated edit forms, and an audit timeline. Applications retain
control of authentication and transport headers.

## Repository layout

```text
packages/react       React component library
packages/sdk-python  LangGraph-native Python SDK
packages/schema      Versioned approval request JSON Schema
examples/            Runnable LangGraph examples
docs/                Public integration and oversight guides
```

The proprietary hosted console, team backend, billing, notifications,
deployment, and infrastructure live in the private `countersign-cloud`
repository. See [`docs/repository-boundary.md`](docs/repository-boundary.md)
for the source boundary.

## Develop

Prerequisites are Node 22+, pnpm 10.30.3, Python 3.11+, and `uv`.

```sh
corepack pnpm install --frozen-lockfile
pnpm typecheck
pnpm build

cd packages/sdk-python
uv run --all-extras --group dev pytest -q
uv run --all-extras --group dev mypy src
uv build
```

## Guides

- [Agent Inbox migration](docs/agent-inbox-migration.md)
- [LangGraph Platform integration](docs/langgraph-platform.md)
- [EU AI Act human oversight](docs/eu-ai-act-human-oversight.md)
- [Wire schema](packages/schema/README.md)

## License

MIT. See [LICENSE](LICENSE).
