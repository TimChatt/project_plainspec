import { Program, Entity, Field, Rule, Condition, Action, Constraint, Example, Operand, ValueOperand, ValidationResult } from './types';
import { validateProgram } from './validator';
import { runExamples } from './executor';

export interface ParseResult {
  program?: Program;
  errors: string[];
  warnings: string[];
}

const numberWithUnit = /^(-?\d+(?:\.\d+)?)(?:\s+([A-Za-z%][\w%]*))?$/;

function parseFields(text: string, errors: string[]): Field[] {
  const fields: Field[] = [];
  const parts = text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const match = part.match(/^(\w+)\s+(string|number|boolean|date)(?:\s*\(([^)]+)\))?/i);
    if (!match) {
      errors.push(`Could not parse field definition: "${part}"`);
      continue;
    }
    const [, name, type, units] = match;
    fields.push({ name, type: type.toLowerCase() as Field['type'], units });
  }
  return fields;
}

function parseOperand(raw: string): Operand {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === 'false') {
    return { kind: 'value', value: lower === 'true' };
  }

  const quoted = text.match(/^"(.+)"$/);
  if (quoted) {
    return { kind: 'value', value: quoted[1] };
  }

  const numMatch = text.match(numberWithUnit);
  if (numMatch) {
    const [, num, unit] = numMatch;
    const numeric = num.includes('.') ? parseFloat(num) : parseInt(num, 10);
    return unit ? { kind: 'value', value: numeric, units: unit } : { kind: 'value', value: numeric };
  }

  if (text.includes('.')) {
    return { kind: 'fact', path: text };
  }

  return { kind: 'value', value: text } as ValueOperand;
}

function parseComparison(text: string, errors: string[]): Condition | undefined {
  const checks: { regex: RegExp; operator: Condition['kind'] | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains' | 'in' }[] = [
    { regex: /^(.+?)\s+is\s+greater\s+than\s+or\s+equal\s+to\s+(.+)$/i, operator: 'gte' },
    { regex: /^(.+?)\s+is\s+greater\s+than\s+(.+)$/i, operator: 'gt' },
    { regex: /^(.+?)\s+is\s+less\s+than\s+or\s+equal\s+to\s+(.+)$/i, operator: 'lte' },
    { regex: /^(.+?)\s+is\s+less\s+than\s+(.+)$/i, operator: 'lt' },
    { regex: /^(.+?)\s+is\s+not\s+equal\s+to\s+(.+)$/i, operator: 'neq' },
    { regex: /^(.+?)\s+is\s+not\s+(.+)$/i, operator: 'neq' },
    { regex: /^(.+?)\s+equals\s+(.+)$/i, operator: 'eq' },
    { regex: /^(.+?)\s+is\s+equal\s+to\s+(.+)$/i, operator: 'eq' },
    { regex: /^(.+?)\s+contains\s+(.+)$/i, operator: 'contains' },
    { regex: /^(.+?)\s+in\s+(.+)$/i, operator: 'in' },
    { regex: /^(.+?)\s+is\s+(.+)$/i, operator: 'eq' },
  ];

  for (const check of checks) {
    const match = text.match(check.regex);
    if (match) {
      const [, lhsRaw, rhsRaw] = match.map((m) => m.trim());
      return {
        kind: 'comparison',
        lhs: parseOperand(lhsRaw),
        operator: check.operator as any,
        rhs: parseOperand(rhsRaw),
      } as Condition;
    }
  }

  errors.push(`Could not parse comparison: "${text}"`);
  return undefined;
}

