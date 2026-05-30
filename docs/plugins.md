# Plugins

Plugins extend Commons but must never become hidden authority.

## The Core Model

The coordination model that Commons protects is:

> Need → Coordination → Contribution → Community Memory → Accountability

Plugins may extend this model. They may not replace it, bypass its constitutional constraints, or import external administrative complexity into the core platform.

## What Belongs in Plugins

Communities sometimes need capabilities beyond coordination. Those capabilities belong in optional plugins, not in core Commons:

- document storage and retrieval
- cloud-drive integration
- inventory management
- warehousing and asset tracking
- accounting integration
- fundraising integrations
- procurement and resource logistics

Communities that need these capabilities may install them as community-governed plugins. The core platform remains focused on coordination rather than record management or administrative infrastructure.

## Plugin Requirements

Plugins must:

- declare permissions explicitly before activation
- obey constitutional constraints set by node and group governance
- obey privacy envelopes on all data they access
- remain auditable by group and node administrators
- avoid requiring AI services that cannot be governed or explained locally

Sensitive support data is unavailable to plugins unless explicitly permitted by node or group governance and affected participant consent.

## Documents, Files, and Vulnerability

Plugins that handle documents or external files must obey the same vulnerability-archiving protections as core Commons:

- Documents containing sensitive personal information should not be retained longer than the coordination event that required them.
- File replication through federation must be governed by replication policies and privacy envelopes.
- No plugin may silently archive vulnerability-associated documents without explicit participant consent and explicit community governance.

A plugin that makes Commons into a document repository by default violates the spirit of the platform, even if it satisfies the technical permission requirements.
