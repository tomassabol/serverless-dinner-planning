/**
 * AgentCore Gateway REQUEST interceptor.
 *
 * The Gateway uses AWS_IAM auth, so only our agent runtimes can call it. They pass the household
 * (taken from the weekly workflow input or the user's Cognito claims) in `X-Dinner-Household-Id` and
 * their role in `X-Dinner-Caller`. This interceptor copies the household into the tool arguments,
 * overwriting anything the model supplied, and blocks write tools for non-chat callers.
 */
import { HouseholdIdSchema } from '@dinner/shared';
import { WRITE_TOOLS, type ToolName } from './definitions.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> } & Record<string, unknown>;
}

export interface InterceptorEvent {
  interceptorInputVersion: string;
  mcp: {
    gatewayRequest: {
      headers?: Record<string, string>;
      body: JsonRpcRequest;
    };
  };
}

export const HOUSEHOLD_HEADER = 'x-dinner-household-id';
export const CALLER_HEADER = 'x-dinner-caller';

export const handler = async (event: InterceptorEvent) => {
  const { body, headers = {} } = event.mcp.gatewayRequest;
  if (body.method !== 'tools/call') return pass(body);

  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const household = HouseholdIdSchema.safeParse(lower[HOUSEHOLD_HEADER]);
  if (!household.success) return reject(body, 'Missing or invalid household context.');

  const fullName = body.params?.name ?? '';
  const toolName = fullName.slice(fullName.indexOf('___') + 3) as ToolName;
  if (WRITE_TOOLS.has(toolName) && lower[CALLER_HEADER] !== 'chat') {
    return reject(body, `${toolName} is only available in chat.`);
  }

  return pass({
    ...body,
    params: { ...body.params, arguments: { ...body.params?.arguments, householdId: household.data } },
  });
};

const pass = (body: JsonRpcRequest) => ({
  interceptorOutputVersion: '1.0',
  mcp: { transformedGatewayRequest: { body } },
});

const reject = (body: JsonRpcRequest, message: string) => ({
  interceptorOutputVersion: '1.0',
  mcp: {
    transformedGatewayResponse: {
      statusCode: 200,
      body: { jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: message }] } },
    },
  },
});
