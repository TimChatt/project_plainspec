import {
  Action,
  ActionTrace,
  Condition,
  ConditionTrace,
  Constraint,
  ConstraintReport,
  ConstraintResult,
  Example,
  ExampleResult,
  ExecutionOptions,
  ExecutionResult,
  NormalizedActionLog,
  Program,
  Rule,
  RuleTrace,
  StateDiff,
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

function evaluateOperand(data: Record<string, unknown>, operand: any): any {
  if (operand.kind === 'fact') return getPathValue(data, operand.path);
  return operand.value;
}

function evaluateComparison(lhs: any, operator: string, rhs: any): boolean {
  switch (operator) {
    case 'eq':
    case '==':
      return lhs === rhs;
    case 'neq':
    case '!=':
      return lhs !== rhs;
    case 'gt':
    case '>':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs > rhs;
    case 'gte':
    case '>=':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs >= rhs;
    case 'lt':
    case '<':
      return typeof lhs === 'number' && typeof rhs === 'number' && lhs < rhs;
    case 'lte':
    case '<=':
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

function evaluateCondition(condition: Condition, data: Record<string, unknown>): ConditionTrace {
  if (condition.kind === 'comparison' || condition.kind === 'compare') {
    const lhs = evaluateOperand(data, condition.lhs as any);
    const rhs = evaluateOperand(data, condition.rhs as any);
    const result = lhs !== undefined && rhs !== undefined ? evaluateComparison(lhs, (condition as any).operator, rhs) : false;
    return { condition, result, details: { lhs, rhs, operator: (condition as any).operator } };
  }

  if (condition.kind === 'exists') {
    const value = evaluateOperand(data, condition.fact);
    const result = value !== undefined && value !== null;
    return { condition, result, details: { value } };
  }

  if (condition.kind === 'in') {
    const value = evaluateOperand(data, condition.value);
    const options = condition.options.map((opt: any) => evaluateOperand(data, opt));
    const result = options.includes(value);
    return { condition, result, details: { value, options } };
  }

  if (condition.kind === 'matches') {
    const value = evaluateOperand(data, condition.value);
    const pattern = condition.pattern;
    let result = false;
    if (typeof value === 'string') {
      try {
        const flags = condition.caseInsensitive ? 'i' : undefined;
        const regex = new RegExp(pattern, flags);
        result = regex.test(value);
      } catch (_err) {
        result = value.includes(pattern);
      }
    }
    return { condition, result, details: { value, pattern } };
  }

  if (condition.kind === 'not') {
    const child = evaluateCondition(condition.condition, data);
    return { condition, result: !child.result, children: [child] };
  }

  if (condition.kind === 'all' || condition.kind === 'and' || condition.kind === 'any' || condition.kind === 'or') {
    const childTraces = condition.conditions.map((child) => evaluateCondition(child, data));
    const reducer = condition.kind === 'all' || condition.kind === 'and' ? 'every' : 'some';
    const result = (childTraces as any)[reducer]!((c: ConditionTrace) => c.result);
    return { condition, result, children: childTraces };
  }

  return { condition, result: false };
}

function applyAction(
  action: Action,
  data: Record<string, unknown>,
  ruleId: string,
  actionId: string,
  enableActions: boolean,
  priorWrites: Map<string, { actionId: string; ruleId: string }>
): { trace: ActionTrace; diffs: StateDiff[]; log?: NormalizedActionLog; warning?: string } {
  const diffs: StateDiff[] = [];
  const markConflict = (path: string) => priorWrites.get(path);
  const recordWrite = (path: string) => priorWrites.set(path, { actionId, ruleId });

  switch (action.kind) {
    case 'set': {
      const targetValue = evaluateOperand(data, (action as any).value);
      const { previous, next } = enableActions ? setPathValue(data, action.target, targetValue) : { previous: getPathValue(data, action.target), next: targetValue };
      if (enableActions && previous !== next) {
        diffs.push({ path: action.target, before: previous, after: next });
      }
      const conflict = markConflict(action.target);
      if (enableActions) recordWrite(action.target);
      const warning = conflict
        ? `Conflict on ${action.target}: previously written by ${conflict.ruleId} (${conflict.actionId}), now by ${ruleId} (${actionId}).`
        : undefined;
      return {
        trace: {
          action,
          applied: enableActions,
          path: action.target,
          beforeValue: previous,
          afterValue: enableActions ? next : previous,
          actionId,
          ruleId,
          conflict: Boolean(conflict),
        },
        diffs,
        warning,
        log: enableActions
          ? { actionId, ruleId, kind: action.kind, path: action.target, before: previous, after: next }
          : undefined,
      };
    }
    case 'increment': {
      const current = getPathValue(data, action.target);
      const next = typeof current === 'number' ? current + action.value : action.value;
      if (enableActions) {
        const { previous } = setPathValue(data, action.target, next);
        diffs.push({ path: action.target, before: previous, after: next });
      }
      const conflict = markConflict(action.target);
      if (enableActions) recordWrite(action.target);
      const warning = conflict
        ? `Conflict on ${action.target}: previously written by ${conflict.ruleId} (${conflict.actionId}), now by ${ruleId} (${actionId}).`
        : undefined;
      return {
        trace: {
          action,
          applied: enableActions,
          path: action.target,
          beforeValue: current,
          afterValue: enableActions ? next : current,
          actionId,
          ruleId,
          conflict: Boolean(conflict),
        },
        diffs,
        warning,
        log: enableActions
          ? { actionId, ruleId, kind: action.kind, path: action.target, before: current, after: next }
          : undefined,
      };
    }
    case 'append': {
      const current = getPathValue(data, action.target);
      const valueToAppend = evaluateOperand(data, (action as any).value);
      const nextArray = Array.isArray(current) ? [...current, valueToAppend] : [valueToAppend];
      const beforeValue = Array.isArray(current) ? current : current === undefined ? [] : current;
      if (enableActions) {
        setPathValue(data, action.target, nextArray);
        diffs.push({ path: action.target, before: beforeValue, after: nextArray });
      }
      const conflict = markConflict(action.target);
      if (enableActions) recordWrite(action.target);
      const warning = conflict
        ? `Conflict on ${action.target}: previously written by ${conflict.ruleId} (${conflict.actionId}), now by ${ruleId} (${actionId}).`
        : undefined;
      return {
        trace: {
          action,
          applied: enableActions,
          path: action.target,
          beforeValue,
          afterValue: enableActions ? nextArray : beforeValue,
          actionId,
          ruleId,
          conflict: Boolean(conflict),
        },
        diffs,
        warning,
        log: enableActions
          ? { actionId, ruleId, kind: action.kind, path: action.target, before: beforeValue, after: nextArray }
          : undefined,
      };
    }
    case 'emit': {
      return {
        trace: { action, applied: enableActions, actionId, ruleId },
        diffs,
        log: enableActions
          ? { actionId, ruleId, kind: action.kind, payload: action.payload ?? {}, path: action.event }
          : undefined,
      };
    }
    case 'route': {
      const beforeRoute = getPathValue(data, 'route');
      const nextRoute = { ...(typeof beforeRoute === 'object' && beforeRoute !== null ? beforeRoute : {}), toQueue: action.toQueue, reason: action.reason };
      if (enableActions) {
        setPathValue(data, 'route', nextRoute);
        diffs.push({ path: 'route', before: beforeRoute, after: nextRoute });
      }
      const conflict = markConflict('route');
      if (enableActions) recordWrite('route');
      const warning = conflict
        ? `Conflict on route: previously written by ${conflict.ruleId} (${conflict.actionId}), now by ${ruleId} (${actionId}).`
        : undefined;
      return {
        trace: {
          action,
          applied: enableActions,
          path: 'route',
          beforeValue: beforeRoute,
          afterValue: enableActions ? nextRoute : beforeRoute,
          actionId,
          ruleId,
          conflict: Boolean(conflict),
        },
        diffs,
        warning,
        log: enableActions
          ? { actionId, ruleId, kind: action.kind, path: 'route', before: beforeRoute, after: nextRoute }
          : undefined,
      };
    }
    default:
      return { trace: { action, applied: false, actionId, ruleId }, diffs: [] };
  }
}

function evaluateConstraints(constraints: Constraint[] | undefined, data: Record<string, unknown>): ConstraintReport {
  if (!constraints) {
    return { passed: [], failed: [], hasFailures: false, hasErrors: false, errorCount: 0, warningCount: 0 };
  }

  const passed: ConstraintResult[] = [];
  const failed: ConstraintResult[] = [];
  let errorCount = 0;
  let warningCount = 0;

  constraints.forEach((constraint) => {
    const trace = evaluateCondition(constraint.assert, data);
    const entry = { constraint, passed: trace.result, trace };
    if (trace.result) {
      passed.push(entry);
    } else {
      failed.push(entry);
      if ((constraint.severity ?? 'error') === 'error') {
        errorCount += 1;
      } else {
        warningCount += 1;
      }
    }
  });

  return {
    passed,
    failed,
    hasFailures: failed.length > 0,
    hasErrors: errorCount > 0,
    errorCount,
    warningCount,
  };
}

function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    const prioA = a.priority ?? 0;
    const prioB = b.priority ?? 0;
    if (prioA !== prioB) return prioB - prioA;
    return a.id.localeCompare(b.id);
  });
}

