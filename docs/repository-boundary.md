# Repository boundary

Countersign separates its open-source integration surface from the hosted
service so the MIT license has an unambiguous scope.

## This repository: `countersign`

- Python types, decorators, and LangGraph adapters;
- React approval components and client-side store interfaces;
- the versioned JSON wire schema;
- examples and public integration documentation.

Everything tracked here is licensed under MIT unless a file says otherwise.

## Private repository: `countersign-cloud`

- hosted API and reviewer console applications;
- organization identity, sessions, RBAC, and team policy enforcement;
- billing, notifications, escalation, and activation services;
- production database implementations and operational tooling;
- VPS/AWS deployment configuration and private product documentation.

Public models may describe fields used by a hosted service; that does not move
the hosted implementation into the public boundary. Released public packages
are consumed directly by pinned version from the private repository. The
private repository does not vendor a second copy of their source or schema.
