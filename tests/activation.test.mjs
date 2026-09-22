// Regression tests for the one-click activation flow in public/deepseek.mjs.
//
// The activation link carries the DeepSeek API key in the URL fragment, so
// parsing and cleanup must be exact: a bug here either loses the key or
// leaves it sitting in the address bar.
//
// Run with: node --test tests/activation.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const CONFIG_KEY = "bandcraft:deepseek-config:v1";

function installBrowserStub(href) {
  const url = new URL(href);
  const store = new Map();
  const calls = [];

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.location = { href, hash: url.hash, search: url.search };
  globalThis.history = {
    replaceState: (_state, _title, next) => {
      calls.push(next);
      const replaced = new URL(next, "https://example.test");
      globalThis.location.href = replaced.toString();
      globalThis.location.hash = replaced.hash;
      globalThis.location.search = replaced.search;
    },
  };

  return { store, calls };
}

test("applyConfigFromUrl stores the key from the fragment and scrubs the URL", async () => {
  const { store, calls } = installBrowserStub(
    "https://example.test/#bc_key=sk-abc123456789&bc_model=deepseek-chat&bc_base=https%3A%2F%2Fapi.deepseek.com"
  );
  const ds = await import("../public/deepseek.mjs");

  const result = ds.applyConfigFromUrl();

  assert.equal(result.changed, true);
  assert.equal(result.apiKey, "sk-abc123456789");
  assert.equal(result.model, "deepseek-chat");
  assert.equal(result.baseUrl, "https://api.deepseek.com");

  const saved = JSON.parse(store.get(CONFIG_KEY));
  assert.equal(saved.apiKey, "sk-abc123456789");
  assert.equal(ds.isConfigured(), true);

  assert.deepEqual(calls, ["/"]);
  assert.equal(globalThis.location.href, "https://example.test/");
});

test("applyConfigFromUrl keeps other fragment parameters (routing) intact", async () => {
  const { calls } = installBrowserStub("https://example.test/#/settings&bc_key=sk-routing9999&bc_model=deepseek-chat");
  const ds = await import("../public/deepseek.mjs");

  ds.applyConfigFromUrl();

  assert.deepEqual(calls, ["/#/settings"]);
  assert.equal(ds.getStoredConfig().apiKey, "sk-routing9999");
});

test("applyConfigFromUrl accepts the query-string form too", async () => {
  const { calls } = installBrowserStub("https://example.test/?bc_key=sk-query0000abc");
  const ds = await import("../public/deepseek.mjs");

  ds.applyConfigFromUrl();

  assert.equal(ds.getStoredConfig().apiKey, "sk-query0000abc");
  assert.deepEqual(calls, ["/"]);
});

test("applyConfigFromUrl is a no-op without an activation parameter", async () => {
  const { calls } = installBrowserStub("https://example.test/#/bank");
  const ds = await import("../public/deepseek.mjs");

  assert.equal(ds.applyConfigFromUrl(), null);
  assert.deepEqual(calls, []);
  assert.equal(ds.isConfigured(), false);
});

test("buildActivationUrl round-trips through applyConfigFromUrl", async () => {
  const { store } = installBrowserStub("https://example.test/");
  const ds = await import("../public/deepseek.mjs");

  ds.saveStoredConfig({ apiKey: "sk-roundtrip12345678", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" });
  const link = ds.buildActivationUrl();
  assert.match(link, /^https:\/\/example\.test\/#bc_key=sk-roundtrip12345678&/);
  assert.ok(!link.includes("?"));

  store.clear();
  const { calls } = installBrowserStub(link);
  void calls;

  const result = ds.applyConfigFromUrl();
  assert.equal(result.apiKey, "sk-roundtrip12345678");
  assert.equal(result.model, "deepseek-chat");
  assert.equal(result.baseUrl, "https://api.deepseek.com");
});

test("buildActivationUrl returns an empty string when no key is configured", async () => {
  installBrowserStub("https://example.test/");
  const ds = await import("../public/deepseek.mjs");
  ds.clearStoredConfig();

  assert.equal(ds.buildActivationUrl(), "");
});

test("maskApiKey never reveals the middle of the key", async () => {
  installBrowserStub("https://example.test/");
  const ds = await import("../public/deepseek.mjs");

  assert.equal(ds.maskApiKey(""), "");
  assert.equal(ds.maskApiKey("short"), "****");
  assert.equal(ds.maskApiKey("sk-9e4e6d5b7d8d466db21630f0de81cfe9"), "sk-9e4…cfe9");
});
