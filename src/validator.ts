import Ajv, { ErrorObject } from 'ajv';
import { programSchema } from './schema';
import {
  Action,
  Condition,
  FactOperand,
  Program,
  ValidationResult
} from './types';
import { assessRuleCoverage } from './coverage';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(programSchema);

const bannedTerms = ['recent', 'large', 'soon', 'some', 'few'];

function collectPathsFromCondition(condition: Condition): string[] {
  switch (condition.kind) {
    case 'comparison': {
      const paths: string[] = [];
      if (condition.lhs.kind === 'fact') paths.push(condition.lhs.path);
      if (condition.rhs.kind === 'fact') paths.push(condition.rhs.path);
      return paths;
    }
    case 'all':
    case 'any':
      return condition.conditions.flatMap((c) => collectPathsFromCondition(c));
    case 'not':
      return collectPathsFromCondition(condition.condition);
  }
}

function collectPathsFromAction(action: Action): string[] {
  if (action.kind === 'set') return [action.target];
  return [];
}

function describeAjvError(error: ErrorObject): string {
  const instancePath = error.instancePath ? ` at ${error.instancePath}` : '';
  return `${error.message ?? 'Invalid value'}${instancePath}`;
}

function checkEntityPath(path: string, entities: Program['entities']): string | null {
  const [entityName, fieldName] = path.split('.');
  const entity = entities.find((e) => e.name === entityName);
  if (!entity) return `Unknown entity "${entityName}" in path "${path}"`;
  const field = entity.fields.find((f) => f.name === fieldName);
  if (!field) return `Unknown field "${fieldName}" on entity "${entityName}" in path "${path}"`;
  return null;
}

function lintText(text: string): string[] {
  const lower = text.toLowerCase();
  return bannedTerms.filter((term) => lower.includes(term)).map((term) => `Avoid vague term: "${term}".`);
}

function validateUnitsForOperand(operand: FactOperand, entities: Program['entities']): string[] {
  const [entityName, fieldName] = operand.path.split('.');
  const entity = entities.find((e) => e.name === entityName);
  const field = entity?.fields.find((f) => f.name === fieldName);
  if (field?.units && !operand.units) {
    return [`Units required for path "${operand.path}" (expected ${field.units}).`];
  }
  return [];
}

export function validateProgram(program: Program): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isValid = ajv.validate<Program>(programSchema.$id!, program);
  if (!isValid && ajv.errors) {
    errors.push(...ajv.errors.map(describeAjvError));
  }

  if (isValid) {
    // Cross-reference paths
    const paths = new Set<string>();
    program.rules.forEach((rule) => {
      collectPathsFromCondition(rule.when).forEach((p) => paths.add(p));
      rule.actions.forEach((action) => collectPathsFromAction(action).forEach((p) => paths.add(p)));
    });
    program.constraints?.forEach((constraint) => {
      collectPathsFromCondition(constraint.assert).forEach((p) => paths.add(p));
    });

    paths.forEach((path) => {
      const message = checkEntityPath(path, program.entities);
      if (message) errors.push(message);
    });

    // Units on operands
    program.rules.forEach((rule) => {
      const operands = collectPathsFromCondition(rule.when)
        .map((path) => ({ kind: 'fact', path } as FactOperand))
        .concat(
          rule.actions
            .filter((a): a is Extract<Action, { kind: 'set' }> => a.kind === 'set')
            .map((a) => ({ kind: 'fact', path: a.target } as FactOperand))
        );
      operands.forEach((operand) => warnings.push(...validateUnitsForOperand(operand, program.entities)));
    });

    // Lint names/descriptions
    program.rules.forEach((rule) => {
      lintText(rule.name).forEach((msg) => warnings.push(`Rule ${rule.id}: ${msg}`));
      if (rule.description) lintText(rule.description).forEach((msg) => warnings.push(`Rule ${rule.id}: ${msg}`));
    });
    program.constraints?.forEach((constraint) => {
      lintText(constraint.description).forEach((msg) => warnings.push(`Constraint ${constraint.id}: ${msg}`));
    });

    if (program.examples?.length) {
      const coverage = assessRuleCoverage(program);
      coverage
        .filter((entry) => entry.matchedInExamples === 0)
        .forEach((entry) =>
          warnings.push(
            `Rule ${entry.ruleId} is never exercised by examples (${entry.matchedInExamples}/${entry.totalExamples}).`
          )
        );
    } else {
      warnings.push('No examples provided; cannot assess rule coverage.');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
