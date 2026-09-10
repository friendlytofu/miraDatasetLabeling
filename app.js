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
  if (items.length === 2 && !isVerifiedUser()) { setStatus(document.getElementById("create-status"), "Verify a user above before saving a new pair so it is credited correctly.", "error"); return; }
  setBusy(button, true, "Saving…");
  try {
    const pair = items.length === 2 && items.some((item) => item.type === "offer") && items.some((item) => item.type === "want")
      ? { owner: getCreateMissionOwner(), offer_text: items.find((item) => item.type === "offer")?.text || "", want_text: items.find((item) => item.type === "want")?.text || "" }
      : null;
    await api("/items", { method: "POST", body: JSON.stringify({ items, ...(pair ? { creator_pair: pair } : {}) }) });
    setStatus(document.getElementById("create-status"), `Saved ${items.length} item${items.length > 1 ? "s" : ""} to the bank.`, "success");
    showToast("Item bank updated.", "success");
    phraseInput.value = ""; draftArea.hidden = true;
    await loadItems();
    await refreshCreateMission();
    await refreshQualityDashboard();
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

// ---------- item bank backup / restore ----------
const backupDownloadBtn = document.getElementById("backup-download-btn");
const backupUploadInput = document.getElementById("backup-upload-input");
const backupStatus = document.getElementById("backup-status");

backupDownloadBtn?.addEventListener("click", async () => {
  setBusy(backupDownloadBtn, true, "Preparing…");
  try {
    const { items } = await api("/items");
    if (!items.length) {
      setStatus(backupStatus, "Your item bank is empty — nothing to back up yet.", "error");
      return;
    }
    const payload = {
      kind: "mira-item-bank-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      count: items.length,
      items: items.map((item) => ({
        text: item.text,
        type: item.type,
        source_phrase: item.source_phrase || null,
        created_at: item.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = payload.exported_at.slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url; link.download = `mira-item-bank-${stamp}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    setStatus(backupStatus, `Downloaded ${items.length} item${items.length === 1 ? "" : "s"} to a backup file.`, "success");
    showToast("Item bank backup downloaded.", "success");
  } catch (error) {
    setStatus(backupStatus, `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  } finally { setBusy(backupDownloadBtn, false); }
});

backupUploadInput?.addEventListener("change", async () => {
  const file = backupUploadInput.files?.[0];
  backupUploadInput.value = ""; // allow re-selecting the same file again later
  if (!file) return;
  setStatus(backupStatus, "Reading backup file…");
  try {
    const raw = JSON.parse(await file.text());
    const incoming = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : null;
    if (!incoming) throw new Error("That file doesn't look like a Mira item bank backup.");

    const cleaned = incoming
      .map((item) => ({
        text: String(item?.text || "").trim(),
        type: item?.type === "offer" || item?.type === "want" ? item.type : null,
        source_phrase: item?.source_phrase || null,
        created_at: typeof item?.created_at === "string" ? item.created_at : null,
      }))
      .filter((item) => item.text && item.type);
    if (!cleaned.length) throw new Error("No valid offer/want items found in that file.");

    const { items: existing } = await api("/items");
    const existingKeys = new Set(existing.map((item) => `${item.type}::${item.text}`));
    const toRestore = cleaned.filter((item) => !existingKeys.has(`${item.type}::${item.text}`));
    const skipped = cleaned.length - toRestore.length;

    if (!toRestore.length) {
      setStatus(backupStatus, `Every item in that file (${cleaned.length}) is already in your bank — nothing to restore.`, "success");
      showToast("Bank already matches that backup.");
      return;
    }

    setStatus(backupStatus, `Restoring ${toRestore.length} item${toRestore.length === 1 ? "" : "s"}…`);
    await api("/items", { method: "POST", body: JSON.stringify({ items: toRestore }) });
    const skippedNote = skipped ? ` (${skipped} already in your bank were skipped)` : "";
    setStatus(backupStatus, `Restored ${toRestore.length} item${toRestore.length === 1 ? "" : "s"}${skippedNote}.`, "success");
    showToast("Item bank restored from file.", "success");
    await loadItems();
  } catch (error) {
    setStatus(backupStatus, `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  }
});

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

// ---------- USERS + BULLETIN BOARD ----------
const USER_KEY = "mira_active_user_v1";
const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
let activeUser = storedUser ? {...storedUser, verified:false} : null;
let usersCache = [];
function saveActiveUser() { localStorage.setItem(USER_KEY, JSON.stringify(activeUser || null)); }
function isVerifiedUser() { return !!(activeUser?.id && activeUser?.owner && activeUser?.verified === true); }
function getActiveUserOwner() { return isVerifiedUser() ? activeUser.owner : "default"; }
function getActiveUserName() { return isVerifiedUser() ? activeUser.name : "default"; }
function setUserStatus(message, kind = "") { const el=document.getElementById("user-status-line"); if (!el) return; el.textContent=message || ""; el.className=`status-line ${kind ? `is-${kind}` : ""}`; }
function renderUsers(users) {
  usersCache = users || [];
  const select = document.getElementById("user-select");
  if (!select) return;
  select.innerHTML = `<option value="">Select a user</option>` + usersCache.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
  if (activeUser?.id && usersCache.some(u => Number(u.id) === Number(activeUser.id))) select.value = String(activeUser.id);
  const verified = isVerifiedUser();
  document.getElementById("user-verified-pill").textContent = verified ? `✓ ${activeUser.name}` : "No user verified";
  document.getElementById("user-verified-pill").classList.toggle("is-verified", verified);
  document.getElementById("user-rename-btn").disabled = !verified;
  document.getElementById("user-code-btn").disabled = !verified;
  const labeler = document.getElementById("labeler-name");
  if (labeler) { labeler.value = verified ? activeUser.name : ""; labeler.readOnly = verified; labeler.placeholder = verified ? "Verified user" : "Verify a user above"; }
}
function renderBulletin(users) {
  const el=document.getElementById("bulletin-list");
  if (!users?.length) { el.innerHTML='<div class="bulletin-empty">No users yet — add the first contributor.</div>'; return; }
  el.innerHTML=users.map(u=>{
    const selected=Number(activeUser?.id)===Number(u.id);
    const points=Number(u.labels||0)+Number(u.pairs||0);
    const cm=u.active_creation_mission;
    const missionBits=cm?[`Create ${Math.min(cm.progress,cm.goal)}/${cm.goal}`]:[];
    return `<div class="bulletin-row ${selected?'is-current':''}"><div class="bulletin-rank">${u.rank}</div><div class="bulletin-avatar">${escapeHtml((u.name||"?").slice(0,1).toUpperCase())}</div><div class="bulletin-copy"><strong>${escapeHtml(u.name)}</strong><span>${Number(u.labels||0).toLocaleString()} labels · ${Number(u.pairs||0).toLocaleString()} pairs · ${Number(u.creation_missions||0)} creation missions</span>${missionBits.length?`<em>${missionBits.join(' · ')}</em>`:''}</div><div class="bulletin-score"><strong>${points.toLocaleString()}</strong><small>points</small></div></div>`;
  }).join('');
}
async function loadUsers() {
  try { const data=await api("/users"); renderUsers(data.users||[]); renderBulletin(data.users||[]); } catch(error) { showToast(error.message,"error"); }
}
async function verifySelectedUser() {
  const id=Number(document.getElementById("user-select").value); const code=document.getElementById("user-code").value.trim();
  if (!id) { setUserStatus("Select a user first.","error"); return; }
  if (!code) { setUserStatus("Enter the user code to verify.","error"); return; }
  try {
    const data=await api("/users",{method:"POST",body:JSON.stringify({action:"validate",id,code})});
    activeUser={...data.user,verified:true}; saveActiveUser(); switchMissionOwner(activeUser.owner); document.getElementById("user-code").value="";
    setUserStatus(`Verified as ${activeUser.name}. Your missions and progress now follow this account.`,"success");
    renderUsers(usersCache); await Promise.all([refreshCreateMission(),refreshQualityDashboard(),loadItems()]);
  } catch(error) { activeUser=null; saveActiveUser(); renderUsers(usersCache); setUserStatus(error.message,"error"); }
}
document.getElementById("user-select").addEventListener("change", () => {
  const id=Number(document.getElementById("user-select").value); const user=usersCache.find(u=>Number(u.id)===id);
  if (!user) { activeUser=null; saveActiveUser(); switchMissionOwner("default"); renderUsers(usersCache); return; }
  activeUser={id:user.id,name:user.name,owner:`user:${user.id}`,verified:false}; saveActiveUser(); switchMissionOwner(activeUser.owner); renderUsers(usersCache); setUserStatus(`Enter ${user.name}'s code to continue.`);
});
document.getElementById("user-verify-btn").addEventListener("click", verifySelectedUser);
document.getElementById("user-code").addEventListener("keydown", e=>{ if(e.key==='Enter'){e.preventDefault();verifySelectedUser();} });
document.getElementById("user-add-btn").addEventListener("click", async () => {
  const name=prompt("New user name:"); if(!name?.trim()) return; const code=prompt("Set a user code (at least 4 characters):"); if(!code?.trim()) return;
  try { const data=await api("/users",{method:"POST",body:JSON.stringify({action:"add",name:name.trim(),code:code.trim()})}); activeUser={...data.user,verified:true}; saveActiveUser(); switchMissionOwner(activeUser.owner); await loadUsers(); setUserStatus(`${activeUser.name} added and verified.` ,"success"); await Promise.all([refreshCreateMission(),refreshQualityDashboard()]); }
  catch(error){setUserStatus(error.message,"error");}
});
document.getElementById("user-rename-btn").addEventListener("click", async () => {
  if(!isVerifiedUser()) return; const name=prompt("Rename this user:",activeUser.name); if(!name?.trim()||name.trim()===activeUser.name) return;
  try { const data=await api("/users",{method:"POST",body:JSON.stringify({action:"rename",id:activeUser.id,name:name.trim()})}); activeUser.name=data.user.name; saveActiveUser(); await loadUsers(); setUserStatus(`User renamed to ${activeUser.name}. Existing labels stay attached to this user.`,"success"); await Promise.all([refreshCreateMission(),refreshQualityDashboard()]); }
  catch(error){setUserStatus(error.message,"error");}
});
document.getElementById("user-code-btn").addEventListener("click", async () => {
  if(!isVerifiedUser()) return; const code=prompt("Set a new user code (at least 4 characters):"); if(!code?.trim()) return;
  try { await api("/users",{method:"POST",body:JSON.stringify({action:"set_code",id:activeUser.id,code:code.trim()})}); setUserStatus("User code updated. Keep it private.","success"); }
  catch(error){setUserStatus(error.message,"error");}
});
document.getElementById("users-refresh-btn").addEventListener("click", loadUsers);

// Pair quality is a dataset-wide dashboard; it can optionally be narrowed to the verified user.
function renderQualityTrend(trend) {
  const el=document.getElementById("quality-trend-chart");
  if(!trend?.length){el.innerHTML='<div class="theme-empty">No quality snapshots yet.</div>';return;}
  const rows=trend.slice(-30), max=Math.max(1,...rows.map(r=>Number(r.duplicate_rate||0))), width=680,height=190,pad=28;
  const pts=rows.map((r,i)=>{const x=pad+(rows.length===1?(width-pad*2)/2:(i/(rows.length-1))*(width-pad*2));const y=height-pad-(Number(r.duplicate_rate||0)/max)*(height-pad*2);return [x,y];});
  const poly=pts.map(p=>p.join(',')).join(' ');
  const circles=pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.2"><title>${escapeHtml(new Date(rows[i].captured_at).toLocaleString())}: ${Number(rows[i].duplicate_rate||0)}% duplicate rate · ${Number(rows[i].total_pairs||0)} pairs · ${Number(rows[i].average_pair_words||0)} avg words</title></circle>`).join('');
  const labels=rows.length>1?[rows[0],rows[rows.length-1]].map((r,i)=>`<text x="${i?width-pad:pad}" y="${height-6}" text-anchor="${i?'end':'start'}">${escapeHtml(new Date(r.captured_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</text>`).join(''):'';
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Duplicate rate quality trend"><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="chart-axis"/><polyline points="${poly}" class="quality-line"/>${circles}${labels}</svg><div class="quality-chart-legend"><span><i></i>Duplicate rate</span><span>Latest: <strong>${Number(rows.at(-1).duplicate_rate||0)}%</strong></span></div>`;
}
function renderGlobalThemes(id,themes){renderPairThemeList(id,themes);}
async function refreshQualityDashboard(){
  try {
    const scope=document.getElementById("quality-scope-select")?.value||"all";
    const owner=scope==='active' && isVerifiedUser() ? `?owner=${encodeURIComponent(activeUser.owner)}` : '';
    const data=await api(`/creator-missions${owner}`); const q=data.quality||{};
    document.getElementById("global-quality-pairs").textContent=Number(q.unique_pairs||0).toLocaleString();
    document.getElementById("global-quality-duplicate").textContent=`${Number(q.duplicate_rate||0)}%`;
    document.getElementById("global-quality-duplicate-detail").textContent=`${Number(q.duplicates||0).toLocaleString()} duplicate attempts · ${Number(q.attempts||0).toLocaleString()} attempts`;
    document.getElementById("global-quality-length").textContent=`${Number(q.average_pair_words||0)} words`;
    document.getElementById("quality-chart-caption").textContent=scope==='all'?'all saved snapshots':`${activeUser?.name||'active user'} snapshots`;
    renderQualityTrend(data.trend||[]); renderGlobalThemes("global-offer-themes",q.offer_themes); renderGlobalThemes("global-want-themes",q.want_themes);
  } catch(error){showToast(error.message,"error");}
}
document.getElementById("quality-scope-select").addEventListener("change",refreshQualityDashboard);
document.getElementById("quality-refresh-btn").addEventListener("click",refreshQualityDashboard);

// ---------- CREATION MISSION ----------
const CREATE_MISSION_KEY = "mira_creation_mission_v1";
function missionStorageKey(base, owner) { return `${base}::${owner || "default"}`; }
function defaultCreateMission() { return { goal:25, flag:"✦", active:false, started_at:null, starting_pairs:0, owner:"default" }; }
let createMission = JSON.parse(localStorage.getItem(missionStorageKey(CREATE_MISSION_KEY, getCreateMissionOwner())) || "null") || defaultCreateMission();
let createMissionPresets = [];

function saveCreateMissionLocal() { createMission.owner = getCreateMissionOwner(); localStorage.setItem(missionStorageKey(CREATE_MISSION_KEY, createMission.owner), JSON.stringify(createMission)); }
function loadCreateMissionForOwner(owner) { createMission = JSON.parse(localStorage.getItem(missionStorageKey(CREATE_MISSION_KEY, owner)) || "null") || {...defaultCreateMission(), owner}; }

function getCreateMissionOwner() { return getActiveUserOwner(); }
function createMissionPercent(pairs) { return Math.min(100, Math.max(0, (pairs / Math.max(1, createMission.goal)) * 100)); }
function setCreateMissionFlag(flag) {
  createMission.flag = flag || "✦";
  saveCreateMissionLocal();
  document.getElementById("create-mission-flag-cloth").textContent = createMission.flag;
  document.querySelectorAll(".create-mission-flag-choice").forEach((b) => b.classList.toggle("is-active", b.dataset.flag === createMission.flag));
}
function renderCreateMissionPresets() {
  const el = document.getElementById("create-mission-preset-list");
  if (!createMissionPresets.length) { el.innerHTML = `<span class="mission-empty-inline">No presets yet — save a goal you like.</span>`; return; }
  el.innerHTML = createMissionPresets.map((p) => `<div class="mission-preset"><button class="mission-preset-load" type="button" data-create-preset-id="${p.id}">${escapeHtml(p.flag)} ${escapeHtml(p.name)} · ${p.goal}</button><button class="mission-preset-delete" type="button" aria-label="Delete ${escapeHtml(p.name)}" data-delete-create-preset-id="${p.id}">×</button></div>`).join("");
}
function renderCreateMissionHistory(history) {
  const el = document.getElementById("create-mission-history-list");
  if (!history?.length) { el.innerHTML = `<div class="mission-history-empty">No completed missions yet.</div>`; return; }
  el.innerHTML = history.slice(0, 20).map((h) => {
    const date = new Date(h.completed_at).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
    const time = new Date(h.completed_at).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
    return `<div class="mission-history-item"><span class="mission-history-flag">${escapeHtml(h.flag || "✦")}</span><div class="mission-history-copy"><strong>${Number(h.pairs_total || h.goal)} pairs · goal ${Number(h.goal)}</strong><span>${date} · ${time}</span></div><span class="mission-history-total">${Number(h.pairs_total || 0)} new</span></div>`;
  }).join("");
}
function renderPairThemeList(id, themes) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!themes?.length) { el.innerHTML = '<div class="theme-empty">No pairs yet.</div>'; return; }
  el.innerHTML = themes.map((t) => `<div class="theme-row"><div class="theme-row-copy"><div class="theme-row-label"><strong>${escapeHtml(t.theme)}</strong><span>${Number(t.count)} pairs</span></div><div class="theme-bar"><i style="width:${Math.min(100, Number(t.share || 0))}%"></i></div></div><span>${Number(t.share || 0)}%</span></div>`).join('');
}
function renderPairQuality(quality) {
  const q = quality || {};
  document.getElementById('quality-duplicate-rate').textContent = `${Number(q.duplicate_rate || 0).toFixed(Number(q.duplicate_rate || 0) % 1 ? 1 : 0)}%`;
  document.getElementById('quality-duplicate-detail').textContent = `${Number(q.duplicates || 0)} duplicate attempt${Number(q.duplicates || 0) === 1 ? '' : 's'}`;
  document.getElementById('quality-average-length').textContent = `${Number(q.average_pair_words || 0)} words`;
  document.getElementById('quality-unique-pairs').textContent = Number(q.unique_pairs || 0).toLocaleString();
  document.getElementById('quality-attempt-detail').textContent = `${Number(q.attempts || 0).toLocaleString()} save attempt${Number(q.attempts || 0) === 1 ? '' : 's'}`;
  renderPairThemeList('offer-theme-list', q.offer_themes);
  renderPairThemeList('want-theme-list', q.want_themes);
}

function updateCreateMission(pairTotal, history = null) {
  const goal = Math.max(1, Number(createMission.goal) || 25);
  const owner = getCreateMissionOwner();
  const pairs = createMission.active && createMission.owner === owner ? Math.max(0, Number(pairTotal) - Number(createMission.starting_pairs || 0)) : 0;
  const shown = Math.min(goal, pairs);
  const pct = createMissionPercent(shown);
  document.getElementById("create-mission-goal").value = goal;
  document.getElementById("create-mission-title").textContent = `Write ${goal} new pairs.`;
  document.getElementById("create-mission-progress-text").textContent = `${shown} / ${goal} pairs written`;
  document.getElementById("create-mission-remaining-text").textContent = `${Math.max(0, goal - shown)} to go`;
  document.getElementById("create-mission-progress-fill").style.width = `${pct}%`;
  document.getElementById("create-mission-node-write").classList.toggle("is-done", createMission.active && shown > 0);
  document.getElementById("create-mission-node-write").classList.toggle("is-active", !createMission.active);
  document.getElementById("create-mission-node-pair").classList.toggle("is-active", createMission.active && shown < goal);
  document.getElementById("create-mission-node-pair").classList.toggle("is-done", createMission.active && shown >= goal);
  document.getElementById("create-mission-node-goal").classList.toggle("is-active", shown >= goal);
  document.getElementById("create-mission-node-goal").classList.toggle("is-done", shown >= goal);
  document.getElementById("create-mission-line-one").style.width = `${createMission.active ? Math.min(100, pct) : 0}%`;
  document.getElementById("create-mission-line-two").style.width = `${shown >= goal ? 100 : 0}%`;
  const status = document.getElementById("create-mission-status");
  status.textContent = shown >= goal ? "Complete" : createMission.active ? "In progress" : "Ready";
  status.classList.toggle("is-complete", shown >= goal);
  if (history) renderCreateMissionHistory(history);
}

async function refreshCreateMission() {
  try {
    const owner = getCreateMissionOwner();
    const data = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
    createMissionPresets = data.presets || [];
    renderCreateMissionPresets();
    const total = Number(data.pairTotal || 0);
    if (data.active) {
      createMission.active = true; createMission.owner = owner; createMission.goal = Number(data.active.goal || createMission.goal || 25); createMission.flag = data.active.flag || createMission.flag; createMission.started_at = data.active.started_at; createMission.starting_pairs = Number(data.active.starting_pairs || 0); saveCreateMissionLocal();
      setCreateMissionFlag(createMission.flag);
    } else if (createMission.active && createMission.owner === owner) {
      createMission.active = false; createMission.started_at = null; createMission.starting_pairs = total; saveCreateMissionLocal();
    }
    if (createMission.owner !== owner) {
      createMission.active = false; createMission.started_at = null; createMission.starting_pairs = total; createMission.owner = owner; saveCreateMissionLocal();
    }
    if (createMission.active && total - Number(createMission.starting_pairs || 0) >= Number(createMission.goal || 25)) {
      const result = await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"complete", owner, goal:createMission.goal, flag:createMission.flag, started_at:createMission.started_at, starting_pairs:createMission.starting_pairs }) });
      createMission.active = false; createMission.started_at = null; createMission.starting_pairs = total; saveCreateMissionLocal();
      showToast(`Creation mission complete — ${result.pairs_total} new pairs logged.`, "success");
      const refreshed = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
      renderCreateMissionHistory(refreshed.history || []);
    } else renderCreateMissionHistory(data.history || []);
    updateCreateMission(total);
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("create-mission-goal").addEventListener("change", () => {
  const value = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  createMission.goal = value; saveCreateMissionLocal(); refreshCreateMission();
});
document.querySelectorAll(".create-mission-flag-choice").forEach((button) => button.addEventListener("click", () => setCreateMissionFlag(button.dataset.flag)));
document.getElementById("create-mission-run-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const owner = getCreateMissionOwner();
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  createMission.goal = goal;
  if (!isVerifiedUser()) { showToast("Verify a user before running an individual mission.","error"); return; }
  setBusy(button, true, "Launching…");
  try {
    const data = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
    const total = Number(data.pairTotal || 0);
    if (!createMission.active || createMission.owner !== owner) {
      const started = await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"start", owner, goal, flag:createMission.flag }) });
      createMission.active = true; createMission.owner = owner; createMission.started_at = started.mission.started_at; createMission.starting_pairs = Number(started.mission.starting_pairs || total); saveCreateMissionLocal();
    }
    updateCreateMission(total, data.history || []);
    await activateTab("create");
    document.getElementById("phrase-input")?.focus();
    showToast(`Creation mission started — write ${goal} distinct pairs.`, "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});
document.getElementById("create-mission-save-preset-btn").addEventListener("click", async () => {
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  const name = prompt("Name this creation mission preset:", `Create · ${goal}`);
  if (!name?.trim()) return;
  try { await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"preset", owner:getCreateMissionOwner(), name:name.trim(), goal, flag:createMission.flag }) }); await refreshCreateMission(); showToast("Creation mission preset saved.", "success"); }
  catch (error) { showToast(error.message, "error"); }
});
document.getElementById("create-mission-preset-list").addEventListener("click", async (event) => {
  const load = event.target.closest("[data-create-preset-id]");
  const del = event.target.closest("[data-delete-create-preset-id]");
  if (load) { const preset = createMissionPresets.find((p) => String(p.id) === load.dataset.createPresetId); if (preset) { createMission.goal = Number(preset.goal); createMission.owner = getCreateMissionOwner(); setCreateMissionFlag(preset.flag); saveCreateMissionLocal(); document.getElementById("create-mission-goal").value = createMission.goal; refreshCreateMission(); showToast(`${preset.name} loaded.`); } }
  if (del) { if (!confirm("Delete this creation mission preset?")) return; try { await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"delete_preset", owner:getCreateMissionOwner(), id:Number(del.dataset.deleteCreatePresetId) }) }); await refreshCreateMission(); } catch(error) { showToast(error.message,"error"); } }
});
document.getElementById("create-mission-refresh-history-btn").addEventListener("click", refreshCreateMission);
refreshCreateMission();

