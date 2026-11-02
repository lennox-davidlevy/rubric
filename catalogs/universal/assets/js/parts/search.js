// search: finds pages on this site as the reader types, from the site's own
// feed (its titles and summaries), fetched once on first use. Without it the
// form searches the site on DuckDuckGo.
document.querySelectorAll(".part-search[data-feed]").forEach((form) => {
  const input = form.querySelector("input[type=search]");
  const results = form.querySelector(".part-search-results");
  let items;
  const load = async () => {
    if (items) return items;
    const xml = new DOMParser().parseFromString(await (await fetch(form.dataset.feed)).text(), "application/xml");
    items = [...xml.querySelectorAll("item")].map((i) => ({
      title: i.querySelector("title")?.textContent ?? "",
      link: i.querySelector("link")?.textContent ?? "",
      text: (i.querySelector("description")?.textContent ?? "").replace(/<[^>]+>/g, " "),
    }));
    return items;
  };
  const render = async () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { results.hidden = true; return; }
    const found = (await load())
      .map((it) => ({ it, score: words.reduce((n, w) => n + (it.title.toLowerCase().includes(w) ? 3 : 0) + (it.text.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter((r) => r.score >= words.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    results.replaceChildren(...(found.length ? found.map(({ it }) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = new URL(it.link, location.href).pathname;
      a.textContent = it.title;
      li.append(a);
      return li;
    }) : [Object.assign(document.createElement("li"), { className: "part-search-none", textContent: "Nothing found" })]));
    results.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("focus", () => { load().catch(() => {}); });
  form.addEventListener("submit", (e) => {
    const first = results.querySelector("a");
    if (first && !results.hidden) { e.preventDefault(); location.href = first.href; }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { results.hidden = true; input.blur(); } });
});
