// diagram: draws each diagram's text with Mermaid, in the theme's own colors
// and font. Mermaid ships with the catalog (static/js/vendor/, MIT), pinned
// by its version and checked by its hash, and is fetched only on a page that
// has a diagram: no outside site is asked, and it works offline. To upgrade,
// replace the file, its name here and in diagram.html, and the hash. If it
// cannot draw a diagram, the text stays.
const INTEGRITY = "sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I";
// Runs again on "rubric:drawn", when the live preview puts new parts in the
// page without reloading it; anything set up once is marked and skipped.
let mermaidReady;
let drawn = 0;
const loadMermaid = (src) => (mermaidReady ??= new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = src;
  script.integrity = INTEGRITY;
  script.crossOrigin = "anonymous";
  script.onload = () => {
    const mermaid = window.mermaid;
    const slot = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      themeVariables: {
        background: slot("paper"),
        primaryColor: slot("tint"),
        primaryTextColor: slot("ink"),
        primaryBorderColor: slot("muted"),
        lineColor: slot("muted"),
        secondaryColor: slot("raised"),
        tertiaryColor: slot("paper"),
        fontFamily: slot("font-ui"),
      },
    });
    resolve(mermaid);
  };
  script.onerror = reject;
  document.head.append(script);
}));
const diagrams = async () => {
  const figures = [...document.querySelectorAll(".part-diagram[data-mermaid]:not([data-ready])")];
  if (!figures.length) return;
  figures.forEach((f) => (f.dataset.ready = ""));
  let mermaid;
  try { mermaid = await loadMermaid(figures[0].dataset.mermaid); } catch { return; }
  for (const figure of figures) {
    const pre = figure.querySelector(".part-diagram-source");
    try {
      const { svg } = await mermaid.render(`rubric-diagram-${drawn++}`, pre.textContent);
      figure.insertAdjacentHTML("afterbegin", svg);
      pre.hidden = true;
      figure.classList.add("is-drawn");
    } catch {
      // The text stays, which still says what the diagram would.
    }
  }
};
diagrams();
document.addEventListener("rubric:drawn", diagrams);