// ---------- MISSION OWNER ----------
function switchMissionOwner(owner) {
  loadCreateMissionForOwner(owner || "default");
}

// ---------- LABEL ----------
const HIGHLIGHT_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#ddd6fe", "#fed7aa"];
const labelerInput = document.getElementById("labeler-name");
labelerInput.value = isVerifiedUser() ? activeUser.name : "";
labelerInput.readOnly = isVerifiedUser();
labelerInput.addEventListener("input", () => { if (!isVerifiedUser()) { localStorage.setItem("mira_labeler_name", labelerInput.value); refreshCreateMission(); } });
let currentEntry = null;
let labelEntries = [];
let labelIndex = -1;
let labelingBusy = false;

function tokenize(text) {
  const stop = new Set(["i","a","an","the","to","for","with","and","of","on","in","my","me","want","need","can","help","someone","who","looking","someone"]);
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))];
}
function crossCategorySharedTokens(entry) {
  const offerTokens = new Set(entry.offers.flatMap(tokenize));
  const wantTokens = new Set(entry.wants.flatMap(tokenize));
  return [...offerTokens].filter((token) => wantTokens.has(token));
}
function highlightCrossCategory(texts, sharedTokens) {
  const colorFor = Object.fromEntries(sharedTokens.map((t, i) => [t, HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]]));
  return texts.map((text) => {
    const escaped = escapeHtml(text);
    if (!sharedTokens.length) return escaped;
    const pattern = new RegExp(`\\b(${sharedTokens.map((t) => t.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    return escaped.replace(pattern, (m) => `<mark style="background:${colorFor[m.toLowerCase()]}">${m}</mark>`);
  });
}

async function fetchLabelEntries() {
  const { entries, counts } = await api("/entries?status=all&limit=500");
  labelEntries = entries;
  document.getElementById("label-progress").textContent = `${Number(counts.unlabeled || 0)} unlabeled · ${Number(counts.total || 0)} total`;
  const done = Number(counts.total || 0) - Number(counts.unlabeled || 0);
  document.getElementById("progress-fill").style.width = counts.total ? `${(done / counts.total) * 100}%` : "0%";
  document.getElementById("metric-unlabeled").textContent = Number(counts.unlabeled || 0);
  return labelEntries;
}

function updateLabelNavigation() {
  document.getElementById("label-back-btn").disabled = labelIndex <= 0;
  document.getElementById("label-forward-btn").disabled = labelIndex < 0 || labelIndex >= labelEntries.length - 1;
  document.getElementById("label-reset-btn").disabled = !currentEntry;
  document.getElementById("label-delete-btn").disabled = !currentEntry;
  const state = currentEntry?.status === "labeled" ? `Labeled: ${currentEntry.human_label === "yes" ? "Match" : "No match"}` : "Unlabeled";
  document.getElementById("entry-state-label").textContent = state;
}

async function showLabelEntry(entry, index = labelEntries.findIndex((e) => e.id === entry?.id)) {
  if (!entry) return;
  currentEntry = entry;
  labelIndex = index;
  document.getElementById("label-empty").hidden = true;
  const card = document.getElementById("label-card"); card.hidden = false; card.classList.add("is-loading");
  document.getElementById("entry-index-label").textContent = `Entry #${entry.id} · ${labelIndex + 1}/${labelEntries.length}`;
  document.getElementById("entry-detail-label").textContent = entry.labeled_at ? `Last labeled ${new Date(entry.labeled_at).toLocaleString()} · ${entry.labeler || "unknown"}` : "Not labeled yet";
  await renderEntry(entry);
  updateLabelNavigation();
  requestAnimationFrame(() => card.classList.remove("is-loading"));
}

async function loadNextEntry() {
  try {
    await fetchLabelEntries();
    const firstUnlabeled = labelEntries.findIndex((entry) => entry.status === "unlabeled");
    if (firstUnlabeled < 0) {
      currentEntry = labelEntries[labelEntries.length - 1] || null;
      if (currentEntry) await showLabelEntry(currentEntry, labelEntries.length - 1);
      else { document.getElementById("label-card").hidden = true; document.getElementById("label-empty").hidden = false; }
      return;
    }
    await showLabelEntry(labelEntries[firstUnlabeled], firstUnlabeled);
  } catch (error) { showToast(error.message, "error"); }
}

async function renderEntry(entry) {
  const sharedTokens = crossCategorySharedTokens(entry);
  const offerHtml = highlightCrossCategory(entry.offers, sharedTokens);
  const wantHtml = highlightCrossCategory(entry.wants, sharedTokens);
  document.getElementById("entry-offers").innerHTML = entry.offers.map((text, i) => `<div class="entry-item"><div class="en">${offerHtml[i]}</div></div>`).join("");
  document.getElementById("entry-wants").innerHTML = entry.wants.map((text, i) => `<div class="entry-item"><div class="en">${wantHtml[i]}</div></div>`).join("");
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
document.getElementById("label-back-btn").addEventListener("click", async () => { if (labelIndex > 0) await showLabelEntry(labelEntries[labelIndex - 1], labelIndex - 1); });
document.getElementById("label-forward-btn").addEventListener("click", async () => { if (labelIndex < labelEntries.length - 1) await showLabelEntry(labelEntries[labelIndex + 1], labelIndex + 1); });

document.getElementById("label-reset-btn").addEventListener("click", async () => {
  if (!currentEntry || !confirm(`Reset Entry #${currentEntry.id} and return it to the unlabeled queue?`)) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  try {
    await api("/label", { method: "PUT", body: JSON.stringify({ id: currentEntry.id, labeler, acted_at: formatLocalISO(new Date()) }) });
    showToast(`Entry #${currentEntry.id} reset.`, "success");
    await loadNextEntry(); await loadLabelHistory(); 
  } catch (error) { showToast(error.message, "error"); }
});

document.getElementById("label-delete-btn").addEventListener("click", async () => {
  if (!currentEntry || !confirm(`Permanently delete Entry #${currentEntry.id}? This cannot be undone.`)) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  try {
    await api(`/label?id=${encodeURIComponent(currentEntry.id)}&labeler=${encodeURIComponent(labeler)}`, { method: "DELETE" });
    showToast(`Entry #${currentEntry.id} deleted.`, "success");
    await loadNextEntry(); await loadLabelHistory(); 
  } catch (error) { showToast(error.message, "error"); }
});

async function labelCurrent(humanLabel) {
  if (!currentEntry || labelingBusy) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  labelingBusy = true;
  const yes = humanLabel === "yes"; const feedback = document.getElementById("label-feedback");
  document.getElementById("feedback-yes-icon").hidden = !yes; document.getElementById("feedback-no-icon").hidden = yes; feedback.classList.add("is-active");
  try {
    await api("/label", { method: "POST", body: JSON.stringify({ id: currentEntry.id, human_label: humanLabel, labeler, labeled_at: formatLocalISO(new Date()) }) });
    await new Promise((resolve) => setTimeout(resolve, 150)); feedback.classList.remove("is-active");
    showToast(currentEntry.status === "labeled" ? `Entry #${currentEntry.id} updated.` : `Entry #${currentEntry.id} labeled.`, "success");
    await loadNextEntry(); await loadLabelHistory(); 
  } catch (error) { feedback.classList.remove("is-active"); showToast(error.message, "error"); }
  finally { labelingBusy = false; }
}
document.getElementById("label-no").addEventListener("click", () => labelCurrent("no"));
document.getElementById("label-yes").addEventListener("click", () => labelCurrent("yes"));
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("panel-label").classList.contains("is-active") || labelingBusy) return;
  const tag = document.activeElement?.tagName; if (["INPUT","TEXTAREA","BUTTON","SELECT"].includes(tag)) return;
  if (event.key.toLowerCase() === "y") labelCurrent("yes");
  if (event.key.toLowerCase() === "n") labelCurrent("no");
  if (event.key === "ArrowLeft" && labelIndex > 0) document.getElementById("label-back-btn").click();
  if (event.key === "ArrowRight" && labelIndex < labelEntries.length - 1) document.getElementById("label-forward-btn").click();
});

