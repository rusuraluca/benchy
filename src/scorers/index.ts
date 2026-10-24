import type { BenchConfig, CaseSpec, ScorerOutcome } from '../core/types';
import type { TargetResponse } from '../core/target';
import { evaluateExact } from './exact';
import { evaluateSchema } from './schema';
import { judgeOutput, resolveJudgeEngine } from './judge';

export async function runScorers(
  config: BenchConfig,
  spec: CaseSpec,
  response: TargetResponse,
): Promise<ScorerOutcome[]> {
  const outcomes: ScorerOutcome[] = [];
  const expected = spec.expected;

  if (expected?.output !== undefined) {
    const result = evaluateExact(expected.output, response.body);
    outcomes.push({
      name: 'exact',
      status: result.passed ? 'passed' : 'failed',
      detail: result.detail,
    });
  }

  if (expected?.schema !== undefined) {
    try {
      const result = evaluateSchema(expected.schema, response.body);
      outcomes.push({
        name: 'schema',
        status: result.passed ? 'passed' : 'failed',
        detail: result.passed
          ? 'schema valid'
          : `schema validation failed: ${result.errors.join('; ')}`,
      });
    } catch (err) {
      outcomes.push({
        name: 'schema',
        status: 'error',
        detail: `schema compile error: ${(err as Error).message}`,
      });
    }
  }

  if (expected?.judge !== undefined) {
    const engine = resolveJudgeEngine(config);
    if (!engine) {
      outcomes.push({
        name: 'judge',
        status: 'skipped',
        detail: 'no judge configured in benchy.yaml',
      });
    } else {
      const result = await judgeOutput(engine, expected.judge, spec.input, response.body);
      outcomes.push({
        name: 'judge',
        status: result.status,
        detail: result.reason ?? result.error ?? 'judge ran',
        reason: result.reason,
        usage: result.usage
          ? {
              in: result.usage.in,
              out: result.usage.out,
              model: result.usage.model,
              source: 'judge',
            }
          : undefined,
      });
    }
  }

  return outcomes;
}
