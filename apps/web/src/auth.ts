import { Amplify } from 'aws-amplify';
import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  signIn,
  signOut,
  updateUserAttributes,
  type SignInOutput,
} from 'aws-amplify/auth';
import type { AppConfig } from './config';

export interface User {
  name: string;
  email: string;
}

export type SignInStep = 'done' | 'newPassword' | 'totp';

/** Dev-only preview mode (see dev/preview.ts): a fake signed-in user, no Cognito calls. */
let preview = false;
export const enablePreviewAuth = () => {
  preview = true;
};

export function configureAuth(config: AppConfig) {
  Amplify.configure({ Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId } } });
}

export async function currentUser(): Promise<User | null> {
  if (preview) return { name: 'Tomas', email: 'preview@example.com' };
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.idToken) return null;
    const attributes = await fetchUserAttributes();
    return { name: attributes.given_name || attributes.email?.split('@')[0] || 'you', email: attributes.email ?? '' };
  } catch {
    return null;
  }
}

const stepOf = (output: SignInOutput): SignInStep => {
  if (output.isSignedIn) return 'done';
  switch (output.nextStep.signInStep) {
    case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':
      return 'newPassword';
    case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
      return 'totp';
    default:
      throw new Error(`Unsupported sign-in step: ${output.nextStep.signInStep}`);
  }
};

export async function startSignIn(email: string, password: string): Promise<SignInStep> {
  return stepOf(await signIn({ username: email.trim().toLowerCase(), password }));
}

/** First sign-in: replaces the emailed temporary password and stores the name the chat uses. */
export async function completeNewPassword(newPassword: string, name: string): Promise<SignInStep> {
  const step = stepOf(await confirmSignIn({ challengeResponse: newPassword }));
  if (step === 'done' && name.trim()) await updateUserAttributes({ userAttributes: { given_name: name.trim() } });
  return step;
}

export async function completeTotp(code: string): Promise<SignInStep> {
  return stepOf(await confirmSignIn({ challengeResponse: code.trim() }));
}

export const logOut = () => signOut();

/** The API Gateway Cognito authorizer validates the ID token, which carries custom:householdId. */
export async function idToken(): Promise<string> {
  if (preview) return 'preview';
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Not signed in');
  return token;
}
