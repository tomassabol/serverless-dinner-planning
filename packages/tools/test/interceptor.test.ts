import { describe, expect, it } from 'vitest';
import { handler, type InterceptorEvent } from '../src/interceptor.js';

const event = (body: object, headers: Record<string, string> = {}): InterceptorEvent => ({
  interceptorInputVersion: '1.0',
  mcp: { gatewayRequest: { headers, body: { jsonrpc: '2.0', id: 7, ...body } as never } },
});

const call = (name: string, args: object) => ({ method: 'tools/call', params: { name: `dinner-tools___${name}`, arguments: args } });

describe('interceptor', () => {
  it('passes non-tool calls through unchanged', async () => {
    const result = await handler(event({ method: 'tools/list' }));
    expect(result.mcp).toEqual({ transformedGatewayRequest: { body: { jsonrpc: '2.0', id: 7, method: 'tools/list' } } });
  });

  it('injects the household from the header and overwrites model-supplied values', async () => {
    const result = await handler(
      event(call('search_offers', { query: 'salmon', householdId: 'someone-else' }), { 'X-Dinner-Household-Id': 'home' }),
    );
    const body = (result.mcp as { transformedGatewayRequest: { body: { params: { arguments: object } } } })
      .transformedGatewayRequest.body;
    expect(body.params.arguments).toEqual({ query: 'salmon', householdId: 'home' });
  });

  it('rejects tool calls without a valid household', async () => {
    for (const headers of [{}, { 'x-dinner-household-id': 'Not Valid!' }] as Record<string, string>[]) {
      const result = await handler(event(call('get_preferences', {}), headers));
      expect(result.mcp).toHaveProperty('transformedGatewayResponse.body.result.isError', true);
    }
  });

  it('allows write tools only for the chat caller', async () => {
    const weekly = await handler(
      event(call('update_preferences', {}), { 'x-dinner-household-id': 'home', 'x-dinner-caller': 'weekly' }),
    );
    expect(weekly.mcp).toHaveProperty('transformedGatewayResponse');

    const chat = await handler(
      event(call('update_preferences', {}), { 'x-dinner-household-id': 'home', 'x-dinner-caller': 'chat' }),
    );
    expect(chat.mcp).toHaveProperty('transformedGatewayRequest');
  });
});
