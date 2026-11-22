// Distant Intention Study · app (step 3: the Sunday Telepathy Event)
const cfg = window.DI_CONFIG || {};
const $app = document.getElementById("app");

// ---------- small helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
function showError(msg) {
  let n = $app.querySelector(".notice.err");
  if (!n) { n = document.createElement("div"); n.className = "notice err"; n.setAttribute("role", "alert"); $app.appendChild(n); }
  n.textContent = msg; n.scrollIntoView({ behavior: "smooth", block: "center" });
}
function friendly(err) {
  const m = (err && (err.message || err.error_description)) || String(err || "");
  if (/birthdates_dob_check/.test(m)) return "The study is for adults: please check your date of birth.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/Token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return "That code didn't work. Check it, or ask for a new one.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the study right now. Check your connection and try again.";
  return m || "Something went wrong. Please try again.";
}
function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Please wait…"; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// ---------- config check ----------
if (!window.supabase || !cfg.supabaseUrl || cfg.supabaseUrl.startsWith("PASTE")) {
  $app.innerHTML = `<h2>Almost <em>ready</em></h2><p class="muted">This copy of the app hasn't been connected to its database yet. Add the Supabase project URL and key to <b>config.js</b>.</p>`;
  throw new Error("Missing config");
}
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ---------- vocabulary ----------
const RELS = [
  ["identical_twin", "Identical twin"], ["non_identical_twin", "Non-identical twin"], ["sibling", "Brother or sister"],
  ["cousin", "Cousin"], ["parent", "Parent"], ["child", "Child"], ["grandparent", "Grandparent"], ["grandchild", "Grandchild"],
  ["aunt_uncle", "Aunt or uncle"], ["niece_nephew", "Niece or nephew"], ["partner", "Partner"],
  ["close_friend", "Close friend"], ["friend", "Friend"], ["colleague", "Colleague"], ["other", "Other"]
];
const relLabel = r => (RELS.find(x => x[0] === r) || [r, r])[1];
const isTwin = r => r === "identical_twin" || r === "non_identical_twin";
const COUNTRIES = ["United Kingdom", "Ireland", "United States", "Canada", "Australia", "New Zealand", "India", "South Africa",
  "Germany", "France", "Spain", "Italy", "Netherlands", "Sweden", "Norway", "Denmark", "Poland", "Portugal", "Brazil", "Mexico", "Japan", "Other"];
const STEPS = ["dob", "place", "belief", "twin", "experience", "invite", "animals", "consent"];

// ---------- state ----------
const S = { screen: "loading", user: null, profile: null, dob: null, draft: { animals: {} }, conns: [], email: "",
  inv: { rel: "", nick: "", last: null }, redeem: null, confirm: null, delStep: 0 };

// A join link (?join=CODE) is remembered until the person has signed up.
(function rememberJoin() {
  const p = new URLSearchParams(location.search); const j = p.get("join");
  if (j) { try { localStorage.setItem("di-join", j.toUpperCase()); } catch (_) {} history.replaceState(null, "", location.pathname); }
})();
const pendingJoin = () => { try { return localStorage.getItem("di-join"); } catch (_) { return null; } };
const clearJoin = () => { try { localStorage.removeItem("di-join"); } catch (_) {} };
const inviteUrl = code => location.origin + location.pathname + "?join=" + code;

// ---------- data ----------
async function loadProfile() {
  const uid = S.user.id;
  const [{ data: p, error: e1 }, { data: d, error: e2 }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.from("birthdates").select("dob").eq("user_id", uid).maybeSingle()
  ]);
  if (e1 || e2) throw (e1 || e2);
  S.profile = p; S.dob = d ? d.dob : null;
  S.draft = { animals: {}, ...(p || {}) };
}
async function saveProfile(fields) {
  const { data, error } = await sb.from("profiles").upsert({ id: S.user.id, ...fields }).select().single();
  if (error) throw error; S.profile = data; Object.assign(S.draft, fields);
}
async function loadConns() {
  const { data, error } = await sb.rpc("my_connections");
  if (error) throw error; S.conns = data || [];
}

function nextScreenAfterSignIn() {
  const p = S.profile;
  if (!p || !p.adult_confirmed) return "age";
  if (!S.dob) return "dob";
  if (!p.country || !p.town) return "place";
  if (!p.belief) return "belief";
  if (!p.onboarded_at) return p.twin_status ? "consent" : "twin";
  return pendingJoin() ? "entercode" : "home";
}

// ---------- shared bits ----------
const ORBS = cls => `<div class="orbs ${cls || ""}" aria-hidden="true"><div class="ln"></div><div class="pulse"></div><div class="orb w"></div><div class="orb c"></div></div>`;
const progress = name => { const i = STEPS.indexOf(name);
  return `<div class="progress">${STEPS.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div><p class="eyebrow">About you · ${i + 1} of ${STEPS.length}</p>`; };
