"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Divider, Modal, Space, Steps, Tooltip, Typography } from "antd";
import { useState } from "react";

const { Paragraph, Text, Title } = Typography;

/**
 * The whole workflow in one place.
 *
 * Written for the person who opens this on their first morning with it and for
 * the one who comes back after a month away. Both need the same thing: the
 * order of operations, and what the system does that they cannot see.
 */
export function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="How this works">
        <Button
          type="text"
          aria-label="How this works"
          icon={<QuestionCircleOutlined />}
          onClick={() => setOpen(true)}
        />
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="How this works"
        width="min(760px, 100%)"
        footer={
          <Button type="primary" onClick={() => setOpen(false)}>
            Got it
          </Button>
        }
      >
        <Paragraph type="secondary">
          The <Text strong>Dashboard</Text> greets you with the month at a glance: which files
          are still missing, which reports can be built — one button builds everything ready —
          and what needs your attention. The steps below are the same work in detail, on the
          pages the sidebar lists.
        </Paragraph>

        <Steps
          direction="vertical"
          size="small"
          current={-1}
          items={[
            {
              title: "1 · Upload the exports",
              description: (
                <>
                  <Paragraph>
                    On <Text strong>Uploads</Text>, press <Text strong>Upload files</Text>. Add
                    as many as you have — they queue up in a list and go one after another, and
                    each one reports what it turned out to be. CSV or XLSX, up to 20 MB each.
                  </Paragraph>
                  <Paragraph type="secondary">
                    Nothing is read from the filename. The type, the country and the period come
                    from inside the file, so renaming one changes nothing — except for Amazon
                    Monthly, where the period is in the name because Amazon puts it there.
                  </Paragraph>
                  <Paragraph type="secondary">
                    A file must cover one whole month or one whole quarter. The old binary{" "}
                    <Text code>.xls</Text> is refused — open it in Excel and save as{" "}
                    <Text code>.xlsx</Text>.
                  </Paragraph>
                </>
              ),
            },
            {
              title: "2 · Check what landed",
              description: (
                <>
                  <Paragraph>
                    Expand any row on <Text strong>Uploads</Text>. It shows how many rows the file
                    offered, how many became transactions, and how many are in the ledger now.
                  </Paragraph>
                  <Paragraph type="secondary">
                    A difference between the first two is usually correct: a bank statement carries
                    the channel&rsquo;s own fees, and those are not sales. What matters is that
                    nothing disappeared without a reason.
                  </Paragraph>
                  <Paragraph type="secondary">
                    <Text strong>Preview</Text> opens the first rows of the stored file, so you can
                    compare against the original.
                  </Paragraph>
                  <Paragraph type="secondary">
                    <Text strong>Delete</Text> removes an upload completely — the file, its rows
                    and its stored copy. If it had replaced an earlier upload for the same period,
                    that earlier one starts counting again. A file some report was built from is
                    kept until that report is deleted, so no run is ever left unable to show what
                    it used.
                  </Paragraph>
                </>
              ),
            },
            {
              title: "3 · Fix anything flagged",
              description: (
                <>
                  <Paragraph>
                    A number or date that could not be read flags its row. The count appears next to{" "}
                    <Text strong>Uploads</Text> in the sidebar, and against the file itself in the
                    list — expand it to see how many.
                  </Paragraph>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 8 }}
                    message="Values are never edited here"
                    description="Correct the source file and upload it again. A figure that no longer matches the document it came from is worse than a gap."
                  />
                  <Paragraph type="secondary">
                    Uploading a corrected file for a period you already have replaces it. The old
                    rows stay but stop counting, so a report built earlier still traces back to the
                    figures it used.
                  </Paragraph>
                </>
              ),
            },
            {
              title: "4 · Build the reports",
              description: (
                <>
                  <Paragraph>
                    On <Text strong>Reports</Text>, pick a period and build. Only periods with
                    everything the report needs are offered — and when one is not, the card names
                    what it is still waiting for, so nobody has to guess which file is missing.
                  </Paragraph>
                  <Paragraph type="secondary">
                    <Text strong>Off-Amazon Sales</Text> needs Allegro, Cdiscount and Shopify
                    together — a sheet missing one would look complete and understate the rest.{" "}
                    <Text strong>Amazon invoice for Zoho</Text> needs all ten marketplaces, for the
                    same reason. <Text strong>Sales report by currency</Text> needs only the Amazon
                    VAT file.
                  </Paragraph>
                  <Paragraph type="secondary">
                    What each report insists on is configurable on{" "}
                    <Text strong>Settings &rarr; Reports</Text>: a retired channel or marketplace
                    can be made optional — it stops blocking builds but is still counted whenever
                    its file arrives — and a report you never use can be switched off entirely.
                  </Paragraph>
                  <Paragraph type="secondary">
                    Each run records the uploads, the VAT rates and the exchange rates it used, so
                    rebuilding the same period later gives the same numbers. Expanding a row shows
                    the sources and anything that was skipped.
                  </Paragraph>
                </>
              ),
            },
            {
              title: "5 · Take the result",
              description: (
                <>
                  <Paragraph>
                    Download the workbook from the register, or open it in Google Drive if the Drive
                    connection is set up.
                  </Paragraph>
                  <Paragraph type="secondary">
                    Files land in your Drive as Google Sheets, in a folder named after the report
                    and the period. If Drive is unreachable the report is unaffected — the file is
                    here and <Text strong>Retry</Text> sends it again.
                  </Paragraph>
                </>
              ),
            },
          ]}
        />

        <Divider />

        <Title level={5}>Worth knowing</Title>

        <Space direction="vertical" size="small">
          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Connecting Drive.</Text> On <Text strong>Settings &rarr; Google
            Drive</Text>, connect the account and then choose the folder. The app asks only for the files it creates
            itself and the folder you point it at — the rest of your Drive stays invisible to it.
          </Paragraph>

          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Rates and rules.</Text> VAT rates, SKU mapping, channel rules and the
            report configuration each have a tab on <Text strong>Settings</Text>. To
            change a rate, add a row with the date it takes effect rather than editing the old
            one — otherwise recalculating a closed month would give different figures.
          </Paragraph>

          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Exchange rates.</Text> European Central Bank reference rates. The bank does
            not publish at weekends, so a rate &ldquo;as at&rdquo; the last day of a month uses the
            most recent publication before it, and the report records which one.
          </Paragraph>

          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Who can do what.</Text> An owner manages access and all settings; an
            accountant uploads, builds, deletes and exports; a viewer only looks. Every change is
            recorded under <Text strong>Activity</Text> on Settings.
          </Paragraph>

          <Paragraph style={{ marginBottom: 0 }}>
            <Text strong>Buyer data.</Text> The exports contain names, addresses and phone numbers.
            Files are stored privately with no shareable link, a rejected upload is deleted
            immediately, and the reports themselves carry none of it.
          </Paragraph>
        </Space>
      </Modal>
    </>
  );
}
