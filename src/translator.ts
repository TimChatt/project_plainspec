import { Program } from './types';
import {
  ClarificationRequest,
  TranslationConfidence,
  TranslationEnvelope,
  TranslationEnvelopeProgram
} from './types';
import { validateProgram } from './validator';

export interface TranslatorPromptOptions {
  domain?: Program['domain'];
  synonyms?: Record<string, string[]>;
  bannedTerms?: string[];
  confidence?: TranslationConfidence;
}

export interface TranslatorResponse {
  envelope: TranslationEnvelope;
  validation?: ReturnType<typeof validateProgram>;
}

export const defaultSynonyms: Record<string, string[]> = {
  discount: ['rebate', 'price reduction'],
  approve: ['accept', 'greenlight'],
  deny: ['reject', 'decline'],
  customer: ['client', 'buyer'],
  order: ['purchase'],
  invoice: ['bill'],
  queue: ['work queue', 'inbox'],
  sla: ['service level agreement']
};

const defaultBannedTerms = ['recent', 'soon', 'large', 'few', 'some'];

function formatSynonyms(synonyms: Record<string, string[]>): string {
  return Object.entries(synonyms)
    .map(([canonical, variants]) => `- ${canonical}: ${variants.join(', ')}`)
    .join('\n');
}

/**
 * Build an instruction prompt for an LLM that enforces the JSON envelope format and
 * bans vague phrasing. The caller is responsible for invoking the LLM; this helper
 * keeps the prompt text deterministic and testable.
 */
export function buildTranslationPrompt(
  spec: string,
  options: TranslatorPromptOptions = {}
): string {
  const synonyms = formatSynonyms(options.synonyms ?? defaultSynonyms);
  const banned = (options.bannedTerms ?? defaultBannedTerms).join(', ');
  const domain = options.domain ?? 'business-rules';
  const confidence = options.confidence ?? 'medium';
  const envelopeExample: TranslationEnvelopeProgram = {
    kind: 'program',
    confidence,
    assumptions: ['explicit assumptions you made go here'],
    warnings: ['note where you rewrote vague phrasing'],
    program: {
      domain,
      description: 'plain language summary',
      entities: [
        {
          name: 'entityName',
          fields: [
            {
              name: 'fieldName',
              type: 'string',
              description: 'field description with units when relevant',
              units: 'percent'
            }
          ]
        }
      ],
      rules: [
        {
          id: 'rule-1',
          name: 'Concise rule name without vague terms',
          description: 'Describe the rule without banned words.',
          when: {
            kind: 'comparison',
            lhs: { kind: 'fact', path: 'entityName.fieldName', units: 'percent' },
            operator: 'gt',
            rhs: { kind: 'value', value: 10, units: 'percent' }
          },
          actions: [
            {
              kind: 'set',
              target: 'entityName.otherField',
              value: { kind: 'value', value: 'approved' }
            }
          ],
          mode: 'all',
          priority: 1
        }
      ],
      constraints: [
        {
          id: 'constraint-1',
          description: 'Invariant without vague words',
          assert: {
            kind: 'comparison',
            lhs: { kind: 'fact', path: 'entityName.fieldName' },
            operator: 'lte',
            rhs: { kind: 'value', value: 100, units: 'percent' }
          },
          severity: 'error'
        }
      ],
      examples: [
        {
          id: 'example-1',
          description: 'Given X expect Y',
          input: { entityName: { fieldName: 50 } },
          expected: { entityName: { otherField: 'approved' } }
        }
      ],
      config: {
        ruleEvaluation: 'all'
      }
    }
  };

  const clarificationExample: ClarificationRequest = {
    kind: 'clarification',
    reason: 'Ambiguous units for discount percentage',
    questions: [
      {
        id: 'q1',
        text: 'What units should the discount use?',
        options: ['percent', 'currency']
      }
    ],
    assumptions: ['Assumed discount refers to price reduction percent']
  };

  return [
    'Translate the following free-form English specification into a PlainSpec JSON envelope.',
    'Strictly return JSON only. Do not add commentary.',
    'Choose exactly one of the following output envelopes:',
    '- {"kind":"program", "confidence": "high|medium|low", "assumptions": [], "warnings": [], "program": <Program>}',
    '- {"kind":"clarification", "reason": "string", "questions": [{"id":"q1", "text":"?", "options":["opt"]}], "assumptions": []}',
    'Rules:',
    `- Domain: ${domain}.`,
    '- Reject vague adjectives or pronouns; surface them as clarification questions.',
    `- Normalise synonyms to canonical terms: \n${synonyms}`,
    `- Banned vague terms: ${banned}.`,
    '- Include explicit units where the field implies them.',
    '- List every assumption you make in the envelope assumptions array.',
    '- Never invent fields or entities that are not stated; ask for clarification instead.',
    'Examples:',
    JSON.stringify(envelopeExample, null, 2),
    JSON.stringify(clarificationExample, null, 2),
    'Specification to translate (delimited by <<< >>>):',
    '<<<',
    spec.trim(),
    '>>>'
  ].join('\n');
}

function isClarificationEnvelope(data: any): data is ClarificationRequest {
  return data && data.kind === 'clarification' && Array.isArray(data.questions);
}

function isProgramEnvelope(data: any): data is TranslationEnvelopeProgram {
  return data && data.kind === 'program' && data.program;
}

/**
 * Parse an LLM response string into a strongly typed envelope and validate the
 * program payload if present. Invalid JSON automatically becomes a
 * clarification envelope that explains the issue.
 */
export function interpretTranslatorOutput(raw: string): TranslatorResponse {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    const clar: ClarificationRequest = {
      kind: 'clarification',
      reason: `Malformed JSON: ${error.message}`,
      questions: [
        {
          id: 'format',
          text: 'Please resend the translation as strict JSON with one of the allowed envelopes.'
        }
      ]
    };
    return { envelope: clar };
  }

  if (isClarificationEnvelope(parsed)) {
    return { envelope: parsed };
  }

  if (isProgramEnvelope(parsed)) {
    const validation = validateProgram(parsed.program);
    return { envelope: parsed, validation };
  }

  const clar: ClarificationRequest = {
    kind: 'clarification',
    reason: 'Unexpected envelope shape. Expect "program" or "clarification" kinds.',
    questions: [
      {
        id: 'kind',
        text: 'Return either a "program" or "clarification" envelope as documented.'
      }
    ]
  };
  return { envelope: clar };
}

/**
 * Simple helper to normalise common synonyms in free-form specs before parsing.
 */
export function normaliseSpec(text: string, synonyms: Record<string, string[]> = defaultSynonyms): string {
  let normalised = text;
  Object.entries(synonyms).forEach(([canonical, variants]) => {
    variants.forEach((variant) => {
      const pattern = new RegExp(`\\b${variant.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
      normalised = normalised.replace(pattern, canonical);
    });
  });
  return normalised;
}
