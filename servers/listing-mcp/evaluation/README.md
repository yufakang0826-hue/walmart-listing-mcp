# Evaluation Suite

Evaluations test whether an LLM client can use this MCP server to accomplish realistic tasks end-to-end. They are the objective measure of server quality (see [mcp-builder Phase 4](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/reference/evaluation.md)).

## Files

- `evaluation.xml` — 10 multi-step questions in the mcp-builder XML format.

## Running

You need the `mcp-builder` evaluation harness (Python):

```bash
git clone https://github.com/anthropics/skills.git /tmp/skills
cd /tmp/skills/skills/mcp-builder/scripts
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
```

Build this server first:

```bash
cd <walmart-listing-mcp>
npm install && npm run build
```

Run the eval against the stdio server (set credentials via `-e`):

```bash
python /tmp/skills/skills/mcp-builder/scripts/evaluation.py \
  evaluation/evaluation.xml \
  -t stdio \
  -c node \
  -a dist/index.js \
  -e WALMART_CLIENT_ID=<id> \
  -e WALMART_CLIENT_SECRET=<secret> \
  -e WALMART_SANDBOX=true \
  -m claude-sonnet-4-6 \
  -o evaluation/last-report.md
```

**Target: ≥ 8/10 pass.** Below this, address the failures before shipping changes.

## Answer customization

Several questions depend on what's in YOUR sandbox seller account (item count, SKUs, feed IDs). Answers in `evaluation.xml` are marked `<!-- SANDBOX-SPECIFIC -->` where this applies — replace them with values from your own data before running.

State-independent questions (path-guard behavior, schema validation, tool inventory) need no customization.

## When evaluations fail

Per mcp-builder §4.6, classify each failure and fix the corresponding gap:

| LLM failure | Root cause | Fix |
|---|---|---|
| Picked wrong tool | Description gap | Rewrite tool description |
| Couldn't construct the call | Schema gap | Add `.describe()` with examples |
| Got data but parsed wrong | Output gap | Tighten `outputSchema` |
| Gave up on error | Error gap | Improve error message |
| Task genuinely impossible | Tool gap | Add the missing tool |
