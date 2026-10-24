import type { BenchConfig, JudgeSpec } from '../core/types';

export interface JudgeEvalResult {
  status: 'passed' | 'failed' | 'skipped' | 'error';
  reason?: string;
  usage?: { in: number; out: number; model: string };
  error?: string;
}

interface JudgeEngineConfig {
  model: string;
  baseUrl: string;
  apiKey?: string;
  temperature: number;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export function resolveJudgeEngine(config: BenchConfig): JudgeEngineConfig | undefined {
  const judge = config.judge;
  if (!judge) return undefined;
  const apiKeyEnv = judge.apiKeyEnv ?? 'OPENAI_API_KEY';
  const apiKey = process.env[apiKeyEnv] || process.env.OPENAI_API_KEY;
  return {
    model: judge.model ?? DEFAULT_MODEL,
    baseUrl: (judge.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey,
    temperature: judge.temperature ?? 0,
  };
}

export async function judgeOutput(
  engine: JudgeEngineConfig,
  spec: JudgeSpec & { required?: boolean },
  input: unknown,
  output: unknown,
  timeoutMs = 60_000,
): Promise<JudgeEvalResult> {
  if (!engine.apiKey) {
    return {
      status: 'skipped',
      reason:
        'judge skipped: no API key configured (set OPENAI_API_KEY or judge.apiKeyEnv); ' +
        'use expected.judge.required to force a hard failure instead of a skip',
    };
  }

  const scale =
    spec.scale ??
    `0-100 rubric: 90-100 flawless, handles the intent precisely; 70-89 correct with minor */
    omissions or imprecision; 50-69 partially correct, misses key requirements; <50 fails the criteria.`;

  const system =
    'You are BenchJudge, a strict, deterministic evaluator. You receive an LLM-app input, ' +
    'the app output, and evaluation criteria. Judge ONLY what the criteria ask for. ' +
    'Respond with STRICT JSON, no prose: {"passed": true|false, "score": 0-100, "reason": "one short sentence"}. ' +
    'passed must be false when score < 60.';

  const user = JSON.stringify(
    {
      app_input: input,
      app_output: output,
      criteria: spec.criteria,
      scoring_scale: scale,
    },
    null,
    2,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${engine.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${engine.apiKey}`,
      },
      body: JSON.stringify({
        model: engine.model,
        temperature: engine.temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      return {
        status: 'error',
        error: `judge request failed (HTTP ${res.status}): ${truncate(raw, 200)}`,
      };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const verdict = parseVerdict(content);
    if (!verdict) {
      return { status: 'error', error: 'judge returned unparseable output' };
    }
    const usage = data.usage;
    return {
      status: verdict.passed ? 'passed' : 'failed',
      reason: verdict.reason,
      usage:
        usage && typeof usage.prompt_tokens === 'number'
          ? {
              in: usage.prompt_tokens,
              out: usage.completion_tokens ?? 0,
              model: engine.model,
            }
          : undefined,
    };
  } catch (e) {
    return { status: 'error', error: `judge call failed: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

interface Verdict {
  passed: boolean;
  score: number;
  reason: string;
}

function parseVerdict(content: string): Verdict | undefined {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '');
  try {
    const parsed = JSON.parse(trimmed) as {
      passed?: unknown;
      score?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.passed !== 'boolean') return undefined;
    const score = typeof parsed.score === 'number' ? parsed.score : 0;
    return {
      passed: parsed.passed && score >= 60,
      score,
      reason: typeof parsed.reason === 'string' ? parsed.reason : `score ${score}/100`,
    };
  } catch {
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}
