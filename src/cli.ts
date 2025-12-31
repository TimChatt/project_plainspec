import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { assessRuleCoverage } from './coverage';
import { runExamples, runProgram } from './executor';
import { parseAndValidate } from './parser';
import { Program } from './types';
import { validateProgram } from './validator';

function printUsage(): void {
  console.log(`Usage: ts-node src/cli.ts <command> [options]

Commands:
  validate <program.json>       Validate an AST program file
  run <program.json> --input <payload.json>
                                Execute a program against an input payload
  examples <program.json>       Run all examples bundled in the program
  parse <spec.cnl> [--out file] [--run-examples]
                                Parse controlled English into AST, validate, and optionally save/run examples

Options:
  --input <file>                Path to JSON payload for run
  --out <file>                  Path to write parsed AST JSON for parse command
  --run-examples                When parsing, also run the embedded examples
`);
}

function readJson<T>(filePath: string): T {
  const resolved = path.resolve(filePath);
  return JSON.parse(readFileSync(resolved, 'utf-8')) as T;
}

function getOption(name: string, args: string[]): string | undefined {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) {
    return undefined;
  }
  return args[idx + 1];
}

function hasFlag(name: string, args: string[]): boolean {
  const flag = `--${name}`;
  return args.includes(flag);
}

function validate(program: Program): boolean {
  const validation = validateProgram(program);
  if (validation.valid) {
    console.log('Program is valid.');
  } else {
    console.error('Program has validation errors:');
    validation.errors.forEach((err) => console.error(`- ${err}`));
  }

  if (validation.warnings.length) {
    console.warn('\nWarnings:');
    validation.warnings.forEach((warning) => console.warn(`- ${warning}`));
  }

  const coverage = assessRuleCoverage(program);
  if (coverage.length) {
    console.log('\nRule coverage from examples:');
    coverage.forEach((entry) => {
      console.log(`- ${entry.ruleId}: ${entry.coveragePercent}% (${entry.matchedInExamples}/${entry.totalExamples})`);
    });
  }

  return validation.valid;
}

function handleValidate(args: string[]): void {
  const programPath = args[0];
  if (!programPath) {
    console.error('Missing program path for validate command');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const program = readJson<Program>(programPath);
  validate(program);
}

function handleRun(args: string[]): void {
  const programPath = args[0];
  const inputPath = getOption('input', args);

  if (!programPath || !inputPath) {
    console.error('Usage: run <program.json> --input <payload.json>');
    process.exitCode = 1;
    return;
  }

  const program = readJson<Program>(programPath);
  if (!validate(program)) {
    process.exitCode = 1;
    return;
  }

  const payload = readJson<Record<string, unknown>>(inputPath);
  const result = runProgram(program, payload);

  console.log('\nExecution result:');
  console.log(JSON.stringify(result.output, null, 2));
  console.log('\nFired rules:');
  result.firedRules.forEach((trace) => {
    console.log(`- ${trace.rule.id}: matched=${trace.matched}`);
  });

  if (result.constraints.length) {
    console.log('\nConstraint checks:');
    result.constraints.forEach((constraint) => {
      console.log(`- ${constraint.constraint.id}: ${constraint.passed ? 'passed' : 'FAILED'}`);
    });
  }
}

function handleExamples(args: string[]): void {
  const programPath = args[0];
  if (!programPath) {
    console.error('Usage: examples <program.json>');
    process.exitCode = 1;
    return;
  }

  const program = readJson<Program>(programPath);
  if (!validate(program)) {
    process.exitCode = 1;
    return;
  }

  console.log('\nRunning examples...');
  const results = runExamples(program);
  results.forEach((example) => {
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
}

function handleParse(args: string[]): void {
  const specPath = args[0];
  if (!specPath) {
    console.error('Usage: parse <spec.cnl> [--out file] [--run-examples]');
    process.exitCode = 1;
    return;
  }

  const source = readFileSync(path.resolve(specPath), 'utf-8');
  const { parse, validation } = parseAndValidate(source);

  if (parse.errors.length) {
    console.error('Parser errors:');
    parse.errors.forEach((err) => console.error(`- ${err}`));
    process.exitCode = 1;
    return;
  }

  if (!parse.program) {
    console.error('Parser did not return a program.');
    process.exitCode = 1;
    return;
  }

  console.log('Parsed program with controlled English.');
  const program = parse.program;

  if (validation) {
    console.log('\nValidation results:');
    const valid = validate(program);
    if (!valid) {
      process.exitCode = 1;
    }
  }

  const outPath = getOption('out', args);
  if (outPath) {
    writeFileSync(path.resolve(outPath), JSON.stringify(program, null, 2));
    console.log(`\nWrote AST JSON to ${outPath}`);
  }

  if (hasFlag('run-examples', args)) {
    console.log('\nRunning examples from parsed program...');
    const results = runExamples(program);
    results.forEach((example) => {
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
  }
}

function main(): void {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'validate':
      handleValidate(args);
      break;
    case 'run':
      handleRun(args);
      break;
    case 'examples':
      handleExamples(args);
      break;
    case 'parse':
      handleParse(args);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main();
