# Contributing to Commons

Commons contributions should strengthen cooperation, consent, privacy, auditability, and local autonomy.

Before proposing a major feature, read the [Commons Charter](docs/charter.md). Before implementing interface work, read the [Commons Experience Principles](docs/experience-principles.md).

## Project Boundary

This repository is independent.

Do not import code, schemas, migrations, databases, or configuration from the other project.

Any shared functionality must be explicitly copied or packaged.

Before making schema, governance, roadmap, or implementation recommendations, verify which repository is currently open. Commons and Tribal Commons are independent projects. Similar concepts do not imply shared implementation.

If this project identity conflicts with surrounding folder names, package names, database names, or prior context, stop and ask before proceeding.

## Code Standards

- Keep core behavior understandable before making it clever.
- Prefer typed interfaces, schema validation, and explicit permission checks.
- Treat privacy envelopes, governance preferences, retention, and deletion behavior as part of the feature, not cleanup.
- Add tests for sensitive flows, permission boundaries, routing logic, and data deletion.
- Avoid hidden authority paths and global scoring systems.

## Feature Review Filter

Every significant change should answer:

- Does this help communities coordinate themselves?
- Does it avoid unnecessary surveillance, bureaucracy, dependency, or hidden power?
- Does it preserve deletion, expiration, revocation, correction, and consent withdrawal where appropriate?
- Does it keep shared coordination visible and accountable while keeping personal life private and sovereign?
- For interface work, does it feel calm, understandable, dignified, privacy-visible, mobile-friendly, and low-pressure?

If a feature increases power, retention, identity requirements, or administrative reach, its benefits and limits should be explicit.

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