function splitTopLevel(text: string, keyword: 'and' | 'or'): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '(') depth++;
    if (token === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && token.toLowerCase() === keyword) {
      parts.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += (buffer ? ' ' : '') + token;
  }
  if (parts.length === 0) return null;
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function parseCondition(text: string, errors: string[]): Condition | undefined {
  const trimmed = text.trim().replace(/^\(+|\)+$/g, '');
  const comparisonErrors: string[] = [];
  const comparison = parseComparison(trimmed, comparisonErrors);
  if (comparison) return comparison;

  const orParts = splitTopLevel(trimmed, 'or');
  if (orParts) {
    const conditions = orParts.map((part) => parseCondition(part, errors)).filter(Boolean) as Condition[];
    return { kind: 'any', conditions };
  }
  const andParts = splitTopLevel(trimmed, 'and');
  if (andParts) {
    const conditions = andParts.map((part) => parseCondition(part, errors)).filter(Boolean) as Condition[];
    return { kind: 'all', conditions };
  }
  if (/^not\s+/i.test(trimmed)) {
    const inner = parseCondition(trimmed.replace(/^not\s+/i, ''), errors);
    return inner ? { kind: 'not', condition: inner } : undefined;
  }
  errors.push(...comparisonErrors);
  return undefined;
}

function parseActions(text: string, errors: string[]): Action[] {
  const actions: Action[] = [];
  const parts = text.split(/\s+and\s+|,\s*/i).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const setMatch = part.match(/^set\s+([\w\.]+)\s+to\s+(.+)$/i);
    if (setMatch) {
      const [, target, valueRaw] = setMatch;
      const operand = parseOperand(valueRaw);
      if (operand.kind !== 'value') {
        errors.push(`Set action must use a literal value: "${part}"`);
        continue;
      }
      actions.push({ kind: 'set', target, value: operand });
      continue;
    }
    const emitMatch = part.match(/^emit\s+event\s+"?([\w-]+)"?/i);
    if (emitMatch) {
      actions.push({ kind: 'emit', event: emitMatch[1] });
      continue;
    }
    const routeMatch = part.match(/^route\s+to\s+queue\s+"?([\w-]+)"?/i);
    if (routeMatch) {
      actions.push({ kind: 'route', toQueue: routeMatch[1] });
      continue;
    }
    errors.push(`Unrecognised action: "${part}"`);
  }
  return actions;
}

function parseRule(line: string, errors: string[]): Rule | undefined {
  const match = line.match(/^Rule\s+([\w-]+)(?:\s*\(priority\s+(\d+)\))?(?:\s*\(mode\s+(first|all)\))?:\s*If\s+(.+?)\s+then\s+(.+)$/i);
  if (!match) {
    errors.push(`Could not parse rule: "${line}"`);
    return undefined;
  }
  const [, id, priorityRaw, mode, conditionText, actionText] = match;
  const when = parseCondition(conditionText, errors);
  const actions = parseActions(actionText, errors);
  if (!when) return undefined;
  return {
    id,
    name: id.replace(/-/g, ' '),
    priority: priorityRaw ? parseInt(priorityRaw, 10) : undefined,
    mode: mode as Rule['mode'],
    when,
    actions,
  };
}

function parseConstraint(line: string, errors: string[]): Constraint | undefined {
  const match = line.match(/^Constraint\s+([\w-]+):\s*(.+)$/i);
  if (!match) {
    errors.push(`Could not parse constraint: "${line}"`);
    return undefined;
  }
  const [, id, expr] = match;
  const normalized = expr
    .replace(/must\s+not\s+exceed/i, 'is less than or equal to')
    .replace(/must\s+not\s+be\s+greater\s+than/i, 'is less than or equal to')
    .replace(/must\s+be\s+at\s+most/i, 'is less than or equal to')
    .replace(/must\s+be\s+at\s+least/i, 'is greater than or equal to')
    .replace(/must\s+be/i, 'is');
  const assert = parseCondition(normalized, errors);
  if (!assert) return undefined;
  return { id, description: expr.trim(), assert, severity: 'error' };
}

