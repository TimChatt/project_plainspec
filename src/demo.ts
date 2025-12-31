import { readFileSync } from 'fs';
import path from 'path';
import { runExamples, runProgram } from './executor';
import { assessRuleCoverage } from './coverage';
import { Program } from './types';
import { validateProgram } from './validator';

const programPath = path.join(__dirname, '..', 'examples', 'discount-program.json');
const raw = readFileSync(programPath, 'utf-8');
const program = JSON.parse(raw) as Program;

const result = validateProgram(program);

if (!result.valid) {
  console.error('Program has validation errors:');
  result.errors.forEach((err) => console.error(`- ${err}`));
  process.exitCode = 1;
  process.exit();
}

console.log('Program is valid.');
if (result.warnings.length) {
  console.warn('\nWarnings:');
  result.warnings.forEach((warning) => console.warn(`- ${warning}`));
}

console.log('\nRunning program against sample input...');
const execution = runProgram(program, { order: { total: 120, vip: false } });
console.log('Output:', JSON.stringify(execution.output, null, 2));
console.log('Fired rules:', execution.firedRules.map((r) => `${r.rule.id} (matched=${r.matched})`).join(', '));
console.log('Constraint checks:', execution.constraints.map((c) => `${c.constraint.id}: ${c.passed ? 'passed' : 'failed'}`).join(', '));

console.log('\nRunning examples...');
const exampleResults = runExamples(program);
exampleResults.forEach((example) => {
  const constraintSummary =
    example.constraints.length > 0
      ? ` | constraints: ${example.constraints
          .map((c) => `${c.constraint.id}:${c.passed ? 'ok' : 'FAILED'}`)
          .join(', ')}`
      : '';
  console.log(
    `${example.example.id}: ${example.passed ? 'passed' : 'FAILED'}${constraintSummary} -> ${JSON.stringify(example.actualOutput)}`
  );
});

const coverage = assessRuleCoverage(program);
if (coverage.length) {
  console.log('\nRule coverage from examples:');
  coverage.forEach((entry) => {
    console.log(`- ${entry.ruleId}: ${entry.coveragePercent}% (${entry.matchedInExamples}/${entry.totalExamples})`);
  });
}
