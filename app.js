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
    // Keep the same idempotency key while a save is being retried. If the network
    // drops after D1 commits, pressing Save again returns the original upload instead
    // of creating duplicate items or pair events. A changed draft gets a fresh key.
    const uploadPayload = JSON.stringify({ items, ...(pair ? { creator_pair: pair } : {}) });
    const payloadFingerprint = uploadPayload;
    let uploadKey = draftArea.dataset.uploadKey || "";
    if (!uploadKey || draftArea.dataset.uploadFingerprint !== payloadFingerprint) {
      uploadKey = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      draftArea.dataset.uploadKey = uploadKey;
      draftArea.dataset.uploadFingerprint = payloadFingerprint;
    }
    const saved = await api("/items", {
      method: "POST",
      headers: { "Idempotency-Key": uploadKey },
      body: uploadPayload
    });
    setStatus(document.getElementById("create-status"), `Saved ${items.length} item${items.length > 1 ? "s" : ""} to the bank.`, "success");
    showToast("Item bank updated.", "success");
    phraseInput.value = ""; draftArea.hidden = true;
    delete draftArea.dataset.uploadKey;
    delete draftArea.dataset.uploadFingerprint;
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
const USER_KEY = "mira_active_user_v2";
const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || localStorage.getItem("mira_active_user_v1") || "null");
let activeUser = storedUser ? {...storedUser, verified:false} : null;
let selectedUserId = activeUser?.id ? Number(activeUser.id) : null;
let usersCache = [];

function saveActiveUser() { localStorage.setItem(USER_KEY, JSON.stringify(activeUser || null)); }
function isVerifiedUser() { return !!(activeUser?.id && activeUser?.owner && activeUser?.verified === true); }
function getActiveUserOwner() { return isVerifiedUser() ? activeUser.owner : "default"; }
function getActiveUserName() { return isVerifiedUser() ? activeUser.name : "default"; }
function setUserStatus(message, kind = "") { const el=document.getElementById("user-status-line"); if (!el) return; el.textContent=message || ""; el.className=`status-line ${kind ? `is-${kind}` : ""}`; }

function setPasswordVisibility(inputId, buttonId) {
  const input=document.getElementById(inputId), button=document.getElementById(buttonId);
  if(!input || !button) return;
  button.addEventListener("click",()=>{
    const visible=input.type === "text";
    input.type=visible ? "password" : "text";
    button.textContent=visible ? "Show" : "Hide";
    button.setAttribute("aria-label", visible ? "Show user code" : "Hide user code");
  });
}
setPasswordVisibility("user-code","user-code-toggle");
setPasswordVisibility("new-user-code","new-user-code-toggle");

function renderUsers(users) {
  usersCache = users || [];
  const directory=document.getElementById("user-directory");
  const count=document.getElementById("user-directory-count");
  if(count) count.textContent=`${usersCache.length} user${usersCache.length===1?'':'s'}`;
  if(!directory) return;
  if(!usersCache.length){
    directory.innerHTML='<div class="user-directory-empty">No users yet. Add the first team member to get started.</div>';
  } else {
    directory.innerHTML=usersCache.map(u=>{
      const selected=Number(selectedUserId)===Number(u.id);
      const verified=isVerifiedUser() && Number(activeUser.id)===Number(u.id);
      const initial=escapeHtml((u.name||"?").slice(0,1).toUpperCase());
      return `<button type="button" class="user-person ${selected?'is-selected':''} ${verified?'is-verified':''}" data-user-id="${Number(u.id)}" aria-pressed="${selected?'true':'false'}">
        <span class="user-person-avatar">${initial}</span>
        <span class="user-person-main"><strong>${escapeHtml(u.name)}</strong><small>${Number(u.pairs||0).toLocaleString()} pairs · ${Number(u.labels||0).toLocaleString()} labels</small></span>
        <span class="user-person-action">${verified?'✓ Signed in':selected?'Enter code →':'Sign in →'}</span>
      </button>`;
    }).join('');
  }
  directory.querySelectorAll("[data-user-id]").forEach(btn=>btn.addEventListener("click",()=>selectUser(Number(btn.dataset.userId))));

  const pill=document.getElementById("user-verified-pill");
  if(pill){ pill.textContent=isVerifiedUser()?`✓ ${activeUser.name}`:"No user signed in"; pill.classList.toggle("is-verified",isVerifiedUser()); }
  const signin=document.getElementById("user-signin-panel");
  const management=document.getElementById("user-management");
  if(signin) signin.hidden=isVerifiedUser() || !selectedUserId;
  if(management) management.hidden=!isVerifiedUser();
  if(selectedUserId){
    const selected=usersCache.find(u=>Number(u.id)===Number(selectedUserId));
    const name=document.getElementById("selected-user-name");
    if(name) name.textContent=selected?.name || activeUser?.name || "—";
  }
}

