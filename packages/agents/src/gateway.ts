import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SignatureV4 } from '@smithy/signature-v4';
import { McpClient, type McpClientOptions } from '@strands-agents/sdk';

export type Caller = 'weekly' | 'chat';

export interface GatewayClientOptions extends McpClientOptions {
  url: string;
  region: string;
  householdId: string;
  caller: Caller;
}

/**
 * MCP client for the AgentCore Gateway. Requests are SigV4-signed with the runtime role, and carry
 * the household and caller headers that the Gateway interceptor turns into trusted tool arguments.
 */
export function createGatewayClient({ url, region, householdId, caller, ...options }: GatewayClientOptions): McpClient {
  const signer = new SignatureV4({
    service: 'bedrock-agentcore',
    region,
    credentials: fromNodeProviderChain(),
    sha256: Sha256,
  });

  const signedFetch: typeof fetch = async (input, init = {}) => {
    const target = new URL(input instanceof Request ? input.url : input.toString());
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body = typeof init.body === 'string' ? init.body : undefined;

    const signed = await signer.sign({
      method: init.method ?? 'GET',
      protocol: target.protocol,
      hostname: target.hostname,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers: {
        ...headers,
        host: target.hostname,
        'x-dinner-household-id': householdId,
        'x-dinner-caller': caller,
      },
      body,
    });
    return fetch(target, { ...init, headers: signed.headers });
  };

  return new McpClient({
    ...options,
    transport: new StreamableHTTPClientTransport(new URL(url), { fetch: signedFetch }),
  });
}

/** Calls a Gateway tool directly (outside an agent) and parses its JSON result. */
export async function callTool<T>(client: McpClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const tools = await client.listTools();
  const tool = tools.find((t) => t.name === name || t.name.endsWith(`___${name}`));
  if (!tool) throw new Error(`Gateway has no tool named ${name}`);

  const result = (await client.callTool(tool, args as never)) as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = result.content?.find((c) => c.type === 'text')?.text ?? 'null';
  if (result.isError) throw new Error(`${name} failed: ${text}`);
  const parsed = JSON.parse(text) as T & { error?: string };
  if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) throw new Error(`${name} failed: ${parsed.error}`);
  return parsed;
}
