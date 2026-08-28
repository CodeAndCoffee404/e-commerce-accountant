"use client";

import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Popover, Space, Spin, theme } from "antd";
import { useMemo, useState } from "react";

import { MONTHS } from "@/lib/ingest/months";

/** `"2026.08 August"` -> `{ year: 2026, month: 8 }`. */
function parseLabel(label: string): { year: number; month: number } | null {
  const match = /^(\d{4})\.(\d{2}) /.exec(label);

  if (!match) return null;

  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * One button, not two selects: the month grid is scoped to a year at a
 * time, so picking a month is still two clicks (open, pick) without a
 * dropdown for the year sitting next to a dropdown for the month. The
 * arrows either side step one open month at a time through `months` itself,
 * so a step never lands on one that isn't actually open.
 */
export function MonthPicker({
  months,
  value,
  loading,
  disabled,
  onChange,
}: {
  /** Open months, as period labels, newest first — the order `months` already arrives in. */
  months: string[];
  value: string | null;
  loading: boolean;
  disabled: boolean;
  onChange: (month: string) => void;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);

  const byYear = useMemo(() => {
    const map = new Map<number, Map<number, string>>();

    for (const label of months) {
      const parsed = parseLabel(label);

      if (!parsed) continue;

      const forYear = map.get(parsed.year) ?? new Map<number, string>();

      forYear.set(parsed.month, label);
      map.set(parsed.year, forYear);
    }

    return map;
  }, [months]);

  const years = useMemo(() => [...byYear.keys()].sort((a, b) => a - b), [byYear]);
  const shown = value ? parseLabel(value) : null;
  const [popoverYear, setPopoverYear] = useState(shown?.year ?? years[years.length - 1] ?? 0);

  const currentIndex = value ? months.indexOf(value) : -1;
  // `months` is newest first, so the next open month is the previous index.
  const atNewest = currentIndex <= 0;
  const atOldest = currentIndex === -1 || currentIndex === months.length - 1;

  const step = (delta: number) => {
    if (currentIndex === -1) return;

    const next = months[currentIndex + delta];

    if (next) onChange(next);
  };

  const monthLabel = shown ? (MONTHS[shown.month - 1]?.fullName ?? String(shown.month)) : "—";

  // Chevrons rather than buttons: stepping a month is a small, reversible
  // move that does not need a bordered box of its own on either side of the
  // month it steps. The one spinner for "the switch is in flight" stays on
  // the month button between them.
  const arrow = { fontSize: 12, color: token.colorTextTertiary };

  return (
    <Space size={2} align="center">
      <Button
        type="text"
        icon={<LeftOutlined style={arrow} />}
        disabled={disabled || atOldest}
        aria-label="Previous open month"
        onClick={() => step(1)}
      />
      <Popover
        trigger="click"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setPopoverYear(shown?.year ?? years[years.length - 1] ?? 0);
        }}
        content={
          <MonthGrid
            year={popoverYear}
            years={years}
            openMonths={byYear.get(popoverYear)}
            selected={shown}
            onYearChange={setPopoverYear}
            onPick={(label) => {
              onChange(label);
              setOpen(false);
            }}
          />
        }
      >
        <Button disabled={disabled} style={{ minWidth: 150 }}>
          {loading ? <Spin size="small" style={{ marginInlineEnd: 8 }} /> : null}
          {shown ? `${monthLabel} ${shown.year}` : "No open period"}
        </Button>
      </Popover>
      <Button
        type="text"
        icon={<RightOutlined style={arrow} />}
        disabled={disabled || atNewest}
        aria-label="Next open month"
        onClick={() => step(-1)}
      />
    </Space>
  );
}

function MonthGrid({
  year,
  years,
  openMonths,
  selected,
  onYearChange,
  onPick,
}: {
  year: number;
  years: number[];
  openMonths: Map<number, string> | undefined;
  selected: { year: number; month: number } | null;
  onYearChange: (year: number) => void;
  onPick: (label: string) => void;
}) {
  const yearIndex = years.indexOf(year);

  return (
    <div style={{ width: 220 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          disabled={yearIndex <= 0}
          aria-label="Earlier year"
          onClick={() => onYearChange(years[yearIndex - 1])}
        />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{year}</span>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          disabled={yearIndex === -1 || yearIndex >= years.length - 1}
          aria-label="Later year"
          onClick={() => onYearChange(years[yearIndex + 1])}
        />
      </Space>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        {MONTHS.map((month) => {
          const label = openMonths?.get(month.number);
          const isSelected = selected?.year === year && selected.month === month.number;

          return (
            <Button
              key={month.number}
              size="small"
              type={isSelected ? "primary" : "text"}
              disabled={!label}
              onClick={() => label && onPick(label)}
            >
              {month.fullName.slice(0, 3)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
