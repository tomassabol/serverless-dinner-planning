/**
 * Sets where a household shops, the same way the web app's Settings tab does (PUT /household).
 * Usage:
 *   AWS_PROFILE=tomassabol pnpm --filter @dinner/tools set-market <householdId> DK
 *   AWS_PROFILE=tomassabol pnpm --filter @dinner/tools set-market <householdId> SE <lat> <lng> <label>
 * It does not fetch offers; run the ingest with {"householdIds":["<householdId>"]} afterwards.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CountrySchema, HouseholdIdSchema, LocationSchema, marketFor } from '@dinner/shared';
import { PreferencesRepo } from '../src/preferences.js';

const [householdId, country, lat, lng, ...label] = process.argv.slice(2);
const market = {
  country: CountrySchema.parse(country),
  location: country === 'SE' ? LocationSchema.parse({ lat: Number(lat), lng: Number(lng), label: label.join(' ') }) : null,
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'eu-west-1' }), {
  marshallOptions: { removeUndefinedValues: true },
});
const repo = new PreferencesRepo(ddb, process.env.TABLE_NAME ?? 'dinner-prod-main');
const saved = await repo.setMarket(HouseholdIdSchema.parse(householdId), market);
console.log(JSON.stringify({ householdId: saved.householdId, market: saved.market, offerMarket: marketFor(saved.market)?.key }, null, 2));
