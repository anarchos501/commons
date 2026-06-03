# Commons Open Alpha

Commons is experimental software for testing coordination and governance ideas. This document is for testers, developers, and anyone curious about how mutual aid coordination infrastructure might work.

**Open Alpha is for hypothetical testing, architecture review, and governance feedback — not real-world sensitive deployment.**

---

## What Is Commons Open Alpha

Commons is a mutual aid coordination platform that lets communities:

- Accept support requests from neighbors (with or without accounts)
- Route requests to trusted contributors based on service capability and trust
- Coordinate through shared spaces: bulletins, publications, living documents, and projects
- Assign and confirm community responsibilities (reviewer, steward, etc.)
- Govern collectively through temperature-weighted petition and confirmation workflows

The Open Alpha makes this infrastructure publicly available for review and feedback. The goal is not feature completeness — it is to test whether the underlying model is coherent, honest, and usable.

---

## What to Test

These are the areas most valuable to exercise during Open Alpha:

**Core coordination**
- Submit a support request as a guest (no account needed)
- Create an account and join a group
- Offer help by declaring a service capability
- Browse requests you can respond to

**Communication**
- Post a bulletin in a group or project space
- Create a publication and add entries
- Create and revise a living document
- Create a project and explore its coordination space

**Responsibilities**
- Volunteer for a responsibility (e.g., Reviewer)
- Observe responsibility assignment and coverage behavior
- Observe what happens when a member becomes Quiet or Dormant

**Accountability**
- File a concern report
- Begin a concern review (if you hold the Reviewer responsibility)
- Issue findings on a concern

**Governance**
- Express a governance temperature signal (More Restrictive / Neutral / Less Restrictive)
- Observe how the signal affects displayed governance parameters
- Open a petition for a community decision

---

## What Not to Use Commons for

**Do not use Commons for:**

- Real medical emergencies or safety situations
- Real legal emergencies or sensitive legal matters
- Private or confidential organizing that requires data security
- Sensitive personal information (health, immigration status, financial details)
- Any situation where data exposure would cause real harm

**Why:** Alpha data is stored in plaintext on the server. No end-to-end encryption exists yet. The server operator can read all stored content. Treat everything entered into Alpha as non-private.

---

## Security and Data Caveats

- All data is stored as plaintext on the server. The server operator has full read access.
- There is no end-to-end encryption in this version.
- Passwords are hashed. Everything else is unencrypted at rest.
- Sessions use signed cookies (iron-session). Session tokens are not exposed in the UI.
- There is no email verification, password reset, or account recovery in Alpha.
- Alpha data may be reset without notice. Do not rely on data persistence.

**Alpha is for coordination modeling and governance feedback, not operational security.**

---

## Known Gaps

These features are intentionally absent from Open Alpha:

| Gap | Status |
|---|---|
| Password reset / account recovery | Not implemented |
| Email notifications | Not implemented |
| Governance UX (petition UI, temperature display) | Backend only; no UI yet |
| End-to-end encryption | Deferred |
| Admin / moderation console | Deferred |
| Federation between nodes | Deferred |
| Challenge window mechanics | Deferred |
| Mobile / PWA | Deferred |
| Plugin system | Deferred |

The governance infrastructure (RFC-006: temperature signals, petitions, responsibility confirmation) exists in the backend and is tested, but is not yet surfaced through the dashboard UI. It can be exercised via the API or seeded test scenarios.

---

## Suggested Demo Scenarios

These scenarios use a fictional group — **Northside Commons** — with approximately 20 members. All names and situations are invented.

**Scenario 1 — Guest support request**
A neighbor named Mateo needs help moving supplies before a storm. He goes to the Commons landing page, selects Northside Commons, picks "moving help" as a service, sets urgency to high, and submits. He receives a private link to track the request.

**Scenario 2 — Member joins and offers help**
Amara creates an account, joins Northside Commons, and declares that she can offer rides within 5 miles. She does not need to be a member to receive requests — but membership lets her see routed requests she qualifies for.

