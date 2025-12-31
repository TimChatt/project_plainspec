import type { JSONSchemaType } from 'ajv';
import { Action, Condition, Constraint, Program, Rule } from './types';

const operandSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'fact' },
        path: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*\\.[a-zA-Z][a-zA-Z0-9_]*$' },
        units: { type: 'string', nullable: true }
      },
      required: ['kind', 'path'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'value' },
        value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        units: { type: 'string', nullable: true }
      },
      required: ['kind', 'value'],
      additionalProperties: false
    }
  ]
} as const;

const conditionSchema: JSONSchemaType<Condition> = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { enum: ['comparison', 'compare'] },
        lhs: operandSchema,
        operator: {
          type: 'string',
          enum: ['==', '!=', '>', '>=', '<', '<=', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']
        },
        rhs: operandSchema
      },
      required: ['kind', 'lhs', 'operator', 'rhs'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { enum: ['all', 'any', 'and', 'or'] },
        conditions: {
          type: 'array',
          items: { $ref: '#/definitions/condition' },
          minItems: 1
        }
      },
      required: ['kind', 'conditions'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'not' },
        condition: { $ref: '#/definitions/condition' }
      },
      required: ['kind', 'condition'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'exists' },
        fact: operandSchema
      },
      required: ['kind', 'fact'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'in' },
        value: operandSchema,
        options: {
          type: 'array',
          items: operandSchema,
          minItems: 1
        }
      },
      required: ['kind', 'value', 'options'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'matches' },
        value: operandSchema,
        pattern: { type: 'string' },
        caseInsensitive: { type: 'boolean', nullable: true }
      },
      required: ['kind', 'value', 'pattern'],
      additionalProperties: false
    }
  ],
  definitions: {
    condition: {} as JSONSchemaType<Condition>
  }
} as any;
(conditionSchema.definitions!.condition as any).oneOf = conditionSchema.oneOf;

const actionSchema: JSONSchemaType<Action> = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'set' },
        target: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*\\.[a-zA-Z][a-zA-Z0-9_]*$' },
        value: operandSchema
      },
      required: ['kind', 'target', 'value'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'increment' },
        target: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*\\.[a-zA-Z][a-zA-Z0-9_]*$' },
        value: { type: 'number' }
      },
      required: ['kind', 'target', 'value'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'append' },
        target: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]*\\.[a-zA-Z][a-zA-Z0-9_]*$' },
        value: operandSchema
      },
      required: ['kind', 'target', 'value'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'emit' },
        event: { type: 'string' },
        payload: { type: 'object', nullable: true }
      },
      required: ['kind', 'event'],
      additionalProperties: false
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'route' },
        toQueue: { type: 'string' },
        reason: { type: 'string', nullable: true }
      },
      required: ['kind', 'toQueue'],
      additionalProperties: false
    }
  ]
} as any;

const ruleSchema: JSONSchemaType<Rule> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    priority: { type: 'number', nullable: true },
    mode: { type: 'string', enum: ['all', 'first', 'allMatches', 'firstMatch'], nullable: true },
    when: conditionSchema,
    then: {
      type: 'array',
      items: actionSchema,
      minItems: 1,
      nullable: true
    },
    else: {
      type: 'array',
      items: actionSchema,
      nullable: true
    },
    actions: {
      type: 'array',
      items: actionSchema,
      nullable: true
    },
    tags: { type: 'array', items: { type: 'string' }, nullable: true },
    stopProcessing: { type: 'boolean', nullable: true }
  },
  required: ['id', 'name', 'when'],
  additionalProperties: false
};

const constraintSchema: JSONSchemaType<Constraint> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    description: { type: 'string' },
    assert: conditionSchema,
    severity: { type: 'string', enum: ['error', 'warn', 'warning'], nullable: true }
  },
  required: ['id', 'description', 'assert'],
  additionalProperties: false
};

export const programSchema: JSONSchemaType<Program> = {
  $id: 'https://plainspec.dev/program.schema.json',
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      enum: ['business-rules', 'workflow', 'data-transform', 'game-rules']
    },
    description: { type: 'string', nullable: true },
    entities: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          fields: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['string', 'number', 'boolean', 'date'] },
                description: { type: 'string', nullable: true },
                units: { type: 'string', nullable: true }
              },
              required: ['name', 'type'],
              additionalProperties: false
            }
          }
        },
        required: ['name', 'fields'],
        additionalProperties: false
      }
    },
    rules: {
      type: 'array',
      minItems: 1,
      items: ruleSchema
    },
    constraints: {
      type: 'array',
      nullable: true,
      items: constraintSchema
    },
    examples: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string', nullable: true },
          input: { type: 'object' },
          expected: { type: 'object' }
        },
        required: ['id', 'input', 'expected'],
        additionalProperties: false
      }
    },
    config: {
      type: 'object',
      nullable: true,
      properties: {
        ruleEvaluation: { type: 'string', enum: ['all', 'first', 'allMatches', 'firstMatch'] }
      },
      required: ['ruleEvaluation'],
      additionalProperties: false
    }
  },
  required: ['domain', 'entities', 'rules'],
  additionalProperties: false
};
