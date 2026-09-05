import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { maySignIn, resolveAccess, roleFor } from "@/lib/auth/allowlist";
import { rootDb, schema } from "@/lib/db";
import { acrossTenants } from "@/lib/db/tenant";
import { serverEnv } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    /** The company this session is currently working in. */
    tenantId: string;

  }
}

// `next-auth/jwt` only re-exports these types, so the augmentation has to
// target the module that declares them.
declare module "@auth/core/jwt" {
  interface JWT {
    tenantId?: string;
  }
}

/**
 * Lazy config: `serverEnv()` throws when a variable is missing, and evaluating
 * it at import time would fail `next build`, which imports modules without a
 * runtime environment.
 */
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(() => {
  const env = serverEnv();

  return {
    // `rootDb()` rather than `getDb()`: the adapter is given a database and
    // keeps it, so handing it whatever scope happened to be open would hand it
    // a transaction that ends. Harmless while sessions live in the token and
    // the adapter only writes during the OAuth callback; wrong the day
    // database sessions are turned on, which is not a day to discover it.
    adapter: DrizzleAdapter(rootDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    }),

    // JWT rather than database sessions: every request would otherwise hit
    // Postgres just to read the session. What the token carries is the company
    // this session has *chosen*, not what the person is entitled to — that is
    // read from the access list on each request, so a withdrawal does not wait
    // for the token to expire.
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
      //
      // The address has to be one Google says it verified. Every invitation in
      // this application is an email address and nothing else, so an
      // unverified one is an invitation handed to whoever claimed the address
      // rather than to whoever holds it. Google verifies its own accounts, so
      // in practice this refuses nothing that would otherwise get in — which
      // is the argument for checking rather than for trusting.
      signIn: ({ user, profile }) => {
        if (profile && profile.email_verified !== true) return false;

        return acrossTenants(() => maySignIn(user.email));
      },

      async jwt({ token, trigger, session, user }) {
        // `user` is set on the sign-in pass only; on later requests the token
        // already carries the company and there is nothing to look up.
        const { id, email } = user ?? {};

        if (id && email) {
          const access = await acrossTenants(() => resolveAccess(id, email));

          if (!access) return null;

          token.tenantId = access.tenantId;
        }

        // Switching company.
        //
        // Checked here rather than trusted from the caller: Auth.js exposes
        // this update as an endpoint of its own, so the value can arrive from
        // the browser without passing through `switchCompany` at all. Every
        // screen would still refuse the company afterwards — each one asks
        // what this person may do in it — but that would leave the guarantee
        // resting on the ordering of checks inside forty function bodies
        // rather than on the token itself.
        if (trigger === "update" && typeof session?.tenantId === "string" && token.email) {
          const email = token.email;
          const wanted = session.tenantId;
          const role = await roleFor(email, wanted);

          if (role) token.tenantId = wanted;
        }

        return token;
      },

      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        if (token.tenantId) session.tenantId = token.tenantId;
        return session;
      },
    },
  };
});
