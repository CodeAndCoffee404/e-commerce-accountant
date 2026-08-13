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
        padding: 24,
      }}
    >
      <SignInCard
        next={typeof next === "string" ? next : undefined}
        error={typeof error === "string" ? error : undefined}
      />
    </div>
  );
}
