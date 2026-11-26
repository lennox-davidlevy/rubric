// Tests for catalogs/universal/assets/js/rubric-live.js: timeout recovery,
// non-200 fallback, cache-busting, SSE built-revision catch-up, and LiveReload fallback.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = readFileSync(join(import.meta.dir, "../catalogs/universal/assets/js/rubric-live.js"), "utf8");

class FakeNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: FakeNode[] = [];
  attrs = new Map<string, string>();
  parentNode: FakeNode | null = null;

  constructor(type: number, name: string, value: string | null = null) {
    this.nodeType = type;
    this.nodeName = name;
    this.nodeValue = value;
  }

  get attributes() {
    return [...this.attrs.entries()].map(([name, value]) => ({ name, value }));
  }

  get outerHTML(): string {
    if (this.nodeType !== 1) return this.nodeValue ?? "";
    const a = [...this.attrs.entries()].map(([k, v]) => ` ${k}="${v}"`).join("");
    const inner = this.childNodes.map((c) => c.outerHTML).join("");
    return `<${this.nodeName.toLowerCase()}${a}>${inner}</${this.nodeName.toLowerCase()}>`;
  }

  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  hasAttribute(k: string) { return this.attrs.has(k); }
  removeAttribute(k: string) { this.attrs.delete(k); }

  append(n: FakeNode) {
    n.parentNode = this;
    this.childNodes.push(n);
  }

  insertBefore(n: FakeNode, ref: FakeNode | null) {
    n.parentNode = this;
    if (!ref) { this.childNodes.push(n); return n; }
    const i = this.childNodes.indexOf(ref);
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    return n;
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }

  replaceWith(n: FakeNode) {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    n.parentNode = this.parentNode;
    if (i >= 0) this.parentNode.childNodes[i] = n;
    this.parentNode = null;
  }

  clone(): FakeNode {
    const c = new FakeNode(this.nodeType, this.nodeName, this.nodeValue);
    for (const [k, v] of this.attrs) c.attrs.set(k, v);
    for (const ch of this.childNodes) c.append(ch.clone());
    return c;
  }
}

function makeDoc(paragraphs: string[]) {
  const body = new FakeNode(1, "BODY");
  for (const text of paragraphs) {
    const p = new FakeNode(1, "P");
    p.append(new FakeNode(3, "#text", text));
    body.append(p);
  }
  return {
    title: "Post",
    body,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

interface HarnessOptions {
  relay?: string;
  fetchImpl: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  fetchMs?: number;
}

function mount(opts: HarnessOptions) {
  let reloads = 0;
  let drawn = 0;
  const ipcMessages: string[] = [];
  const urls: string[] = [];
  const doc = makeDoc(["initial"]);
  let sse: { onmessage?: (e: { data: string }) => void } | undefined;

  class FakeEventSource {
    onmessage?: (e: { data: string }) => void;
    constructor(_url: string) { sse = this; }
  }

  class FakeDOMParser {
    parseFromString(html: string) {
      return makeDoc(JSON.parse(html) as string[]);
    }
  }

  const documentObj = {
    title: "Post",
    body: doc.body,
    head: { append() {} },
    querySelector: (sel: string) => {
      if (sel === 'meta[name="rubric-source"]') return { content: "posts/long.md" };
      if (sel === 'meta[name="rubric-relay"]') return opts.relay ? { content: opts.relay } : null;
      return null;
    },
    querySelectorAll: () => [],
    importNode: (n: FakeNode) => n.clone(),
    dispatchEvent: () => { drawn++; return true; },
  };

  const windowObj: Record<string, unknown> = {
    EventSource: FakeEventSource,
    __rubricFetchMs: opts.fetchMs ?? 40,
    ipc: { postMessage: (m: string) => ipcMessages.push(m) },
  };

  const locationObj = {
    href: "http://127.0.0.1:1415/posts/long/",
    pathname: "/posts/long/",
    reload: () => { reloads++; },
    assign: () => {},
  };

  const fetchSpy = (url: string, init?: RequestInit) => {
    urls.push(url);
    return opts.fetchImpl(url, init);
  };

  const fn = new Function(
    "window", "document", "location", "fetch", "DOMParser", "EventSource", "Node", "CustomEvent", "console", "matchMedia", "scrollTo",
    SCRIPT,
  );
  fn(
    windowObj,
    documentObj,
    locationObj,
    fetchSpy,
    FakeDOMParser,
    FakeEventSource,
    { ELEMENT_NODE: 1 },
    class FakeCustomEvent { constructor(public type: string) {} },
    { warn: () => {} },
    () => ({ matches: true }),
    () => {},
  );

  const Plugin = windowObj.LiveReloadPluginRubric as new () => { reload(path: string): boolean };
  return {
    plugin: new Plugin(),
    sse: () => sse,
    bodyText: () => doc.body.childNodes.map((n) => n.outerHTML),
    reloads: () => reloads,
    drawn: () => drawn,
    ipcMessages,
    urls,
  };
}

test("a stalled fetch aborts on timeout, warns via IPC, and reloads instead of wedging forever", async () => {
  let calls = 0;
  const h = mount({
    relay: "http://127.0.0.1:1416",
    fetchMs: 30,
    fetchImpl: () => {
      calls++;
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(["initial"]) });
      // Never resolves: simulates a wedged WebKitGTK/libsoup3 fetch.
      return new Promise(() => {});
    },
  });

  await Bun.sleep(10);
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 1 }) });
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 2 }) });
  await Bun.sleep(80);
  expect(h.reloads()).toBe(1);
  expect(h.ipcMessages.some((m) => m.includes("fetch timed out"))).toBe(true);
});

