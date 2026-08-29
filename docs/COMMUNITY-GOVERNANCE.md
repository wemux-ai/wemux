# Wemux Community Governance

This document defines where community input belongs and how maintainers turn it into actionable work.

## Choose the right channel

| Content | GitHub entry point | Expected output |
| --- | --- | --- |
| Reproducible defect | Issues / **Bug report** | A triaged bug with reproduction details and an owner |
| Clearly scoped engineering change | Issues / **Engineering task** | An actionable task with acceptance criteria |
| Installation, deployment, or usage question | Discussions / **Q&A** | A community answer or a documentation fix |
| Open-ended idea or product direction | Discussions / **Ideas** | Feedback, alternatives, and maintainer decision |
| User story, integration, or project showcase | Discussions / **Show and tell** | A reusable example or community reference |
| Maintainer-led plans and priorities | Discussions / **Roadmap** (or a clearly tagged roadmap post) | Status, rationale, and links to tracked work |
| Security vulnerability | Private report via [SECURITY.md](../SECURITY.md) | Confidential triage and coordinated disclosure |

Use an Issue only when the work can be described with a concrete outcome. A feature request that still needs discovery belongs in Discussions / Ideas. A maintainer may close or convert an Issue when it is in the wrong channel, preserving the original context in the linked Discussion.

## Issue quality bar

Every engineering Issue should include:

- the problem and affected users;
- a bounded scope and explicit non-goals;
- acceptance criteria that can be checked in review or testing;
- relevant dependencies, risks, and links to prior discussion.

Bug reports should include a minimal reproduction, expected and actual behavior, version or commit, deployment mode, affected area, and sanitized logs. Do not include credentials, private repository contents, or personal data.

## Maintainer workflow

1. Triage new Issues and Discussions regularly; the current goal is at least once per week as maintainer capacity allows.
2. Add type, area, priority, and status labels; link duplicates instead of creating parallel work.
3. Ask for missing reproduction details or acceptance criteria before assigning implementation.
4. Review Ideas at least monthly. Record the decision as `planned`, `needs research`, `not planned`, or `converted to issue`.
5. Keep the Roadmap maintainer-owned. Reactions and comments inform prioritization but do not constitute a binding vote.
6. Close stale or resolved threads with a short explanation and a link to the replacement resource, PR, release, or documentation.

The target for an initial maintainer response is within a few business days when maintainers are available. This is a best-effort service goal, not a guarantee; security reports follow the timeline in `SECURITY.md`.

## Labels

Use a small, predictable vocabulary:

- Type: `type:bug`, `type:task`, `type:docs`
- Status: `needs-triage`, `blocked`
- Priority: `priority:p0`, `priority:p1`, `priority:p2`
- Area: `area:web`, `area:server`, `area:worker`, `area:desktop`, `area:mobile`, `area:shared`, `area:ci`

Labels describe the current state; they do not replace the Issue or Discussion body. Maintainers should update them when scope or status changes.

## Repository boundary

The public repository is the community edition. Private or commercial implementation details must not be proposed through public Issues or Discussions. If a report is ambiguous, maintainers should request a sanitized reproduction and move any private details to a confidential channel.

GitHub's current repository categories include Q&A, Ideas, Show and tell, and Announcements. If a dedicated Roadmap category is added in repository settings, use it for maintainer-led planning posts; until then, publish those posts in Discussions with a clear `[roadmap]` title prefix and link them from `ROADMAP.md`.
