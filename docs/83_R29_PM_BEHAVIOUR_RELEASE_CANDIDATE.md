# r29 — controlled #45 PM behaviour release candidate

Date: 2026-09-26. Source: committed main `912a5d5d2f9628ebbe5bfdd09b3a35641f2e7fbd`. This resolves the accepted #45 prompt and three coordinator Skills for Daniel's later Telegram behaviour test. No commit, push, deployment, restart, host secret change, inference, reminder activation, or issue/roadmap change was made here.

## Starting state and exact delta

- `release:check -- r28` passed. Remote coordinator latest and explicit v28 were byte/config equal; `attestAgentVersion(RELEASE_R28, v28)` passed. The current hosted r28 serving Session also attested: `sesn_01NZztXWCqh1jBCp5h1gpz1U`, idle, app `757ec5ee4e74538cf95ba03c1c56c57b3238f035`, Agent @28.
- v28 prompt SHA-256: `c85e7e621af71f78890ddfe7c270ce737ce83d58e58d5543d1ea7be17964e7da`. v29 prompt SHA-256, from committed `managed-agents/djonik.md`: `fe28b19599d3c4334e68fb8c819063457f3634c9af96995cb9db4cc4db375025`.
- The only Skill changes are `task-management`, `planning-and-focus`, and `pm-rhythm`. The r28 pinned remote archives for `studio-intake` and `work-review` already matched committed main byte for byte; their pins were retained. The specialist and its `project-health` Skill were untouched.
- The Agent update body was generated with `buildCandidateUpdateBody`, carried `version: 28`, `skills`, `system`, and `tools`, and had SHA-256 `0fd8d90860e59dfa9808cc35c67cb71ab90fb7afa126815b8a36042ff2e7e9c3`. Its effective built-in, custom and MCP tool surface equalled v28. There was exactly one Agent update, v28 → v29; raw read-back changed only `version`, `updated_at`, `system`, and `skills`. v28 read back unchanged.

## Immutable Skill versions

Each new version was created on the existing Skill identity from `git show HEAD:.claude/skills/<name>/SKILL.md`, then downloaded and compared byte for byte with that committed source.

| Skill | Existing `skill_id` | r28 → r29 `skver_` | Committed/downloaded SHA-256 | Measured Session version |
|---|---|---|---|---|
| task-management | `skill_01WS6JtY1GMu3rGZaKCVR9w1` | `skver_01CJQkVY1kp1urhBWQgHUYxW` → `skver_01H9ZMhZKJv7Ryi3tdKiS4Ni` | `aec09d5aa2b8170fe4f9d365a61484d1a1dc8b5e3b49a55382f3b014a8d70b7a` | `1790413381043587` |
| planning-and-focus | `skill_01PxXTvhbZSrbxqi7gmDs6KW` | `skver_01RzxVaCr47k6R11pHLWr62e` → `skver_01ELK2Ap5N8oYTQxYtNpGptG` | `02097376a7872950296e96993b7b76bbf144276236b24669e349e8c760cf9bab` | `1790413383331016` |
| pm-rhythm | `skill_01GzpQX3bVuWNk5bhbGcbzku` | `skver_01Y77TKeXY9suV99XZU3cv5a` → `skver_011MPsX8NEXALfqBKMRzGVz8` | `91ed09622bc205b4cc380f62c51a121b91abbbf8ce8f7ae3f732f29e866a2dc7` | `1790413385648302` |

## Agent and inspection

- Agent `agent_01WGRHDBjQa3eMhoGJMmQ1dh@29` read back and attested. Model remains Claude Sonnet 5, medium, standard. Specialist remains `agent_01KNiQDzzPjaMU6LLF4mU6uM@4`. Built-in tools, Trello and disabled Calendar MCP, permission policies, environment, vault and Memory store remain r28. `customTools` remains exactly `["trello_work_history"]`; **`reminder` is absent**.
- One inspection Session, `sesn_01FiuPDV5Sto6wJqpg9XexX2`, was pinned to @29 with Memory `read_only`, unchanged environment/vault/Memory IDs and a 1¢ budget backstop. It was retrieved rather than recreated after a local assertion expected `skver_` in the snapshot; the provider snapshot correctly uses numeric Skill spellings. Final read-back: idle, 0 events, 0 input/output/cache tokens, $0 list cost, 0 active seconds in stats. Its resolved Agent snapshot attested with the measured numbers above. The unchanged `studio-intake` and `work-review` Session versions remain `1789734659839542` and `1790083840153637`.

## Source release and validation

`RELEASE_R29` is now in `RELEASES` and is the source `SERVING_RELEASE`. It pins the prompt hash and all five coordinator Skill versions with measured Session spellings. The r28 release remains immutable and attestable. The declarative `managed-agents/djonik.md` frontmatter matches r29; its body was not changed in this pass.

- Focused release, attestation, Agent-source and #45 Skill tests: **279/279 passed**.
- `npm run typecheck`: pass. `npm run build`: pass.
- `npm test`: first run had the two documented Windows failures plus one timing-sensitive reminder delivery failure; that reminder file passed **21/21** on focused rerun. The final full run: **1168/1170 passed**, with only the unchanged Windows baseline failures in `deployConfig.test.ts` (CRLF checkout of `deploy.sh`) and `processExit.test.ts` (exit 1 instead of 78).
- `npm run release:check -- r29`: pass, remote Agent @29, `serving_in_this_revision=true`.
- No normal user/model inference smoke was run. Daniel's Telegram behaviour test follows deployment.

## Deployment handoff — not executed

After review, Daniel commits and pushes this revision to main and records its full commit SHA. On the host, set `DJONIK_EXPECTED_RELEASE` to `r29` using `deploy/set-secrets.sh` as in docs/52 and docs/75, then run `deploy/deploy.sh <full-commit-sha>`. The deploy script runs the read-only release check before its one restart. Afterward, run `npm run release:check -- r29 --serving` and verify a newly created hosted Telegram Session has the deployed app SHA and Agent @29. Then Daniel performs the manual PM conversation test in Telegram. Rollback remains the previous deployed r28 app revision with Agent @28. Do not enable `reminder` in this release.
