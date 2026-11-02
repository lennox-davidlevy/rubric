// diagram: draws each diagram's text with Mermaid, in the theme's own colors
// and font. Mermaid ships with the catalog (static/js/vendor/, MIT), pinned
// by its version and checked by its hash, and is fetched only on a page that
// has a diagram: no outside site is asked, and it works offline. To upgrade,
// replace the file, its name here and in diagram.html, and the hash. If it
// cannot draw a diagram, the text stays.
const INTEGRITY = "sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I";
const figures = [...document.querySelectorAll(".part-diagram[data-mermaid]")];
if (figures.length) {
  const script = document.createElement("script");
  script.src = figures[0].dataset.mermaid;
  script.integrity = INTEGRITY;
  script.crossOrigin = "anonymous";
  script.onload = async () => {
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
    for (const [i, figure] of figures.entries()) {
      const pre = figure.querySelector(".part-diagram-source");
      try {
        const { svg } = await mermaid.render(`rubric-diagram-${i}`, pre.textContent);
        figure.insertAdjacentHTML("afterbegin", svg);
        pre.hidden = true;
        figure.classList.add("is-drawn");
      } catch {
        // The text stays, which still says what the diagram would.
      }
    }
  };
  document.head.append(script);
}
