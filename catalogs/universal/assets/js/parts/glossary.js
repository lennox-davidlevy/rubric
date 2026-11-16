// glossary: numbers each term, marks the first place the writing uses it
// (a dotted line and its number, linking to its meaning), links the term in
// the list back there, and shows its meaning in the margin while the reader
// points at the mark, where the screen has room. Without this script the
// glossary is the list as written.
// Runs again on "rubric:drawn", when the live preview puts new parts in the
// page without reloading it; what is already done is left as it is.
(() => {
  const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Text the writer could have meant a term in: not headings, links, code,
  // a glossary, or a term already marked.
  const SKIP = "h1, h2, h3, h4, h5, h6, a, code, pre, kbd, script, style, .part-glossary, .glossary-note, header, nav, footer, aside";

  const mark = (root, term, id, n) => {
    const words = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(term)}(?:s|es)?)(?![\\p{L}\\p{N}])`, "iu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const m = words.exec(t.nodeValue);
      if (!m) continue;
      const start = m.index + m[1].length;
      const rest = t.splitText(start);
      rest.splitText(m[2].length);
      const a = document.createElement("a");
      a.className = "glossary-term";
      a.id = `term-${id}`;
      a.href = `#${id}`;
      a.dataset.note = id;
      a.textContent = rest.nodeValue;
      const sup = document.createElement("sup");
      sup.textContent = n;
      a.append(sup);
      rest.replaceWith(a);
      return a;
    }
    return undefined;
  };

  // Every run goes over every term, since the live preview may have put back
  // a paragraph without its mark, or a list with a new term: what is already
  // done is left as it is.
  const glossaries = () => {
    const seen = new Set();
    document.querySelectorAll(".part-glossary").forEach((part, g) => {
      const root = part.closest("main") ?? document.body;
      const items = [...part.querySelectorAll(":scope > .stack > :is(ul, ol) > li")];
      items.forEach((li, i) => {
        // A tight list holds the term straight in the item; a loose one, in
        // its first paragraph.
        const head = li.querySelector(":scope > :is(strong, a):first-child, :scope > p:first-child > :is(strong, a):first-child");
        if (!head) return;
        const term = head.textContent.replace(/[:\s]+$/, "").trim();
        if (!term) return;
        // Unique on the page, even for a term in two glossaries or one with
        // no letters.
        let id = `glossary-${slug(term) || `${g}-${i}`}`;
        if (seen.has(id)) id = `${id}-${g}-${i}`;
        seen.add(id);
        li.id = id;
        const marked = document.getElementById(`term-${id}`) ?? mark(root, term, id, i + 1);
        if (marked && head.tagName === "STRONG") {
          const back = document.createElement("a");
          back.href = `#term-${id}`;
          back.innerHTML = head.innerHTML;
          head.replaceWith(back);
        }
      });
    });
  };

  // One note for the page, inside the glossary, so the live preview's page
  // keeps the same pieces around it.
  let note, shown;
  const show = (a) => {
    const li = document.getElementById(a.dataset.note);
    const part = li?.closest(".part-glossary");
    if (!li || !part) return;
    if (!note || !part.contains(note)) {
      note = document.createElement("div");
      note.className = "glossary-note";
      note.hidden = true;
      part.append(note);
    }
    const line = a.closest("p, li, td, dd, blockquote") ?? a;
    // Laid out but not seen while it is measured: a hidden box has no parent
    // to measure from.
    note.style.visibility = "hidden";
    note.hidden = false;
    const box = note.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    note.style.visibility = "";
    const gap = parseFloat(getComputedStyle(note).marginLeft) || 0;
    const left = line.getBoundingClientRect().right - box.left;
    // Only where the margin has room for it; the mark's link still leads to it.
    const room = document.documentElement.clientWidth - (box.left + left + gap);
    if (room < 180) return hide();
    const meaning = li.cloneNode(true);
    const head = meaning.querySelector(":scope > a:first-child, :scope > strong:first-child");
    const name = document.createElement("strong");
    name.textContent = head ? head.textContent.replace(/[:\s]+$/, "") : "";
    head?.remove();
    note.replaceChildren(name, document.createTextNode(` — ${meaning.textContent.replace(/^[\s:—–-]+/, "")}`));
    note.style.left = `${left}px`;
    note.style.top = `${a.getBoundingClientRect().top - box.top}px`;
    note.style.width = `${Math.min(240, room - 16)}px`;
    note.hidden = false;
    shown?.classList.remove("is-shown");
    shown = a;
    a.classList.add("is-shown");
  };
  const hide = () => {
    if (note) note.hidden = true;
    shown?.classList.remove("is-shown");
    shown = undefined;
  };
  document.addEventListener("pointerover", (e) => {
    const a = e.target.closest?.(".glossary-term");
    if (a && e.pointerType !== "touch") show(a);
    else if (shown && !e.target.closest?.(".glossary-term")) hide();
  });
  document.addEventListener("focusin", (e) => {
    const a = e.target.closest?.(".glossary-term");
    if (a) show(a); else hide();
  });
  // Escape dismisses it, and so does leaving the page.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  addEventListener("blur", hide);

  glossaries();
  document.addEventListener("rubric:drawn", glossaries);
})();