**Scenario 3 — Reviewer responsibility**
The group needs someone to handle accountability concerns. Priya volunteers for the Reviewer responsibility. A governance petition opens. Other active members signal support. Once the petition closes with enough support, Priya is confirmed as a Reviewer.

**Scenario 4 — Group bulletin**
Northside Commons is hosting a tool-sharing event. A member posts a bulletin: "Tool Library pop-up: Saturday 10am–2pm at the community garden." All group members can see it.

**Scenario 5 — Living document revision**
The group's Code of Conduct needs updating. A member drafts a revision and opens a governance petition. The community reviews it during the petition window and signals support. On approval, the new version becomes the current document.

**Scenario 6 — Emergency Preparedness project**
A subset of members want to coordinate emergency preparedness specifically. They create a project under Northside Commons. The project has its own bulletins, publications, and living documents. Host group members can be invited to join.

**Scenario 7 — Concern reported and reviewed**
A member reports a concern about a contributor's behavior. A Reviewer is assigned, starts a review, and eventually issues findings. The group decides on a response through a concern action proposal.

**Scenario 8 — Governance temperature signal**
A member thinks the group's membership process is too open and should require more support to admit new members. She sets her governance temperature signal to "More Restrictive" for the membership category. The collective temperature shifts slightly. If enough members signal in the same direction over time, the effective membership threshold adjusts.

**Scenario 9 — Collective support request**
The Emergency Preparedness project needs help from another community network. A project member submits a collective support request on behalf of the project, triggering a governance petition within the project before the request is sent.

---

## What Feedback Is Most Valuable

The goal of Open Alpha is design improvement, not only bug reports.

We are especially interested in:

- **What was confusing?** Which parts of the interface or model were hard to understand on first contact?
- **What felt unnecessarily complicated?** Where did the system create friction that didn't feel justified?
- **What felt missing?** What did you expect to be able to do that wasn't there?
- **Which words or concepts were hard to understand?** "Participation status," "governance temperature," "petition" — did these land, or did they create confusion?
- **Which workflows felt natural?** What worked without needing explanation?
- **Which workflows felt frustrating?** Where did the system get in your way?
- **What did you expect to happen that didn't?** Surprises (good and bad) are valuable data.

Bug reports are welcome. But the more important question is: **does the model make sense to people who aren't already familiar with it?**

---

## Data Reset Policy

Alpha data may be cleared at any time without notice.

- Do not store anything you need to keep.
- Do not use Alpha for real coordination that would be harmed by data loss.
- Seed data may be re-applied after resets, restoring the demo group structure.

---

## Reporting and Feedback

Feedback channels are not yet formalized. In the interim:

- GitHub issues: [github.com/anarchos501/commons/issues](https://github.com/anarchos501/commons/issues)
- Email or direct contact with the operator

---

## Beta-Critical Gaps

The following need to exist before a public beta:

1. **Password reset** — users are otherwise permanently locked out if they lose access
2. **Email verification** — prevents account enumeration and spam
3. **Governance UX** — petition creation, temperature signal UI, and status display need to be surfaced in the dashboard
4. **Basic admin tooling** — at minimum: the ability to reset a group, remove a member, or clear stale data
5. **Security review** — session handling, rate limiting, and input validation reviewed by someone with a security background
6. **Data retention and deletion** — users should be able to delete their accounts and associated data
7. **Clearer onboarding** — new users need orientation; the model is not yet self-explaining in the UI

---

## Manual UI Settings Principle

Commons is designed around a principle: **membership unlocks possible actions, not a flood of visible complexity.**

Joining a group should reveal what you can do — not immediately present every system at once. UI visibility and preferences should be manually editable by the user. The interface should not permanently force complexity onto the screen because a user became a member or completed an action.

This principle will guide how governance UX, responsibility interfaces, and advanced features are introduced in later phases.
