import test from "node:test";
import assert from "node:assert/strict";
import { GoogleClient } from "../google.js";
import { jsonResponse } from "./helpers.js";

test("refreshes once after a 401 and paginates read results", async () => {
  const refreshFlags = [];
  let requests = 0;
  const provider = {
    async getAccessToken(forceRefresh) {
      refreshFlags.push(forceRefresh);
      return forceRefresh ? "TEST_ONLY_NOT_A_SECRET_REFRESHED_ACCESS" : "TEST_ONLY_NOT_A_SECRET_INITIAL_ACCESS";
    },
  };
  const google = new GoogleClient(provider, async (input) => {
    requests += 1;
    const url = new URL(input);
    if (requests === 1) return jsonResponse({ error: { message: "expired" } }, 401);
    if (!url.searchParams.has("pageToken")) {
      return jsonResponse({
        accountSummaries: [{ account: "accounts/1" }],
        nextPageToken: "next",
      });
    }
    return jsonResponse({ accountSummaries: [{ account: "accounts/2" }] });
  });
  const accounts = await google.listAnalyticsAccounts();
  assert.deepEqual(accounts.map((item) => item.account), ["accounts/1", "accounts/2"]);
  assert.deepEqual(refreshFlags, [false, true, false, false]);
  assert.equal(requests, 3);
});
