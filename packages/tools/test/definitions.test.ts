import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gatewayToolSchema } from '../src/definitions.js';

const ALLOWED_KEYS = new Set(['type', 'description', 'properties', 'required', 'items']);

function assertGatewayCompatible(schema: Record<string, unknown>, path: string) {
  for (const key of Object.keys(schema)) expect(ALLOWED_KEYS.has(key), `${path}.${key}`).toBe(true);
  expect(typeof schema.type, `${path}.type`).toBe('string');
  for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)) {
    assertGatewayCompatible(child, `${path}.${name}`);
  }
  if (schema.items) assertGatewayCompatible(schema.items as Record<string, unknown>, `${path}[]`);
}

describe('tool schema', () => {
  it('only uses JSON Schema keywords the Gateway accepts', () => {
    for (const tool of gatewayToolSchema()) assertGatewayCompatible(tool.inputSchema, tool.name);
  });

  it('never exposes householdId to the model', () => {
    expect(JSON.stringify(gatewayToolSchema())).not.toContain('householdId');
  });

  it('matches the committed data/tool-schema.json (run `pnpm gen:schema`)', () => {
    const committed = JSON.parse(readFileSync(new URL('../data/tool-schema.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(gatewayToolSchema());
  });
});
