# Contributing

Issues and pull requests are welcome for the Python SDK, React components,
wire schema, examples, and public documentation.

## Development checks

```sh
corepack pnpm install --frozen-lockfile
pnpm typecheck
pnpm build

cd packages/sdk-python
uv run --all-extras --group dev pytest -q
uv run --all-extras --group dev mypy src
uv build
```

Keep changes inside the public repository boundary described in
`docs/repository-boundary.md`. Hosted service implementation, credentials,
billing, private infrastructure, and operational configuration belong in
`countersign-cloud` and should not be included in public issues or patches.

By contributing, you agree that your contribution is licensed under MIT.
