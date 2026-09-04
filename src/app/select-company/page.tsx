import { redirect } from "next/navigation";

import { CompanyChooser } from "@/components/layout/company-chooser";
import { myCompanies } from "@/lib/auth/companies";
import { DEFAULT_ROUTE } from "@/lib/navigation";

export const metadata = { title: "Choose a company" };

/**
 * Where someone lands with more than one company to choose from, and where a
 * session holding a company that is no longer theirs is sent.
 *
 * The only screen in the application that names no company — it exists because
 * none has been chosen yet — so it reads nothing a company owns.
 */
export default async function SelectCompanyPage() {
  const companies = await myCompanies();

  if (companies.length === 0) redirect("/signin");
  // Nothing to choose. Sending someone to a list of one would be a question
  // with one answer.
  if (companies.length === 1) redirect(DEFAULT_ROUTE);

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
      <CompanyChooser companies={companies} />
    </div>
  );
}
