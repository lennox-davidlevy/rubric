// reading-progress: sets how far down the page the reader is, from 0 at the
// top to 1 at the bottom, on each mark; the CSS draws it as a bar or a ruler.
// A ruler also lists the page's sections, each where the reader is when its
// heading reaches the top, the one being read marked as current, and on a
// phone, where it opens over the page, choosing one closes it.
// Runs again on "rubric:drawn", when the live preview puts new parts in the
// page without reloading it, and when the page changes height (a picture
// loading moves every heading below it).
(() => {
  const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  // The writing's own headings: not a part's, which belong to the part.
  const headings = () => [...document.querySelectorAll("main h2")].filter((h) => !h.closest(".part"));
  const end = () => document.documentElement.scrollHeight - innerHeight;

  // Names a line apart at least: pushed down past the one above, then, where
  // that runs off the end, back up from the bottom.
  const spread = (ats, height) => {
    const gap = Math.min(1 / Math.max(1, ats.length), 20 / Math.max(1, height));
    const out = [...ats];
    for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
    for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i], i === out.length - 1 ? 1 : out[i + 1] - gap);
    return out.map((v) => Math.max(0, v));
  };

  let sections = [];
  const list = () => {
    const rulers = document.querySelectorAll(".part-reading-progress-sections");
    if (!rulers.length) return;
    const room = end();
    sections = headings().map((h) => {
      if (!h.id) h.id = slug(h.textContent) || "section";
      const top = h.getBoundingClientRect().top + scrollY;
      return { h, at: room > 0 ? Math.min(1, Math.max(0, top / room)) : 0 };
    });
    for (const ol of rulers) {
      const spots = spread(sections.map((x) => x.at), ol.parentElement.clientHeight || innerHeight * 0.8);
      ol.replaceChildren(...sections.map(({ h }, i) => {
        const li = document.createElement("li");
        li.style.setProperty("--at", spots[i].toFixed(4));
        const a = document.createElement("a");
        a.href = `#${h.id}`;
        a.textContent = h.textContent.trim();
        li.append(a);
        return li;
      }));
    }
  };

  let queued = false;
  const update = () => {
    queued = false;
    const room = end();
    const read = room > 0 ? Math.min(1, Math.max(0, scrollY / room)) : 1;
    // The section being read: the last whose heading is in the top third.
    let current = -1;
    sections.forEach(({ h }, i) => { if (h.getBoundingClientRect().top <= innerHeight / 3) current = i; });
    for (const part of document.querySelectorAll(".part-reading-progress")) {
      part.dataset.ready = "";
      part.style.setProperty("--read", read.toFixed(4));
      const value = part.querySelector(".part-reading-progress-value");
      if (value) value.textContent = read.toFixed(2);
      part.querySelectorAll(".part-reading-progress-sections li").forEach((li, i) => {
        if (i === current) li.setAttribute("aria-current", "location");
        else li.removeAttribute("aria-current");
      });
    }
  };
  const soon = () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  };
  const again = () => { list(); soon(); };

  // On a phone the ruler is open over the page: a section chosen closes it.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(".part-reading-progress-sections a");
    a?.closest("[popover]")?.hidePopover?.();
  });
  // Opened on a phone, it would stay over the page once the screen is wide.
  matchMedia("(min-width: 64rem)").addEventListener("change", (e) => {
    if (e.matches) document.querySelectorAll(".part-reading-progress-panel:popover-open").forEach((p) => p.hidePopover());
  });
  addEventListener("scroll", soon, { passive: true });
  addEventListener("resize", again);
  document.addEventListener("rubric:drawn", again);
  new ResizeObserver(again).observe(document.body);
  again();
})();
