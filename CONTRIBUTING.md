# Contributing to Commons

Commons contributions should strengthen cooperation, consent, privacy, auditability, and local autonomy.

## Code Standards

- Keep core behavior understandable before making it clever.
- Prefer typed interfaces, schema validation, and explicit permission checks.
- Treat privacy envelopes, governance preferences, retention, and deletion behavior as part of the feature, not cleanup.
- Add tests for sensitive flows, permission boundaries, routing logic, and data deletion.
- Avoid hidden authority paths and global scoring systems.

## Contribution Process

1. Open an issue or proposal for significant changes.
2. Keep pull requests focused and explain the governance, privacy, and security impact.
3. Document new data models, permissions, plugin hooks, or retention behavior.
4. Expect careful review for features touching support requests, guest access, trust, roles, federation, or plugins.

## Security Expectations

- Do not log sensitive support data.
- Do not add third-party intelligence services to core workflows.
- Do not bypass privacy envelopes for admin convenience.
- Do not create permanent recipient histories.
- Use scoped, expiring roles and visible permissions.

## Plugin Safety

Plugins must declare permissions, obey constitutional constraints, and remain auditable. Plugins cannot require AI services or access sensitive support data unless a node or group explicitly permits that access.
