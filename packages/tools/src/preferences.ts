import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  CHAINS,
  PreferencesSchema,
  chainsFor,
  countryInfo,
  householdIndexKeys,
  householdKeys,
  migratePreferences,
  type Market,
  type Member,
  type Preferences,
} from '@dinner/shared';
import type { z } from 'zod';
import type { UpdatePreferencesInput } from './definitions.js';

export class PreferencesRepo {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(householdId: string): Promise<Preferences> {
    const { Item } = await this.ddb.send(
      new GetCommand({ TableName: this.tableName, Key: householdKeys.preferences(householdId) }),
    );
    return PreferencesSchema.parse(migratePreferences(Item) ?? { householdId });
  }

  async update(householdId: string, input: z.infer<typeof UpdatePreferencesInput>): Promise<Preferences> {
    const current = await this.get(householdId);
    const next = applyPreferenceUpdate(current, input, new Date());
    await this.put(current, next);
    return next;
  }

  /** Changes where the household shops (web app settings only). Preferred chains of the old country are dropped. */
  async setMarket(householdId: string, market: Market, preferredChains?: string[]): Promise<Preferences> {
    const current = await this.get(householdId);
    const next = applyMarketUpdate(current, market, preferredChains, new Date());
    await this.put(current, next);
    return next;
  }

  private async put(current: Preferences, next: Preferences) {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        // The index keys list every household with saved preferences, so ingest finds Swedish locations.
        Item: { ...householdKeys.preferences(next.householdId), ...householdIndexKeys(next.householdId), ...next },
        // Optimistic lock so two concurrent edits can't silently overwrite each other.
        ConditionExpression: current.updatedAt ? 'updatedAt = :previous' : 'attribute_not_exists(pk)',
        ExpressionAttributeValues: current.updatedAt ? { ':previous': current.updatedAt } : undefined,
      }),
    );
  }
}

/** What the agents see from get_preferences: the stored preferences plus derived market facts. */
export function describePreferences(preferences: Preferences) {
  const { country } = preferences.market;
  const info = countryInfo(country);
  return {
    ...preferences,
    country: info.name,
    currency: info.currency,
    availableChains: chainsFor(country).map((c) => ({ id: c.id, name: c.name })),
  };
}

export function applyMarketUpdate(current: Preferences, market: Market, preferredChains: string[] | undefined, now: Date): Preferences {
  if (market.country === 'SE' && !market.location) throw new Error('A household in Sweden needs a location to find nearby stores.');
  const available = new Set(chainsFor(market.country).map((c) => c.id as string));
  const requested = preferredChains ?? current.settings.preferredChains;
  const unknown = requested.filter((id) => !available.has(id));
  if (preferredChains && unknown.length) throw new Error(`Not available in ${countryInfo(market.country).name}: ${unknown.join(', ')}`);
  return {
    ...current,
    market: { country: market.country, location: market.country === 'DK' ? null : market.location },
    settings: { ...current.settings, preferredChains: requested.filter((id) => available.has(id)) as Preferences['settings']['preferredChains'] },
    updatedAt: now.toISOString(),
  };
}

const MEMBER_FIELDS = ['addAllergies', 'removeAllergies', 'addDislikes', 'removeDislikes', 'addLikes', 'removeLikes', 'diet'] as const;

export function applyPreferenceUpdate(
  current: Preferences,
  input: z.infer<typeof UpdatePreferencesInput>,
  now: Date,
): Preferences {
  const touchesMember = MEMBER_FIELDS.some((field) => input[field] !== undefined);
  if (touchesMember && !input.member) {
    throw new Error('member is required when changing allergies, dislikes, likes or diet');
  }

  const members = [...current.members];
  if (input.member) {
    const index = members.findIndex((m) => m.name.toLowerCase() === input.member!.toLowerCase());
    const member: Member =
      index >= 0 ? { ...members[index]! } : { name: input.member, allergies: [], dislikes: [], likes: [], diet: null };

    member.allergies = edit(member.allergies, input.addAllergies, input.removeAllergies);
    member.dislikes = edit(member.dislikes, input.addDislikes, input.removeDislikes);
    member.likes = edit(member.likes, input.addLikes, input.removeLikes);
    if (input.diet !== undefined) member.diet = input.diet;

    if (index >= 0) members[index] = member;
    else members.push(member);
  }

  if (input.settings?.preferredChains) {
    const available = new Set(chainsFor(current.market.country).map((c) => c.id as string));
    const unknown = input.settings.preferredChains.filter((id) => !available.has(id));
    if (unknown.length) {
      const names = unknown.map((id) => CHAINS.find((c) => c.id === id)?.name ?? id);
      throw new Error(`${names.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not available to this household (${countryInfo(current.market.country).name}).`);
    }
  }

  return {
    ...current,
    members,
    settings: { ...current.settings, ...input.settings },
    notes: edit(current.notes, input.addNotes, input.removeNotes),
    updatedAt: now.toISOString(),
  };
}

/** Adds and removes entries case-insensitively, keeping the first spelling seen. */
function edit(list: string[], add: string[] = [], remove: string[] = []): string[] {
  const removed = new Set(remove.map((r) => r.trim().toLowerCase()));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of [...list, ...add]) {
    const key = value.trim().toLowerCase();
    if (!key || removed.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(value.trim());
  }
  return result;
}
