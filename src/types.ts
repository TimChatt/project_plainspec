export type ScalarType = 'string' | 'number' | 'boolean' | 'date';

export interface Field {
  name: string;
  type: ScalarType;
  description?: string;
  units?: string;
}

export interface Entity {
  name: string;
  fields: Field[];
  description?: string;
}

export interface FactOperand {
  kind: 'fact';
  /** Path like "order.total" */
  path: string;
  units?: string;
}

export interface ValueOperand {
  kind: 'value';
  value: string | number | boolean;
  units?: string;
}

export type Operand = FactOperand | ValueOperand;

export type Comparator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface ComparisonCondition {
  kind: 'comparison';
  lhs: Operand;
  operator: Comparator;
  rhs: Operand;
}

export interface BooleanCondition {
  kind: 'all' | 'any';
  conditions: Condition[];
}

export interface NotCondition {
  kind: 'not';
  condition: Condition;
}

export type Condition = ComparisonCondition | BooleanCondition | NotCondition;

export interface SetAction {
  kind: 'set';
  target: string; // path like "order.discountPercent"
  value: ValueOperand;
}

export interface EmitAction {
  kind: 'emit';
  event: string;
  payload?: Record<string, unknown>;
}

export interface RouteAction {
  kind: 'route';
  queue: string;
  reason?: string;
}

export type Action = SetAction | EmitAction | RouteAction;

export interface Rule {
  id: string;
  name: string;
  description?: string;
  priority?: number;
  mode?: 'all' | 'first';
  when: Condition;
  actions: Action[];
}

export interface Constraint {
  id: string;
  description: string;
  assert: Condition;
  severity?: 'error' | 'warn';
}

export interface Example {
  id: string;
  description?: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  options?: string[];
}

export interface ClarificationRequest {
  kind: 'clarification';
  reason?: string;
  questions: ClarificationQuestion[];
  assumptions?: string[];
}

export type TranslationConfidence = 'high' | 'medium' | 'low';

export interface TranslationEnvelopeProgram {
  kind: 'program';
  program: Program;
  confidence: TranslationConfidence;
  assumptions?: string[];
  warnings?: string[];
}

export type TranslationEnvelope = TranslationEnvelopeProgram | ClarificationRequest;

export interface ProgramConfig {
  ruleEvaluation: 'all' | 'first';
}

export interface Program {
  domain: 'business-rules' | 'workflow' | 'data-transform' | 'game-rules';
  description?: string;
  entities: Entity[];
  rules: Rule[];
  constraints?: Constraint[];
  examples?: Example[];
  config?: ProgramConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RuleCoverage {
  ruleId: string;
  matchedInExamples: number;
  totalExamples: number;
  coveragePercent: number;
}

export interface ConditionTrace {
  condition: Condition;
  result: boolean;
  children?: ConditionTrace[];
}

export interface ActionTrace {
  action: Action;
  applied: boolean;
  previousValue?: any;
  newValue?: any;
}

export interface RuleTrace {
  rule: Rule;
  matched: boolean;
  conditionTrace: ConditionTrace;
  actions: ActionTrace[];
}

export interface ConstraintResult {
  constraint: Constraint;
  passed: boolean;
}

export interface ExecutionResult {
  output: Record<string, unknown>;
  firedRules: RuleTrace[];
  constraints: ConstraintResult[];
}

export interface ExampleResult {
  example: Example;
  passed: boolean;
  actualOutput: Record<string, unknown>;
}
