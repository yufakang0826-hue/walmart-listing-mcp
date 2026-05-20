---
name: walmart-bug-from-dogfood
description: Turn a user-reported production bug from dogfooding into a structured fix PR. Use when the user pastes back results from real production tool calls showing 4xx/5xx errors, unexpected responses, or behavior different from sandbox.
disable-model-invocation: true
---

# walmart-bug-from-dogfood

Codifies the workflow used across v0.3.1 → v0.3.2 → v0.3.3 → v0.4.0 PR cycles. Every dogfooding round produces 2-4 bug reports; each needs to be classified, fixed (or documented as a Walmart-side limit), and shipped in a single coherent PR.

## When to use

User pastes output from Codex / Claude Desktop showing one or more of:
- HTTP 4xx/5xx from a tool call against production
- Response shape unexpected (missing fields, wrong types)
- Tool succeeded but did the wrong thing
- Behavior different from what the README or smoke test showed

## Process

### Step 1: Classify each finding

For every reported bug, decide which bucket:

| Bucket | Signal | Action |
|---|---|---|
| **A — Our schema bug** | 405 / wrong HTTP method, payload validation regex unknown to LLM, output schema rejects valid response | **Fix in code**: update walmart-client method or tool schema |
| **B — Walmart endpoint missing** | Sandbox 404 across all variants, no docs match | **Remove tool** + document workaround in README |
| **C — Walmart prod-only failure** | Sandbox works, prod 4xx/5xx with different error | **Document** in README "Known production issues" + tool description warning; do NOT remove |
| **D — Walmart-side outage** | 5xx + Walmart-internal backend domain (e.g. `midas-api.catdev`), persistent for hours | **Document + workaround pointer** (often `walmart_get_taxonomy` substitutes for `walmart_get_departments`) |
| **E — Tool design issue** | User confused which tool to use, or wanted info no tool returns | **Improve descriptions** + maybe add composite tool |

### Step 2: Probe what's probable

For Bucket A and B: run a `scripts/probe-<bug>.mjs` (see `walmart-probe` skill). Confirm whether a sandbox-working shape exists before committing to a fix vs removal.

### Step 3: Plan the PR scope

Group findings that fit one cohesive story. Examples:
- All 3 v0.3.3 bugs → one PR (different fixes per bucket, single release)
- 1 schema fix → one minor PR

Bump version: **patch** (0.x.y → 0.x.y+1) for fixes-only; **minor** (0.x.y → 0.x+1.0) when adding capability.

### Step 4: Execute the rhythm

Follow CLAUDE.md "Release cycle":
1. Branch
2. Apply fixes per bucket
3. Update README "Known production issues" section if any Bucket C/D
4. Local verify (typecheck / unit / build)
5. Sandbox verify (all 3 smoke layers)
6. Commit with detailed message — explicitly state which buckets each fix addresses
7. PR with description grouping fixes by bucket
8. Merge + release + cleanup secrets

### Step 5: Honest reporting

In the PR description and user response, tell the user:
- Which bugs got actual fixes (Bucket A, sometimes E)
- Which got removal + workaround (Bucket B)
- Which got documentation only because they're upstream issues (Bucket C, D)

Never pretend a documented limitation is a fix. The user came back with real data — be straight about what we can and cannot control.

## Anti-patterns

- ❌ Lumping all reported bugs into "needs more investigation" — classify each one
- ❌ Removing a tool without probing first (might just be wrong shape)
- ❌ Trying to "fix" a Walmart-side outage in our code
- ❌ Skipping the sandbox smoke run because "this is just a docs change" (a wrong tool description can break LLM tool selection)
- ❌ Committing `.env` because of haste — always `rm .env` before `git add`

## Past examples

| PR | Findings | Classification | Outcome |
|---|---|---|---|
| #11 (v0.3.1) | listing_quality_score works | A (we missed sku/itemId support) | Code fix |
| #12 (v0.3.2) | search_my_catalog 405 | A (wrong HTTP method) | Code fix (GET → POST + body shape) |
| #13 (v0.3.3) | 3 bugs across buckets | A + B + D | bulk_inventory removed, search_my_catalog + get_departments documented |
| #14 (v0.4.0) | per-SKU quality available | E (tool surface) | Added composite tool + per-SKU mode |