const opt = (key, val, label) => `<button class="opt${String(S.draft[key]) === String(val) ? " sel" : ""}" data-set="${key}" data-val="${esc(val)}"><span>${label}</span><span class="tick"></span></button>`;
const back = to => `<button class="link" data-go="${to}">← Back</button>`;
const relSelect = (id, sel, prompt) => `<label class="field" for="${id}">${prompt}<select id="${id}"><option value="">Choose…</option>${RELS.map(([v, l]) => `<option value="${v}"${sel === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
const closeness = (sel) => `<div class="stack" style="gap:6px"><p class="small muted" style="font-weight:600">How close do you feel to them?</p>
  <div class="scale" style="grid-template-columns:repeat(10,1fr)">${Array.from({ length: 10 }, (_, i) => `<button class="${sel === i + 1 ? "sel" : ""}" data-close="${i + 1}" style="font-size:.85rem">${i + 1}</button>`).join("")}</div>
  <div class="scale-labels"><span>Not close</span><span>Very close</span></div></div>`;
const twinQs = (a) => `<div class="panel stack"><p class="eyebrow">Twin questions</p>
  <p class="small muted">As children, were you as alike as "two peas in a pod"?</p><div class="chips">${[["yes", "Yes"], ["somewhat", "Somewhat"], ["no", "No"]].map(([v, l]) => `<button class="chip${a.peas === v ? " sel" : ""}" data-tq="peas" data-v="${v}">${l}</button>`).join("")}</div>
  <p class="small muted">Were you often mistaken for each other by family or friends?</p><div class="chips">${[["often", "Often"], ["sometimes", "Sometimes"], ["rarely", "Rarely"]].map(([v, l]) => `<button class="chip${a.mistaken === v ? " sel" : ""}" data-tq="mistaken" data-v="${v}">${l}</button>`).join("")}</div>
  <p class="small faint">Linked twins must have the same date of birth.</p></div>`;
const inviteMaker = () => {
  const last = S.inv.last;
  return `<div class="panel stack"><p class="eyebrow">${last ? "Invite someone else" : "Who are they?"}</p>
  ${relSelect("f-irel", S.inv.rel, "They are my…")}
  <label class="field" for="f-inick">A name to remind you (optional)<input type="text" id="f-inick" maxlength="30" placeholder="e.g. Sarah" value="${esc(S.inv.nick)}"></label>
  <p class="small faint">Only you ever see this name. It isn't part of the study data.</p>
  <button class="btn cool" data-act="mkinvite">Create invite link</button></div>
  ${last ? `<div class="panel stack"><p class="eyebrow">Send this to ${esc(last.nick || "them")}</p>
  <div class="copyline"><input type="text" id="f-link" readonly value="${esc(inviteUrl(last.code))}" aria-label="Invite link"><button class="btn cool" data-copy="${esc(inviteUrl(last.code))}">Copy</button></div>
  ${navigator.share ? `<button class="btn ghost" data-share="${esc(last.code)}">Share…</button>` : ""}
  <p class="small muted">Or they can enter the code <b class="mono" style="color:var(--moon)">${esc(last.code)}</b> in the app. It works once and lasts 30 days. When they join, you'll both confirm the link.</p></div>` : ""}`;
};
const REWARD = `<div class="panel stack" style="border-color:rgba(244,177,131,.45)"><p class="eyebrow" style="color:var(--warm)">Invite rewards</p>
  <p class="small muted">Rewards for inviting people who go on to play regularly are coming soon. Invite now and their sessions will count.</p>
  <p class="small faint">Rewards are for taking part, never for scores.</p></div>`;

// ---------- screens ----------
const V = {
loading: () => `<div class="spinner" aria-label="Loading"></div>`,

welcome: () => ORBS() + `<div class="stack"><p class="eyebrow">Distant Intention Study</p>
  <h1>The Sunday <em>Telepathy Event</em></h1>
  <p class="lede">Every Sunday at 7:30pm (UK time), everyone taking part is split at random into two groups. Senders concentrate on one picture for two minutes. Receivers try to feel it, then sketch what comes to them. Can a group of minds send an image?</p></div>
  ${pendingJoin() ? `<div class="notice">You've been invited to link with someone. Sign up first, and you'll be able to accept.</div>` : ""}
  <button class="btn warm" data-go="email">Get started</button>
  <button class="link" data-go="email">I already have an account</button>`,

email: () => back("welcome") + `<h2>Sign in with your <em>email</em></h2>
  <p class="muted">We'll email you a sign-in link. Your email is kept separate from the study data and never shown to anyone.</p>
  <label class="field" for="f-email">Email address<input type="email" id="f-email" autocomplete="email" inputmode="email" value="${esc(S.email)}" placeholder="you@example.com"></label>
  <button class="btn warm" data-act="sendcode">Email me a sign-in link</button>
  <p class="small faint">No password, name or phone number needed.</p>`,

code: () => back("email") + ORBS("search") + `<h2>Check your <em>email</em></h2>
  <p class="muted">We sent a sign-in link to <b style="color:var(--moon)">${esc(S.email)}</b>. Open the email <b style="color:var(--moon)">on this phone</b> and tap the link. It can take a minute to arrive; check your spam folder too.</p>
  <button class="link" data-act="resend">Send a new link</button>
  <details class="panel"><summary class="small muted" style="cursor:pointer">My email shows a code instead</summary>
  <div class="stack" style="margin-top:12px"><label class="field" for="f-code">Code<input type="text" id="f-code" class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="······"></label>
  <button class="btn warm" data-act="verify">Continue</button></div></details>`,

age: () => `<h2>Are you <em>18 or over?</em></h2><p class="muted">The study is for adults only.</p>
  <button class="btn warm" data-act="adult">Yes, I'm 18 or over</button><button class="btn ghost" data-act="notadult">No</button>`,

under: () => `<h2>Thank you for your <em>interest</em></h2><p class="muted">This study is only open to adults, so we can't sign you up. We'd love to hear from you when you're 18.</p>`,

dob: () => progress("dob") + `<h2>Your date of <em>birth</em></h2>
  <p class="muted">Used to find partners who share your birthday and to compare age groups. It's stored separately and never shown to anyone.</p>
  <label class="field" for="f-dob">Date of birth<input type="date" id="f-dob" value="${esc(S.dob || "")}" max="${new Date().toISOString().slice(0, 10)}" min="1900-01-01"></label>
  <button class="btn warm" data-act="savedob">Continue</button>`,

place: () => progress("place") + back("dob") + `<h2>Where do you <em>live?</em></h2>
  <p class="muted">Only used to work out roughly how far apart partners are. Never your address.</p>
  <label class="field" for="f-country">Country<select id="f-country"><option value="">Choose…</option>${COUNTRIES.map(c => `<option${S.draft.country === c ? " selected" : ""}>${c}</option>`).join("")}</select></label>
  <label class="field" for="f-town">Nearest town or city<input type="text" id="f-town" maxlength="80" placeholder="e.g. London" value="${esc(S.draft.town || "")}"></label>
  <button class="btn warm" data-act="saveplace">Continue</button>`,

belief: () => progress("belief") + back("place") + `<h2>Do you believe in <em>telepathy?</em></h2>
  <p class="muted">There's no right answer. We ask everyone before their first game.</p>
  <div class="opts">${opt("belief", 1, "Definitely not")}${opt("belief", 2, "Probably not")}${opt("belief", 3, "Not sure")}${opt("belief", 4, "Probably yes")}${opt("belief", 5, "Definitely yes")}</div>
  <button class="btn warm" data-act="savebelief">Continue</button>`,

twin: () => progress("twin") + back("belief") + `<h2>Are you a <em>twin?</em></h2>
  <p class="muted">Optional. Twins can be matched with twins from other families.</p>
  <div class="opts">${opt("twin_status", "identical", "Yes, identical")}${opt("twin_status", "non_identical", "Yes, non-identical")}${opt("twin_status", "unsure", "Yes, not sure which")}${opt("twin_status", "no", "No")}</div>
  <button class="btn warm" data-act="savetwin">Continue</button><button class="link" data-go="experience">Skip</button>`,

experience: () => progress("experience") + back("twin") + `<h2>Ever known what someone was <em>thinking?</em></h2>
  <p class="muted">Optional. Have you ever felt you knew what someone close to you was thinking, or was about to do, without being told?</p>
  <div class="opts">${opt("experience", "yes", "Yes")}${opt("experience", "no", "No")}${opt("experience", "unsure", "Not sure")}</div>
  ${S.draft.experience === "yes" ? `<label class="field" for="f-expt">Tell us about it (optional)<textarea id="f-expt" maxlength="1000" placeholder="e.g. My sister rang just as I picked up the phone to call her">${esc(S.draft.experience_note || "")}</textarea></label>` : ""}
  <button class="btn warm" data-act="saveexp">Continue</button><button class="link" data-go="invite">Skip</button>`,

invite: () => progress("invite") + back("experience") + `<h2>Who do you feel <em>close to?</em></h2>
  <p class="muted">Invite everyone you feel close to, or think you might share a connection with: twins, family, partners, friends. Once they've joined, the app will sometimes match you together without saying when.</p>
  ${REWARD}
  <div class="opts">${opt("feels_connected", "yes", "Yes, I'd like to invite someone")}${opt("feels_connected", "later", "Maybe later")}${opt("feels_connected", "no", "No")}</div>
  ${S.draft.feels_connected === "yes" ? inviteMaker() : ""}
  <button class="btn warm" data-act="saveinvite">Continue</button>`,

animals: () => { const a = S.draft.animals || {}; const kinds = [["dog", "Dog"], ["cat", "Cat"], ["other", "Other"]];
  return progress("animals") + back("invite") + `<h2>Do you live with any <em>animals?</em></h2>
  <p class="muted">Optional. Rupert Sheldrake has studied the bond between people and their pets, so we'd like to know.</p>
  <div class="chips">${kinds.map(([k, l]) => `<button class="chip${a[k] ? " sel" : ""}" data-animal="${k}">${l}</button>`).join("")}<button class="chip${a.none ? " sel" : ""}" data-animal="none">None</button></div>
  ${kinds.filter(([k]) => a[k]).map(([k, l]) => `<div class="stepper"><span>How many: <b>${l.toLowerCase()}s</b></span><span class="ctl"><button data-count="${k}" data-d="-1" aria-label="Fewer">−</button><span class="mono">${a[k]}</span><button data-count="${k}" data-d="1" aria-label="More">+</button></span></div>`).join("")}
  <button class="btn warm" data-act="saveanimals">Continue</button><button class="link" data-go="consent">Skip</button>`; },

consent: () => progress("consent") + back("animals") + `<h2>Before you <em>play</em></h2>
  <div class="panel stack small muted">
  <p><b style="color:var(--moon)">What this is.</b> A research study, not a test that proves anything about you.</p>
  <p><b style="color:var(--moon)">Your partners.</b> You'll never see who they are, and they'll never see you.</p>
  <p><b style="color:var(--moon)">Your data.</b> Stored securely under UK data protection law, analysed anonymously, including with AI tools, and published only as group results.</p>
  <p><b style="color:var(--moon)">Your choice.</b> You can leave and delete all your data at any time from Settings.</p></div>
  <button class="check${S.draft.consentTick ? " sel" : ""}" data-act="tickconsent"><span class="box">${S.draft.consentTick ? "✓" : ""}</span><span>I've read this and agree to take part.</span></button>
  <button class="btn warm" data-act="join" ${S.draft.consentTick ? "" : "disabled"}>Join the study</button>`,

home: () => { const c = S.conns, needs = c.filter(x => x.needs_my_answer);
  const row = x => {
    const name = esc(x.nickname || relLabel(x.relationship));
    if (x.kind === "invite") return `<div class="item"><span class="dot" style="background:var(--faint)"></span><span class="meta"><b>${name}</b><div>${esc(relLabel(x.relationship))} · invited, hasn't joined yet</div></span><button class="pill wait" data-copy="${esc(inviteUrl(x.link_code))}">Copy link</button></div>`;
    if (x.status === "confirmed") return `<div class="item"><span class="dot" style="background:var(--ok)"></span><span class="meta"><b>${name}</b><div>${esc(relLabel(x.relationship))}</div></span><span class="pill ok">Linked</span></div>`;
    if (x.status === "mismatch") return `<div class="item"><span class="dot" style="background:var(--alert)"></span><span class="meta"><b>${name}</b><div>${esc(x.status_reason || "Not confirmed")}</div></span><button class="pill wait" data-unlink="${esc(x.id)}">Remove</button></div>`;
    if (x.needs_my_answer) return `<div class="item"><span class="dot" style="background:var(--warm)"></span><span class="meta"><b>${name}</b><div>Has joined. Confirm your link</div></span><button class="pill wait" data-confirm="${esc(x.id)}">Confirm</button></div>`;
    return `<div class="item"><span class="dot" style="background:var(--warm)"></span><span class="meta"><b>${name}</b><div>${esc(relLabel(x.relationship))} · waiting for them to confirm</div></span><span class="pill wait">Pending</span></div>`;
  };
  return `<div class="bar"><p class="eyebrow">Distant Intention Study</p><button class="link" data-go="settings" style="align-self:auto">Settings</button></div>
  ${eventCard()}
  ${needs.length ? `<div class="notice">${needs.length === 1 ? "Someone you invited has" : needs.length + " people you invited have"} joined. Confirm below.</div>` : ""}
  <div class="stack"><p class="eyebrow">Your people</p>
  <div class="list">${c.length ? c.map(row).join("") : `<div class="empty">Invite a twin, relative or friend. The app will sometimes match you together, without telling you when.</div>`}</div>
  <button class="btn ghost" data-go="invitehome">Invite someone</button>
  <button class="btn ghost" data-go="entercode">I have a code</button></div>
  ${REWARD}`; },

invitehome: () => back("home") + `<h2>Invite <em>someone</em></h2>
  <p class="muted">Anyone you feel close to, or think you might share a connection with.</p>` + inviteMaker(),

entercode: () => back("home") + `<h2>Enter a <em>code</em></h2>
  <p class="muted">If someone invited you, enter the code from their invite.</p>
  <label class="field" for="f-jcode">Invite code<input type="text" id="f-jcode" class="code-in" maxlength="6" autocomplete="off" autocapitalize="characters" value="${esc(pendingJoin() || "")}" placeholder="······"></label>
  <button class="btn cool" data-act="checkcode">Continue</button>`,

redeem: () => { const r = S.redeem; return back("entercode") + `<h2>How are you <em>related?</em></h2>
  <p class="muted">Code accepted. Your answer needs to match theirs for the link to be confirmed.</p>
  ${relSelect("f-rrel", r.rel, "They are my…")}
  ${closeness(r.close)}
  ${isTwin(r.rel) ? twinQs(r.twin) : ""}
  <button class="btn warm" data-act="redeem" ${r.rel && r.close ? "" : "disabled"}>Link with them</button>`; },

confirm: () => { const c = S.confirm; return back("home") + `<h2>Confirm your <em>link</em></h2>
  <p class="muted"><b style="color:var(--moon)">${esc(c.nickname || relLabel(c.relationship))}</b> has joined using your invite. You said they're your <b style="color:var(--moon)">${esc(relLabel(c.relationship).toLowerCase())}</b>.</p>
  ${closeness(c.close)}
  ${isTwin(c.relationship) ? twinQs(c.twin) : ""}
  <button class="btn warm" data-act="confirmlink" ${c.close ? "" : "disabled"}>Confirm link</button>
  <button class="btn ghost danger" data-unlink="${esc(c.id)}">This isn't them, remove</button>`; },

settings: () => back("home") + `<h2>Settings</h2>
  <div class="panel stack"><div class="settings-row"><span class="small muted">Signed in as</span><span class="small">${esc(S.user?.email)}</span></div>
  <button class="btn ghost" data-act="signout">Sign out</button></div>
  ${S.home && S.home.admin ? `<div class="panel stack"><p class="eyebrow">Admin</p><p class="small muted">Start a test event so you can try the whole thing. Anyone signed in will see it on their home screen.</p>
  <button class="btn ghost" data-act="testevent">Start a test event in 2 minutes</button></div>` : ""}
  <div class="panel stack"><p class="eyebrow">Leave the study</p>
  <p class="small muted">This permanently deletes your account, your answers and your links. It can't be undone.</p>
  ${S.delStep ? `<p class="small" style="color:var(--alert)">Are you sure? Everything will be deleted.</p><button class="btn ghost danger" data-act="delete">Yes, delete everything</button><button class="btn ghost" data-act="canceldelete">Keep my account</button>`
    : `<button class="btn ghost danger" data-act="askdelete">Delete my account and data</button>`}</div>`
};

// =====================================================================
// The Sunday Telepathy Event
// Timing in seconds after the start: 0–120 send / tune in, 120–300 sketch,
// 300–420 photograph the sketch, 420 reveal. Leaving the app 0–300 = not counted.
// =====================================================================
const T = { lobby: -900, sendEnd: 120, sketchEnd: 300, photoEnd: 420 };
const L = { id: null, es: null, timer: null, poll: null, phase: null, draw: false, photo: null, photoUrl: null,
  hiddenAt: null, reported: false, wake: null, sketchUrl: null, hashOk: null, busy: false };
let clockOffset = 0;                                  // server time minus this device's time, in ms
const nowMs = () => Date.now() + clockOffset;
const syncClock = iso => { if (iso) clockOffset = new Date(iso).getTime() - Date.now(); };

async function loadHome() {
  const { data, error } = await sb.rpc("home_events");
  if (error) throw error; S.home = data; syncClock(data.server_now);
}

const fmtWhen = iso => new Date(iso).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const fmtTime = iso => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function fmtLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  if (d) return `${d} day${d > 1 ? "s" : ""} ${h} hr`;
  if (h) return `${h} hr ${m} min`;
  return `${m}:${String(x).padStart(2, "0")}`;
}
const clock = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