function renderBulletin(users) {
  const el=document.getElementById("bulletin-list");
  if(!el) return;
  if(!users?.length){ el.innerHTML='<div class="bulletin-empty">No users yet — add the first contributor.</div>'; return; }
  el.innerHTML=users.map(u=>{
    const selected=Number(activeUser?.id)===Number(u.id);
    const points=Number(u.labels||0)+Number(u.pairs||0);
    const cm=u.active_creation_mission;
    const missionBits=cm?[`Create ${Math.min(cm.progress,cm.goal)}/${cm.goal}`]:[];
    return `<div class="bulletin-row ${selected?'is-current':''}"><div class="bulletin-rank">${u.rank}</div><div class="bulletin-avatar">${escapeHtml((u.name||"?").slice(0,1).toUpperCase())}</div><div class="bulletin-copy"><strong>${escapeHtml(u.name)}</strong><span>${Number(u.labels||0).toLocaleString()} labels · ${Number(u.pairs||0).toLocaleString()} pairs · ${Number(u.creation_missions||0)} creation missions</span>${missionBits.length?`<em>${missionBits.join(' · ')}</em>`:''}</div><div class="bulletin-score"><strong>${points.toLocaleString()}</strong><small>points</small></div></div>`;
  }).join('');
}

async function loadUsers() {
  try { const data=await api("/users"); renderUsers(data.users||[]); renderBulletin(data.users||[]); } catch(error) { showToast(error.message,"error"); setUserStatus("Could not load team members. Try refresh.","error"); }
}

function selectUser(id) {
  const user=usersCache.find(u=>Number(u.id)===Number(id));
  if(!user) return;
  selectedUserId=Number(user.id);
  activeUser={id:user.id,name:user.name,owner:`user:${user.id}`,verified:false};
  saveActiveUser();
  switchMissionOwner(activeUser.owner);
  const code=document.getElementById("user-code"); if(code){code.value=""; code.focus();}
  setUserStatus(`Enter ${user.name}'s private code to sign in.`);
  renderUsers(usersCache);
}

async function verifySelectedUser() {
  const id=Number(selectedUserId); const code=document.getElementById("user-code")?.value.trim();
  if(!id){setUserStatus("Choose a team member first.","error");return;}
  if(!code){setUserStatus("Enter the private code to sign in.","error");document.getElementById("user-code")?.focus();return;}
  const button=document.getElementById("user-verify-btn"); setBusy(button,true,"Signing in…");
  try {
    const data=await api("/users",{method:"POST",body:JSON.stringify({action:"validate",id,code})});
    selectedUserId=Number(data.user.id); activeUser={...data.user,verified:true}; saveActiveUser(); switchMissionOwner(activeUser.owner);
    document.getElementById("user-code").value="";
    setUserStatus(`Signed in as ${activeUser.name}. Your work now follows this account.` ,"success");
    renderUsers(usersCache); await Promise.all([refreshCreateMission(),refreshQualityDashboard(),loadItems()]);
  } catch(error) {
    setUserStatus(error.message || "That code is not valid.","error");
    document.getElementById("user-code")?.focus();
  } finally { setBusy(button,false); }
}

