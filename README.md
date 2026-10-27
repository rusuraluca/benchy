# benchy

A drop-in eval suite for LLM apps. Define cases in YAML, point it at your endpoint, and let
`benchy` run them, score the answers, track pass rate / latency / cost over time, and **fail CI
when a new model version regresses** — all locally, with SQLite, no external services.

```bash
npm ci && npm run build && npm link   # installs the `benchy` binary
benchy init        # scaffold benchy.yaml
benchy run         # evaluate your app
benchy serve       # results dashboard on :4173
benchy baseline check          # the gate CI uses (exit 1 on regression)
```

## Why benchy

Most LLM teams ship prompts and model updates with "I looked at five examples and it felt fine".
benchy makes evals the same boring, repeated, diffable habit as unit tests:

- **YAML-first.** One file, zero lock-in. Cases are plain data and live next to your prompts.
- **Cost + latency built in.** Every run records per-case time and token cost, so a model
  change that keeps quality but doubles billable tokens is caught in review.
- **Regressions, not averages.** `benchy diff v1.0 v1.1` and `benchy baseline check` tell you
  _which_ case flipped, not just that the pass rate moved.
- **GitHub-native.** Fails the PR when a change regresses a previously-passing case.
- **Docker-ready.** `docker compose up` brings up the demo app + dashboard; a one-shot
  `evals` service runs the suite inside Docker too.

## How it works

```
bench.yaml ──► runner (YAML cases ──► HTTP calls to your app)
                   │
                   ├─► scorers: exact match · JSON schema · LLM-as-judge
                   ├─► usage & cost (per-model pricing table, USD/1M tokens)
                   └─► SQLite store  .benchy/benchy.db
                          │
                          ├─► benchy list / show / diff
                          ├─► benchy baseline check  (CI gate, exit 1)
                          └─► benchy serve  (dashboard: pass rate, p50/p95, cost)
```

## Getting started

```bash
git clone … && cd bench
npm install
npm run build

benchy init          # writes benchy.yaml
benchy run --config benchy.yaml
benchy list
benchy serve         # open http://localhost:4173
```

`benchy init` scaffolds a commented `benchy.yaml` with sample cases. Point `target.url` at your
app and edit `cases:` — done.

## Demo (no API key needed)

The repo ships a tiny rule-based _support-triage_ app with an eval suite:

```bash
docker compose up --build            # demo-app (:3000) + dashboard (:4173, seeded)
node examples/demo-app/dist/server.js   # or just the app on :3000

benchy run --config examples/demo/benchy.yaml --label v1.0
# → 8/8 passed   p50 36ms   cost $0.00013
```

Now deploy the "v2" of the app where refund requests are misclassified as feature requests:

```bash
BENCHY_DEMO_MODE=v2 node examples/demo-app/dist/server.js
benchy baseline check --config examples/demo/benchy.yaml --baseline benchy-baseline.json
```

The check runs the suite, compares to the committed baseline and exits `1`:

```
failed  triage-billing-refund  Triage: billing refund request  passed → failed
88% pass (target 100%), 1 regression(s) …
baseline check failed: 1 regression(s)
```

That is exactly what the CI workflow does on every PR.

## The YAML suite

```yaml
name: support-triage-demo

target:
  url: http://localhost:3000        # your app
  model: rule-triage-v1             # used for cost attribution

concurrency: 4                      # parallel requests per run (default 3)
timeoutMs: 10000                    # per-request timeout
retries: 1                          # retries 5xx/429 with backoff

pricing:                            # USD per 1M tokens, keyed by model
  rule-triage-v1: { input: 0.10, output: 0.10 }

judge:                              # optional LLM-as-judge scorer
  model: gpt-4o-mini                # OpenAI-compatible /chat/completions
  # apiKeyEnv: MY_KEY               # default: OPENAI_API_KEY

imports: [cases.yaml]               # cases can live in separate files

cases:
  - id: triage-billing-refund
    name: Triage: billing refund request
    tags: [billing]                 # filter with benchy run --tag billing
    method: POST                    # GET | POST | PUT
    path: /v1/triage
    input:                          # JSON body (POST/PUT)
      message: I want a refund for the last invoice.
    headers: {Authorization: Bearer $TOKEN}
    required: true                  # non-required cases run but don't flip CI
    expected:
      output:                       # scorer 1: exact match
        category: billing
      schema:                       # scorer 2: JSON schema (Ajv)
        type: object, required: [category, priority]
      judge:                        # scorer 3: LLM judge
        criteria: The triage must be accurate, professional, actionable.
        required: false             # false ⇒ skipped without OPENAI_API_KEY
```

