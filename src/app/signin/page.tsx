import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignInCard } from "@/components/auth/sign-in-card";
import { DEFAULT_ROUTE } from "@/lib/navigation";

export const metadata = { title: "Sign in — E-commerce Accountant" };

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();

  if (session?.user?.id) redirect(DEFAULT_ROUTE);

  const { next, error } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(16px, 5vw, 48px)",
        // A quiet wash rather than a flat panel, so the card has somewhere to
        // sit. Both stops are theme tokens, so it follows dark mode.
        background:
          "radial-gradient(120% 120% at 50% 0%, var(--ant-color-primary-bg, transparent) 0%, transparent 60%)",
      }}
    >
      <SignInCard
        next={typeof next === "string" ? next : undefined}
        error={typeof error === "string" ? error : undefined}
      />
    </div>
  );
}