function eventCard() {
  const H = S.home; if (!H || !H.next) return `<h2>The Sunday <em>Telepathy Event</em></h2>`;
  const n = H.next, start = new Date(n.starts_at).getTime(), t = (nowMs() - start) / 1000;
  const title = n.kind === "test" ? "Test <em>event</em>" : "Sunday <em>Telepathy Event</em>";
  let body;
  if (n.checked_in && t < T.photoEnd) body = `<p class="muted">You're checked in. Keep the app open.</p><button class="btn warm" data-act="golive" data-ev="${esc(n.id)}">Go to the event</button>`;
  else if (t >= T.lobby && t < 0) body = `<div class="cd"><span class="k">Starts in</span><span class="v mono" data-cd="${start}">${fmtLeft(start - nowMs())}</span></div>
    <p class="muted">The lobby is open. Have a <b style="color:var(--moon)">blank sheet of paper and a pen</b> ready.</p><button class="btn warm" data-go="pledge">Join now</button>`;
  else if (t >= 0) body = `<p class="muted">This event has started. The next one is on Sunday at 7:30pm.</p>`;
  else body = `<div class="cd"><span class="k">Starts in</span><span class="v mono" data-cd="${start}">${fmtLeft(start - nowMs())}</span></div>
    <p class="small muted">The lobby opens 15 minutes before, at ${fmtTime(new Date(start - 900000).toISOString())}. You'll need about 10 minutes, a quiet place, and a blank sheet of paper and a pen.</p>
    <div class="grid2"><button class="btn ghost" data-act="calendar">Add to calendar</button><button class="btn ghost" data-act="shareevent">Invite friends</button></div>`;
  const last = H.last ? `<button class="item" style="width:100%;text-align:left;color:inherit" data-act="golive" data-ev="${esc(H.last.id)}"><span class="dot" style="background:var(--cool)"></span><span class="meta"><b>Your last event</b><div>${esc(fmtWhen(H.last.starts_at))}</div></span><span class="pill ok">Results</span></button>` : "";
  return `<div class="panel stack event-card"><p class="eyebrow" style="color:var(--warm)">${n.kind === "test" ? "Test" : "Every Sunday · 7:30pm UK"}</p>
    <h2>${title}</h2><p class="small muted">${esc(fmtWhen(n.starts_at))}</p>${body}</div>${last}`;
}

