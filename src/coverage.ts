import { runProgram } from './executor';
import { Program, RuleCoverage } from './types';

/**
 * Evaluate how many examples cause each rule to fire.
 */
export function assessRuleCoverage(program: Program): RuleCoverage[] {
  if (!program.examples || program.examples.length === 0) return [];
  const totalExamples = program.examples.length;
  const counts: Record<string, number> = {};
  program.rules.forEach((rule) => {
    counts[rule.id] = 0;
  });

  program.examples.forEach((example) => {
    const result = runProgram(program, example.input);
    result.firedRules.forEach((trace) => {
      if (trace.matched) counts[trace.rule.id] = (counts[trace.rule.id] ?? 0) + 1;
    });
  });

  return program.rules.map((rule) => ({
    ruleId: rule.id,
    matchedInExamples: counts[rule.id] ?? 0,
    totalExamples,
    coveragePercent: totalExamples === 0 ? 0 : Math.round(((counts[rule.id] ?? 0) / totalExamples) * 100),
  }));
}
