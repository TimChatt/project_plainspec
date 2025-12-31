import { Action, Condition, Operand, Program, ScalarType, ValueOperand, ValidationResult } from './types';
import { assessRuleCoverage } from './coverage';

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOperandShape(operand: any, context: string): string[] {
  const errors: string[] = [];
  if (!isObject(operand)) {
    return [`${context} must be an object operand.`];
  }

  if (operand.kind === 'fact') {
    if (typeof operand.path !== 'string') {
      errors.push(`${context} fact operand requires a string path.`);
    }
  } else if (operand.kind === 'value') {
    if (!['string', 'number', 'boolean'].includes(typeof operand.value)) {
      errors.push(`${context} value operand must be string, number, or boolean.`);
    }
  } else {
    errors.push(`${context} has unknown operand kind "${operand.kind}".`);
  }

  return errors;
}

function validateConditionShape(condition: any, context: string): string[] {
  const errors: string[] = [];
  if (!isObject(condition)) return [`${context} must be a condition object.`];

  switch (condition.kind) {
    case 'comparison': {
      const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'];
      if (typeof condition.operator !== 'string' || !operators.includes(condition.operator)) {
        errors.push(`${context} comparison has unknown operator.`);
      }
      errors.push(...validateOperandShape(condition.lhs, `${context}.lhs`));
      errors.push(...validateOperandShape(condition.rhs, `${context}.rhs`));
      break;
    }
    case 'all':
    case 'any': {
      if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
        errors.push(`${context} must include at least one child condition.`);
      } else {
        condition.conditions.forEach((child: any, idx: number) => {
          errors.push(...validateConditionShape(child, `${context}.conditions[${idx}]`));
        });
      }
      break;
    }
    case 'not': {
      errors.push(...validateConditionShape(condition.condition, `${context}.condition`));
      break;
    }
    default:
      errors.push(`${context} has unknown condition kind "${condition.kind}".`);
  }

  return errors;
}

function validateActionShape(action: any, context: string): string[] {
  const errors: string[] = [];
  if (!isObject(action)) return [`${context} must be an action object.`];

  switch (action.kind) {
    case 'set': {
      if (typeof action.target !== 'string') {
        errors.push(`${context} set action requires a string target.`);
      }
      errors.push(...validateOperandShape(action.value, `${context}.value`));
      break;
    }
    case 'emit': {
      if (typeof action.event !== 'string') {
        errors.push(`${context} emit action requires an event name.`);
      }
      break;
    }
    case 'route': {
      if (typeof action.queue !== 'string') {
        errors.push(`${context} route action requires a queue name.`);
      }
      break;
    }
    default:
      errors.push(`${context} has unknown action kind "${action.kind}".`);
  }

  return errors;
}

