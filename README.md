# PlainSpec – English-Based Coding Language (V1)

## TL;DR Codex Paste
- Build an English-like language that compiles to a validated JSON AST and runs deterministically—LLM never executes logic.
- Pick **one domain** (recommend business rules; alternatives: workflow, data transforms, game rules).
- Pipeline: English spec → (optional LLM rewrite) → Controlled English or AST → Validate/Lint → Execute → Trace.
- Controlled English supports definitions, rules, constraints, examples; bans vague terms, pronouns without reference, and implicit units.
- AST nodes: Program, Entity (fields+types), Rule (conditions+actions+priority), Condition, Action (set/emit/route), Constraint, Example.
- LLM translator returns **AST JSON** or **clarification questions**; flags ambiguity, normalises synonyms, lists assumptions.
- Parser: deterministic Controlled-English → AST with clear errors.
- Validator/Linter: schema validity, undefined refs, conflicts, explicit units, banned vague terms, constraint sanity; fail closed.
- Engine: deterministic rules with priority + first/all modes; outputs result, fired rules, condition results, field changes, constraint checks.
- Examples as tests must pass (configurable) before execution; failures show expected vs actual.
- Minimal UI: panels for English Spec / Compiled AST / Run+Trace; buttons Translate, Validate, Run, Run Examples.

Condensed, Codex-ready requirements for building PlainSpec, an English-like programming language that compiles into a typed, deterministic AST and executes via a rules engine.

## Goal
Build an English-like programming language that compiles into a typed AST and executes deterministically. LLMs translate intent but never execute logic.

## V1 Scope
Pick a single domain (recommended: business rules). Alternatives: workflow automation, data transforms, or game rules.

## Architecture Pipeline
1. English Spec → (optional LLM rewrite)
2. Controlled English or Typed AST
3. Validation + Linting
4. Rules Engine Execution
5. Trace Output

## Controlled English Surface
- **Supports** definitions, rules, constraints, and examples/tests.
  - Example: "If order total > 100, apply a 10 percent discount."
  - Example: "Example: total 120 → discount 10 percent."
- **Disallow** pronouns without explicit reference, vague terms (recent, large, soon), and implicit units.

## AST (Source of Truth)
JSON schema entities:
- Program, Entity (fields + types), Rule (conditions + actions + priority), Condition (boolean logic), Action (set, emit, route), Constraint (invariants), Example (input + expected output).
- AST must fully validate before execution.

## LLM Translator
- Input: free English.
- Output: valid AST JSON **or** structured clarification questions.
- Rules: no execution via LLM, flag ambiguity, normalise synonyms, and list assumptions.

## Controlled English Parser
- Deterministic grammar converting Controlled English → AST.
- Clear errors (undefined entity, ambiguous rule).

## Validator + Linter
- Schema validity, undefined references, conflicting rules, explicit units, banned vague terms, constraint sanity. Fail closed on error.

## Execution Engine
- Deterministic rule evaluation with priority and first-match/all-match modes.
- Returns output, fired rules, condition results, field changes, constraint checks.

## Examples as Tests
- Examples must pass before execution (configurable). Failures show expected vs actual.

## Minimal UX
- Panels: English Spec, Compiled AST, Run + Trace.
- Buttons: Translate, Validate, Run, Run Examples.

## Milestones
1. AST schema + validator
2. Rules engine + trace
3. Example test runner
4. Controlled English parser
5. LLM translator
6. UX polish

## Safety Rules
- LLM never runs logic; execute only validated AST. Ambiguity requires clarification. Optional capability permissions (read/write).

## Suggested Stack
- Node + TypeScript, JSON Schema validation, PEG parser, simple React UI.

---

## Validator + Engine Quickstart
This repo now includes a TypeScript schema + validator for the AST, a simple execution engine, and a sample business-rules program.

### Setup
```bash
npm install
```

### Validate and run the sample program
```bash
npm run validate:sample
```

The script loads `examples/discount-program.json`, validates it against the schema, reports any errors plus lint warnings (vague words, missing units when fields declare them), runs a sample input through the rules engine, and executes the bundled examples.
It also prints how many examples exercise each rule.

Alternatively, use the generic CLI to target any AST file or controlled-English spec:

```bash
# Validate an AST program
npm run cli -- validate examples/discount-program.json

# Execute an AST program against a payload
npm run cli -- run examples/discount-program.json --input examples/discount-input.json

# Run all examples embedded in the AST
npm run cli -- examples examples/discount-program.json

# Parse controlled English into AST, validate it, and write JSON to disk
npm run cli -- parse examples/discount-program.cnl --out /tmp/program.json --run-examples
```

### What gets checked
- JSON Schema correctness for all nodes (program, entities, rules, constraints, examples).
- Entity/field references in conditions and `set` actions.
- Units and types: comparisons and `set` actions must align with referenced field types, and operands must carry required units when a field declares them (warns when units are missing; errors when mismatched).
- Examples: inputs and expected outputs must reference known entities/fields and align with declared field types (with warnings when numeric values omit required units).
- Vague language: simple lint on rule/constraint names and descriptions.
- Rule coverage: warns when no examples are provided or when a rule never fires in any example.
- Rule execution: deterministic rule application (priority, first/all modes), constraint checks, and per-rule traces.
- Examples: each example input is executed and compared against expected outputs.

### Parse controlled English into AST
```bash
npm run parse:sample
```

This script parses the controlled English spec in `examples/discount-program.cnl` into the AST shape, validates it with the same checks above, and runs the bundled examples.

### Build an LLM translation prompt for free English
```bash
npm run translate:prompt
```

This prints a deterministic prompt for the free-form spec in `examples/discount-program.free.txt`. Pass `--response path/to/response.json` to validate an LLM JSON reply (translated program or clarification) against the schema and lint rules.

### Extending
- Add more rules/entities to `examples/` and rerun `npm run validate:sample`.
- Use `src/schema.ts` as the source of truth for AST validation; `src/validator.ts` adds cross-reference and linting.
- Extend the rules engine behavior in `src/executor.ts` (e.g., richer actions, more operators, better tracing).
