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

| 2026-10-03 | (awaiting reading) | – | 1.90M build agents (5 Sonnet implementers + 1 default-model integrator) + 1.81M verification agents (6 default-model reviewers, 3 Sonnet fixers, confirm) + ~0.3M orchestrator ≈ 4.0M | Round 2: spin lifting, SDF shapes, Flatland mode, OBJ/GLB import, WebXR; 22 findings, 2 spin bugs and 1 input bug fixed; 1124 tests passing |

Notes:
- Agent token figures are the workflow runner's totals (`subagent_tokens`) for
  the two workflows; they include cached-context reads, so they overstate
  billable output tokens by an unknown factor. The next billing reading will
  calibrate $/token for this kind of session.
- Build workflow: 7 agents, 225 tool calls, 90 min wall clock, two agents at a
  time on a 4-core container. Verify workflow: 13 agents, 345 tool calls,
  108 min.
- Round 2 build: 6 agents, 350 tool calls, 90 min. Round 2 verification:
  10 agents, 284 tool calls, 82 min. Implementers and fixers ran on Sonnet
  at the user's request; integration and the reviewers stay on the default
  model because a wrong judgement there costs more than it saves. The
  Sonnet build was about 20 % cheaper in tokens than round 1's build for a
  comparable amount of code, and its reports were as thorough.
