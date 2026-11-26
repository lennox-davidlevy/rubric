// The live preview's own script, loaded only by `hugo server`. Two jobs:
//
// - Hugo's live reload reloads the whole page on every change, so a video
//   starts over and a diagram is drawn again from nothing, and the page
//   jumps. This takes over that reload: it fetches the new page and changes
//   only what changed, leaving everything else as it is, playing and drawn.
//   Hugo's script picks up any window.LiveReloadPlugin* defined before it
//   runs, and this one is: it is in the head, not deferred.
// - It follows the writer's cursor. The language server tells `bun run play`
//   where the cursor is, which passes it on here (the relay); the page
//   scrolls to the block the cursor is in, using the markers the server
//   writes before each block ({{< rubric-line >}}), or opens the page the
//   writer moved to.
//
// Anything unexpected falls back to the plain reload.
(() => {
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content;
  const source = meta("rubric-source");
  const relay = meta("rubric-relay");
  const warn = (why) => {
    console.warn(`rubric-live: ${why}`);
    try { window.ipc?.postMessage(`live: ${why}`); } catch {}
  };
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  // Bound every fetch so a stalled WebKitGTK/libsoup3 request can never wedge
  // `running = true` forever; cache-bust alongside `no-store` as belt-and-suspenders.
  const FETCH_MS = window.__rubricFetchMs ?? 3000;
  let fetchSeq = 0;
  const fetchPage = async () => {
    const url = new URL(location.href);
    url.searchParams.set("_rubric", String(++fetchSeq));
    const ac = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { ac.abort(); reject(new Error("fetch timed out")); }, FETCH_MS);
    });
    try {
      const html = await Promise.race([
        fetch(url.href, { cache: "no-store", signal: ac.signal }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        }),
        timeout,
      ]);
      return parse(html);
    } finally {
      clearTimeout(timer);
    }
  };

  // The page as Hugo last sent it, before any script changed it. A node the
  // new page has unchanged from this one is left alone in the live page.
  let sent = fetchPage().catch((err) => { warn(`initial fetch failed (${err?.message ?? err})`); return undefined; });

  // Changes `live` to match `next`, where `live` started as `was` and only
  // scripts may have changed it since. The longest run of nodes unchanged
  // between `was` and `next` is kept as it is, never moved, so a video keeps
  // playing and a diagram stays drawn. Between them, a node of the same kind
  // is changed in place, and the rest are removed or added.
  const key = (n) => (n.nodeType === Node.ELEMENT_NODE ? n.outerHTML : `${n.nodeType}:${n.nodeValue}`);
  const kind = (a, b) =>
    a.nodeType === b.nodeType && a.nodeName === b.nodeName &&
    (a.nodeType !== Node.ELEMENT_NODE || a.getAttribute("class") === b.getAttribute("class"));

  const morph = (live, was, next) => {
    const L = [...live.childNodes], W = [...was.childNodes], N = [...next.childNodes];
    if (L.length !== W.length) return false;
    const wk = W.map(key), nk = N.map(key);
    // The longest common run, by dynamic programming over the two lists.
    const cols = N.length + 1;
    const t = new Uint16Array((W.length + 1) * cols);
    for (let i = W.length - 1; i >= 0; i--) {
      for (let j = N.length - 1; j >= 0; j--) {
        t[i * cols + j] = wk[i] === nk[j] ? t[(i + 1) * cols + j + 1] + 1 : Math.max(t[(i + 1) * cols + j], t[i * cols + j + 1]);
      }
    }
    const kept = [];
    for (let i = 0, j = 0; i < W.length && j < N.length;) {
      if (wk[i] === nk[j]) { kept.push([i, j]); i++; j++; }
      else if (t[(i + 1) * cols + j] >= t[i * cols + j + 1]) i++;
      else j++;
    }
    kept.push([W.length, N.length]);
    let i = 0, j = 0;
    for (const [ki, kj] of kept) {
      const anchor = L[ki] ?? null;
      for (; j < kj; j++) {
        let q = i;
        while (q < ki && !kind(W[q], N[j])) q++;
        if (q < ki) {
          for (; i < q; i++) L[i].remove();
          patch(L[i], W[i], N[j]);
          i++;
        } else live.insertBefore(document.importNode(N[j], true), i < ki ? L[i] : anchor);
      }
      for (; i < ki; i++) L[i].remove();
      i = ki + 1;
      j = kj + 1;
    }
    return true;
  };

  const patch = (live, was, next) => {
    if (live.nodeType !== Node.ELEMENT_NODE) {
      live.nodeValue = next.nodeValue;
      return;
    }
    // An object (a PDF) loads its file once: Chrome keeps the fallback after a
    // missing file even when `data` changes to one that's there. A new one
    // loads afresh. Only when it changed, so an unchanged PDF keeps its place.
    if (/^(OBJECT|EMBED)$/.test(live.nodeName)) {
      live.replaceWith(document.importNode(next, true));
      return;
    }
    // Only what the page itself changed: an attribute a script set stays.
    for (const { name, value } of next.attributes) if (was.getAttribute(name) !== value) live.setAttribute(name, value);
    for (const { name } of was.attributes) if (!next.hasAttribute(name)) live.removeAttribute(name);
    if (!morph(live, was, next)) live.replaceWith(document.importNode(next, true));
  };

  // The head: new stylesheets in before old ones go, so nothing flashes
  // unstyled; a part's script that is new to the page is added. A changed
  // script, or anything else, reloads.
  const head = (next) => {
    const hrefs = (d) => [...d.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));
    const srcs = (d) => [...d.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
    const name = (src) => src.replace(/\.[0-9a-f]{16,}\.js$/, "");
    const have = srcs(document);
    for (const src of srcs(next)) {
      if (have.includes(src)) continue;
      if (have.some((h) => name(h) === name(src))) return false;
      const script = document.createElement("script");
      const from = next.querySelector(`script[src="${CSS.escape(src)}"]`);
      for (const { name: n, value } of from.attributes) script.setAttribute(n, value);
      document.head.append(script);
    }
    const old = hrefs(document), now = hrefs(next);
    if (old.join() !== now.join()) {
      const gone = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => !now.includes(l.getAttribute("href")));
      const added = now.filter((h) => !old.includes(h)).map((h) => {
        const link = document.importNode(next.querySelector(`link[rel="stylesheet"][href="${CSS.escape(h)}"]`), true);
        document.head.append(link);
        return new Promise((r) => { link.onload = link.onerror = r; });
      });
      Promise.all(added).then(() => gone.forEach((l) => l.remove()));
    }
    document.title = next.title;
    return true;
  };

  let running = false, again = false;
  const redraw = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const was = await sent;
        const next = await fetchPage();
        if (!was) { warn("reloading: no baseline"); return location.reload(); }
        if (!head(next)) { warn("reloading: head changed"); return location.reload(); }
        if (!morph(document.body, was.body, next.body)) { warn("reloading: body mismatch"); return location.reload(); }
        sent = Promise.resolve(next);
        document.dispatchEvent(new CustomEvent("rubric:drawn"));
        if (cursor) follow(cursor.line);
      } while (again);
    } catch (err) {
      warn(`reloading: ${err?.message ?? err}`);
      location.reload();
    } finally {
      running = false;
    }
  };

  // Both the SSE relay (`{ built: rev }`) and Hugo's LiveReload trigger a
  // redraw. When SSE is healthy it drives rebuilds directly and suppresses the
  // duplicate LiveReload fetch; if either channel stalls, the other still runs.
  let seenBuilt;
  let builtAt = 0;
  let lrTimer;

  window.LiveReloadPluginRubric = class {
    static identifier = "rubric";
    static version = "1.0";
    reload(path) {
      // Hugo asks for a whole reload with the made-up path "/x.js", which is
      // what a changed page sends. Its own navigation, and real files the
      // page loads, are its to handle.
      const asset = path !== "/x.js" && /\.(css|js|map|png|jpe?g|gif|svg|webp|avif|woff2?)$/i.test(path);
      if (path.startsWith("__hugo_navigate") || asset) return false;
      if (Date.now() - builtAt < 250) return true;
      clearTimeout(lrTimer);
      lrTimer = setTimeout(() => { lrTimer = undefined; redraw(); }, seenBuilt === undefined ? 0 : 60);
      return true;
    }
    analyze() { return {}; }
  };

  // Where the line is on the page: between the markers before and after it,
  // as far down as it is between their lines.
  let cursor;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const follow = (line) => {
    const marks = [...document.querySelectorAll("link[data-rubric-line]")]
      .map((m) => ({ line: Number(m.dataset.rubricLine), el: m.nextElementSibling }))
      .filter((m) => m.el)
      .sort((a, b) => a.line - b.line);
    let before, after;
    for (const m of marks) {
      if (m.line <= line) before = m;
      else { after = m; break; }
    }
    let y = 0;
    if (before) {
      const from = top(before.el);
      const to = after ? top(after.el) : from + before.el.offsetHeight;
      const span = after ? after.line - before.line : Math.max(1, line - before.line + 1);
      y = from + Math.min(1, (line - before.line) / span) * (to - from);
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: Math.max(0, y - innerHeight / 3), behavior: still ? "auto" : "smooth" });
  };

  if (relay && "EventSource" in window) {
    const events = new EventSource(`${relay}/events`);
    events.onmessage = (e) => {
      let c;
      try { c = JSON.parse(e.data); } catch { return; }
      if (typeof c.built === "number") {
        if (seenBuilt === undefined) {
          seenBuilt = c.built;
        } else if (c.built !== seenBuilt) {
          seenBuilt = c.built;
          builtAt = Date.now();
          clearTimeout(lrTimer);
          lrTimer = undefined;
          redraw();
        }
        return;
      }
      if (c.source === source) {
        cursor = c;
        follow(c.line);
      } else if (c.url && c.url !== location.pathname) location.assign(c.url);
    };
  }
})();