document.getElementById("user-verify-btn")?.addEventListener("click", verifySelectedUser);
document.getElementById("user-code")?.addEventListener("keydown", e=>{if(e.key==='Enter'){e.preventDefault();verifySelectedUser();}});
document.getElementById("user-switch-btn")?.addEventListener("click",()=>{
  activeUser=null; selectedUserId=null; saveActiveUser(); switchMissionOwner("default"); renderUsers(usersCache); setUserStatus("Choose another team member to sign in.");
});

document.getElementById("user-add-btn")?.addEventListener("click",()=>{
  const panel=document.getElementById("user-add-panel");
  if(panel) panel.hidden=false;
  document.getElementById("new-user-name")?.focus();
});
document.getElementById("user-add-cancel")?.addEventListener("click",()=>{
  const panel=document.getElementById("user-add-panel"); if(panel) panel.hidden=true;
  document.getElementById("new-user-name").value=""; document.getElementById("new-user-code").value="";
});

document.getElementById("user-create-btn")?.addEventListener("click",async()=>{
  const name=document.getElementById("new-user-name")?.value.trim(); const code=document.getElementById("new-user-code")?.value.trim();
  if(!name){setUserStatus("Enter a name for the new user.","error");document.getElementById("new-user-name")?.focus();return;}
  if(code.length<4){setUserStatus("Use a private code with at least 4 characters.","error");document.getElementById("new-user-code")?.focus();return;}
  const button=document.getElementById("user-create-btn"); setBusy(button,true,"Creating…");
  try {
    const data=await api("/users",{method:"POST",body:JSON.stringify({action:"add",name,code})});
    activeUser={...data.user,verified:true}; selectedUserId=Number(data.user.id); saveActiveUser(); switchMissionOwner(activeUser.owner);
    document.getElementById("new-user-name").value=""; document.getElementById("new-user-code").value=""; document.getElementById("user-add-panel").hidden=true;
    await loadUsers(); setUserStatus(`${activeUser.name} created and signed in.` ,"success"); await Promise.all([refreshCreateMission(),refreshQualityDashboard(),loadItems()]);
  } catch(error){setUserStatus(error.message,"error");} finally {setBusy(button,false);}
});

async function renameActiveUser() {
  if(!isVerifiedUser()) return;
  const name=prompt("Rename this user:",activeUser.name);
  if(!name?.trim()||name.trim()===activeUser.name) return;
  try { const data=await api("/users",{method:"POST",body:JSON.stringify({action:"rename",id:activeUser.id,name:name.trim()})}); activeUser.name=data.user.name; saveActiveUser(); await loadUsers(); setUserStatus(`User renamed to ${activeUser.name}. Existing work stays attached to this account.` ,"success"); await Promise.all([refreshCreateMission(),refreshQualityDashboard()]); }
  catch(error){setUserStatus(error.message,"error");}
}
document.getElementById("user-rename-btn")?.addEventListener("click",renameActiveUser);
document.getElementById("user-code-btn")?.addEventListener("click",async()=>{
  if(!isVerifiedUser()) return; const code=prompt("Set a new user code (at least 4 characters):"); if(!code?.trim()) return;
  try { await api("/users",{method:"POST",body:JSON.stringify({action:"set_code",id:activeUser.id,code:code.trim()})}); setUserStatus("User code updated. Keep it private.","success"); }
  catch(error){setUserStatus(error.message,"error");}
});
document.getElementById("users-refresh-btn")?.addEventListener("click", loadUsers);

// Pair quality is a dataset-wide dashboard; it can optionally be narrowed to the verified user.
function renderQualityTrend(quality){
  const el=document.getElementById("quality-trend-chart");
  if(!el) return;
  const q=quality||{};
  const pairs=Number(q.current_pairs ?? q.unique_pairs ?? 0);
  const duplicates=Number(q.duplicates||0);
  const avg=Number(q.average_pair_words||0);
  el.innerHTML=`<div class="quality-current-grid"><div><strong>${pairs.toLocaleString()}</strong><span>current pairs checked</span></div><div><strong>${duplicates.toLocaleString()}</strong><span>repeated / near-duplicate pairs</span></div><div><strong>${avg} words</strong><span>average offer + want</span></div></div><div class="quality-current-note">Re-examined ${q.assessed_at ? escapeHtml(new Date(q.assessed_at).toLocaleString()) : 'just now'}. This assessment uses only distinct current offer + want pairs, collapsing exact repeats and tiny copy-edit variants. Label history, save attempts, and old snapshots are excluded.</div>`;
}

