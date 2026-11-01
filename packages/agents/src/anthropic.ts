import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

let apiKey: Promise<string> | undefined;

/**
 * Claude API key: ANTHROPIC_API_KEY when set (local scripts load it from the repo's .env), otherwise
 * the Secrets Manager secret named by ANTHROPIC_API_KEY_SECRET_ARN (AgentCore runtimes). Read once per process.
 */
export function anthropicApiKey(env: Record<string, string | undefined> = process.env): Promise<string> {
  apiKey ??= (async () => {
    if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
    const secretId = env.ANTHROPIC_API_KEY_SECRET_ARN;
    if (!secretId) throw new Error('Set ANTHROPIC_API_KEY or ANTHROPIC_API_KEY_SECRET_ARN');
    const { SecretString } = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!SecretString) throw new Error(`Secret ${secretId} has no value`);
    return SecretString;
  })().catch((error) => {
    apiKey = undefined;
    throw error;
  });
  return apiKey;
}
