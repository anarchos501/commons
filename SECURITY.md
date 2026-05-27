# Security

Commons handles mutual aid coordination and may touch sensitive support data. Security and privacy issues should be treated as urgent infrastructure work.

## Responsible Disclosure

Please report suspected vulnerabilities privately to the maintainers before public disclosure. Include reproduction steps, affected versions, impact, and any suggested mitigation.

## Threat Model Assumptions

- Node operators should not have unrestricted access to sensitive support data.
- Guests may need help without becoming permanent members.
- Contributors may need routed notifications without broad requester identity exposure.
- Roles, trust, and plugin permissions can become power centers if they are not scoped, visible, and revocable.
- Offline devices may be lost or shared, so sensitive local data must be encrypted.

## Privacy Expectations

- Support requests should auto-expire and be deletable.
- Recipient vulnerability should not become permanent public history.
- Privacy resolution should choose the most restrictive valid preference.
- Audit logs should record privileged actions without exposing sensitive request content.
- Export and deletion workflows are core security features.

## Support Data Handling

Collect the minimum data needed for coordination, store it for the shortest practical time, and avoid exposing it to plugins, admins, or contributors unless the person affected has consented and the relevant governance preferences allow it.
