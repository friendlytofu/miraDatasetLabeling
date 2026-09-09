// ---------- session ----------
const toastRegion = document.getElementById("toast-region");

function showToast(message, tone = "") {
  if (!toastRegion) return;
  const toast = document.createElement("div");
  toast.className = `toast ${tone ? `is-${tone}` : ""}`;
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    setTimeout(() => toast.remove(), 180);
  }, 2800);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) };
  let res;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", ...opts, headers });
  } catch (error) {
    throw new Error("Network error — check your connection and try again.");
  }

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (res.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Session expired — redirecting to sign in.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setBusy(button, busy, text = "Working…") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) button.dataset.originalText = button.querySelector("span")?.textContent || button.textContent;
    button.disabled = true;
    const label = button.querySelector("span");
    if (label) label.textContent = text;
  } else {
    button.disabled = false;
    const label = button.querySelector("span");
    if (label && button.dataset.originalText) label.textContent = button.dataset.originalText;
  }
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-error", "is-success");
  if (tone) el.classList.add(`is-${tone}`);
}

// ---------- logout ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  const button = document.getElementById("logout-btn");
  button.disabled = true;
  try { await fetch("/api/logout", { method: "POST", credentials: "same-origin", cache: "no-store" }); } catch {}
  window.location.replace("/login.html");
});

// ---------- tab switching ----------
const tabIndicator = document.getElementById("tab-indicator");
function moveTabIndicator(btn) {
  if (!tabIndicator || !btn) return;
  const nav = btn.parentElement;
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  tabIndicator.style.width = `${btnRect.width}px`;
  tabIndicator.style.transform = `translateX(${btnRect.left - navRect.left}px)`;
}

async function activateTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const active = b === btn;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  document.getElementById(`panel-${name}`)?.classList.add("is-active");
  moveTabIndicator(btn);
  if (name === "label") await loadNextEntry();
  if (name === "export") await loadExportStats();
  if (name === "create") await loadItems();
}

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
window.addEventListener("resize", () => moveTabIndicator(document.querySelector(".tab-btn.is-active")));

// ---------- helpers ----------
function lowerFirst(s) {
  if (!s) return s;
  if (s === s.toUpperCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function stripLeadingVerb(phrase) {
  return phrase.trim().replace(/^(i\s+(can|could|will|offer|teach|know)\s+)/i, "").trim();
}
function offerVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  const capped = p.charAt(0).toUpperCase() + p.slice(1);
  return [
    `I can offer ${p}.`, `I'm happy to help with ${p}.`, `I have experience with ${p} and can teach it.`,
    `I offer ${p} for anyone interested.`, `${capped} is something I can share with others.`,
    `I know ${p} well and can walk someone through it.`, `Count me in to help with ${p}.`,
    `I can put together a session on ${p}.`, `Happy to run a beginner-friendly session on ${p}.`,
  ];
}
function wantVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  return [
    `I want ${p}.`, `I'm looking for help with ${p}.`, `I need someone who can help me with ${p}.`,
    `I'd love to learn more about ${p}.`, `Looking for guidance on ${p}.`, `I need a hand with ${p}.`,
    `Could really use help with ${p}.`, `I'm hoping to find someone who can teach me ${p}.`,
    `Would appreciate any pointers on ${p}.`,
  ];
}
function randomIndexExcluding(length, exclude) {
  if (length <= 1) return 0;
  let idx;
  do idx = Math.floor(Math.random() * length); while (idx === exclude);
  return idx;
}
function formatLocalISO(d) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
}

// ---------- CREATE ----------
let offerIdx = 0;
let wantIdx = 0;
const phraseInput = document.getElementById("phrase-input");
const draftArea = document.getElementById("draft-area");

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => {
    phraseInput.value = button.dataset.phrase || "";
    phraseInput.focus();
  });
});
document.getElementById("clear-phrase-btn").addEventListener("click", () => { phraseInput.value = ""; phraseInput.focus(); });
phraseInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); document.getElementById("draft-btn").click(); }
});

document.getElementById("draft-btn").addEventListener("click", () => {
  const phrase = phraseInput.value.trim();
  if (!phrase) { setStatus(document.getElementById("create-status"), "Add an activity first.", "error"); phraseInput.focus(); return; }
  const offers = offerVariants(phrase); const wants = wantVariants(phrase);
  offerIdx = Math.floor(Math.random() * offers.length); wantIdx = Math.floor(Math.random() * wants.length);
  document.getElementById("offer-text").value = offers[offerIdx];
  document.getElementById("want-text").value = wants[wantIdx];
  document.getElementById("offer-variant-count").textContent = `(${offerIdx + 1}/${offers.length})`;
  document.getElementById("want-variant-count").textContent = `(${wantIdx + 1}/${wants.length})`;
  draftArea.hidden = false; draftArea.dataset.phrase = phrase;
  setStatus(document.getElementById("create-status"), "Draft ready — edit freely before saving.", "success");
});

