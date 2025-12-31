import {
  Action,
  ActionTrace,
  Comparator,
  Condition,
  ConditionTrace,
  Constraint,
  ConstraintResult,
  Example,
  ExampleResult,
  ExecutionResult,
  Program,
  Rule,
  RuleTrace,
} from './types';

function cloneInput<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getPathValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

function setPathValue(obj: any, path: string, value: any): { previous: any; next: any } {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined) current[key] = {};
    current = current[key];
  }
  const lastKey = keys[keys.length - 1];
  const previous = current[lastKey];
  current[lastKey] = value;
  return { previous, next: value };
}

function evaluateComparison(lhs: any, operator: Comparator, rhs: any): boolean {
  switch (operator) {
    case 'eq':
      return lhs === rhs;
    case 'neq':
      return lhs !== rhs;
    case 'gt':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs > rhs;
    case 'gte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs >= rhs;
    case 'lt':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs < rhs;
    case 'lte':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs <= rhs;
    case 'contains':
      if (typeof lhs === 'string') return lhs.includes(String(rhs));
      if (Array.isArray(lhs)) return lhs.includes(rhs);
      return false;
    case 'in':
      if (Array.isArray(rhs)) return rhs.includes(lhs);
      return false;
    default:
      return false;
  }
}

function evaluateOperand(data: Record<string, unknown>, operand: any): any {
  if (operand.kind === 'fact') return getPathValue(data, operand.path);
  return operand.value;
}

function evaluateCondition(condition: Condition, data: Record<string, unknown>): ConditionTrace {
  if (condition.kind === 'comparison') {
    const lhs = evaluateOperand(data, condition.lhs);
    const rhs = evaluateOperand(data, condition.rhs);
    const result = evaluateComparison(lhs, condition.operator, rhs);
    return { condition, result };
  }

  if (condition.kind === 'not') {
    const child = evaluateCondition(condition.condition, data);
    return { condition, result: !child.result, children: [child] };
  }

  const childTraces = condition.conditions.map((child) => evaluateCondition(child, data));
  if (condition.kind === 'all') {
    return { condition, result: childTraces.every((c) => c.result), children: childTraces };
  }
  return { condition, result: childTraces.some((c) => c.result), children: childTraces };
}

function applyAction(action: Action, data: Record<string, unknown>): ActionTrace {
  switch (action.kind) {
    case 'set': {
      const value = action.value.value;
      const { previous, next } = setPathValue(data, action.target, value);
      return { action, applied: true, previousValue: previous, newValue: next };
    }
    default:
      // emit/route are represented as trace-only for now
      return { action, applied: true };
  }
}

function evaluateConstraints(constraints: Constraint[] | undefined, data: Record<string, unknown>): ConstraintResult[] {
  if (!constraints) return [];
  return constraints.map((constraint) => {
    const trace = evaluateCondition(constraint.assert, data);
    return { constraint, passed: trace.result };
  });
}

function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    if (a.priority == null && b.priority == null) return 0;
    if (a.priority == null) return 1;
    if (b.priority == null) return -1;
    return a.priority - b.priority;
  });
}

export function runProgram(program: Program, input: Record<string, unknown>): ExecutionResult {
  const state = cloneInput(input);
  const firedRules: RuleTrace[] = [];
  const evaluationMode = program.config?.ruleEvaluation ?? 'all';

  for (const rule of sortRules(program.rules)) {
    const conditionTrace = evaluateCondition(rule.when, state);
    const matched = conditionTrace.result;
    const actions: ActionTrace[] = [];
    if (matched) {
      rule.actions.forEach((action) => actions.push(applyAction(action, state)));
    }
    firedRules.push({ rule, matched, conditionTrace, actions });

    const ruleMode = rule.mode ?? evaluationMode;
    if (matched && ruleMode === 'first') break;
  }

  const constraints = evaluateConstraints(program.constraints, state);

  return {
    output: state,
    firedRules,
    constraints,
  };
}

function expectationMatches(actual: any, expected: any): boolean {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected;
  }
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.keys(expected).every((key) => expectationMatches((actual as any)[key], (expected as any)[key]));
}

export function runExamples(program: Program): ExampleResult[] {
  if (!program.examples?.length) return [];

  return program.examples.map((example) => {
    const result = runProgram(program, example.input);
    const passed = expectationMatches(result.output, example.expected);
    return { example, passed, actualOutput: result.output };
  });
}
