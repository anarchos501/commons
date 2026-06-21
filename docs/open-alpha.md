# Commons Open Alpha

Commons is experimental software for testing mutual aid coordination and community governance. This document is for testers, developers, and people reviewing whether the model is coherent and usable.

**Open Alpha is for hypothetical testing, architecture review, and governance feedback. It is not ready for real-world sensitive deployment.**

---

## What Commons Can Do Now

Commons currently lets communities:

- Accept public support requests from neighbors, with or without accounts.
- Route requests to contributors based on service capability, availability, contribution categories, and trusted provider status.
- Coordinate inside collective, project, and responsibility workspaces.
- Use discussions, bulletins, publications, and living documents as shared coordination material.
- Apply for collective membership, sponsor pending applicants, and decide membership requests through petitions.
- Propose projects through host-collective governance, then let active project members govern project-internal decisions. Project join requests are approved by existing members.
- Volunteer for collective responsibilities and confirm responsibility assignments through petitions.
- Form coalitions — multi-collective spaces where each collective keeps its own members and governance. Coalition proposals run as bundled petitions requiring separate approval from each member collective.
- Use governance temperature signals across 17 categories to affect displayed thresholds and petition durations.
- Declare emergency periods through petitions and show active emergency periods in the governance surface.
- File and review accountability concerns where appropriate responsibilities are assigned.
- View node feedback and routing activity in the node host inbox.

**Terminology:** The user-facing label for what the codebase calls a "Group" is "Collective."

The goal is not production readiness. The goal is to test whether Commons makes cooperation easier without hiding power, permanence, or surveillance behind the interface.

---

## What To Test

**Core coordination**

- Submit a support request as a guest.
- Create an account and join or apply to join a collective.
- Route a request to eligible contributors.
- Accept or decline routed requests.
- Complete a request and observe the privacy-safe contribution record.

**Collective governance**

- Sponsor a pending membership application.
- Support, withdraw support from, and explicitly evaluate petitions.
- Propose a project and approve it through collective governance.
- Adjust governance temperature signals across the 17 categories.
- Declare an emergency and observe the active emergency period.

**Coalitions**

- Create a coalition and invite another collective.
- Follow the bundled petition flow — both collectives must approve separately.
- Propose a host-adoption federation proposal and trace the multi-collective approval process.
- Depart a coalition and observe how the departure petition works.

**Project spaces**

- Open a project from the sidebar.
- Use project discussion, bulletins, publications, and living documents.
- Request to join a project from a second account and approve or dismiss the request.
- Propose project-scoped library revisions or contribution categories.
- Confirm that project-internal petitions use project membership, not host-collective membership.

**Responsibilities**

- Volunteer for a responsibility.
- Confirm a responsibility assignment through petition approval.
- Visit a responsibility workspace.
- Resign from a responsibility.
- Observe coverage status in the collective responsibility section.

**Accountability**

- File a concern report.
- Start a review as a member holding the Reviewer responsibility.
- Issue findings and follow the concern lifecycle.

---

## What Not To Use Commons For

Do not use Commons for:

- Real medical emergencies or safety situations.
- Real legal emergencies or sensitive legal matters.
- Private or confidential organizing that requires data security.
- Sensitive personal information such as health, immigration, financial, or legal details.
- Any situation where data exposure would cause real harm.

Alpha data is stored in plaintext on the server. No end-to-end encryption exists yet. The server operator can read stored content.

---

## Security And Data Caveats

- All non-password data is stored as plaintext on the server.
- Passwords are hashed.
- Sessions use signed cookies.
- There is no email verification, password reset, or account recovery.
- Alpha data may be reset without notice.
- There is no production moderation/admin console.

**Alpha is for coordination modeling and governance feedback, not operational security.**

---

## Known Gaps

| Gap | Status |
|---|---|
| Password reset / account recovery | Not implemented |
| Email notifications | Not implemented |
| End-to-end encryption | Deferred |
| Admin / moderation console | Deferred |
| Federation between nodes | Deferred |
| Plugin runtime | Deferred |
| Challenge window mechanics | Deferred |
| Mobile/PWA offline support | Deferred |
| Advanced proposal-family workflows | Partially surfaced |

Governance UX is now surfaced in group, project, and responsibility contexts, but it remains alpha-grade and should be tested for clarity and correctness.

---

## Suggested Demo Scenarios

1. **Guest support request:** submit a fictional request, route it, accept it, and complete it.
2. **Membership sponsorship:** apply to a non-open collective, sponsor the pending application, support the petition, and approve membership.
3. **Project creation:** propose a project, approve it through the host collective, then use the resulting project workspace.
4. **Project join request:** from a second account, request to join a project; approve or dismiss the request as an existing member.
5. **Project-internal governance:** as an active project member, propose a living document revision and approve it through a project-scoped petition.
6. **Responsibility volunteering:** volunteer for Reviewer, approve the responsibility petition, then visit the responsibility workspace.
7. **Coalition formation:** create a coalition, invite a second collective, and follow the bundled petition approval flow.
8. **Emergency declaration:** open an emergency petition, approve it, and confirm the emergency period appears in governance settings.
9. **Governance temperature:** adjust category signals and observe threshold/duration changes.

---

## Feedback That Helps Most

- What was confusing?
- What felt unnecessarily complicated?
- What felt missing?
- Which terms were unclear?
- Which workflows felt natural?
- Which workflows felt frustrating?
- What did you expect to happen that did not?

Bug reports are welcome, but the deeper question is whether the model makes sense to people who are not already inside it.

---

## Data Reset Policy

Alpha data may be cleared at any time without notice.

- Do not store anything you need to keep.
- Do not use Alpha for real coordination that would be harmed by data loss.
- Seed data may be re-applied after resets.

---

## Reporting And Feedback

- GitHub issues: [github.com/anarchos501/commons/issues](https://github.com/anarchos501/commons/issues)
- Direct contact with the operator

---

## Beta-Critical Gaps

1. Password reset and account recovery.
2. Email verification or another anti-abuse path.
3. Basic admin tooling for local operators.
4. Security review of sessions, rate limiting, input validation, and data retention.
5. User-facing data deletion/export workflows.
6. Clearer onboarding for membership, petitions, responsibilities, and project autonomy.
7. Mobile/PWA support if Commons is expected to be used in the field.