document.getElementById("cycle-offer").addEventListener("click", () => {
  const variants = offerVariants(draftArea.dataset.phrase || "");
  offerIdx = randomIndexExcluding(variants.length, offerIdx);
  document.getElementById("offer-text").value = variants[offerIdx];
  document.getElementById("offer-variant-count").textContent = `(${offerIdx + 1}/${variants.length})`;
});
document.getElementById("cycle-want").addEventListener("click", () => {
  const variants = wantVariants(draftArea.dataset.phrase || "");
  wantIdx = randomIndexExcluding(variants.length, wantIdx);
  document.getElementById("want-text").value = variants[wantIdx];
  document.getElementById("want-variant-count").textContent = `(${wantIdx + 1}/${variants.length})`;
});

document.getElementById("save-draft-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const phrase = draftArea.dataset.phrase || "";
  const items = [];
  if (document.getElementById("offer-include").checked) items.push({ text: document.getElementById("offer-text").value.trim(), type: "offer", source_phrase: phrase });
  if (document.getElementById("want-include").checked) items.push({ text: document.getElementById("want-text").value.trim(), type: "want", source_phrase: phrase });
  if (!items.length || items.some((item) => !item.text)) { setStatus(document.getElementById("create-status"), "Select at least one non-empty item.", "error"); return; }
  setBusy(button, true, "Saving…");
  try {
    await api("/items", { method: "POST", body: JSON.stringify({ items }) });
    setStatus(document.getElementById("create-status"), `Saved ${items.length} item${items.length > 1 ? "s" : ""} to the bank.`, "success");
    showToast("Item bank updated.", "success");
    phraseInput.value = ""; draftArea.hidden = true;
    await loadItems();
  } catch (error) {
    setStatus(document.getElementById("create-status"), `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
});

document.getElementById("refresh-items-btn").addEventListener("click", loadItems);

async function loadItems() {
  try {
    const { items } = await api("/items");
    const offers = items.filter((i) => i.type === "offer");
    const wants = items.filter((i) => i.type === "want");
    document.getElementById("offer-count").textContent = offers.length;
    document.getElementById("want-count").textContent = wants.length;
    document.getElementById("metric-offers").textContent = offers.length;
    document.getElementById("metric-wants").textContent = wants.length;
    const offerMeter = Math.min(100, offers.length * 5); const wantMeter = Math.min(100, wants.length * 5);
    document.getElementById("offer-meter-fill").style.width = `${offerMeter}%`;
    document.getElementById("want-meter-fill").style.width = `${wantMeter}%`;
    renderItemList("offer-list", offers);
    renderItemList("want-list", wants);
  } catch (error) { showToast(error.message, "error"); }
}
function renderItemList(elId, list) {
  const el = document.getElementById(elId); el.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li"); const span = document.createElement("span"); span.textContent = item.text;
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "remove"; btn.setAttribute("aria-label", `Remove ${item.text}`);
    btn.addEventListener("click", async () => {
      try { await api(`/items?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }); showToast("Item removed."); await loadItems(); }
      catch (error) { showToast(error.message, "error"); }
    });
    li.append(span, btn); el.appendChild(li);
  }
}

// ---------- GENERATE ----------
const genCount = document.getElementById("gen-count");
document.querySelectorAll(".stepper-btn").forEach((button) => button.addEventListener("click", () => {
  const delta = Number(button.dataset.step) || 0;
  genCount.value = Math.min(1000, Math.max(1, (Number(genCount.value) || 30) + delta));
}));
document.querySelectorAll(".preset-btn").forEach((button) => button.addEventListener("click", () => {
  genCount.value = button.dataset.count;
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("is-active", b === button));
}));

