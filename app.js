// Distant Intention Study · app (step 2: sign-up, questionnaire, invites and links)
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
  <h1>Can they feel you <em>thinking of them?</em></h1>
  <p class="lede">A study of the connection between minds. You'll be paired with someone, usually a stranger and sometimes someone close to you, and try to send or receive a picture.</p></div>
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
  <h2>Ready when <em>you are</em></h2>
  ${needs.length ? `<div class="notice">${needs.length === 1 ? "Someone you invited has" : needs.length + " people you invited have"} joined. Confirm below.</div>` : ""}
  <div class="panel stack"><p class="eyebrow">Play</p>
  <p class="muted">5 rounds · about 5 minutes. If you both enjoy it, you can play again together at the end.</p>
  <button class="btn warm" disabled>Play</button>
  <p class="small faint">The picture test arrives in the next update. Thanks for signing up early!</p></div>
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
  <div class="panel stack"><p class="eyebrow">Leave the study</p>
  <p class="small muted">This permanently deletes your account, your answers and your links. It can't be undone.</p>
  ${S.delStep ? `<p class="small" style="color:var(--alert)">Are you sure? Everything will be deleted.</p><button class="btn ghost danger" data-act="delete">Yes, delete everything</button><button class="btn ghost" data-act="canceldelete">Keep my account</button>`
    : `<button class="btn ghost danger" data-act="askdelete">Delete my account and data</button>`}</div>`
};

function render() { $app.innerHTML = (V[S.screen] || V.home)(); }
async function go(s) {
  S.screen = s;
  if (s === "home") { try { await loadConns(); } catch (e) { S.conns = []; } }
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