function parseAssignments(segment: string, errors: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const assignments = segment.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
  for (const assign of assignments) {
    const match = assign.match(/^([\w\.]+)\s*=\s*(.+)$/);
    if (!match) {
      errors.push(`Could not parse assignment: "${assign}"`);
      continue;
    }
    const [, path, valueRaw] = match;
    const operand = parseOperand(valueRaw);
    if (operand.kind !== 'value') {
      errors.push(`Example assignments must use literal values: "${assign}"`);
      continue;
    }
    const segments = path.split('.');
    let current: any = result;
    for (let i = 0; i < segments.length; i++) {
      const key = segments[i];
      if (i === segments.length - 1) {
        current[key] = operand.value;
      } else {
        current[key] = current[key] || {};
        current = current[key];
      }
    }
  }
  return result;
}

function parseExample(line: string, errors: string[]): Example | undefined {
  const match = line.match(/^Example\s+([\w-]+):\s*Given\s+(.+?)\s*->\s*Expect\s+(.+)$/i);
  if (!match) {
    errors.push(`Could not parse example: "${line}"`);
    return undefined;
  }
  const [, id, givenPart, expectPart] = match;
  const input = parseAssignments(givenPart, errors);
  const expected = parseAssignments(expectPart, errors);
  return { id, description: id.replace(/-/g, ' '), input, expected };
}

export function parseControlledEnglish(source: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const entities: Entity[] = [];
  const rules: Rule[] = [];
  const constraints: Constraint[] = [];
  const examples: Example[] = [];
  let domain: Program['domain'] = 'business-rules';
  let description: string | undefined;

  const lines = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('#'));

  for (const line of lines) {
    if (/^Domain:/i.test(line)) {
      const [, dom] = line.split(':');
      const normalized = dom.trim().toLowerCase().replace(/\s+/g, '-');
      if (['business-rules', 'workflow', 'data-transform', 'game-rules'].includes(normalized)) {
        domain = normalized as Program['domain'];
      } else {
        errors.push(`Unknown domain: ${dom}`);
      }
      continue;
    }
    if (/^Description:/i.test(line)) {
      description = line.replace(/^Description:/i, '').trim();
      continue;
    }
    if (/^Entity\s+/i.test(line)) {
      const [, name, rest] = line.match(/^Entity\s+(\w+)\s*:\s*(.+)$/i) || [];
      if (!name || !rest) {
        errors.push(`Could not parse entity: "${line}"`);
        continue;
      }
      entities.push({ name, fields: parseFields(rest, errors) });
      continue;
    }
    if (/^Rule\s+/i.test(line)) {
      const rule = parseRule(line, errors);
      if (rule) rules.push(rule);
      continue;
    }
    if (/^Constraint\s+/i.test(line)) {
      const constraint = parseConstraint(line, errors);
      if (constraint) constraints.push(constraint);
      continue;
    }
    if (/^Example\s+/i.test(line)) {
      const example = parseExample(line, errors);
      if (example) examples.push(example);
      continue;
    }
    warnings.push(`Unrecognised line ignored: "${line}"`);
  }

  if (entities.length === 0) {
    errors.push('No entities defined.');
  }
  if (rules.length === 0) {
    errors.push('No rules defined.');
  }

  if (errors.length > 0) {
    return { errors, warnings };
  }

  const program: Program = { domain, description, entities, rules, constraints, examples, config: { ruleEvaluation: 'first' } };
  return { program, errors, warnings };
}

export function parseAndValidate(source: string): { parse: ParseResult; validation?: ValidationResult } {
  const parse = parseControlledEnglish(source);
  if (!parse.program) return { parse };
  const validation = validateProgram(parse.program);
  return { parse, validation };
}

export async function parseValidateAndRunExamples(source: string): Promise<{ parse: ParseResult; validation?: ValidationResult; exampleResults?: ReturnType<typeof runExamples> }> {
  const result = parseAndValidate(source);
  if (!result.parse.program || !result.validation?.valid) {
    return result;
  }
  const exampleResults = runExamples(result.parse.program);
  return { ...result, exampleResults };
}