function clearQualityAssessment(){
  document.getElementById("global-quality-pairs").textContent="—";
  document.getElementById("global-quality-duplicate").textContent="—";
  document.getElementById("global-quality-duplicate-detail").textContent="assessment cleared";
  document.getElementById("global-quality-length").textContent="—";
  document.getElementById("quality-chart-caption").textContent="not examined yet";
  const chart=document.getElementById("quality-trend-chart");
  if(chart) chart.innerHTML='<div class="theme-empty">Re-examine the current pairs to run a fresh check.</div>';
  const offer=document.getElementById("global-offer-themes");
  const want=document.getElementById("global-want-themes");
  if(offer) offer.innerHTML='<div class="theme-empty">No assessment yet.</div>';
  if(want) want.innerHTML='<div class="theme-empty">No assessment yet.</div>';
}

function renderGlobalThemes(id,themes){renderPairThemeList(id,themes);}
async function refreshQualityDashboard(){
  const button=document.getElementById("quality-refresh-btn");
  try {
    const scope=document.getElementById("quality-scope-select")?.value||"all";
    const activeOwner=scope==='active' && isVerifiedUser() ? activeUser.owner : null;
    setBusy(button,true,"Re-examining…");
    const data=await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"analyze_quality", ...(activeOwner ? { owner: activeOwner } : {}) }) });
    const q=data.quality||{};
    document.getElementById("global-quality-pairs").textContent=Number(q.current_pairs ?? q.unique_pairs ?? 0).toLocaleString();
    document.getElementById("global-quality-duplicate").textContent=`${Number(q.duplicate_rate||0)}%`;
    document.getElementById("global-quality-duplicate-detail").textContent=`${Number(q.duplicates||0).toLocaleString()} repeated or near-duplicate record${Number(q.duplicates||0)===1?'':'s'} in current bank`;
    document.getElementById("global-quality-length").textContent=`${Number(q.average_pair_words||0)} words`;
    document.getElementById("quality-chart-caption").textContent=scope==='all'?'current bank':`${activeUser?.name||'active user'} current bank`;
    renderQualityTrend(q); renderGlobalThemes("global-offer-themes",q.offer_themes); renderGlobalThemes("global-want-themes",q.want_themes);
  } catch(error){showToast(error.message,"error");}
  finally { setBusy(button,false); }
}
document.getElementById("quality-scope-select").addEventListener("change",refreshQualityDashboard);
document.getElementById("quality-refresh-btn").addEventListener("click",refreshQualityDashboard);
document.getElementById("quality-clear-btn")?.addEventListener("click",clearQualityAssessment);

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
  const offersEdit = document.getElementById("entry-offers-edit");
  const wantsEdit = document.getElementById("entry-wants-edit");
  if (offersEdit) offersEdit.value = (entry.offers || []).join("\n");
  if (wantsEdit) wantsEdit.value = (entry.wants || []).join("\n");
  const editStatus = document.getElementById("entry-edit-status");
  if (editStatus) editStatus.textContent = "";
  const sharedTokens = crossCategorySharedTokens(entry);
  const offerHtml = highlightCrossCategory(entry.offers, sharedTokens);
  const wantHtml = highlightCrossCategory(entry.wants, sharedTokens);
  document.getElementById("entry-offers").innerHTML = entry.offers.map((text, i) => `<div class="entry-item"><div class="en">${offerHtml[i]}</div></div>`).join("");
  document.getElementById("entry-wants").innerHTML = entry.wants.map((text, i) => `<div class="entry-item"><div class="en">${wantHtml[i]}</div></div>`).join("");
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
document.getElementById("label-back-btn").addEventListener("click", async () => { if (labelIndex > 0) await showLabelEntry(labelEntries[labelIndex - 1], labelIndex - 1); });
document.getElementById("label-forward-btn").addEventListener("click", async () => { if (labelIndex < labelEntries.length - 1) await showLabelEntry(labelEntries[labelIndex + 1], labelIndex + 1); });


