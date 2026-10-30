# Mobile UX design synthesis

- Candidates: shared shell overlay and reusable Account XP boundary (A), or minimal in-place shell patch with native disclosure and launch marker (B).
- Cross-judge base: B, because it keeps the existing providers and routes stable, uses a native keyboard-accessible disclosure, and limits the verification surface.
- Grafted choices from A: split Account Level presentation content from its panel wrapper, and apply scoped safe-area shell spacing.
- Final opening choice: use a small client overlay under the persistent `/app` layout, gated to the `/app` entry path. This keeps ordinary `/app` entry and installed `start_url` deliberate without changing invite or battle URLs. Direct battle routes stay unobstructed.
- Rejected: a URL launch marker. It adds route state only for presentation and complicates refresh/return behavior without improving the installed `/app` start path.
- Verification target: focused audio and Account XP tests, app-shell type/lint/build, and browser screenshots at 390x844 and 1366x768. Authenticated Privy acceptance remains unavailable unless a real session is supplied.
