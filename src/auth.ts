import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { maySignIn, resolveAccess } from "@/lib/auth/allowlist";
import { getDb, schema } from "@/lib/db";
import type { MembershipRole } from "@/lib/db/schema";
import { acrossTenants } from "@/lib/db/tenant";
import { serverEnv } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    tenantId: string;
    role: MembershipRole;
  }
}

// `next-auth/jwt` only re-exports these types, so the augmentation has to
// target the module that declares them.
declare module "@auth/core/jwt" {
  interface JWT {
    tenantId?: string;
    role?: MembershipRole;
  }
}

/**
 * Lazy config: `serverEnv()` throws when a variable is missing, and evaluating
 * it at import time would fail `next build`, which imports modules without a
 * runtime environment.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = serverEnv();

  return {
    adapter: DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    }),

    // JWT rather than database sessions: every request would otherwise hit
    // Postgres just to read the session, and the tenant a user belongs to
    // changes rarely enough to live in the token.
    session: { strategy: "jwt" },

    pages: { signIn: "/signin", error: "/signin" },

    providers: [
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    ],

    callbacks: {
      // Runs before Auth.js creates the user row, so this only reads.
      //
      // Signing in is the one thing that happens before anyone knows which
      // company the person belongs to — the invitation is looked up by email
      // across all of them — so it says so rather than leaving it to be
      // inferred from the absence of a scope.
      signIn: ({ user }) => acrossTenants(() => maySignIn(user.email)),

      async jwt({ token, user }) {
        // `user` is set on the sign-in pass only; on later requests the token
        // already carries the tenant and there is nothing to look up.
        const { id, email } = user ?? {};

        if (id && email) {
          const access = await acrossTenants(() => resolveAccess(id, email));

          if (!access) return null;

          token.tenantId = access.tenantId;
          token.role = access.role;
        }

        return token;
      },

      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        if (token.tenantId) session.tenantId = token.tenantId;
        if (token.role) session.role = token.role;

        return session;
      },
    },
  };
});
