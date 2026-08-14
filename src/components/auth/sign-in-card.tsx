"use client";

import { GoogleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Typography } from "antd";

import { signInWithGoogle } from "@/lib/auth/actions";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "This Google account is not on the access list. Ask an owner to invite it, then try again.",
  OAuthAccountNotLinked:
    "This email is already signed in through a different provider.",
  Configuration: "Sign-in is misconfigured on the server. Check the Google credentials.",
  Verification: "That sign-in link has expired. Try again.",
};

export function SignInCard({ next, error }: { next?: string; error?: string }) {
  return (
    <Card style={{ width: "100%", maxWidth: 400 }}>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
        E-commerce Accountant
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        VAT and invoicing reports for multi-channel sellers.
      </Typography.Paragraph>

      <Typography.Paragraph type="secondary">
        Sign in with the Google account that was given access. There is no password to
        remember — access is granted by address, and an owner can revoke it at any time.
      </Typography.Paragraph>

      {error ? (
        <Alert
          type="error"
          showIcon
          message={ERROR_MESSAGES[error] ?? "Could not sign you in. Try again."}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <form action={signInWithGoogle}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button type="primary" htmlType="submit" icon={<GoogleOutlined />} block size="large">
          Continue with Google
        </Button>
      </form>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}>
        Signing in asks Google only for your name and email address. Access to your Drive is a
        separate step, asked for once and only when you choose to connect it.
      </Typography.Paragraph>
    </Card>
  );
}
