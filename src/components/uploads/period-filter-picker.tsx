"use client";

import { CloseCircleFilled, DownOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Popover, theme } from "antd";
import { useMemo, useState } from "react";

import { MONTHS } from "@/lib/ingest/months";
import { periodLabelWords } from "@/lib/ingest/period";
import type { PeriodOption } from "@/lib/uploads/queries";

function parseMonth(label: string): { year: number; month: number } | null {
  const match = /^(\d{4})\.(\d{2}) /.exec(label);

  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

function parseQuarter(label: string): { year: number; quarter: number } | null {
  const match = /^(\d{4})\.Q(\d)$/.exec(label);

  return match ? { year: Number(match[1]), quarter: Number(match[2]) } : null;
}

function parseYear(label: string): number | null {
  const match = /^(\d{4})\.Y$/.exec(label);

  return match ? Number(match[1]) : null;
}

/**
 * A period filter, in one popover: a year switcher on top, every month below
 * it, every quarter below that, and — where the list holds any — the whole
 * year at the bottom. Picking one clears the other.
 * Unlike the dashboard's own month picker, this one is a filter: any
 * calendar period can be picked, not only ones a file exists for (an empty
 * pick just shows an empty table), and clearing it means "every period" —
 * there is no separate "All periods" option to pick instead.
 *
 * Months and quarters nothing was ever uploaded for are muted, not disabled
 * — a hint, not a restriction.
 */
export function PeriodFilterPicker({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string | null;
  options: readonly PeriodOption[];
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);

  const monthsWithData = useMemo(
    () => new Set(options.filter((o) => o.granularity === "month").map((o) => o.label)),
    [options],
  );
  const quartersWithData = useMemo(
    () => new Set(options.filter((o) => o.granularity === "quarter").map((o) => o.label)),
    [options],
  );
  // Whole-year periods exist only where a report is built for one, so the
  // year row appears only for a list that actually holds some — the Source
  // files filter, whose options never include a year, is left exactly as it was.
  const yearsWithData = useMemo(
    () => new Set(options.filter((o) => o.granularity === "year").map((o) => o.label)),
    [options],
  );
  const offersYears = yearsWithData.size > 0;

  const currentYear = new Date().getUTCFullYear();
  const dataYears = options.map((o) => Number(o.label.slice(0, 4))).filter((y) => !Number.isNaN(y));
  // Reasonable bounds, not an unbounded switcher: from the earliest year
  // anything is on record for, to one calendar year ahead of now — room to
  // plan the next period without a free-typed year nobody needs.
  const minYear = dataYears.length > 0 ? Math.min(...dataYears, currentYear) : currentYear;
  const maxYear = Math.max(currentYear, ...dataYears) + 1;

  const shownMonth = value ? parseMonth(value) : null;
  const shownQuarter = value ? parseQuarter(value) : null;
  const shownYear = value ? parseYear(value) : null;
  const [viewYear, setViewYear] = useState(
    shownMonth?.year ?? shownQuarter?.year ?? shownYear ?? currentYear,
  );

  const pick = (label: string) => {
    onChange(label);
    setOpen(false);
  };

  const content = (
    <div style={{ width: 240 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          disabled={viewYear <= minYear}
          aria-label="Earlier year"
          onClick={() => setViewYear((y) => y - 1)}
        />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{viewYear}</span>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          disabled={viewYear >= maxYear}
          aria-label="Later year"
          onClick={() => setViewYear((y) => y + 1)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {MONTHS.map((month) => {
          const label = `${viewYear}.${month.numberText} ${month.fullName}`;
          const selected = shownMonth?.year === viewYear && shownMonth.month === month.number;
          const hasData = monthsWithData.has(label);

          return (
            <Button
              key={month.number}
              size="small"
              type={selected ? "primary" : "text"}
              style={!selected && !hasData ? { color: token.colorTextQuaternary } : undefined}
              onClick={() => pick(label)}
            >
              {month.fullName.slice(0, 3)}
            </Button>
          );
        })}
      </div>

      <div style={{ margin: "10px 0 8px", borderTop: `1px solid ${token.colorSplit}` }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {[1, 2, 3, 4].map((quarter) => {
          const label = `${viewYear}.Q${quarter}`;
          const selected = shownQuarter?.year === viewYear && shownQuarter.quarter === quarter;
          const hasData = quartersWithData.has(label);

          return (
            <Button
              key={quarter}
              size="small"
              type={selected ? "primary" : "text"}
              style={!selected && !hasData ? { color: token.colorTextQuaternary } : undefined}
              onClick={() => pick(label)}
            >
              Q{quarter}
            </Button>
          );
        })}
      </div>

      {offersYears ? (
        <>
          <div style={{ margin: "10px 0 8px", borderTop: `1px solid ${token.colorSplit}` }} />
          <Button
            size="small"
            block
            type={shownYear === viewYear ? "primary" : "text"}
            style={
              shownYear !== viewYear && !yearsWithData.has(`${viewYear}.Y`)
                ? { color: token.colorTextQuaternary }
                : undefined
            }
            onClick={() => pick(`${viewYear}.Y`)}
          >
            Whole year {viewYear}
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setViewYear(shownMonth?.year ?? shownQuarter?.year ?? shownYear ?? currentYear);
      }}
      content={content}
    >
      <Button disabled={disabled} style={{ minWidth: 160, justifyContent: "space-between", display: "inline-flex" }}>
        <span style={{ color: value ? undefined : token.colorTextPlaceholder }}>
          {value ? periodLabelWords(value) : "Any period"}
        </span>
        {value ? (
          <CloseCircleFilled
            style={{ color: token.colorTextQuaternary, marginInlineStart: 8 }}
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
          />
        ) : (
          <DownOutlined style={{ color: token.colorTextQuaternary, fontSize: 11, marginInlineStart: 8 }} />
        )}
      </Button>
    </Popover>
  );
}