document.getElementById("generate-btn").addEventListener("click", async (event) => {
  const count = Math.min(1000, Math.max(1, Number(genCount.value) || 30));
  const statusEl = document.getElementById("generate-status");
  const button = event.currentTarget; genCount.value = count;
  setStatus(statusEl, "Building a balanced queue…"); setBusy(button, true, "Generating…");
  try {
    const res = await api("/generate", { method: "POST", body: JSON.stringify({ count }) });
    setStatus(statusEl, res.exhausted ? `Generated ${res.generated} of ${res.requested} — the remaining unique combinations are running low.` : `Generated ${res.generated} new combinations.`, "success");
    document.getElementById("generated-total").textContent = res.generated;
    renderBucketGrid(res.bucketCounts);
    document.getElementById("metric-unlabeled").textContent = "…";
    showToast(`${res.generated} combinations added.`, "success");
  } catch (error) {
    setStatus(statusEl, `Error: ${error.message}`, "error"); showToast(error.message, "error");
  } finally { setBusy(button, false); }
});

function renderBucketGrid(counts = {}) {
  const el = document.getElementById("bucket-grid"); el.innerHTML = "";
  const values = [];
  for (let o = 1; o <= 3; o++) for (let w = 1; w <= 3; w++) values.push(Number(counts[`${o}x${w}`] || 0));
  const max = Math.max(1, ...values);
  for (let o = 1; o <= 3; o++) for (let w = 1; w <= 3; w++) {
    const key = `${o}x${w}`; const n = Number(counts[key] || 0);
    const cell = document.createElement("div"); cell.className = "bucket-cell";
    if (n === max && n > 0) cell.classList.add("is-max");
    const bar = document.createElement("div"); bar.className = "bar"; bar.style.height = `${(n / max) * 100}%`;
    const num = document.createElement("span"); num.className = "n"; num.textContent = n;
    const label = document.createElement("span"); label.className = "bucket-label"; label.textContent = `${o} offer${o > 1 ? "s" : ""} × ${w} want${w > 1 ? "s" : ""}`;
    cell.append(bar, num, label); el.appendChild(cell);
  }
}
renderBucketGrid();

// ---------- LABEL ----------
const HIGHLIGHT_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#ddd6fe", "#fed7aa"];
const labelerInput = document.getElementById("labeler-name");
labelerInput.value = localStorage.getItem("mira_labeler_name") || "";
labelerInput.addEventListener("input", () => localStorage.setItem("mira_labeler_name", labelerInput.value));
let currentEntry = null;
let labelingBusy = false;

