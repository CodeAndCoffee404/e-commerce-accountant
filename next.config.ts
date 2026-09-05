import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // How long a client-side navigation may reuse what it already fetched.
  //
  // Zero — the default — means going back to a screen visited a moment ago
  // waits on the server all over again, which is most of what "the tabs
  // reload every time" was. Thirty seconds was not enough either: reading the
  // checklist, opening Reports and coming back is more than half a minute.
  //
  // Five minutes covers a working session. It does not make anything stale
  // that this person changed: every action that writes calls `revalidatePath`,
  // which clears these entries for the paths it names, so an upload, a build
  // or a settings change still shows up at once. What it does defer is a
  // change made by somebody else, or by the nightly job, for up to five
  // minutes on a screen already open.
  experimental: {
    staleTimes: { dynamic: 300 },
  },
  // Pin the workspace root: without it Turbopack walks up and picks a stray
  // lockfile from the parent directory.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  // The screen was called Uploads until the name caught up with the table it
  // reads — `source_files` — and an address people have bookmarked should not
  // stop working over a rename. Permanent, because the old name is not coming
  // back.
  async redirects() {
    return [{ source: "/uploads", destination: "/source-files", permanent: true }];
  },
};

export default nextConfig;
