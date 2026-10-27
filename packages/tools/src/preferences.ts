import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PreferencesSchema, householdKeys, type Member, type Preferences } from '@dinner/shared';
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
    return PreferencesSchema.parse(Item ?? { householdId });
  }

  async update(householdId: string, input: z.infer<typeof UpdatePreferencesInput>): Promise<Preferences> {
    const current = await this.get(householdId);
    const next = applyPreferenceUpdate(current, input, new Date());
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...householdKeys.preferences(householdId), ...next },
        // Optimistic lock so two concurrent chat edits can't silently overwrite each other.
        ConditionExpression: current.updatedAt ? 'updatedAt = :previous' : 'attribute_not_exists(pk)',
        ExpressionAttributeValues: current.updatedAt ? { ':previous': current.updatedAt } : undefined,
      }),
    );
    return next;
  }
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