async function loadNextEntry() {
  try {
    const { entries, counts } = await api("/entries?status=unlabeled&limit=1");
    const total = Number(counts.total || 0); const unlabeled = Number(counts.unlabeled || 0); const done = total - unlabeled;
    document.getElementById("label-progress").textContent = `${unlabeled} unlabeled · ${total} total`;
    document.getElementById("progress-fill").style.width = total ? `${(done / total) * 100}%` : "0%";
    document.getElementById("metric-unlabeled").textContent = unlabeled;
    if (!entries.length) {
      currentEntry = null; document.getElementById("label-card").hidden = true; document.getElementById("label-empty").hidden = false; return;
    }
    document.getElementById("label-empty").hidden = true;
    const card = document.getElementById("label-card"); card.hidden = false; card.classList.add("is-loading"); currentEntry = entries[0];
    document.getElementById("entry-index-label").textContent = `Entry #${currentEntry.id}`;
    await renderEntry(currentEntry);
    requestAnimationFrame(() => card.classList.remove("is-loading"));
  } catch (error) { showToast(error.message, "error"); }
}
function tokenize(text) {
  const stop = new Set(["i","a","an","the","to","for","with","and","of","on","in","my","me","want","need","can","help","someone","who","looking"]);
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))];
}
function highlightSharedTerms(texts) {
  const tokensByItem = texts.map(tokenize); const tokenItems = {};
  tokensByItem.forEach((toks, idx) => toks.forEach((t) => (tokenItems[t] = tokenItems[t] || new Set()).add(idx)));
  const sharedTokens = Object.keys(tokenItems).filter((t) => tokenItems[t].size > 1); const colorFor = {};
  sharedTokens.forEach((t, i) => (colorFor[t] = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]));
  return texts.map((text) => {
    const escaped = text.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    if (!sharedTokens.length) return escaped;
    const pattern = new RegExp(`\\b(${sharedTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    return escaped.replace(pattern, (m) => `<mark style="background:${colorFor[m.toLowerCase()]}">${m}</mark>`);
  });
}
async function renderEntry(entry) {
  const offerHtml = highlightSharedTerms(entry.offers); const wantHtml = highlightSharedTerms(entry.wants);
  const translate = document.getElementById("translate-toggle").checked;
  let translations = {};
  if (translate) {
    const texts = [...new Set([...entry.offers, ...entry.wants])];
    const res = await api("/translate", { method: "POST", body: JSON.stringify({ texts }) }); translations = res.translations || {};
  }
  document.getElementById("entry-offers").innerHTML = entry.offers.map((text, i) => `<div class="entry-item"><div class="en">${offerHtml[i]}</div>${translate && translations[text] ? `<div class="zh">${escapeHtml(translations[text])}</div>` : ""}</div>`).join("");
  document.getElementById("entry-wants").innerHTML = entry.wants.map((text, i) => `<div class="entry-item"><div class="en">${wantHtml[i]}</div>${translate && translations[text] ? `<div class="zh">${escapeHtml(translations[text])}</div>` : ""}</div>`).join("");
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
document.getElementById("translate-toggle").addEventListener("change", () => currentEntry && renderEntry(currentEntry).catch((error) => showToast(error.message, "error")));

async function labelCurrent(humanLabel) {
  if (!currentEntry || labelingBusy) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { setStatus(document.getElementById("label-progress"), "", ""); labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  labelingBusy = true;
  const yes = humanLabel === "yes"; const feedback = document.getElementById("label-feedback");
  document.getElementById("feedback-yes-icon").hidden = !yes; document.getElementById("feedback-no-icon").hidden = yes;
  feedback.classList.add("is-active");
  try {
    await api("/label", { method: "POST", body: JSON.stringify({ id: currentEntry.id, human_label: humanLabel, labeler, labeled_at: formatLocalISO(new Date()) }) });
    await new Promise((resolve) => setTimeout(resolve, 150));
    feedback.classList.remove("is-active");
    await loadNextEntry();
  } catch (error) {
    feedback.classList.remove("is-active"); showToast(error.message, "error");
  } finally { labelingBusy = false; }
}
document.getElementById("label-no").addEventListener("click", () => labelCurrent("no"));
document.getElementById("label-yes").addEventListener("click", () => labelCurrent("yes"));
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("panel-label").classList.contains("is-active") || labelingBusy) return;
  const tag = document.activeElement?.tagName;
  if (["INPUT","TEXTAREA","BUTTON","SELECT"].includes(tag)) return;
  if (event.key.toLowerCase() === "y" || event.key === "ArrowRight") labelCurrent("yes");
  if (event.key.toLowerCase() === "n" || event.key === "ArrowLeft") labelCurrent("no");
});

// ---------- EXPORT ----------
async function loadExportStats() {
  try {
    const { counts } = await api("/entries?status=all&limit=1");
    document.getElementById("export-stats").innerHTML = `
      <div><span class="n">${Number(counts.total || 0)}</span><span class="l">total</span></div>
      <div><span class="n">${Number(counts.yes || 0)}</span><span class="l">matches</span></div>
      <div><span class="n">${Number(counts.no || 0)}</span><span class="l">no match</span></div>`;
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("export-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget; const status = document.getElementById("export-status"); setBusy(button, true, "Preparing…"); setStatus(status, "Preparing JSON export…");
  try {
    const res = await fetch("/api/export", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { window.location.replace("/login.html"); return; }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Export failed (${res.status})`); }
    const blob = await res.blob(); const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/); const filename = match?.[1] || `mira_dataset_${new Date().toISOString().slice(0,10)}.json`;
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setStatus(status, `Downloaded ${filename}.`, "success"); showToast("Dataset export downloaded.", "success");
  } catch (error) { setStatus(status, error.message, "error"); showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});

// ---------- gentle interactivity ----------
document.querySelectorAll(".btn, .suggestion-chip, .preset-btn, .icon-btn").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    const rect = button.getBoundingClientRect(); const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height); ripple.style.cssText = `position:absolute;left:${event.clientX-rect.left-size/2}px;top:${event.clientY-rect.top-size/2}px;width:${size}px;height:${size}px;border-radius:50%;background:rgba(255,255,255,.18);transform:scale(0);pointer-events:none;animation:ripple .42s ease-out;`;
    button.appendChild(ripple); setTimeout(() => ripple.remove(), 450);
  });
});
const rippleStyle = document.createElement("style"); rippleStyle.textContent = "@keyframes ripple { to { transform: scale(1); opacity: 0; } }"; document.head.appendChild(rippleStyle);

// ---------- bootstrap ----------
(async function bootstrap() {
  moveTabIndicator(document.querySelector(".tab-btn.is-active"));
  await loadItems();
  await loadNextEntry();
})();