### Scorer semantics

- **output (exact match)** — every key in `expected.output` must be present and equal in the
  response. Extra response fields (model, usage…) are allowed, so tests survive when your
  endpoint starts returning metadata.
- **schema** — the response must validate against the JSON schema (Ajv, all errors reported).
  Schemas can be inline YAML or a JSON/YAML string.
- **judge** — sends the criteria + request/response to the configured judge model and asks
  for a strict `{"passed": bool, "score": 0–100, "reason": string}` verdict (score ≥ 60
  passes). Uses `OPENAI_API_KEY` (or `judge.apiKeyEnv`) and OpenAI-compatible endpoints.
- Multiple scorers per case — all must pass.

## CLI

| Command                                              | What it does                                                          | exit code                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| `benchy run [--label v1.0] [--tag billing] [--json]` | evaluate + store result                                               | 1 on fail (disable with `--allow-fail`) |
| `benchy list`                                        | recent runs                                                           |                                         |
| `benchy show <ref>`                                  | one run: failures with diff + response body                           |                                         |
| `benchy diff <a> <b> [--fail-on-regression]`         | per-case changes: regressed/fixed/added/removed/slower (p50 +20%+5ms) | 1 with `--fail-on-regression`           |
| `benchy baseline update`                             | write `benchy-baseline.json` from the current suite run               |                                         |
| `benchy baseline check`                              | run suite, compare with baseline; fail on regression / below target   | 1 on regression                         |
| `benchy serve [--demo] [--port]`                     | dashboard (`:4173`); `--demo` seeds 5 demo runs                       |                                         |
| `benchy init`                                        | scaffold `benchy.yaml`                                                |                                         |

Common flags: `--config`, `--dir` (store dir, default `./.benchy`), `--target` (override URL).

## CI/CD

Two workflows ship in `.github/workflows`:

**`ci.yml` — quality gate** on every PR/push to `main`:
`lint → format:check → typecheck → test:coverage (threshold: ≥60% lines, ≥50% functions) → build`.

**`evals.yml` + `benchy-eval` action** — on every PR:
build the CLI and the demo app, boot the app, run `benchy baseline check` against the committed
`benchy-baseline.json` (≥ 100% pass target), upload the run store as an artifact.

To guard _your_ app instead of the demo: point the action at your suite and baseline, and add a
job in `ci.yml` that boots your service before running the composite action.

### The baseline lifecycle

1. `benchy baseline update` after a deliberate rollout / prompt change — commit the file.
2. Every later PR: `benchy baseline check` fails if any case flips passed → failed/error,
   or pass rate drops below target.
3. New cases show up as _new cases not tracked by baseline_ (yellow warning) rather than a
   failure, so suites can grow PR-by-PR.

## Docker

```bash
docker compose up --build                  # dashboard (:4173) + demo-app (:3000)
docker compose --profile evals run --rm evals   # one-shot eval + baseline in a container
```

The `benchy` image contains the CLI, dashboard, demo app and baseline; the store lives on the
`benchy-data` volume.

## Development

```bash
npm ci
npm run check      # lint + format + typecheck + unit tests + build
npm run test:coverage   # coverage gate (vitest)
npm test -- tests/e2e.test.ts   # CLI + dashboard e2e
```

Layout: `src/core` (engine: config, runner, scorers, baseline, comparison), `src/storage`
(better-sqlite3, demo seed), `src/cli` (terminal UX), `src/dashboard` + `src/frontend`
(vanilla-HTML dashboard), `examples/demo-app` (the triage demo), `tests/`.

## Contributing

Feature branches, small clean commits, PRs merged with squash; CI must be green — see
issues for good first tasks.

## License

MIT — do whatever, and point new users here when you're asked how you ship quality.

---

<p align="center"><sub>benchy — half an hour of your time, every PR catching the regression your users would have.</sub></p>