function downloadIcs() {
  const H = S.home; if (!H || !H.next) return;
  const d = new Date(H.next.starts_at), p = x => String(x).padStart(2, "0");
  const z = x => `${x.getUTCFullYear()}${p(x.getUTCMonth() + 1)}${p(x.getUTCDate())}T${p(x.getUTCHours())}${p(x.getUTCMinutes())}00Z`;
  const local = d.toLocaleString("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).split("/").reverse().join("");
  const end = new Date(d.getTime() + 10 * 60000);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Distant Intention//Sunday Event//EN",
    "BEGIN:VTIMEZONE", "TZID:Europe/London",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:sunday-telepathy-event@distant-intention", `DTSTAMP:${z(new Date())}`,
    `DTSTART;TZID=Europe/London:${local}T193000`, `DTEND;TZID=Europe/London:${local}T194000`, "RRULE:FREQ=WEEKLY;BYDAY=SU",
    "SUMMARY:Sunday Telepathy Event", `DESCRIPTION:Open the app by 7:30pm. Have a blank sheet of paper and a pen ready. ${location.origin + location.pathname}`,
    `URL:${location.origin + location.pathname}`,
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:The Telepathy Event lobby is open", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  void end;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "sunday-telepathy-event.ics"; document.body.appendChild(a); a.click(); a.remove();
}
async function shareEvent() {
  const url = location.origin + location.pathname, text = "Join me for the Sunday Telepathy Event: every Sunday at 7:30pm UK time, a live experiment in sending and receiving an image. Free to take part:";
  if (navigator.share) { try { await navigator.share({ title: "Sunday Telepathy Event", text, url }); } catch (_) {} return; }
  try { await navigator.clipboard.writeText(text + " " + url); toast("Link copied"); } catch (_) { toast(url); }
}

// Home screen countdown; redraws when the lobby opens or the event starts.
let homeStage = null;
setInterval(() => {
  if (S.screen !== "home" || !S.home || !S.home.next) return;
  const t = (nowMs() - new Date(S.home.next.starts_at).getTime()) / 1000;
  const stage = t < T.lobby ? 0 : t < 0 ? 1 : 2;
  if (homeStage !== null && stage !== homeStage) { homeStage = stage; return go("home"); }
  homeStage = stage;
  document.querySelectorAll("[data-cd]").forEach(el => { el.textContent = fmtLeft(Number(el.dataset.cd) - nowMs()); });
}, 1000);

// ---------- the live event ----------
async function openLive(id) {
  stopLive();
  Object.assign(L, { id, es: null, phase: null, draw: false, photo: null, photoUrl: null, hiddenAt: null, reported: false, sketchUrl: null, hashOk: null, busy: false });
  S.screen = "live"; render(); window.scrollTo(0, 0);
  await refreshLive();
  L.timer = setInterval(tickLive, 250);
}
function stopLive() {
  clearInterval(L.timer); L.timer = null; clearTimeout(L.poll); L.poll = null; releaseWake();
}
async function refreshLive() {
  clearTimeout(L.poll); L.poll = null;
  try {
    const { data, error } = await sb.rpc("event_state", { p_event: L.id });
    if (error) throw error;
    syncClock(data.server_now); L.es = data;
    if (data.reveal && L.hashOk === null) checkHash(data);
    if (data.me && data.me.sketch_path && !L.sketchUrl) {
      const r = await sb.storage.from("sketches").createSignedUrl(data.me.sketch_path, 3600);
      if (r.data) L.sketchUrl = r.data.signedUrl;
    }
  } catch (e) { if (S.screen === "live" && !L.es) showError(friendly(e)); }
  if (S.screen !== "live") return;
  if (!(L.draw && livePhase() === "receiver:sketch")) L.phase = null;  // don't wipe a drawing in progress
  tickLive();
  // when to ask again
  const es = L.es; if (!es) { L.poll = setTimeout(refreshLive, 3000); return; }
  const t = (nowMs() - new Date(es.starts_at).getTime()) / 1000;
  let wait = null;
  if (t < -20) wait = 10000; else if (t < 0) wait = Math.max(300, -t * 1000 + 300);
  else if (es.me && !es.me.role) wait = 1500;
  else if (t < T.sketchEnd && es.me && es.me.role === "receiver" && es.me.sketch_at) wait = (T.sketchEnd - t) * 1000 + 500;
  else if (t < T.photoEnd) wait = Math.min(15000, (T.photoEnd - t) * 1000 + 500);
  else if (!es.reveal) wait = 3000;
  if (wait !== null) L.poll = setTimeout(refreshLive, wait);
}
async function checkHash(es) {
  try {
    const r = es.reveal, buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${r.image_id}:${r.path}:${r.salt}`));
    L.hashOk = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("") === es.commit_hash;
  } catch (_) { L.hashOk = false; }
}
function livePhase() {
  const es = L.es; if (!es) return "loading";
  const t = (nowMs() - new Date(es.starts_at).getTime()) / 1000, me = es.me;
  if (!me) return t >= T.photoEnd ? "done" : "notin";
  if (t < 0) return "lobby";
  if (!me.role) return "splitting";
  if (t < T.sendEnd) return me.role + ":send";
  if (t < T.sketchEnd) return me.role === "receiver" && me.sketch_at ? "receiver:sent" : me.role + ":sketch";
  if (t < T.photoEnd) return me.role === "receiver" ? (me.sketch_at ? "receiver:sent" : "receiver:photo") : "sender:wait";
  return "done";
}
function tickLive() {
  if (S.screen !== "live" || !L.es) return;
  const ph = livePhase(), t = (nowMs() - new Date(L.es.starts_at).getTime()) / 1000;
  if (ph !== L.phase) {
    const prev = L.phase; L.phase = ph; render();
    if (/:send$|lobby|splitting|:sketch$/.test(ph)) holdWake(); else if (ph === "done") releaseWake();
    if (prev && ph !== prev && navigator.vibrate) { try { navigator.vibrate(120); } catch (_) {} }
  }
  // update clocks without redrawing the page
  document.querySelectorAll("[data-until]").forEach(el => { el.textContent = clock(Number(el.dataset.until) - t); });
  document.querySelectorAll("[data-bar]").forEach(el => { const [a, b] = el.dataset.bar.split(",").map(Number); el.style.width = Math.min(100, Math.max(0, (t - a) / (b - a) * 100)) + "%"; });
}

// Keep the screen awake during the event, so the phone doesn't lock (which would count as leaving the app).
async function holdWake() { try { if (!L.wake && "wakeLock" in navigator) { L.wake = await navigator.wakeLock.request("screen"); L.wake.addEventListener("release", () => { L.wake = null; }); } } catch (_) {} }
function releaseWake() { try { L.wake && L.wake.release(); } catch (_) {} L.wake = null; }

// Leaving the app between 7:30 and 7:35 means this person's part doesn't count.
async function reportLeft() {
  if (L.reported || !L.id) return;
  try { const { error } = await sb.rpc("report_left", { p_event: L.id }); if (!error) L.reported = true; } catch (_) {}
}
document.addEventListener("visibilitychange", () => {
  if (S.screen !== "live" || !L.es || !L.es.me) return;
  const t = (nowMs() - new Date(L.es.starts_at).getTime()) / 1000;
  if (document.visibilityState === "hidden") {
    if (t >= 0 && t < T.sketchEnd) { L.hiddenAt = t; reportLeft(); }
  } else {
    if (L.hiddenAt !== null) reportLeft();
    holdWake(); refreshLive();
  }
});

// ---------- sketching ----------
// The camera input lives outside the screen, so it survives the page redrawing while the camera is open.
let camInput = null;
function photoInput() {
  if (camInput) { camInput.value = ""; return camInput; }
  camInput = document.createElement("input"); camInput.type = "file"; camInput.accept = "image/*";
  camInput.setAttribute("capture", "environment"); camInput.hidden = true; document.body.appendChild(camInput);
  camInput.addEventListener("change", () => {
    const f = camInput.files && camInput.files[0]; if (!f) return;
    L.photo = f; if (L.photoUrl) URL.revokeObjectURL(L.photoUrl); L.photoUrl = URL.createObjectURL(f);
    if (S.screen === "live") render();
  });
  return camInput;
}
let pad = null;
function padInit() {
  const c = document.getElementById("pad"); if (!c || c === (pad && pad.c)) return;
  const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const g = c.getContext("2d"); g.scale(dpr, dpr); g.fillStyle = "#fff"; g.fillRect(0, 0, r.width, r.height);
  g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#111"; g.lineWidth = 3;
  pad = { c, g, down: false, used: false, w: r.width, h: r.height };
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener("pointerdown", e => { e.preventDefault(); c.setPointerCapture(e.pointerId); pad.down = true; pad.used = true; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + .1, y + .1); g.stroke(); });
  c.addEventListener("pointermove", e => { if (!pad.down) return; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); });
  const up = () => { pad.down = false; };
  c.addEventListener("pointerup", up); c.addEventListener("pointercancel", up);
}
function padClear() { if (!pad) return; pad.g.fillStyle = "#fff"; pad.g.fillRect(0, 0, pad.w, pad.h); pad.used = false; }

async function shrink(blobOrFile) {
  // resize to at most 1600px and save as JPEG, so uploads are quick
  const bmp = await createImageBitmap(blobOrFile);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
  return await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
}
async function upload(blob, method, btn) {
  if (L.busy) return; L.busy = true; setBusy(btn, true, "Sending…");
  try {
    const path = `${S.user.id}/${L.id}-${Date.now()}.jpg`;
    const up = await sb.storage.from("sketches").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.rpc("submit_sketch", { p_event: L.id, p_path: path, p_method: method });
    if (error) throw error;
    L.sketchUrl = URL.createObjectURL(blob); toast("Sketch received");
    await refreshLive();
  } catch (e) { setBusy(btn, false); showError(friendly(e)); }
  finally { L.busy = false; }
}
async function sendDrawing(btn) {
  if (!pad || !pad.used) return showError("Draw something first, even a few lines.");
  const blob = await new Promise(res => pad.c.toBlob(res, "image/jpeg", 0.9));
  return upload(blob, "screen", btn);
}
async function sendPhoto(btn) {
  if (!L.photo) return showError("Take a photo of your sketch first.");
  let blob; try { blob = await shrink(L.photo); } catch (_) { blob = L.photo; }
  return upload(blob, "paper", btn);
}

// ---------- screens ----------
const timerBlock = (from, to, cls) => `<div class="stack" style="gap:6px"><div class="bar"><span class="small muted">Time left</span><span class="timer" data-until="${to}">${clock(to - from)}</span></div>
  <div class="timerline ${cls || ""}"><i data-bar="${from},${to}" style="width:0"></i></div></div>`;
const imgTag = (im, cls) => im ? `<figure class="target ${cls || ""}"><img src="${esc(im.path)}" alt="${esc(im.title)}"></figure>` : "";
const LEAVE_NOTE = `<p class="small faint">Stay in the app until 7:35. If you leave it, your part won't count this week.</p>`;

Object.assign(V, {
pledge: () => back("home") + `<p class="eyebrow">Before you join</p><h2>Ready to <em>take part?</em></h2>
  <div class="panel stack small muted">
  <p><b style="color:var(--moon)">1. Get ready.</b> Somewhere quiet, on your own, with a <b style="color:var(--moon)">blank sheet of paper and a pen</b>. Turn notifications off.</p>
  <p><b style="color:var(--moon)">2. At 7:30</b> you'll be told if you're a <span style="color:var(--warm)">sender</span> or a <span style="color:var(--cool)">receiver</span>. Senders concentrate on a picture for 2 minutes. Receivers relax and try to feel it, then sketch for 3 minutes.</p>
  <p><b style="color:var(--moon)">3. At 7:35</b> receivers take a photo of their sketch in the app. The picture is revealed to everyone at 7:37.</p>
  <p><b style="color:var(--moon)">Stay in the app until 7:35.</b> If you leave it, even briefly, your part won't count this week.</p></div>
  <button class="check${S.pledged ? " sel" : ""}" data-act="pledge"><span class="box">${S.pledged ? "✓" : ""}</span><span>I agree not to communicate with anyone, or use social media or any other app, until the picture is revealed, and I agree not to cheat.</span></button>
  <button class="btn warm" data-act="checkin" ${S.pledged ? "" : "disabled"}>I'm here</button>`,

live: () => {
  const es = L.es, ph = livePhase(); if (!es) return `<div class="spinner" aria-label="Loading"></div>`;
  const start = new Date(es.starts_at).getTime(), t = (nowMs() - start) / 1000, me = es.me || {};
  const top = `<div class="bar"><button class="link" data-go="home">← Home</button><span class="eyebrow">${es.kind === "test" ? "Test event" : "Sunday Telepathy Event"}</span></div>`;
  switch (ph) {
  case "notin": return top + `<h2>This event has <em>started</em></h2><p class="muted">Check-in closed at ${fmtTime(es.starts_at)}. See you next Sunday!</p>`;
  case "lobby": return top + `<div class="rest"><div><span class="small muted">Starting in</span><b class="mono" data-until="0">${clock(-t)}</b></div></div>
    <h2>You're <em>in</em></h2>
    <p class="muted"><b style="color:var(--moon)">${es.n_checked_in}</b> ${es.n_checked_in === 1 ? "person is" : "people are"} here. At ${fmtTime(es.starts_at)} everyone will be split at random into senders and receivers.</p>
    <div class="panel small muted stack"><p>Have your blank paper and pen ready. Take a few slow breaths.</p><p>Keep this screen open: it will change by itself.</p></div>`;
  case "splitting": return top + ORBS("search") + `<h2>Splitting everyone into <em>two groups…</em></h2>`;
  case "sender:send": return `<div class="role warm"><span class="eyebrow">You are a</span><b>Sender</b></div>
    ${imgTag(es.image)}
    <p class="muted">Concentrate on this picture and the feeling it gives you. Imagine the receivers seeing it.</p>
    ${timerBlock(0, T.sendEnd)}${LEAVE_NOTE}`;
  case "receiver:send": return `<div class="role cool"><span class="eyebrow">You are a</span><b>Receiver</b></div>
    <div class="rest tune"><div><b>Relax</b><span class="small muted">and try to feel the picture</span></div></div>
    <p class="muted">Close your eyes if you like. Notice any shapes, colours, feelings or ideas. When the time is up, you'll sketch.</p>
    ${timerBlock(0, T.sendEnd, "cool")}${LEAVE_NOTE}`;
  case "sender:sketch": return `<div class="role warm"><span class="eyebrow">Sender</span><b>Thank you</b></div>
    <div class="rest"><div><b>Rest</b><span class="small muted">keep the picture gently in mind</span></div></div>
    <p class="muted">The receivers are sketching now.</p>${timerBlock(T.sendEnd, T.sketchEnd)}${LEAVE_NOTE}`;
  case "receiver:sketch": return `<div class="role cool"><span class="eyebrow">Receiver</span><b>Sketch now</b></div>
    ${timerBlock(T.sendEnd, T.sketchEnd, "cool")}
    ${L.draw ? `<canvas id="pad" class="pad" aria-label="Drawing pad"></canvas>
      <div class="grid2"><button class="btn ghost" data-act="clearpad">Clear</button><button class="btn cool" data-act="senddrawing">Send drawing</button></div>
      <button class="link" data-act="papermode">Use paper instead</button>`
    : `<p class="muted">Sketch whatever came to you on your paper: shapes, colours, objects, feelings. Add words if you like. There's no right or wrong.</p>
      <p class="small muted">At 7:35 you'll take a photo of it here.</p>
      <button class="link" data-act="drawmode">No paper? Draw on the screen instead</button>`}
    ${LEAVE_NOTE}`;
  case "receiver:photo": return `<div class="role cool"><span class="eyebrow">Receiver</span><b>Pens down</b></div>
    <p class="muted">Take a photo of your sketch now. The picture will be revealed once it's sent.</p>
    ${L.photo ? `<figure class="target"><img src="${esc(L.photoUrl)}" alt="Your sketch"></figure>
      <div class="grid2"><button class="btn ghost" data-act="retake">Retake</button><button class="btn cool" data-act="sendphoto">Send sketch</button></div>`
    : `<button class="btn cool" data-act="camera">Take photo of sketch</button>`}
    ${timerBlock(T.sketchEnd, T.photoEnd, "cool")}`;
  case "receiver:sent": return `<div class="role cool"><span class="eyebrow">Receiver</span><b>Sketch sent</b></div>
    ${L.sketchUrl ? `<figure class="target"><img src="${esc(L.sketchUrl)}" alt="Your sketch"></figure>` : ""}
    <p class="muted">Thank you. ${t < T.sketchEnd ? "The picture will be shown to you at 7:35." : "Here's the picture."}</p>
    ${t >= T.sketchEnd && es.image ? `<p class="eyebrow">The picture was</p>${imgTag(es.image)}` : t < T.sketchEnd ? timerBlock(T.sendEnd, T.sketchEnd, "cool") + LEAVE_NOTE : ""}`;
  case "sender:wait": return `<div class="role warm"><span class="eyebrow">Sender</span><b>All done</b></div>
    <p class="muted">Thank you for sending. The receivers are sending their sketches. Everyone sees the picture at 7:37.</p>${timerBlock(T.sketchEnd, T.photoEnd)}`;
  case "done": {
    const im = es.reveal || es.image, counted = me.counted;
    let status = "";
    if (es.me) {
      if (me.left_at) status = `<div class="notice">Your part wasn't counted this week because you left the app during the event. See you next Sunday!</div>`;
      else if (me.role === "receiver" && !me.sketch_at) status = `<div class="notice">Your sketch wasn't received in time, so it isn't counted this week. See you next Sunday!</div>`;
      else if (counted) status = `<div class="notice" style="border-left-color:var(--ok)">Your ${me.role === "sender" ? "sending" : "sketch"} counted. Thank you for taking part.</div>`;
    }
    const sc = es.scores;
    return top + `<h2>The picture <em>was…</em></h2>${im ? imgTag({ path: im.path, title: im.title }) + `<p class="muted" style="text-align:center">${esc(im.title)}</p>` : `<p class="muted">Revealing…</p>`}
    ${status}
    ${me.role === "receiver" && L.sketchUrl ? `<p class="eyebrow">Your sketch</p><figure class="target"><img src="${esc(L.sketchUrl)}" alt="Your sketch"></figure>` : ""}
    <div class="grid2"><div class="stat"><div class="k">Senders</div><div class="v">${es.n_senders ?? "–"}</div></div><div class="stat"><div class="k">Receivers</div><div class="v">${es.n_receivers ?? "–"}</div></div></div>
    <div class="panel stack"><p class="eyebrow">Results</p>
    ${sc && sc.judges ? `<p class="muted">AI score for your sketch against the real picture: <b style="color:var(--moon)">${sc.target}</b> out of 5, against pictures that weren't sent: <b style="color:var(--moon)">${sc.others}</b>.</p>`
      : `<p class="small muted">The AI judge scores every sketch against the real picture and against pictures that weren't sent. Results for this event will appear here.</p>`}</div>
    ${es.reveal ? `<div class="seal"><span class="ic">${L.hashOk ? "✓" : "…"}</span><span>${L.hashOk ? "Sealed before the start and checked: the picture wasn't changed after the sketches came in." : "Checking the seal…"}</span></div><p class="hash">${esc(es.commit_hash || "")}</p>` : ""}
    <button class="btn ghost" data-act="shareevent">Invite friends to next Sunday</button>`;
  }
  }
  return top;
}
});

function render() { $app.innerHTML = (V[S.screen] || V.home)(); if (S.screen === "live") { pad = null; padInit(); } }
async function go(s) {
  S.screen = s;
  if (s !== "live") stopLive();
  if (s === "home") { try { await Promise.all([loadConns().catch(() => { S.conns = []; }), loadHome()]); } catch (e) { S.home = null; } }
  render(); window.scrollTo(0, 0);
}

// ---------- actions ----------
async function act(name, btn) {
  try {
    switch (name) {
      case "sendcode": case "resend": {
        const email = (name === "resend" ? S.email : ($("f-email").value || "").trim());
        if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Please enter a valid email address.");
        setBusy(btn, true, "Sending…");
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
        setBusy(btn, false); if (error) throw error;
        S.email = email; if (name === "resend") toast("New link sent"); else go("code"); return;
      }
      case "verify": {
        const token = ($("f-code").value || "").replace(/\D/g, "");
        if (token.length < 6) return showError("Please enter the code from the email.");
        setBusy(btn, true, "Checking…");
        const { data, error } = await sb.auth.verifyOtp({ email: S.email, token, type: "email" });
        setBusy(btn, false); if (error) throw error;
        S.user = data.user; await loadProfile(); return go(nextScreenAfterSignIn());
      }
      case "adult": setBusy(btn, true); await saveProfile({ adult_confirmed: true }); return go(S.dob ? "place" : "dob");
      case "notadult": await sb.auth.signOut(); return go("under");
      case "savedob": {
        const v = $("f-dob").value; if (!v) return showError("Please enter your date of birth.");
        const d = new Date(v + "T00:00:00"), adult = new Date(); adult.setFullYear(adult.getFullYear() - 18);
        if (d > adult) return showError("The study is for adults: please check your date of birth.");
        setBusy(btn, true);
        const { error } = await sb.from("birthdates").upsert({ user_id: S.user.id, dob: v }); setBusy(btn, false);
        if (error) throw error; S.dob = v; return go("place");
      }
      case "saveplace": {
        const country = $("f-country").value, town = $("f-town").value.trim();
        if (!country || !town) return showError("Please choose a country and enter your nearest town or city.");
        setBusy(btn, true); await saveProfile({ country, town }); return go("belief");
      }
      case "savebelief": {
        if (!S.draft.belief) return showError("Please choose an answer.");
        setBusy(btn, true);
        const f = { belief: Number(S.draft.belief) }; if (!S.profile?.belief_at) f.belief_at = new Date().toISOString();
        await saveProfile(f); return go("twin");
      }
      case "savetwin": setBusy(btn, true); await saveProfile({ twin_status: S.draft.twin_status || null }); return go("experience");
      case "saveexp": {
        const note = $("f-expt") ? $("f-expt").value.trim() : null;
        setBusy(btn, true); await saveProfile({ experience: S.draft.experience || null, experience_note: S.draft.experience === "yes" ? (note || null) : null });
        return go("invite");
      }
      case "mkinvite": {
        const rel = $("f-irel").value, nick = $("f-inick").value.trim();
        if (!rel) return showError("Please choose how they're related to you.");
        setBusy(btn, true, "Creating…");
        const { data, error } = await sb.rpc("create_invite", { p_relationship: rel, p_nickname: nick || null, p_kind: "invite" });
        setBusy(btn, false); if (error) throw error;
        S.inv = { rel: "", nick: "", last: { code: data, nick } }; render(); toast("Invite link ready"); return;
      }
      case "saveinvite": setBusy(btn, true); await saveProfile({ feels_connected: S.draft.feels_connected || null }); S.inv.last = null; return go("animals");
      case "saveanimals": setBusy(btn, true); await saveProfile({ animals: S.draft.animals || {} }); return go("consent");
      case "tickconsent": S.draft.consentTick = !S.draft.consentTick; return render();
      case "join": {
        setBusy(btn, true, "Joining…");
        const now = new Date().toISOString();
        await saveProfile({ consent_version: cfg.consentVersion, consented_at: now, onboarded_at: now });
        return go(pendingJoin() ? "entercode" : "home");
      }
      case "checkcode": {
        const code = ($("f-jcode").value || "").trim().toUpperCase();
        if (code.length !== 6) return showError("Invite codes are six characters.");
        setBusy(btn, true, "Checking…");
        const { data, error } = await sb.rpc("check_invite", { p_code: code }); setBusy(btn, false);
        if (error) throw error; const r = data && data[0];
        if (!r || !r.valid) { clearJoin(); return showError(r ? r.reason : "That code wasn't recognised."); }
        S.redeem = { code, rel: r.suggested_relationship || "", close: 0, twin: {} }; return go("redeem");
      }
      case "redeem": {
        const r = S.redeem; setBusy(btn, true, "Linking…");
        const { error } = await sb.rpc("redeem_invite", { p_code: r.code, p_relationship: r.rel, p_closeness: r.close, p_twin_answers: isTwin(r.rel) ? r.twin : null });
        setBusy(btn, false); if (error) throw error;
        clearJoin(); toast("Sent. They'll be asked to confirm"); return go("home");
      }
      case "confirmlink": {
        const c = S.confirm; setBusy(btn, true, "Confirming…");
        const { data, error } = await sb.rpc("confirm_link", { p_link: c.id, p_closeness: c.close, p_twin_answers: isTwin(c.relationship) ? c.twin : null });
        setBusy(btn, false); if (error) throw error;
        toast(data === "confirmed" ? "Linked" : data); return go("home");
      }
      case "testevent": {
        setBusy(btn, true, "Starting…");
        const { error } = await sb.rpc("create_test_event", { p_minutes: 2 }); setBusy(btn, false); if (error) throw error;
        toast("Test event starts in about 2 minutes"); return go("home");
      }
      case "pledge": S.pledged = !S.pledged; return render();
      case "checkin": {
        if (!S.pledged) return showError("Please tick the pledge to take part.");
        setBusy(btn, true, "Checking in…");
        const { error } = await sb.rpc("check_in", { p_event: S.home.next.id, p_pledge: true }); setBusy(btn, false);
        if (error) throw error; return openLive(S.home.next.id);
      }
      case "golive": return openLive(btn.dataset.ev);
      case "calendar": return downloadIcs();
      case "shareevent": return shareEvent();
      case "drawmode": L.draw = true; return render();
      case "papermode": L.draw = false; return render();
      case "clearpad": return padClear();
      case "senddrawing": return sendDrawing(btn);
      case "sendphoto": return sendPhoto(btn);
      case "retake": L.photo = null; return render();
      case "camera": photoInput().click(); return;
      case "signout": await sb.auth.signOut(); S.user = null; S.profile = null; return go("welcome");
      case "askdelete": S.delStep = 1; return render();
      case "canceldelete": S.delStep = 0; return render();
      case "delete": {
        setBusy(btn, true, "Deleting…");
        const { error } = await sb.rpc("delete_my_account"); if (error) throw error;
        await sb.auth.signOut(); S.user = null; S.profile = null; S.delStep = 0; toast("Your account and data have been deleted"); return go("welcome");
      }
    }
  } catch (e) { setBusy(btn, false); showError(friendly(e)); }
}

$app.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return; const d = b.dataset;
  if (d.go) return go(d.go);
  if (d.act) return act(d.act, b);
  if (d.set) { S.draft[d.set] = d.set === "belief" ? Number(d.val) : d.val; return render(); }
  if (d.animal) { const a = { ...(S.draft.animals || {}) };
    if (d.animal === "none") S.draft.animals = a.none ? {} : { none: true };
    else { delete a.none; if (a[d.animal]) delete a[d.animal]; else a[d.animal] = 1; S.draft.animals = a; }
    return render(); }
  if (d.count) { const a = S.draft.animals; a[d.count] = Math.max(1, Math.min(20, a[d.count] + Number(d.d))); return render(); }
  if (d.close) { const t = S.screen === "redeem" ? S.redeem : S.confirm; if (S.screen === "redeem") t.rel = $("f-rrel").value || t.rel; t.close = Number(d.close); return render(); }
  if (d.tq) { const t = S.screen === "redeem" ? S.redeem : S.confirm; t.twin = { ...t.twin, [d.tq]: d.v }; return render(); }
  if (d.confirm) { const c = S.conns.find(x => x.id === d.confirm); if (!c) return; S.confirm = { ...c, close: 0, twin: {} }; return go("confirm"); }
  if (d.unlink) { try { const { error } = await sb.rpc("remove_link", { p_link: d.unlink }); if (error) throw error; toast("Removed"); return go("home"); } catch (err) { return showError(friendly(err)); } }
  if (d.copy) {
    try { await navigator.clipboard.writeText(d.copy); toast("Link copied"); }
    catch (_) { const i = $("f-link"); if (i) { i.focus(); i.select(); } toast("Select the link and copy it"); }
    return;
  }
  if (d.share) { try { await navigator.share({ title: "Distant Intention Study", text: "I'd like to link with you in the Distant Intention Study. Join here:", url: inviteUrl(d.share) }); } catch (_) {} return; }
});
$app.addEventListener("change", e => {
  if (e.target.id === "f-irel") S.inv.rel = e.target.value;
  if (e.target.id === "f-rrel" && S.redeem) { S.redeem.rel = e.target.value; render(); }
});
$app.addEventListener("input", e => {
  if (e.target.id === "f-inick") S.inv.nick = e.target.value;
  if (e.target.id === "f-jcode") e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (e.target.id === "f-expt") S.draft.experience_note = e.target.value;
});
$app.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const map = { "f-email": "sendcode", "f-code": "verify", "f-jcode": "checkcode" };
  const a = map[e.target.id]; if (a) { e.preventDefault(); act(a, $app.querySelector(`[data-act="${a}"]`)); }
});

// ---------- start ----------
(async function boot() {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) { S.user = data.session.user; if (location.hash) history.replaceState(null, "", location.pathname); await loadProfile(); return go(nextScreenAfterSignIn()); }
  } catch (e) { /* fall through to welcome */ }
  go("welcome");
})();
sb.auth.onAuthStateChange((evt, session) => {
  if (evt === "SIGNED_OUT" && S.screen !== "under") { S.user = null; }
  // Signed in from the email link (possibly in this tab while it waits on "Check your email").
  if (evt === "SIGNED_IN" && session && !S.user) {
    S.user = session.user;
    if (location.hash) history.replaceState(null, "", location.pathname);
    setTimeout(async () => { try { await loadProfile(); go(nextScreenAfterSignIn()); } catch (e) { showError(friendly(e)); } }, 0);
  }
});
