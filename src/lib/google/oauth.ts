import { serverEnv } from "@/lib/env";

/**
 * `drive.file` only. It is a non-sensitive scope, so Google does not put the
 * app through review, and it grants access to nothing except files this app
 * created or the user picked. A client handing over their whole Drive to an
 * accounting tool would be the wrong trade even if Google allowed it quietly.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function connectUrl(redirectUri: string, state: string): string {
  const env = serverEnv();
  const url = new URL(AUTH_ENDPOINT);

  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  // Offline plus an explicit prompt: without both, Google returns a refresh
  // token only on the very first consent, and a reconnect would silently
  // produce a connection that stops working when the access token expires.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  expiresInSeconds: number;
};

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const env = serverEnv();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? "Google did not return a token.");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    scope: body.scope ?? DRIVE_SCOPE,
    expiresInSeconds: body.expires_in ?? 3600,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const env = serverEnv();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  const body = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    // `invalid_grant` means the user revoked access or the token expired from
    // disuse. The caller marks the connection revoked rather than retrying.
    throw new Error(body.error_description ?? body.error ?? "Could not refresh the Google token.");
  }

  return body.access_token;
}

/** Which Google account consented, for showing in the interface. */
export async function accountEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return "unknown";

  const body = (await response.json()) as { email?: string };

  return body.email ?? "unknown";
}
