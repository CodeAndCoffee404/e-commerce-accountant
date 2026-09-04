import { acrossTenants } from "@/lib/db/tenant";

/**
 * Runs one test as one request.
 *
 * `requireUser` names the company for the rest of the request and does not
 * take it back — a page has nowhere to hand it back to. In a server that is
 * right: each request arrives in its own context, and the next one starts
 * clean. A test file is one context for all of its tests, so without this the
 * first company named would still be in force for the second, and a test that
 * signs in as a different company gets refused — which is the scope doing its
 * job, in a place that only looks like a bug.
 *
 * So each test gets a scope of its own to enter. `acrossTenants` rather than
 * a company: at the top of a request nobody has signed in yet, which is
 * exactly the state this is imitating.
 */
export function inRequest(body: () => Promise<void>): () => Promise<void> {
  return () => acrossTenants(body);
}
