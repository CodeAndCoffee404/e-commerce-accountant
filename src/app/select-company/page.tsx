import type { ReactNode } from "react";

import { CompanyChooser } from "@/components/layout/company-chooser";
import { NoCompany } from "@/components/layout/no-company";
import { myCompanies } from "@/lib/auth/companies";

export const metadata = { title: "Choose a company" };

/**
 * Where someone lands with more than one company to choose from, and where a
 * session naming a company that is no longer theirs is sent.
 *
 * The one screen in the application that names no company — it exists because
 * none has been chosen — so it reads only the invitations of the person signed
 * in.
 *
 * Both odd cases end here rather than in a redirect, deliberately: this page is
 * reached *from* a redirect, so sending one back is how a loop starts. With one
 * company the chooser moves the session into it and goes on; with none there is
 * nowhere to send anyone, and the screen says so instead of bouncing between
 * here and sign-in forever.
 */
export default async function SelectCompanyPage() {
  const companies = await myCompanies();

  return (
    <Centred>
      {companies.length === 0 ? (
        <NoCompany />
      ) : (
        <CompanyChooser companies={companies} sole={companies.length === 1} />
      )}
    </Centred>
  );
}

function Centred({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(16px, 5vw, 48px)",
        background:
          "radial-gradient(120% 120% at 50% 0%, var(--ant-color-primary-bg, transparent) 0%, transparent 60%)",
      }}
    >
      {children}
    </div>
  );
}
