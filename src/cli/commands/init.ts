import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { booleanOption } from '../context';
import { ANSI, color } from '../render';

export const INIT_TEMPLATE = `# BenchY eval suite
# Define the app endpoint, pricing (USD per 1M tokens), an optional LLM judge,
# and the test cases BenchY runs on every push. Docs: https://github.com/rusuraluca/benchy

name: my-app-evals

target:
  url: http://localhost:3000
  model: my-model

# Optional: track cost per model in USD per 1M tokens (input, output)
# pricing:
#   my-model:
#     input: 0.15
#     output: 0.60

# Optional: LLM-as-a-judge scorer. Uses OPENAI_API_KEY (or judge.apiKeyEnv)
# judge:
#   model: gpt-4o-mini

cases:
  - id: health-basic
    name: Basic health check
    tags: [smoke]
    method: GET
    path: /health
    expected:
      output:
        ok: true

  - id: triage-looks
    name: Triage a support ticket
    method: POST
    path: /v1/triage
    input:
      message: "You charged me twice this month."
    expected:
      schema:
        type: object
        required: [category, priority, sentiment]
        properties:
          category: { type: string, enum: [billing, bug, account, feature] }
          priority: { type: string, enum: [low, medium, high] }
      judge:
        criteria: The triage must be accurate, professional and actionable.
        required: false
`;

export function initCmd(cwd: string, options: Record<string, unknown>): number {
  const path = resolve(cwd, 'benchy.yaml');
  if (existsSync(path) && !booleanOption(options['force'])) {
    process.stdout.write(`${path} already exists — use --force to overwrite\n`);
    return 1;
  }
  writeFileSync(path, INIT_TEMPLATE, 'utf8');
  process.stdout.write(color(ANSI.green, `created ${path}\n\n`));
  process.stdout.write(
    'Next steps:\n' +
      '  1. point target.url at your app (or keep the sample endpoint)\n' +
      '  2. run any endpoint:  benchy run --config benchy.yaml\n' +
      '  3. review:            benchy serve\n' +
      '  4. guard CI:          benchy baseline update && benchy baseline check\n',
  );
  return 0;
}