document.getElementById("save-entry-edit-btn")?.addEventListener("click", async (event) => {
  if (!currentEntry) return;
  const offers = document.getElementById("entry-offers-edit").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const wants = document.getElementById("entry-wants-edit").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const status = document.getElementById("entry-edit-status");
  if (!offers.length || !wants.length) { setStatus(status, "Keep at least one offer and one want.", "error"); return; }
  setBusy(event.currentTarget, true, "Saving…");
  setStatus(status, "Saving task edits…");
  try {
    const updated = await api("/entries", { method:"PUT", body:JSON.stringify({ id:currentEntry.id, offers, wants }) });
    currentEntry = { ...currentEntry, ...updated };
    const at = labelEntries.findIndex(e => e.id === currentEntry.id);
    if (at >= 0) labelEntries[at] = { ...labelEntries[at], ...updated };
    await renderEntry(currentEntry);
    setStatus(status, "Saved. The edited text will be used by the next labeled export.", "success");
    await loadExportStats();
    showToast(`Entry #${currentEntry.id} updated.`, "success");
  } catch (error) { setStatus(status, error.message, "error"); showToast(error.message, "error"); }
  finally { setBusy(event.currentTarget, false); }
});

document.getElementById("reset-all-labels-btn")?.addEventListener("click", async (event) => {
  if (!confirm("Reset ALL labels? All labeling decisions and label history will be cleared, but the current labeling tasks and their offer/want text will remain.")) return;
  setBusy(event.currentTarget, true, "Resetting…");
  try {
    await api("/entries?action=reset_labels", { method:"DELETE" });
    selectedHistoryIds.clear();
    await loadNextEntry(); await loadLabelHistory(); await loadExportStats();
    showToast("All labels reset. Tasks remain ready for a fresh review.", "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(event.currentTarget, false); }
});

document.getElementById("delete-all-tasks-btn")?.addEventListener("click", async (event) => {
  if (!confirm("DELETE ALL CURRENT LABELING TASKS? This removes every generated labeling task and its label history. Your source items, users, and creation-pair data are preserved. This cannot be undone.")) return;
  if (!confirm("Final check: permanently clear the entire labeling queue?")) return;
  setBusy(event.currentTarget, true, "Clearing…");
  try {
    const result = await api("/entries?action=clear", { method:"DELETE" });
    selectedHistoryIds.clear(); currentEntry = null; labelEntries = []; labelIndex = -1;
    await loadNextEntry(); await loadLabelHistory(); await loadExportStats();
    showToast(`Cleared ${Number(result.deleted_entries || 0)} labeling tasks.`, "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(event.currentTarget, false); }
});

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

let labelHistory = [];
let selectedHistoryIds = new Set();

function updateHistorySelectionStatus() {
  const status = document.getElementById("history-selection-status");
  if (!status) return;
  status.textContent = `${selectedHistoryIds.size} selected`;
}

function filteredLabelHistory() {
  const action = document.getElementById("history-filter-action")?.value || "all";
  const label = document.getElementById("history-filter-label")?.value || "all";
  return labelHistory.filter((h) => {
    if (action !== "all" && h.action !== action) return false;
    if (label !== "all" && h.new_label !== label) return false;
    return true;
  });
}

function renderLabelHistory() {
  const el = document.getElementById("label-history-list");
  if (!el) return;
  const history = filteredLabelHistory();
  if (!history.length) {
    el.innerHTML = `<div class="history-empty">No history matches these filters.</div>`;
    updateHistorySelectionStatus();
    return;
  }
  el.innerHTML = history.map((h) => {
    const selected = selectedHistoryIds.has(Number(h.id));
    const icon = h.action === "labeled" ? "✓" : h.action === "changed" ? "↻" : h.action === "reset" ? "↺" : "×";
    const labelText = h.new_label ? (h.new_label === "yes" ? "Match" : "No match") : h.action;
    return `<label class="history-row ${selected ? "is-selected" : ""}">
      <input class="history-row-check" type="checkbox" data-history-id="${Number(h.id)}" ${selected ? "checked" : ""} aria-label="Select history entry ${Number(h.id)}" />
      <div class="history-icon">${icon}</div>
      <div class="history-main"><strong>Entry #${h.entry_id}</strong><span>${escapeHtml(h.details || h.action)}</span></div>
      <div class="history-meta"><strong>${labelText}</strong><span>${escapeHtml(h.labeler || "Unknown")} · ${new Date(h.acted_at).toLocaleString()}</span></div>
    </label>`;
  }).join("");
  el.querySelectorAll(".history-row-check").forEach((input) => input.addEventListener("change", () => {
    const id = Number(input.dataset.historyId);
    if (input.checked) selectedHistoryIds.add(id); else selectedHistoryIds.delete(id);
    input.closest(".history-row")?.classList.toggle("is-selected", input.checked);
    updateHistorySelectionStatus();
    syncHistorySelectAll();
  }));
  updateHistorySelectionStatus();
  syncHistorySelectAll();
}

function syncHistorySelectAll() {
  const box = document.getElementById("history-select-all");
  if (!box) return;
  const visible = filteredLabelHistory();
  const visibleSelected = visible.filter((h) => selectedHistoryIds.has(Number(h.id))).length;
  box.checked = visible.length > 0 && visibleSelected === visible.length;
  box.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
}

async function loadLabelHistory() {
  try {
    const { history } = await api("/history?limit=1000");
    labelHistory = history || [];
    const valid = new Set(labelHistory.map((h) => Number(h.id)));
    selectedHistoryIds = new Set([...selectedHistoryIds].filter((id) => valid.has(id)));
    renderLabelHistory();
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("refresh-history-btn")?.addEventListener("click", loadLabelHistory);
document.getElementById("history-filter-action")?.addEventListener("change", renderLabelHistory);
document.getElementById("history-filter-label")?.addEventListener("change", renderLabelHistory);
document.getElementById("history-select-all")?.addEventListener("change", (event) => {
  const visible = filteredLabelHistory();
  visible.forEach((h) => {
    const id = Number(h.id);
    if (event.target.checked) selectedHistoryIds.add(id); else selectedHistoryIds.delete(id);
  });
  renderLabelHistory();
});

document.getElementById("history-export-selected-btn")?.addEventListener("click", async (event) => {
  const ids = [...selectedHistoryIds];
  if (!ids.length) { showToast("Select at least one history record to export.", "error"); return; }
  const button = event.currentTarget;
  setBusy(button, true, "Preparing…");
  try {
    const res = await fetch(`/api/export?history_ids=${encodeURIComponent(ids.join(","))}`, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { window.location.replace("/login.html"); return; }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Export failed (${res.status})`); }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `mira_selected_${new Date().toISOString().slice(0,10)}.jsonl`;
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    showToast(`Exported ${filename}.`, "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});

document.getElementById("history-delete-selected-btn")?.addEventListener("click", async (event) => {
  const ids = [...selectedHistoryIds];
  if (!ids.length) { showToast("Select history records to delete.", "error"); return; }
  if (!confirm(`Unlink and delete ${ids.length} selected label history record${ids.length === 1 ? "" : "s"}? The linked activities will return to the unlabeled queue and will no longer appear in the labeled export.`)) return;
  const button = event.currentTarget;
  setBusy(button, true, "Deleting…");
  try {
    await api("/history", { method: "DELETE", body: JSON.stringify({ ids }) });
    selectedHistoryIds.clear();
    await loadLabelHistory();
    showToast(`Unlinked ${ids.length} history record${ids.length === 1 ? "" : "s"}; linked activities are back in the labeling queue.`, "success");
    await loadExportStats();
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
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

async function downloadExport(urlPath, button, status) {
  setBusy(button, true, "Preparing…");
  setStatus(status, "Preparing JSON export…");
  try {
    const res = await fetch(urlPath, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { window.location.replace("/login.html"); return; }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Export failed (${res.status})`); }
    const blob = await res.blob(); const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/); const filename = match?.[1] || `mira_dataset_${new Date().toISOString().slice(0,10)}.jsonl`;
    const blobUrl = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = blobUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(blobUrl);
    setStatus(status, `Downloaded ${filename}.`, "success"); showToast("Dataset export downloaded.", "success");
  } catch (error) { setStatus(status, error.message, "error"); showToast(error.message, "error"); }
  finally { setBusy(button, false); }
}

document.getElementById("export-btn").addEventListener("click", (event) => downloadExport("/api/export", event.currentTarget, document.getElementById("export-status")));
document.getElementById("export-history-btn")?.addEventListener("click", () => {
  const tab = document.querySelector('.tab-btn[data-tab="label"]');
  if (tab) tab.click();
  setTimeout(() => document.getElementById("label-history-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
});


// ---------- EXPORT EDITOR ----------
const exportEditor = document.getElementById("export-editor");
const exportEditorStatus = document.getElementById("export-editor-status");

function parseExportText(text) {
  const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error("The export is empty.");
  const rows = lines.map((line, i) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`Line ${i + 1} is not valid JSON.`); }
    if (!Array.isArray(row.offers) || !row.offers.length) throw new Error(`Line ${i + 1}: offers must be a non-empty array.`);
    if (!Array.isArray(row.wants) || !row.wants.length) throw new Error(`Line ${i + 1}: wants must be a non-empty array.`);
    if (row.human_label !== "yes" && row.human_label !== "no") throw new Error(`Line ${i + 1}: human_label must be yes or no.`);
    if (row.labeler != null && typeof row.labeler !== "string") throw new Error(`Line ${i + 1}: labeler must be text.`);
    return row;
  });
  return rows;
}
function setExportEditorStatus(text, kind="") { if (exportEditorStatus) setStatus(exportEditorStatus, text, kind); }
async function loadExportEditor() {
  const button = document.getElementById("load-export-editor-btn");
  setBusy(button, true, "Loading…"); setExportEditorStatus("Loading current labeled export…");
  try {
    const res = await fetch("/api/export", { credentials:"same-origin", cache:"no-store" });
    if (!res.ok) { const data = await res.json().catch(()=>({})); throw new Error(data.error || "No labeled export is available yet."); }
    exportEditor.value = await res.text();
    setExportEditorStatus("Loaded. You can edit the JSONL below, then validate it.", "success");
  } catch (error) { setExportEditorStatus(error.message, "error"); }
  finally { setBusy(button, false); }
}
document.getElementById("load-export-editor-btn")?.addEventListener("click", loadExportEditor);
document.getElementById("export-file-input")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try { exportEditor.value = await file.text(); setExportEditorStatus(`Loaded ${file.name}. Validate before downloading.`, "success"); }
  catch (error) { setExportEditorStatus(error.message, "error"); }
  event.target.value = "";
});
document.getElementById("validate-export-btn")?.addEventListener("click", () => {
  try { const rows = parseExportText(exportEditor.value); setExportEditorStatus(`Valid JSONL · ${rows.length} records ready to download.`, "success"); }
  catch (error) { setExportEditorStatus(error.message, "error"); }
});
document.getElementById("download-edited-export-btn")?.addEventListener("click", (event) => {
  try {
    const rows = parseExportText(exportEditor.value).map((row, i) => ({ ...row, id:i }));
    const content = rows.map(row => JSON.stringify(row)).join("\\n") + "\\n";
    const blob = new Blob([content], { type:"application/jsonl;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href=url; link.download=`mira_edited_dataset_${new Date().toISOString().slice(0,10)}.jsonl`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setExportEditorStatus(`Downloaded edited JSONL · ${rows.length} records.`, "success"); showToast("Edited export downloaded.", "success");
  } catch (error) { setExportEditorStatus(error.message, "error"); }
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
  await loadUsers();
  await loadNextEntry();
})();