function validateProgramShape(program: Program): string[] {
  const errors: string[] = [];
  const allowedDomains: Program['domain'][] = ['business-rules', 'workflow', 'data-transform', 'game-rules'];
  const allowedTypes = ['string', 'number', 'boolean', 'date'];

  if (!allowedDomains.includes(program.domain)) {
    errors.push(`Domain must be one of: ${allowedDomains.join(', ')}.`);
  }

  if (!Array.isArray(program.entities) || program.entities.length === 0) {
    errors.push('Program must define at least one entity.');
  } else {
    program.entities.forEach((entity, idx) => {
      if (!entity.name) errors.push(`Entity[${idx}] is missing a name.`);
      if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
        errors.push(`Entity ${entity.name || idx} must declare at least one field.`);
        return;
      }
      entity.fields.forEach((field, fIdx) => {
        if (!field.name) errors.push(`Field[${fIdx}] on entity ${entity.name} is missing a name.`);
        if (!allowedTypes.includes(field.type)) {
          errors.push(`Field ${field.name} on entity ${entity.name} has unknown type ${field.type}.`);
        }
      });
    });
  }

  if (!Array.isArray(program.rules) || program.rules.length === 0) {
    errors.push('Program must include at least one rule.');
  } else {
    program.rules.forEach((rule, idx) => {
      if (!rule.id) errors.push(`Rule[${idx}] is missing an id.`);
      if (!rule.name) errors.push(`Rule[${rule.id || idx}] is missing a name.`);
      errors.push(...validateConditionShape(rule.when, `Rule ${rule.id || idx}.when`));
      if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
        errors.push(`Rule ${rule.id || idx} must include at least one action.`);
      } else {
        rule.actions.forEach((action, actionIdx) => {
          errors.push(...validateActionShape(action, `Rule ${rule.id || idx}.actions[${actionIdx}]`));
        });
      }
      if (rule.mode && !['all', 'first'].includes(rule.mode)) {
        errors.push(`Rule ${rule.id || idx} has invalid mode ${rule.mode}.`);
      }
    });
  }

  program.constraints?.forEach((constraint, idx) => {
    if (!constraint.id) errors.push(`Constraint[${idx}] is missing an id.`);
    if (!constraint.description) errors.push(`Constraint ${constraint.id || idx} is missing a description.`);
    errors.push(...validateConditionShape(constraint.assert, `Constraint ${constraint.id || idx}.assert`));
  });

  program.examples?.forEach((example, idx) => {
    if (!example.id) errors.push(`Example[${idx}] is missing an id.`);
    if (!isObject(example.input)) errors.push(`Example ${example.id || idx} input must be an object.`);
    if (!isObject(example.expected)) errors.push(`Example ${example.id || idx} expected must be an object.`);
  });

  if (program.config && program.config.ruleEvaluation && !['all', 'first'].includes(program.config.ruleEvaluation)) {
    errors.push('Config.ruleEvaluation must be either "all" or "first".');
  }

  return errors;
}

function checkEntityPath(path: string, entities: Program['entities']): string | null {
  const [entityName, fieldName] = path.split('.');
  const entity = entities.find((e) => e.name === entityName);
  if (!entity) return `Unknown entity "${entityName}" in path "${path}"`;
  const field = entity.fields.find((f) => f.name === fieldName);
  if (!field) return `Unknown field "${fieldName}" on entity "${entityName}" in path "${path}"`;
  return null;
}

function getField(path: string, entities: Program['entities']) {
  const [entityName, fieldName] = path.split('.');
  const entity = entities.find((e) => e.name === entityName);
  if (!entity) return { field: null, error: `Unknown entity "${entityName}" in path "${path}"` } as const;
  const field = entity.fields.find((f) => f.name === fieldName);
  if (!field) return { field: null, error: `Unknown field "${fieldName}" on entity "${entityName}" in path "${path}"` } as const;
  return { field, error: null } as const;
}

function lintText(text: string): string[] {
  const lower = text.toLowerCase();
  return bannedTerms.filter((term) => lower.includes(term)).map((term) => `Avoid vague term: "${term}".`);
}

function validateExampleValue(
  value: unknown,
  field: { name: string; type: ScalarType; units?: string },
  context: string,
  warnings: string[],
  errors: string[],
) {
  if (value === null || value === undefined) {
    errors.push(`${context} is missing a value.`);
    return;
  }

  switch (field.type) {
    case 'number':
      if (typeof value !== 'number') {
        errors.push(`${context} must be a number.`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${context} must be a boolean.`);
      }
      break;
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${context} must be a string.`);
      }
      break;
    case 'date':
      if (typeof value !== 'string') {
        errors.push(`${context} must be a date string.`);
      } else if (Number.isNaN(Date.parse(value))) {
        errors.push(`${context} must be a parseable date string.`);
      }
      break;
  }

  if (field.units && typeof value === 'number') {
    warnings.push(`Units required for ${context} (expected ${field.units}).`);
  }
}

