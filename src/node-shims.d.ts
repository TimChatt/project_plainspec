declare module 'fs' {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module 'path' {
  export function resolve(...segments: string[]): string;
  export function join(...segments: string[]): string;
}

declare const __dirname: string;

declare namespace NodeJS {
  interface Process {
    argv: string[];
    exitCode?: number;
    exit(code?: number): never;
  }
}

declare const process: NodeJS.Process;

declare module 'ajv' {
  export interface ErrorObject {
    instancePath?: string;
    message?: string;
  }

  export type JSONSchemaType<T> = any;

  export default class Ajv {
    constructor(options?: any);
    validate<T>(schemaId: string, data: any): data is T;
    addSchema(schema: any): void;
    errors?: ErrorObject[] | null;
  }
}
