/** Workflow step: emails the stored plan to every verified member of the household. */
import { CognitoIdentityProviderClient, paginateListUsers } from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { HOUSEHOLD_ATTRIBUTE } from '@dinner/shared';
import { ddb, env, logger, tracer } from '../clients.js';
import { renderPlanEmail } from '../email/render.js';
import { PlanRepo } from '../plans.js';

const { TABLE_NAME, USER_POOL_ID, SENDER_EMAIL } = env('TABLE_NAME', 'USER_POOL_ID', 'SENDER_EMAIL');
const plans = new PlanRepo(ddb, TABLE_NAME);
const cognito = tracer.captureAWSv3Client(new CognitoIdentityProviderClient({}));
const ses = tracer.captureAWSv3Client(new SESv2Client({}));

export async function sendPlanEmail(householdId: string, week: string) {
  const plan = await plans.get(householdId, week);
  if (!plan) throw new Error(`No stored plan for ${householdId} ${week}`);

  const recipients = await householdEmails(householdId);
  if (recipients.length === 0) throw new Error(`Household ${householdId} has no verified members`);

  const { subject, html, text } = renderPlanEmail(plan);
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: `Dinner Planner <${SENDER_EMAIL}>`,
      Destination: { ToAddresses: recipients },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
  logger.info('Plan email sent', { householdId, week, recipients: recipients.length });
  return recipients.length;
}

/** Cognito cannot filter on custom attributes, so the (tiny) pool is listed and filtered here. */
async function householdEmails(householdId: string): Promise<string[]> {
  const emails: string[] = [];
  for await (const page of paginateListUsers({ client: cognito }, { UserPoolId: USER_POOL_ID })) {
    for (const user of page.Users ?? []) {
      const attrs = Object.fromEntries((user.Attributes ?? []).map((a) => [a.Name, a.Value]));
      if (user.Enabled && attrs[HOUSEHOLD_ATTRIBUTE] === householdId && attrs.email && attrs.email_verified === 'true') {
        emails.push(attrs.email);
      }
    }
  }
  return emails;
}
