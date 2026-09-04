"use client";

import { Button, Card, Typography } from "antd";

import { signOutAction } from "@/lib/auth/actions";

/**
 * The end of the road: signed in, and invited to nothing.
 *
 * A dead end on purpose. Sending this person to the sign-in screen would send
 * them straight back here — they have a valid session — so the only way out is
 * to end the session, and the button says so. The wording avoids blaming them:
 * an access that was withdrawn is a decision somebody made, not a mistake they
 * made.
 */
export function NoCompany() {
  return (
    <Card style={{ width: "min(420px, 100%)" }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        No company to open
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Your address is signed in, but it is not on the access list of any
        company right now. If that is unexpected, ask whoever manages access to
        invite you again.
      </Typography.Paragraph>

      <form action={signOutAction}>
        <Button htmlType="submit" block>
          Sign out
        </Button>
      </form>
    </Card>
  );
}
