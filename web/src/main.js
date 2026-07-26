/* UI glue: pick/drop a file, run the worker, show progress + results, and
 * package the yearly CSVs into a downloadable zip — all client-side. */
import { configure, ZipWriter, BlobWriter, TextReader } from "../vendor/zipjs/zip.js";

configure({ useWebWorkers: false });

const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file");
const skipExisting = $("skipExisting");
const progressWrap = $("progress");
const bar = $("bar");
const progressLabel = $("progressLabel");
const results = $("results");
const errorBox = $("error");

let objectUrls = []; // revoked between runs

function resetUI() {
  errorBox.hidden = true;
  results.hidden = true;
  results.innerHTML = "";
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  progressWrap.hidden = true;
}

function fmtBytes(n) {
  if (!n) return "";
  const mb = n / (1 << 20);
  return mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(0) + " MB";
}

function startConversion(file) {
  resetUI();
  if (!file) return;
  const name = file.name.toLowerCase();
  if (!name.endsWith(".zip") && !name.endsWith(".xml")) {
    showError("Please choose your Apple Health export.zip (or an extracted export.xml).");
    return;
  }

  progressWrap.hidden = false;
  bar.style.width = "0%";
  bar.classList.add("indeterminate");
  progressLabel.textContent = "Reading " + file.name + " (" + fmtBytes(file.size) + ")…";

  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      if (m.total) {
        bar.classList.remove("indeterminate");
        const pct = Math.min(100, Math.round((m.bytes / m.total) * 100));
        bar.style.width = pct + "%";
        progressLabel.textContent = "Processing… " + pct + "%";
      } else {
        progressLabel.textContent = "Processing… " + fmtBytes(m.bytes);
      }
    } else if (m.type === "done") {
      worker.terminate();
      renderResults(m);
    } else if (m.type === "error") {
      worker.terminate();
      showError(m.message || "Something went wrong while processing the file.");
    }
  };
  worker.onerror = (err) => {
    worker.terminate();
    showError("Worker error: " + (err.message || err.filename || "unknown"));
  };
  worker.postMessage({ file, skipExisting: skipExisting.checked });
}

async function renderResults({ files, perYear, skipped, summary }) {
  progressWrap.hidden = true;

  const totalDays = perYear.reduce((a, y) => a + y.days, 0);
  const range =
    summary.firstDay && summary.lastDay ? `${summary.firstDay} → ${summary.lastDay}` : "";

  const wrap = document.createElement("div");

  const h = document.createElement("h2");
  h.textContent = "Done — your Garmin files are ready";
  wrap.appendChild(h);

  const stats = document.createElement("p");
  stats.className = "stats";
  stats.textContent =
    `${summary.totalSteps.toLocaleString()} steps · ${totalDays.toLocaleString()} days · ` +
    `${perYear.length} yearly file(s)` + (range ? ` · ${range}` : "");
  wrap.appendChild(stats);

  // Download all (.zip)
  const zipBlob = await makeZip(files);
  const zipUrl = URL.createObjectURL(zipBlob);
  objectUrls.push(zipUrl);
  const allBtn = document.createElement("a");
  allBtn.href = zipUrl;
  allBtn.download = "garmin_fitbit_csvs.zip";
  allBtn.className = "btn primary";
  allBtn.textContent = "⬇ Download all (.zip)";
  wrap.appendChild(allBtn);

  // Per-year list
  const ul = document.createElement("ul");
  ul.className = "files";
  for (const y of perYear) {
    const fname = `fitbit_activities_${y.year}.csv`;
    const blob = new Blob([files[fname]], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.textContent = fname;
    const span = document.createElement("span");
    span.className = "muted";
    span.textContent = ` — ${y.days} days, ${y.steps.toLocaleString()} steps`;
    li.appendChild(a);
    li.appendChild(span);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);

  if (skipped && skipped.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent =
      `You chose to skip ${skipped.length} day(s) that already came from Garmin: ${skipped.join(", ")}. ` +
      `Untick the box above to include them.`;
    wrap.appendChild(note);
  }

  const reminder = document.createElement("p");
  reminder.className = "reminder";
  reminder.textContent =
    "Import one file per year into Garmin Connect, and do NOT open the CSVs in Excel first — it reformats them and breaks the import.";
  wrap.appendChild(reminder);

  results.appendChild(wrap);
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function makeZip(files) {
  const zw = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, content] of Object.entries(files)) {
    await zw.add(name, new TextReader(content));
  }
  return zw.close();
}

// --- wiring ---------------------------------------------------------------
fileInput.addEventListener("change", () => startConversion(fileInput.files[0]));

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("hover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("hover");
  })
);
drop.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) startConversion(f);
});
drop.addEventListener("click", () => fileInput.click());
drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
