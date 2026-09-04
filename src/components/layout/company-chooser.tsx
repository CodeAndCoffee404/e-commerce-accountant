"use client";

import { BankOutlined } from "@ant-design/icons";
import { Card, List, Typography, message } from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { Company } from "@/lib/auth/allowlist";
import { switchCompany } from "@/lib/auth/companies";
import { DEFAULT_ROUTE } from "@/lib/navigation";

/**
 * The list someone picks from when they keep the books for more than one
 * company.
 *
 * Deliberately plain: it is a fork in the road, not a screen. What matters is
 * that the names are unmistakable, since everything the person does next
 * belongs to whichever one they touch here.
 */
export function CompanyChooser({
  companies,
  sole,
}: {
  companies: Company[];
  /**
   * Exactly one to choose from. The list still renders, but the choice is made
   * without asking — a question with one answer is not a question, and this
   * page was arrived at by redirect, so answering it here is what stops the
   * browser being sent back and forth.
   */
  sole?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const opened = useRef(false);

  function choose(id: string) {
    setChosen(id);
    start(async () => {
      const result = await switchCompany(id);

      if (!result.ok) {
        setChosen(null);
        message.error(result.message);

        return;
      }

      router.replace(DEFAULT_ROUTE);
    });
  }

  useEffect(() => {
    if (!sole || opened.current) return;

    opened.current = true;
    choose(companies[0].id);
    // `choose` is stable for this render and re-running on it would fire twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sole, companies]);

  return (
    <Card style={{ width: "min(420px, 100%)" }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Which company?
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Everything you upload and build belongs to the one you choose. You can
        change it from the menu at any time.
      </Typography.Paragraph>

      <List
        dataSource={companies}
        renderItem={(company) => (
          <List.Item
            role="button"
            aria-disabled={pending}
            tabIndex={0}
            onClick={() => !pending && choose(company.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") choose(company.id);
            }}
            style={{ cursor: pending ? "progress" : "pointer" }}
          >
            <List.Item.Meta
              avatar={<BankOutlined />}
              title={company.name}
              description={chosen === company.id ? "Opening…" : company.slug}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