async function loadLabelHistory() {
  try {
    const { history } = await api("/history");
    const el = document.getElementById("label-history-list");
    if (!history?.length) { el.innerHTML = `<div class="history-empty">No labeling actions yet.</div>`; return; }
    el.innerHTML = history.map((h) => `<div class="history-row">
      <div class="history-icon">${h.action === "labeled" ? "✓" : h.action === "changed" ? "↻" : h.action === "reset" ? "↺" : "×"}</div>
      <div class="history-main"><strong>Entry #${h.entry_id}</strong><span>${escapeHtml(h.details || h.action)}</span></div>
      <div class="history-meta"><strong>${h.new_label ? (h.new_label === "yes" ? "Match" : "No match") : h.action}</strong><span>${escapeHtml(h.labeler || "Unknown")} · ${new Date(h.acted_at).toLocaleString()}</span></div>
    </div>`).join("");
  } catch (error) { showToast(error.message, "error"); }
}
document.getElementById("refresh-history-btn")?.addEventListener("click", loadLabelHistory);

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

// ---------- playful spinner micro-interaction ----------
(function () {
  const spinner = document.getElementById("fun-spinner");
  if (!spinner) return;
  const pulse = () => {
    spinner.classList.remove("is-spinning");
    void spinner.offsetWidth;
    spinner.classList.add("is-spinning");
  };
  spinner.addEventListener("animationend", () => spinner.classList.remove("is-spinning"));
  spinner.addEventListener("click", pulse);
})();

// ---------- bootstrap ----------
(async function bootstrap() {
  moveTabIndicator(document.querySelector(".tab-btn.is-active"));
  await loadItems();
  await loadNextEntry();
})();
