import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A compound antd component cannot be rendered from a Server Component.
 *
 * antd marks its modules `"use client"`, so what a Server Component imports is
 * an opaque client reference. `Layout` renders; `Layout.Content` is a property
 * hung off it, and across that boundary it is `undefined`. React then refuses
 * with "Element type is invalid … but got: undefined" — a 500 on the whole
 * route, at render, after every guard has already passed.
 *
 * It cost a production release to learn: `/admin` shipped with `Layout.Content`
 * in its layout and answered 500 to the one person allowed to open it. Nothing
 * caught it, because `tsc` sees a valid property, `next build` compiles it, and
 * no test rendered the page.
 *
 * So it is checked here instead. The rule is narrow on purpose: a bare antd
 * component in a Server Component is fine, and this is not an argument against
 * using them there.
 */

const ROOTS = ["src/app", "src/components"];

function filesUnder(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) found.push(...filesUnder(full));
    else if (entry.name.endsWith(".tsx")) found.push(full);
  }

  return found;
}

/** Comments and strings would otherwise vote — this file is full of `Layout.Content` in prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The names a file imports from antd, or none when it does not import from it. */
function antdImports(source: string): string[] {
  const match = /import\s*\{([^}]*)\}\s*from\s*"antd"/.exec(source);

  if (!match) return [];

  return match[1]
    .split(",")
    .map((name) => name.trim().split(/\s+as\s+/).pop() ?? "")
    .filter((name) => /^[A-Z]/.test(name));
}

describe("Server Components and antd", () => {
  it("never render a compound antd component", () => {
    const offences: string[] = [];

    for (const root of ROOTS) {
      for (const file of filesUnder(root)) {
        const source = readFileSync(file, "utf8");

        if (/^\s*"use client"/m.test(source.slice(0, 200))) continue;

        const body = code(source);

        for (const name of antdImports(source)) {
          const rendered = new RegExp(`<${name}\\.[A-Z]`).exec(body);

          if (rendered) {
            offences.push(`${file}: renders ${rendered[0].slice(1)}… from a Server Component`);
          }
        }
      }
    }

    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("would notice if one came back", () => {
    // The check is a regular expression over source, so it is worth proving it
    // matches the shape it is written for rather than trusting that it does.
    const pretend = `import { Layout } from "antd";\nexport default function X() { return <Layout.Content />; }`;

    expect(antdImports(pretend)).toEqual(["Layout"]);
    expect(new RegExp("<Layout\\.[A-Z]").test(code(pretend))).toBe(true);
  });
});
