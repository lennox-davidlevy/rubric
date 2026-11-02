// table: lets the reader sort by a column, by clicking its heading. Numbers
// sort as numbers. Without it the table reads the same, unsorted.
document.querySelectorAll(".part-table[data-sortable] table").forEach((table) => {
  const body = table.tBodies[0];
  if (!body) return;
  const heads = [...table.querySelectorAll("thead th")];
  const value = (row, i) => row.cells[i]?.textContent.trim() ?? "";
  heads.forEach((th, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "part-table-sort";
    button.append(...th.childNodes);
    th.append(button);
    button.addEventListener("click", () => {
      const ascending = th.getAttribute("aria-sort") !== "ascending";
      heads.forEach((h) => h.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      const rows = [...body.rows];
      const numeric = rows.every((r) => value(r, i) === "" || !isNaN(parseFloat(value(r, i).replace(/[^0-9.\-]/g, ""))));
      rows.sort((a, b) => {
        const [x, y] = [value(a, i), value(b, i)];
        const order = numeric
          ? parseFloat(x.replace(/[^0-9.\-]/g, "")) - parseFloat(y.replace(/[^0-9.\-]/g, ""))
          : x.localeCompare(y);
        return ascending ? order : -order;
      });
      body.append(...rows);
    });
  });
});