function validateExamplePayload(
  payload: Record<string, unknown>,
  entities: Program['entities'],
  context: string,
  warnings: string[],
  errors: string[],
) {
  if (!isObject(payload)) {
    errors.push(`${context} must be an object keyed by entity name.`);
    return;
  }

  Object.entries(payload).forEach(([entityName, rawEntity]) => {
    const entity = entities.find((e) => e.name === entityName);
    if (!entity) {
      errors.push(`${context} references unknown entity "${entityName}".`);
      return;
    }

    if (!isObject(rawEntity)) {
      errors.push(`${context}.${entityName} must be an object of fields and values.`);
      return;
    }

    Object.entries(rawEntity).forEach(([fieldName, value]) => {
      const field = entity.fields.find((f) => f.name === fieldName);
      if (!field) {
        errors.push(`${context} references unknown field "${entityName}.${fieldName}".`);
        return;
      }

      validateExampleValue(value, field, `${context}.${entityName}.${fieldName}`, warnings, errors);
    });
  });
}

function validateUnits(operand: Operand, field: { units?: string }, context: string, warnings: string[], errors: string[]) {
  if (!field.units) return;
  if (!operand.units) {
    warnings.push(`Units required for ${context} (expected ${field.units}).`);
    return;
  }
  if (operand.units !== field.units) {
    errors.push(`Unit mismatch for ${context}: expected ${field.units} but got ${operand.units}.`);
  }
}

function inferValueType(value: ValueOperand['value']): ScalarType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function validateOperandType(
  operand: Operand,
  expected: ScalarType | undefined,
  context: string,
  entities: Program['entities'],
  errors: string[],
  warnings: string[]
): ScalarType | undefined {
  if (operand.kind === 'fact') {
    const { field, error } = getField(operand.path, entities);
    if (error || !field) return undefined;
    return field.type;
  }

  const inferred = inferValueType(operand.value);
  if (!expected) return inferred;

  if (expected === 'date' && typeof operand.value === 'string') {
    const parsed = Date.parse(operand.value);
    if (Number.isNaN(parsed)) {
      errors.push(`Expected a date-compatible value for ${context} but got "${operand.value}".`);
    }
    return 'date';
  }

  if (inferred !== expected) {
    errors.push(`Type mismatch for ${context}: expected ${expected} but got ${inferred}.`);
    return inferred;
  }

  return inferred;
}

function validateComparisonTypes(
  condition: Extract<Condition, { kind: 'comparison' }>,
  entities: Program['entities'],
  context: string,
  errors: string[],
  warnings: string[]
) {
  const lhsField = condition.lhs.kind === 'fact' ? getField(condition.lhs.path, entities) : null;
  const rhsField = condition.rhs.kind === 'fact' ? getField(condition.rhs.path, entities) : null;

  if (lhsField?.error) errors.push(lhsField.error);
  if (rhsField?.error) errors.push(rhsField.error);

  if (lhsField?.field) validateUnits(condition.lhs, lhsField.field, `${context}.lhs`, warnings, errors);
  if (rhsField?.field) validateUnits(condition.rhs, rhsField.field, `${context}.rhs`, warnings, errors);

  const lhsType =
    condition.lhs.kind === 'fact'
      ? lhsField?.field?.type
      : validateOperandType(condition.lhs, rhsField?.field?.type, `${context}.lhs`, entities, errors, warnings);
  const rhsType =
    condition.rhs.kind === 'fact'
      ? rhsField?.field?.type
      : validateOperandType(condition.rhs, lhsField?.field?.type, `${context}.rhs`, entities, errors, warnings);

  if (lhsType && rhsType && lhsType !== rhsType) {
    errors.push(`Type mismatch in ${context}: ${lhsType} compared to ${rhsType}.`);
  }
}

