# Cloud session cost ledger

Credits: $250 cloud-session grant, expires 1:59 AM CST, Nov 5 2026.
Readings come from the user's billing page; the assistant cannot see billing.
"Context tokens" is the session's remaining context-window budget as reported
to the assistant, a rough proxy for work volume, not a billing figure.

| Date (UTC) | Credits left | Spent since prior | Context tokens used (cum.) | Work completed at this point |
|---|---|---|---|---|
| 2026-09-24 | $250.00 | – | – | Grant claimed |
| 2026-10-02 | $245.00 | $5.00 | ~38k | Concept assessment, repo scaffold (Vite/TS/Three/Vitest), docs/MATH.md spec written |
| 2026-10-02 | (awaiting reading) | – | ~250k orchestrator + 1.44M build agents + 2.24M verify agents ≈ 3.9M | Math core and slicer; five modules built by 7 agents (polytopes, curved, lifting ×2, renderer, explainers, integration); 13-agent adversarial verification and fixes; visual check; 538 tests passing |

Notes:
- Agent token figures are the workflow runner's totals (`subagent_tokens`) for
  the two workflows; they include cached-context reads, so they overstate
  billable output tokens by an unknown factor. The next billing reading will
  calibrate $/token for this kind of session.
- Build workflow: 7 agents, 225 tool calls, 90 min wall clock, two agents at a
  time on a 4-core container. Verify workflow: 13 agents, 345 tool calls,
  108 min.