function normalizeMode(mode?: string): 'firstMatch' | 'allMatches' {
  if (mode === 'first' || mode === 'firstMatch') return 'firstMatch';
  return 'allMatches';
}

function expectationMatches(actual: any, expected: any): boolean {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected;
  }
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.keys(expected).every((key) => expectationMatches((actual as any)[key], (expected as any)[key]));
}

export function runProgram(
  program: Program,
  input: Record<string, unknown>,
  options?: ExecutionOptions
): ExecutionResult {
  const state = cloneInput(input);
  const actions: NormalizedActionLog[] = [];
  const traces: RuleTrace[] = [];
  const maxRuleFirings = options?.maxRuleFirings ?? 1000;
  const enableActions = options?.enableActions ?? false;
  const mode = options?.mode ?? normalizeMode(program.config?.ruleEvaluation);
  const priorWrites = new Map<string, { actionId: string; ruleId: string }>();
  const sortedRules = sortRules(program.rules);
  const conflictWarnings: string[] = [];
  const loopUntilSettled = options?.loopUntilSettled ?? false;
  let firings = 0;
  let hitRuleLimit = false;

  const executePass = (): { fired: boolean; mutated: boolean; stopEarly: boolean } => {
    let fired = false;
    let mutated = false;
    let stopEarly = false;

    for (const rule of sortedRules) {
      const conditionTrace = evaluateCondition(rule.when, state);
      const matched = conditionTrace.result;
      const ruleActions = matched ? rule.then ?? rule.actions ?? [] : rule.else ?? [];
      const actionTraces: ActionTrace[] = [];
      const stateDiffs: StateDiff[] = [];
      const warnings: string[] = [];

      if (matched) {
        firings += 1;
        fired = true;
      }

      for (const action of ruleActions) {
        const actionId = `act-${actions.length + actionTraces.length + 1}`;
        const { trace, diffs, log, warning } = applyAction(action, state, rule.id, actionId, enableActions, priorWrites);
        actionTraces.push(trace);
        stateDiffs.push(...diffs);
        if (warning) {
          warnings.push(warning);
          conflictWarnings.push(warning);
        }
        if (log) actions.push(log);
      }

      if (enableActions && stateDiffs.length > 0) mutated = true;

      traces.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        evaluatedWhen: matched,
        why: conditionTrace,
        actionsApplied: actionTraces,
        stateDiff: stateDiffs,
        stopProcessing: matched ? rule.stopProcessing : undefined,
        warnings: warnings.length ? warnings : undefined,
      });

      if (firings >= maxRuleFirings) {
        hitRuleLimit = true;
        stopEarly = true;
        break;
      }

      const ruleMode = rule.mode ? normalizeMode(rule.mode) : mode;
      if (matched && (ruleMode === 'firstMatch' || rule.stopProcessing)) {
        stopEarly = true;
        break;
      }
    }

    return { fired, mutated, stopEarly };
  };

  let passResult = executePass();
  while (loopUntilSettled && passResult.mutated && !passResult.stopEarly && !hitRuleLimit) {
    passResult = executePass();
  }

  const constraintReport = evaluateConstraints(program.constraints, state);
  const testReport = options?.evaluateExamples
    ? program.examples?.map((example) => runExample(program, example))
    : undefined;

  return {
    resultState: state,
    actions,
    trace: traces,
    constraintReport,
    testReport,
    success: !(constraintReport.hasErrors || hitRuleLimit),
    conflictWarnings: conflictWarnings.length ? conflictWarnings : undefined,
    ruleFirings: firings,
    hitRuleLimit,
  };
}

export function runExample(program: Program, example: Example): ExampleResult {
  const result = runProgram(program, example.input, { enableActions: true });
  const constraintFailures = result.constraintReport.failed.filter((c) => (c.constraint.severity ?? 'error') === 'error');
  const passed = expectationMatches(result.resultState, example.expected) && constraintFailures.length === 0;
  return { example, passed, actualOutput: result.resultState, constraints: result.constraintReport, trace: result.trace };
}

export function runExamples(program: Program): ExampleResult[] {
  if (!program.examples?.length) return [];

  return program.examples.map((example) => runExample(program, example));
}
