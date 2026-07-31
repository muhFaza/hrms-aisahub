# Handbook

Reference documentation for HRMS Aisahub. Linked from both [CLAUDE.md](../CLAUDE.md) and
[AGENTS.md](../AGENTS.md).

This is **living reference material** — it describes how the system behaves today. It is
separate from `docs/`, which holds the thesis design plan and the UAT script: those are
historical records of what was *intended*, and are deliberately not kept in sync with the
code.

| Page | What it answers |
| --- | --- |
| [architecture.md](architecture.md) | How the pieces fit together, request lifecycle, where code goes |
| [domain-rules.md](domain-rules.md) | The HR policy the code encodes — leave, payroll, overtime, THR |
| [data-model.md](data-model.md) | Tables, relationships, enums, migrations, seed data |
| [auth-and-roles.md](auth-and-roles.md) | Who can do what, and how it is enforced |
| [notifications.md](notifications.md) | The eight events, why emission is transactional, the bell |
| [api-reference.md](api-reference.md) | All 49 endpoints |
| [frontend.md](frontend.md) | Pages, routing, data fetching |
| [testing.md](testing.md) | Test setup and how to add a test |
| [operations.md](operations.md) | Setup, environment variables, Docker, CI/CD, deployment |
| [known-issues.md](known-issues.md) | Real problems already found — check before reporting one |
| [glossary.md](glossary.md) | Indonesian HR and technical terms in plain English |

## Start here

**Setting up for the first time?** [operations.md](operations.md).

**Trying to understand a rule** — how leave is earned, what finalizing payroll does?
[domain-rules.md](domain-rules.md).

**About to change authorization or user accounts?** [auth-and-roles.md](auth-and-roles.md)
first. Two real vulnerabilities were fixed in that area, and the tests exist to stop them
returning.

**Non-technical?** Read [AGENTS.md](../AGENTS.md) and [glossary.md](glossary.md) instead —
those are written for you.

## Keeping this accurate

These pages describe behaviour, not intentions. When you change a rule, a permission, or a
setup step, update the page that covers it in the same change — a handbook that has drifted
is worse than none, because it is trusted.

[known-issues.md](known-issues.md) is the exception that should *shrink*: delete an entry
when it is fixed rather than marking it resolved.
