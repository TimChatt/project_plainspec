import { readFileSync } from 'fs';
import { buildTranslationPrompt, interpretTranslatorOutput, normaliseSpec } from './translator';

interface Args {
  specPath: string;
  responsePath?: string;
}

function parseArgs(): Args {
  const [, , ...rest] = process.argv;
  const specPath = rest[0] ?? 'examples/discount-program.free.txt';
  const responseFlagIndex = rest.findIndex((arg) => arg === '--response');
  const responsePath = responseFlagIndex >= 0 ? rest[responseFlagIndex + 1] : undefined;
  return { specPath, responsePath };
}

function main() {
  const { specPath, responsePath } = parseArgs();
  const source = readFileSync(specPath, 'utf8');
  const cleaned = normaliseSpec(source);
  const prompt = buildTranslationPrompt(cleaned);
  console.log('--- Prompt to send to the LLM ---');
  console.log(prompt);

  if (responsePath) {
    const response = readFileSync(responsePath, 'utf8');
    const parsed = interpretTranslatorOutput(response);
    console.log('\n--- Parsed response envelope ---');
    console.dir(parsed.envelope, { depth: null });
    if (parsed.validation) {
      console.log('\nValidation result for translated program:');
      console.dir(parsed.validation, { depth: null });
    }
  } else {
    console.log('\n(No response file provided; pass --response <path> to validate an LLM JSON reply)');
  }
}

main();
