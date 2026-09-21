# Djonik v1 — architecture audit and accepted delivery decision

Date: 2026-09-21. Governance: [#30](https://github.com/danielkokr/djonik-manager-2.0/issues/30).
Baseline: `97af2e41d417c17a37bcc217ba59556138942307`.
Status: documentation/backlog decision; the reliability fixes and v1 acceptance below are **not implemented by this document**.

## 1. Decision and product outcome

Keep Telegram → thin Session client → Claude Managed Haiku coordinator → native Skills/Memory/Trello, with the existing bounded read-only Sonnet Project Health specialist. Claude owns reasoning and delegation; deterministic boundaries own verifiable target/result and turn provenance. No replacement agent, custom Messages loop, transcript store, RAG, Trello mirror or PM rules engine.

The first release should help Daniel turn design input into tasks, choose realistic priorities, assess current work, retain accepted commitments and continue waiting/follow-up conversations. It should work across his recurring projects without making him operate a command interface. v1 starts when Daniel initiates a conversation; proactive delivery is a later extension. The core product contract remains broader than this release.

Do not equate a passed fixture or closed issue with dependable PM behavior. v1 requires an observed working-week pilot and an explicit accept/hold decision (#35).

## 2. What was inspected and what is known

Evidence comprises repository code and tests at the baseline, #28/#29 reports, source/config records, isolated offline synthetic event streams and the official API references below. No new paid Session, Trello mutation or live production attestation was performed for this audit/governance change.

- Baseline checks: typecheck passed; 330 tests passed, 0 failed/skipped; diff check passed. The new adversarial streams expose cases outside that suite.
- #28 is historically accepted: v19 Haiku coordinator, PH Sonnet specialist v4, native delegation and exact reply-boundary acceptance through connectToDjonik; see §48 in the [implementation report](15_ISSUE_28_IMPLEMENTATION_REPORT.md).
- #29 discovery and source Skill were accepted; production attach v20 failed behavioral acceptance, then rollback produced v21. Recorded v21 is semantically v19 apart from version/update metadata. Four coordinator Skills resolve via latest; specialist is pinned v4. Remote work-review remains retained, unattached and unaccepted.
- These are recorded resource facts. Neither the audit nor the rollback record establishes what an already-running Telegram Session serves. Agent configuration and serving Session are different evidence.
- #29 Turn 1 read the Skill and fresh Trello but invented completion order, naturalized UTC 07:09 as local-looking time (Kyiv would be 10:09), misstated counts (three Done versus four listed; five This-week versus six available), and produced an excessive inventory. Cost $0.06.
- Turn 2 delegated PH correctly but stopped at budget_reached with no final reply. Total was $0.32 against the requested $0.30. Remaining $0.24 was below the previously observed $0.31 full delegated turn; an in-flight request can also overshoot a native cap. That sample did not revalidate relay.
- The work-review source already explicitly prohibited fake chronology and local-time conversion. Regex assertions about those rules are not tests of model compliance.
- Sonnet avoided dominant Haiku failures in #28 comparisons, but earlier Sonnet samples also contained invented entities, verbosity and missing fresh reads. Ownership is a measured choice, not a guarantee associated with a model name.
- #18 remains a limitation of enforcing conditional same-turn fresh reads under this architecture; Trello fresh reads themselves are available.

Historical details and original recommendations remain in [the #29 report](16_ISSUE_29_WORK_REVIEW_DISCOVERY_REPORT.md). Its former hardening-only next step is superseded by this decision.

## 3. Reachable reliability gaps

These are **offline reproductions**, not claims that all seven occurred in production or estimates of their frequency. Line locations refer to the baseline.

| ID | Evidence / actual result | Required behavior | Owner |
|---|---|---|---|
| R1 | Create A returns ID A; unrelated board read permits “Created A”. djonikClient.ts:849–887 uses missing input cardId fallback. | Resolve actual create target and verify that card. | #31 |
| R2 | Writes A and B followed only by read B permit “Updated both”; one pending slot at :768–782 is overwritten. | Account for every operation and supported changed-field postcondition; surface partial completion. | #31 |
| R3 | “Working...” followed by idle/budget_reached returns as final success (:919). | Distinguish end_turn from pause/action/error/incomplete turn. | #32 |
| R4 | Child “HEALTH ONLY” plus coordinator “HEALTH AND DAILY PLAN” returns only the child (:681, :1045). | Preserve specialist evidence and independently requested output. | #32 |
| R5 | Child starts, budget idle, late OLD HEALTH arrives during a new ordinary turn; second reply becomes OLD HEALTH (:983 and retained child IDs). | Correlate turn/delegation/results, including late events and reused threads. | #32 |
| R6 | Card A due:null with nested board.due returns the board timestamp (:433–459). | Anchor extraction to the verified card object and identity. | #31 |
| R7 | Two roster entries make resolveProjectHealthSpecialistName return null (:645). | Resolve canonical identity independently of unrelated entries; ambiguity must be explicit. | #32 |

The existing fallback to coordinator text when specialist provenance is missing is a **bypass of exact-preservation protection**, not a general fail-closed guarantee. The two-roster fixture does not authorize a second production specialist.

Inspect telegramAdapter.ts:273 (process Session lifetime) during #33. Reported errors should distinguish interruption from successful work without exposing raw provider internals unnecessarily; do not introduce a general error framework here. Preserve FIFO, due-date handling and telemetry.

### Offline reproduction

Run from the repository root using Node/tsx, e.g. save the following to a temporary .mjs file in the root and run `node --import tsx <file>`, then remove only that temporary file. All clients below are in-memory mocks; no SDK/network/credentials are used. On a fixed revision these outputs should change; regression tests must assert the safe desired outcomes, not freeze the bugs.

```javascript
import {
  connectToDjonik, PROJECT_HEALTH_SPECIALIST_AGENT_ID,
  extractVerifiedDueFromTrelloReadContent, resolveProjectHealthSpecialistName
} from './src/djonikClient.ts';
const msg = text => ({type:'agent.message',content:[{type:'text',text}]});
const idle = type => ({type:'session.status_idle',stop_reason:{type}});
const use = (id,name,input) => ({type:'agent.mcp_tool_use',id,name,input,mcp_server_name:'trello'});
const result = (id,value={}) => ({
  type:'agent.mcp_tool_result',mcp_tool_use_id:id,is_error:false,
  content:[{type:'text',text:JSON.stringify(value)}]
});
const roster = {multiagent:{type:'coordinator',agents:[
  {type:'agent',id:PROJECT_HEALTH_SPECIALIST_AGENT_ID,name:'PH'}
]}};
const child = {type:'session.thread_created',agent_name:'PH',session_thread_id:'child'};
const childMsg = text => ({
  type:'agent.thread_message_received',from_agent_name:'PH',
  from_session_thread_id:'child',content:[{type:'text',text}]
});
async function probe(label,events,agent,turns=1) {
  let index=0,sends=0;
  const stream={controller:{abort(){}},[Symbol.asyncIterator](){return {
    next:async()=>index<events.length
      ? {done:false,value:events[index++]} : {done:true}
  }}};
  const fake={beta:{sessions:{
    create:async()=>({id:'MOCK_ONLY',agent}),
    events:{stream:async()=>stream,send:async()=>{sends++}}
  }}};
  const handle=await connectToDjonik(fake,'mock','mock','mock','mock');
  const replies=[];
  for(let i=0;i<turns;i++){
    try { replies.push(await handle.send('synthetic audit input')); }
    catch(e) { replies.push('ERROR: '+e.message); }
  }
  console.log(JSON.stringify({label,replies,sends}));
}
await probe('R1',[
  use('w','trelloWriteCard',{action:'create',title:'A'}),result('w',{id:'A'}),
  use('r','trelloReadBoard',{boardId:'other'}),result('r'),msg('Created A'),idle('end_turn')
]);
await probe('R2',[
  use('a','trelloWriteCard',{cardId:'A',title:'new A'}),result('a'),
  use('b','trelloWriteCard',{cardId:'B',title:'new B'}),result('b'),
  use('r','trelloReadCard',{cardId:'B'}),result('r',{id:'B',title:'new B'}),
  msg('Updated both'),idle('end_turn')
]);
await probe('R3',[msg('Working...'),idle('budget_reached')]);
await probe('R4',[child,childMsg('HEALTH ONLY'),msg('HEALTH AND DAILY PLAN'),idle('end_turn')],roster);
await probe('R5',[
  child,idle('budget_reached'),childMsg('OLD HEALTH'),
  msg('NEW ORDINARY ANSWER'),idle('end_turn')
],roster,2);
console.log(JSON.stringify({label:'R6',actual:extractVerifiedDueFromTrelloReadContent([
  {type:'text',text:JSON.stringify({id:'cardA',due:null,board:{id:'board',due:'2026-09-22T21:30:00Z'}})}
])}));
console.log(JSON.stringify({label:'R7',actual:resolveProjectHealthSpecialistName({
  multiagent:{type:'coordinator',agents:[
    ...roster.multiagent.agents,{type:'agent',id:'future',name:'future'}
  ]}
})}));
```

## 4. Current-state review and model ownership

#29 must simplify the promised output and validate capability ownership after #31/#32. Do not pay to rediscover missing action history or add another blanket prompt-hardening round as the assumed fix.

Fresh current Done/list/closed/dueComplete state is not a completion timeline. Treat conflicting signals and incomplete query coverage explicitly. lastActivityAt is not progress, actor, move, reopen or completion evidence. Compare accepted plan identity with current evidence only when the match is clear; no “completed this week” from current state alone. Useful concise facts can stand without a forced PM takeaway.

Start with a source contract and behavioral rubric. A later authorized isolated experiment may compare simplified Haiku review with a bounded extension of the **existing** read-only Sonnet PH role. Do not predetermine the winner or attach an unaccepted candidate to production. An isolated temporary diagnostic resource is not permission for another permanent production specialist.

Follow [validation policy §27](04_MANAGED_AGENT_TOKEN_COST_AUDIT.md#27-development--validation-spend-guardrail-issue-21): one fail-fast diagnostic; for a candidate proceeding to acceptance, five independent varied samples in total plus one multi-turn case, planned and budgeted up front. Critical failures stop the run. Sample coverage is a practical gate, not a statistical guarantee.

## 5. Context, commitments and deferred work

Claude Memory owns stable user/project context and explicitly accepted plans/decisions. Trello owns current operational state. Extend accepted #13 with a bounded conversational lifecycle in #34: identity and provenance, explicit acceptance, waiting-on/next check, reschedule/snooze, correction, cancellation and evidence-backed resolution. No durable raw transcript or duplicated task-state store.

Align weekly-planning semantics in that issue: current source labels due-this-week as hard deadlines and groups waiting with blocked. Due alone is not a client promise; waiting alone is not an obstruction.

After v1, consider only with measured need and a separate bounded issue:

- **Proactive PM:** native Scheduled Deployments first, after checking workspace availability. A thin delivery boundary handles SEND/SILENT, run/outcome deduplication, snooze/resolution and ambiguous-send recovery. No blind retry after uncertain delivery. Share tested finalization with scheduled execution, which bypasses connectToDjonik. Delivery metadata is not a history database. Native schedule jitter up to nine minutes means it is unsuitable for exact-minute promises.
- **History observations:** only if current-state review is insufficient in actual use, try one-project event-driven accepted-plan/review observations in native Memory with timestamps, source and explicit partial coverage. Differences between observations are not proof of intervening transitions. No periodic checkpoint store by default.
- **Calendar:** only when a measured planning/scheduling need warrants the bounded integration; currently disabled.
- **More specialists:** only after a measured benefit; no roster expansion merely because it exists.

## 6. Delivery sequence and handoff

Canonical execution state is [docs/02](02_DEVELOPMENT_ROADMAP.md), not this historical audit or an issue number.

| Issue | Bounded outcome | Dependency |
|---|---|---|
| [#30](https://github.com/danielkokr/djonik-manager-2.0/issues/30) | This governance handoff | PO-authorized docs/issues change |
| [#31](https://github.com/danielkokr/djonik-manager-2.0/issues/31) | Per-mutation identity/result verification | Governance docs available |
| [#32](https://github.com/danielkokr/djonik-manager-2.0/issues/32) | Turn completion/correlation and safe specialist composition | #31 source fixes |
| [#29](https://github.com/danielkokr/djonik-manager-2.0/issues/29) | Current-state review contract and isolated ownership validation | #31/#32; declared live gate |
| [#33](https://github.com/danielkokr/djonik-manager-2.0/issues/33) | Pin accepted tuple and attest serving Telegram Session | Preparation may precede #29; promotion follows accepted candidate |
| [#34](https://github.com/danielkokr/djonik-manager-2.0/issues/34) | Conversational commitment/waiting/follow-up lifecycle | #33 |
| [#35](https://github.com/danielkokr/djonik-manager-2.0/issues/35) | Working-week pilot and v1 accept/hold decision | All required capability/reliability gates |

First implementation pass is source-only. Paid inference, production promotion and test-card writes require their concrete later authorization; no budget is approved by this governance update. Do not commit, push, deploy, create branches or close issues without authorization.

A remote agent must obtain the governance document changes before implementing: issues are updated live while these files may still be uncommitted locally. Do not infer a new NOW from GitHub numbering when a checkout still has the old roadmap.

## 7. Official API findings and limits

Verified against official documentation during the audit; recheck before implementation if the surface changes.

| Source | Consequence |
|---|---|
| [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets) | Caps stop future requests, can overshoot in-flight requests across threads; budget pause is not successful completion. Use authoritative cumulative Session cost rather than assuming rounded thread costs add exactly. |
| [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations) | System/model/Skills are fixed at Session creation; supported tools/MCP updates are distinct and use replacement semantics. Latest Agent GET does not attest an existing Session. |
| [Events and streaming](https://platform.claude.com/docs/en/managed-agents/events-and-streaming) | Inspect stop reason and event provenance; idle alone is not end_turn. |
| [Multi-agent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration) | Child threads have separate persistent context but shared sandbox/filesystem/vault. Own configured tools/Skills/models; primary sent/received events can support correlation. Separate context is not a security boundary. |
| [Skills](https://platform.claude.com/docs/en/managed-agents/skills) | Explicit versions versus latest must be distinguished; local source is not proof of Session attachment. |
| [Memory](https://platform.claude.com/docs/en/managed-agents/memory) | Prefer native stores and scoped mounts. Read-only mounts constrain writes; API concurrency controls exist. Do not treat Memory as operational truth. |
| [Scheduled Deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) | Native cron/timezone, initial events and per-run resources/budgets exist; delivery still needs a bounded channel boundary. Availability in this workspace was not verified. |
| [Official Trello MCP](https://github.com/atlassian/trello-mcp-server) | Activity/history, comments and attachments are roadmap items in the audited surface. Checklist/archive support at provider level does not mean those writes are enabled/accepted in Djonik. Distinguish provider absence from deliberate product restrictions. |

## 8. Governance verification and limitations

This change updates Markdown and GitHub planning artifacts only. No runtime, Skill source, lock, Managed Agent, Memory, Trello or Calendar state changes. The seven reproductions remain unfixed until their issues are implemented. #28 acceptance is retained with narrower stated coverage; #29 remains unaccepted.

Governance recheck: npm run typecheck passed; npm test passed 330/330, zero failed/cancelled/skipped; all seven offline reproductions above were rerun with the documented results; git diff --check passed. Git emitted LF-to-CRLF notices and a permission warning for the global ignore file; checks still exited 0. GitHub issue/comment readbacks and publication status are recorded in #30. Publication of local docs and explicit issue closeout are separate, unauthorized operations in this task.
