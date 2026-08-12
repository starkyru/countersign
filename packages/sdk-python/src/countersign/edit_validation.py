"""Enforcement of a request's edit contract.

The React package validates a reviewer's edit before it is submitted; this
module applies the same contract inside the graph, where the decision arrives
as an untrusted resume payload. Both sides must agree, so the semantics here
mirror `packages/react/src/edit-validation.ts`: editing is refused when the
request disallows it, a request without `context.edit_schema` keeps the
permissive Agent Inbox behavior, and any schema is evaluated against the full
edited argument object.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError
from pydantic import BaseModel, ConfigDict

from .models import ApprovalRequest


class EditValidationIssue(BaseModel):
    """One reason an edited argument object was refused."""

    model_config = ConfigDict(extra="forbid")

    path: str
    keyword: str
    message: str


class ApprovalContractError(ValueError):
    """A decision violated the contract the request published.

    Distinct from `ApprovalRejected`: a reviewer declining is an expected
    outcome, while a decision that the request never permitted indicates a
    faulty or hostile client and must not execute the action.
    """


class ApprovalEditValidationError(ApprovalContractError):
    """Raised when edited arguments fail the request's edit contract."""

    def __init__(self, issues: Iterable[EditValidationIssue]) -> None:
        self.issues = list(issues)
        super().__init__("; ".join(f"{issue.path}: {issue.message}" for issue in self.issues))


def _issue_from_error(error: ValidationError) -> EditValidationIssue:
    path = "/".join(str(part) for part in error.absolute_path)
    keyword = error.validator if isinstance(error.validator, str) else "schema"
    return EditValidationIssue(path=f"/{path}" if path else "args", keyword=keyword, message=error.message)


def validate_approval_edit(
    request: ApprovalRequest,
    args: Mapping[str, Any],
) -> list[EditValidationIssue]:
    """Return the issues blocking an edit; an empty list means it is allowed."""
    if not request.config.allow_edit:
        return [
            EditValidationIssue(
                path="args",
                keyword="permission",
                message="Editing is disabled for this approval",
            )
        ]

    schema: dict[str, Any] | None = request.context.edit_schema if request.context else None
    if not schema:
        return []

    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as error:
        return [EditValidationIssue(path="schema", keyword="schema", message=error.message)]

    errors = sorted(
        Draft202012Validator(schema).iter_errors(dict(args)),
        key=lambda error: [str(part) for part in error.absolute_path],
    )
    return [_issue_from_error(error) for error in errors]
