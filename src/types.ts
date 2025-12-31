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
  value: string | number | boolean | null;
  units?: string;
}

export type Operand = FactOperand | ValueOperand;

export type Comparator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface CompareCondition {
  kind: 'compare' | 'comparison';
  lhs: Operand;
  operator: Comparator;
  rhs: Operand;
}

export interface ExistsCondition {
  kind: 'exists';
  fact: FactOperand;
}

export interface InCondition {
  kind: 'in';
  value: Operand;
  options: Operand[];
}

export interface MatchesCondition {
  kind: 'matches';
  value: Operand;
  pattern: string;
  caseInsensitive?: boolean;
}

export interface BooleanCondition {
  kind: 'all' | 'any' | 'and' | 'or';
  conditions: Condition[];
}

export interface NotCondition {
  kind: 'not';
  condition: Condition;
}

export type Condition = CompareCondition | ExistsCondition | InCondition | MatchesCondition | BooleanCondition | NotCondition;

export interface SetAction {
  kind: 'set';
  target: string; // path like "order.discountPercent"
  value: Operand;
}

export interface IncrementAction {
  kind: 'increment';
  target: string;
  value: number;
}

export interface AppendAction {
  kind: 'append';
  target: string;
  value: Operand;
}

export interface EmitAction {
  kind: 'emit';
  event: string;
  payload?: Record<string, unknown>;
}

export interface RouteAction {
  kind: 'route';
  toQueue: string;
  reason?: string;
}

export type Action = SetAction | IncrementAction | AppendAction | EmitAction | RouteAction;

export interface Rule {
  id: string;
  name: string;
  description?: string;
  priority?: number;
  mode?: 'all' | 'first' | 'allMatches' | 'firstMatch';
  when: Condition;
  then?: Action[];
  else?: Action[];
  /** Legacy field kept for backward compatibility */
  actions?: Action[];
  tags?: string[];
  stopProcessing?: boolean;
}

export interface Constraint {
  id: string;
  description: string;
  assert: Condition;
  severity?: 'error' | 'warn' | 'warning';
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
  ruleEvaluation: 'all' | 'first' | 'allMatches' | 'firstMatch';
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
  details?: Record<string, unknown>;
  children?: ConditionTrace[];
}

export interface ActionTrace {
  action: Action;
  applied: boolean;
  path?: string;
  beforeValue?: any;
  afterValue?: any;
  actionId: string;
  ruleId: string;
  conflict?: boolean;
}

export interface RuleTrace {
  ruleId: string;
  ruleName: string;
  priority?: number;
  evaluatedWhen: boolean;
  why: ConditionTrace;
  actionsApplied: ActionTrace[];
  stateDiff: StateDiff[];
  stopProcessing?: boolean;
  warnings?: string[];
}

export interface StateDiff {
  path: string;
  before: any;
  after: any;
}

export interface ConstraintResult {
  constraint: Constraint;
  passed: boolean;
  trace: ConditionTrace;
}

export interface ConstraintReport {
  passed: ConstraintResult[];
  failed: ConstraintResult[];
  hasFailures: boolean;
  hasErrors: boolean;
  errorCount: number;
  warningCount: number;
}

export interface NormalizedActionLog {
  actionId: string;
  ruleId: string;
  kind: Action['kind'];
  path?: string;
  before?: any;
  after?: any;
  payload?: Record<string, unknown>;
}

export interface ExecutionOptions {
  mode?: 'firstMatch' | 'allMatches';
  maxRuleFirings?: number;
  enableActions?: boolean;
  clock?: number;
  debugTrace?: boolean;
  loopUntilSettled?: boolean;
  evaluateExamples?: boolean;
}

export interface ExecutionResult {
  resultState: Record<string, unknown>;
  actions: NormalizedActionLog[];
  trace: RuleTrace[];
  constraintReport: ConstraintReport;
  testReport?: ExampleResult[];
  success?: boolean;
  conflictWarnings?: string[];
  ruleFirings?: number;
  hitRuleLimit?: boolean;
}

export interface ExampleResult {
  example: Example;
  passed: boolean;
  actualOutput: Record<string, unknown>;
  constraints: ConstraintReport;
  trace: RuleTrace[];
}
