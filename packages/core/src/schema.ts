import Ajv from 'ajv';
import {categories, Config, ReviewResponse} from './types';
const ajv = new Ajv({allErrors: true, strict: true});
export const defaults: Config = {schema_version: 1, files: [], context_files: [], brief: 'Review the argument and pacing. Preserve my voice.', max_comments: 8, limits: {file_bytes: 512 * 1024, packet_bytes: 2 * 1024 * 1024, block_chars: 6000}};
const string = (maxLength: number, minLength = 1) => ({type: 'string', minLength, maxLength});
const positive = (maximum: number, minimum = 1) => ({type: 'integer', minimum, maximum});
const object = (properties: Record<string, unknown>) => ({type: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const configSchema = object({schema_version: {const: 1}, files: {type: 'array', maxItems: 200, uniqueItems: true, items: string(500)}, context_files: {type: 'array', maxItems: 200, uniqueItems: true, items: string(500)}, brief: string(20000), max_comments: positive(100, 0), limits: object({file_bytes: positive(4 * 1024 * 1024), packet_bytes: positive(8 * 1024 * 1024), block_chars: positive(20000, 64)})});
export function responseSchema(requestId: string, budget: number) {
  return {...object({schema_version: {type: 'integer', const: 1}, request_id: {type: 'string', const: requestId}, summary: string(20000, 0), comments: {type: 'array', maxItems: budget, items: object({file: string(500), block_id: string(100), quote: string(20000), category: {type: 'string', enum: categories}, body: string(8000)})}}), $schema: 'http://json-schema.org/draft-07/schema#'};
}
export function validateConfig(value: unknown): Config {
  const validate = ajv.compile<Config>(configSchema);
  if (!validate(value)) throw new Error(`Invalid .reviews/config.json: ${ajv.errorsText(validate.errors)}`);
  return value as Config;
}
export function validateResponse(value: unknown, requestId: string, budget: number): ReviewResponse {
  const validate = ajv.compile<ReviewResponse>(responseSchema(requestId, budget));
  if (!validate(value)) throw new Error(`Response schema validation failed: ${ajv.errorsText(validate.errors)}`);
  return value as ReviewResponse;
}