function detectConflictingSetActions(program: Program): string[] {
  const conflicts: string[] = [];
  const defaultPriority = 0;

  for (let i = 0; i < program.rules.length; i++) {
    const ruleA = program.rules[i];
    const setActionsA = ruleA.actions.filter((a): a is Extract<Action, { kind: 'set' }> => a.kind === 'set');
    const priorityA = ruleA.priority ?? defaultPriority;

    for (let j = i + 1; j < program.rules.length; j++) {
      const ruleB = program.rules[j];
      const priorityB = ruleB.priority ?? defaultPriority;

      if (priorityA !== priorityB) continue; // precedence resolves conflicts

      const setActionsB = ruleB.actions.filter((a): a is Extract<Action, { kind: 'set' }> => a.kind === 'set');
      setActionsA.forEach((actionA) => {
        setActionsB.forEach((actionB) => {
          if (actionA.target !== actionB.target) return;
          const valueA = JSON.stringify(actionA.value);
          const valueB = JSON.stringify(actionB.value);
          if (valueA !== valueB) {
            conflicts.push(
              `Conflicting set actions on "${actionA.target}" between rules ${ruleA.id} and ${ruleB.id} with the same priority. ` +
                'Adjust priorities or consolidate logic.'
            );
          }
        });
      });
    }
  }

  return conflicts;
}

function validateConditionTypesRecursive(
  condition: Condition,
  entities: Program['entities'],
  context: string,
  errors: string[],
  warnings: string[]
) {
  if (condition.kind === 'comparison') {
    validateComparisonTypes(condition, entities, context, errors, warnings);
    return;
  }

  if (condition.kind === 'not') {
    validateConditionTypesRecursive(condition.condition, entities, `${context}.condition`, errors, warnings);
    return;
  }

  condition.conditions.forEach((child, idx) =>
    validateConditionTypesRecursive(child, entities, `${context}.conditions[${idx}]`, errors, warnings)
  );
}

function validateSetAction(
  action: Extract<Action, { kind: 'set' }>,
  entities: Program['entities'],
  errors: string[],
  warnings: string[]
) {
  const { field, error } = getField(action.target, entities);
  if (error || !field) {
    errors.push(error ?? `Unknown field for target ${action.target}`);
    return;
  }
  validateUnits(action.value, field, `action on ${action.target}`, warnings, errors);
  validateOperandType(action.value, field.type, `action on ${action.target}`, entities, errors, warnings);
}

export function validateProgram(program: Program): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  errors.push(...validateProgramShape(program));

  if (errors.length === 0) {
    // Cross-reference paths
    const paths = new Set<string>();
    program.rules.forEach((rule, ruleIdx) => {
      collectPathsFromCondition(rule.when).forEach((p) => paths.add(p));
      rule.actions.forEach((action) => collectPathsFromAction(action).forEach((p) => paths.add(p)));

      validateConditionTypesRecursive(rule.when, program.entities, `Rule ${rule.id || ruleIdx}.when`, errors, warnings);

      rule.actions
        .filter((a): a is Extract<Action, { kind: 'set' }> => a.kind === 'set')
        .forEach((action) => validateSetAction(action, program.entities, errors, warnings));
    });
    program.constraints?.forEach((constraint, idx) => {
      collectPathsFromCondition(constraint.assert).forEach((p) => paths.add(p));
      validateConditionTypesRecursive(
        constraint.assert,
        program.entities,
        `Constraint ${constraint.id || idx}.assert`,
        errors,
        warnings,
      );
    });

    paths.forEach((path) => {
      const message = checkEntityPath(path, program.entities);
      if (message) errors.push(message);
    });

    // Lint names/descriptions
    program.rules.forEach((rule) => {
      lintText(rule.name).forEach((msg) => warnings.push(`Rule ${rule.id}: ${msg}`));
      if (rule.description) lintText(rule.description).forEach((msg) => warnings.push(`Rule ${rule.id}: ${msg}`));
    });
    program.constraints?.forEach((constraint) => {
      lintText(constraint.description).forEach((msg) => warnings.push(`Constraint ${constraint.id}: ${msg}`));
    });

    program.examples?.forEach((example, idx) => {
      validateExamplePayload(
        example.input,
        program.entities,
        `Example ${example.id || idx}.input`,
        warnings,
        errors,
      );
      validateExamplePayload(
        example.expected,
        program.entities,
        `Example ${example.id || idx}.expected`,
        warnings,
        errors,
      );
    });

    // Conflicting set actions when priorities are indistinguishable
    detectConflictingSetActions(program).forEach((msg) => errors.push(msg));

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
