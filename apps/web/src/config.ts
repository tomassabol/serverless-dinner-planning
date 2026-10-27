export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

/** Served next to the app (written at deploy time), so one build works for any stack. */
export async function loadConfig(): Promise<AppConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Missing config.json');
  return response.json();
}
