import fs from 'fs';
import path from 'path';
import { parseValidateAndRunExamples } from './parser';
import { assessRuleCoverage } from './coverage';

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '..', 'examples', 'discount-program.cnl');
  const source = fs.readFileSync(filePath, 'utf-8');
  const result = await parseValidateAndRunExamples(source);

  console.log('Parsing warnings:', result.parse.warnings);
  if (result.parse.errors.length > 0) {
    console.error('Parsing errors:', result.parse.errors);
    process.exitCode = 1;
    return;
  }

  console.log('Parsed Program:', JSON.stringify(result.parse.program, null, 2));

  if (result.validation) {
    console.log('Validation valid:', result.validation.valid);
    if (result.validation.errors.length) console.log('Validation errors:', result.validation.errors);
    if (result.validation.warnings.length) console.log('Validation warnings:', result.validation.warnings);
  }

  if (result.exampleResults) {
    console.log('Example results:', JSON.stringify(result.exampleResults, null, 2));
  }

  if (result.parse.program?.examples?.length) {
    console.log('Rule coverage from examples:', JSON.stringify(assessRuleCoverage(result.parse.program), null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