test("a non-200 response falls back to location.reload and logs the status", async () => {
  let calls = 0;
  const h = mount({
    relay: "http://127.0.0.1:1416",
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, text: async () => JSON.stringify(["initial"]) };
      return { ok: false, status: 500, text: async () => "error" };
    },
  });

  await Bun.sleep(10);
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 1 }) });
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 2 }) });
  await Bun.sleep(20);
  expect(h.reloads()).toBe(1);
  expect(h.ipcMessages.some((m) => m.includes("HTTP 500"))).toBe(true);
});

test("SSE built revisions drive redraw, cache-bust fetches, suppress duplicate LiveReload, and catch up after disconnect", async () => {
  let pages = ["initial"];
  const h = mount({
    relay: "http://127.0.0.1:1416",
    fetchImpl: async (_url, init) => {
      expect(init?.cache).toBe("no-store");
      return { ok: true, status: 200, text: async () => JSON.stringify(pages) };
    },
  });

  await Bun.sleep(10);
  // Initial SSE revision establishes baseline without redundant fetch.
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 10 }) });
  await Bun.sleep(10);
  expect(h.urls.length).toBe(1);

  // New build arrives via SSE; matching LiveReload /x.js right after does not double-fetch.
  pages = ["initial", "zztest"];
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 11 }) });
  expect(h.plugin.reload("/x.js")).toBe(true);
  await Bun.sleep(80);
  expect(h.bodyText()).toEqual(["<p>initial</p>", "<p>zztest</p>"]);
  expect(h.urls.length).toBe(2);
  expect(h.urls[0]).toContain("_rubric=1");
  expect(h.urls[1]).toContain("_rubric=2");
  expect(h.reloads()).toBe(0);

  // Reconnect after missed builds (or server restart with a lower revision) triggers catch-up redraw.
  pages = ["initial", "after-reconnect"];
  h.sse()!.onmessage!({ data: JSON.stringify({ built: 15 }) });
  await Bun.sleep(20);
  expect(h.bodyText()).toEqual(["<p>initial</p>", "<p>after-reconnect</p>"]);
});

test("LiveReload still triggers redraw when no SSE relay is present", async () => {
  let pages = ["initial"];
  const h = mount({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(pages) }),
  });

  await Bun.sleep(10);
  pages = ["updated-by-livereload"];
  expect(h.plugin.reload("/x.js")).toBe(true);
  await Bun.sleep(20);
  expect(h.bodyText()).toEqual(["<p>updated-by-livereload</p>"]);
});
