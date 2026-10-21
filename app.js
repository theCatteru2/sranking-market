import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDvm4QUpWVEhigb3xtckbPoCmYt5tdk8uA",
  authDomain: "ranking-a703b.firebaseapp.com",
  projectId: "ranking-a703b",
  storageBucket: "ranking-a703b.firebasestorage.app",
  messagingSenderId: "1052400903567",
  appId: "1:1052400903567:web:16fba0dbc8cd6ae94b57fa"
};

const ADMIN_EMAIL = "tizianomferro@gmail.com"; 
const SPOTIFY_CLIENT_ID = "9b28d325cf6b49f6b389b6808ca1b7f0";
const REDIRECT_URI = window.location.origin + window.location.pathname;
const PALETTE = ["#00c076", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

let currentUser = null;
let userData = { stars: 5000, positions: [] };
let currentMarket = null;
let currentMarketId = null;
let selectedOption = null;
let selectedOutcome = "YES";
let currentStagedOptions = [];
let spotifyToken = sessionStorage.getItem("spotify_access_token") || null;

const googleLoginBtn = document.getElementById("google-login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminEditorBtn = document.getElementById("admin-editor-btn");
const editorSection = document.getElementById("editor-section");
const closeEditorBtn = document.getElementById("close-editor-btn");
const userBalanceBadge = document.getElementById("user-balance-badge");
const userStarsAmount = document.getElementById("user-stars-amount");
const portfolioBtn = document.getElementById("portfolio-btn");
const settingsBtn = document.getElementById("settings-btn");

const slipTargetImg = document.getElementById("slip-target-img");
const slipTargetName = document.getElementById("slip-target-name");
const slipTargetSub = document.getElementById("slip-target-sub");
const slipBtnYes = document.getElementById("slip-btn-yes");
const slipBtnNo = document.getElementById("slip-btn-no");
const slipYesPrice = document.getElementById("slip-yes-price");
const slipNoPrice = document.getElementById("slip-no-price");
const tradeAmountInput = document.getElementById("trade-amount-input");
const slipBalanceHint = document.getElementById("slip-balance-hint");
const slipToWinAmount = document.getElementById("slip-to-win-amount");
const slipAvgPriceDisplay = document.getElementById("slip-avg-price-display");
const executeTradeBtn = document.getElementById("execute-trade-btn");

// AUTH
googleLoginBtn.addEventListener("click", () => signInWithPopup(auth, googleProvider));
logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    googleLoginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    userBalanceBadge.classList.remove("hidden");
    portfolioBtn.classList.remove("hidden");
    settingsBtn.classList.remove("hidden");
    if (user.email === ADMIN_EMAIL) adminEditorBtn.classList.remove("hidden");

    await loadOrCreateUserProfile(user);
    await checkSpotifyRedirect();
    if (spotifyToken && user.email === ADMIN_EMAIL) {
      document.getElementById("spotify-login-btn").classList.add("hidden");
      document.getElementById("spotify-controls").classList.remove("hidden");
      loadRecentlyPlayed();
    }
  } else {
    googleLoginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
    userBalanceBadge.classList.add("hidden");
    portfolioBtn.classList.add("hidden");
    settingsBtn.classList.add("hidden");
    adminEditorBtn.classList.add("hidden");
    editorSection.classList.add("hidden");
    userData = { stars: 5000, positions: [] };
  }
  updateUI();
});

async function loadOrCreateUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    userData = snap.data();
    if (!userData.positions) userData.positions = [];
  } else {
    userData = { email: user.email, stars: 5000, positions: [] };
    await setDoc(userRef, userData);
  }
  updateUI();
}

function updateUI() {
  userStarsAmount.textContent = Number(userData.stars).toLocaleString();
  slipBalanceHint.textContent = `Balance ⭐ ${Number(userData.stars).toLocaleString()}`;
  document.getElementById("stat-available-stars").textContent = `${Number(userData.stars).toLocaleString()} ⭐`;
  recalculateSlip();
}

// LECTURA EN TIEMPO REAL
onSnapshot(collection(db, "markets"), (snapshot) => {
  if (snapshot.empty) {
    document.getElementById("display-market-title").textContent = "Sin mercados creados. Usa el Modo Editor para crear uno.";
    return;
  }

  snapshot.forEach(docSnap => {
    currentMarketId = docSnap.id;
    currentMarket = docSnap.data();
  });

  renderMarketView();
});

function renderMarketView() {
  if (!currentMarket || !currentMarket.options) return;

  document.getElementById("display-market-title").textContent = currentMarket.title;
  document.getElementById("display-market-vol").textContent = `⭐ ${Number(currentMarket.volume || 1845000).toLocaleString()} Vol.`;
  
  const sorted = [...currentMarket.options].sort((a, b) => b.probability - a.probability);
  document.getElementById("market-main-img").src = sorted[0]?.imageUrl || "";

  if (!selectedOption || !sorted.some(o => o.id === selectedOption.id)) {
    selectedOption = sorted[0];
  }

  const tbody = document.getElementById("outcomes-tbody");
  tbody.innerHTML = "";

  sorted.forEach(opt => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="outcome-cell-info">
          <img class="outcome-cell-img" src="${opt.imageUrl || ''}" alt="${opt.name}">
          <div class="outcome-cell-names">
            <strong>${opt.name}</strong>
            <span>${opt.subtitle || 'Spotify Track'}</span>
          </div>
        </div>
      </td>
      <td style="text-align: right;">
        <span class="outcome-chance-val">${opt.probability}%</span>
      </td>
      <td>
        <div class="table-buttons-cell">
          <button class="tbl-btn-yes" data-id="${opt.id}">Buy Yes ${opt.probability}¢</button>
          <button class="tbl-btn-no" data-id="${opt.id}">Buy No ${100 - opt.probability}¢</button>
        </div>
      </td>
    `;

    tr.querySelector(".tbl-btn-yes").addEventListener("click", () => {
      selectedOption = opt;
      selectedOutcome = "YES";
      updateSlipView();
    });

    tr.querySelector(".tbl-btn-no").addEventListener("click", () => {
      selectedOption = opt;
      selectedOutcome = "NO";
      updateSlipView();
    });

    tbody.appendChild(tr);
  });

  updateSlipView();
  renderSvgChart(sorted);
}

// GRÁFICO SVG NATIVO (Sin librerías externas)
function renderSvgChart(options) {
  const svg = document.getElementById("polySvgChart");
  const legendBox = document.getElementById("chart-legend-row");
  legendBox.innerHTML = "";
  svg.innerHTML = "";

  // Cuadrícula horizontal del gráfico
  [20, 40, 60, 80].forEach(pct => {
    const y = 240 - (pct / 100) * 220;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", y);
    line.setAttribute("x2", "800");
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(255,255,255,0.05)");
    line.setAttribute("stroke-dasharray", "4");
    svg.appendChild(line);
  });

  options.slice(0, 5).forEach((opt, idx) => {
    const color = PALETTE[idx % PALETTE.length];

    // Leyenda
    const legItem = document.createElement("div");
    legItem.className = "chart-legend-item";
    legItem.innerHTML = `<span class="legend-dot" style="background:${color}"></span> ${opt.name} <strong>${opt.probability}%</strong>`;
    legendBox.appendChild(legItem);

    // Trazado de línea simulada que llega a su probabilidad actual
    const base = opt.probability;
    const points = [
      { x: 0,   y: Math.max(5, base - (4 - idx * 2)) },
      { x: 160, y: Math.max(5, base + (idx * 2 - 2)) },
      { x: 320, y: Math.max(5, base - 2) },
      { x: 480, y: Math.max(5, base + 3) },
      { x: 640, y: Math.max(5, base - 1) },
      { x: 800, y: base }
    ];

    let d = "";
    points.forEach((p, i) => {
      const cy = 240 - (p.y / 100) * 220;
      d += `${i === 0 ? "M" : "L"} ${p.x} ${cy} `;
    });

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2.5");
    svg.appendChild(path);

    // Punto terminal
    const endCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    endCircle.setAttribute("cx", "800");
    endCircle.setAttribute("cy", 240 - (base / 100) * 220);
    endCircle.setAttribute("r", "4");
    endCircle.setAttribute("fill", color);
    svg.appendChild(endCircle);
  });
}

// SLIP DE TRADING
function updateSlipView() {
  if (!selectedOption) return;

  slipTargetImg.src = selectedOption.imageUrl || "";
  slipTargetName.textContent = selectedOption.name;
  slipTargetSub.textContent = selectedOption.subtitle || "Spotify Outcome";

  slipYesPrice.textContent = `${selectedOption.probability}¢`;
  slipNoPrice.textContent = `${100 - selectedOption.probability}¢`;

  slipBtnYes.className = `slip-outcome-btn ${selectedOutcome === "YES" ? "active-yes" : ""}`;
  slipBtnNo.className = `slip-outcome-btn ${selectedOutcome === "NO" ? "active-no" : ""}`;

  recalculateSlip();
}

slipBtnYes.addEventListener("click", () => { selectedOutcome = "YES"; updateSlipView(); });
slipBtnNo.addEventListener("click", () => { selectedOutcome = "NO"; updateSlipView(); });
tradeAmountInput.addEventListener("input", recalculateSlip);

document.querySelectorAll(".quick-chip[data-add]").forEach(btn => {
  btn.addEventListener("click", () => {
    tradeAmountInput.value = (parseInt(tradeAmountInput.value) || 0) + parseInt(btn.getAttribute("data-add"));
    recalculateSlip();
  });
});

document.getElementById("quick-max-btn").addEventListener("click", () => {
  tradeAmountInput.value = userData.stars;
  recalculateSlip();
});

function recalculateSlip() {
  if (!selectedOption) return;
  const price = selectedOutcome === "YES" ? selectedOption.probability : (100 - selectedOption.probability);
  const amount = Math.max(1, parseInt(tradeAmountInput.value) || 0);

  slipAvgPriceDisplay.textContent = `${price}¢`;
  const potentialWin = Math.round(amount / (price / 100));
  slipToWinAmount.textContent = `⭐ ${potentialWin.toLocaleString()}`;

  if (amount > userData.stars) {
    executeTradeBtn.disabled = true;
    executeTradeBtn.style.opacity = "0.5";
    executeTradeBtn.textContent = "Balance Insuficiente";
  } else {
    executeTradeBtn.disabled = false;
    executeTradeBtn.style.opacity = "1";
    executeTradeBtn.textContent = `Trade ⭐ ${amount.toLocaleString()}`;
  }
}

executeTradeBtn.addEventListener("click", async () => {
  if (!currentUser) return alert("Inicia sesión con Google para operar.");
  const amount = parseInt(tradeAmountInput.value) || 0;
  if (amount <= 0 || amount > userData.stars) return;

  const price = selectedOutcome === "YES" ? selectedOption.probability : (100 - selectedOption.probability);
  const shares = Math.round(amount / (price / 100));

  userData.stars -= amount;
  userData.positions.push({
    optionName: selectedOption.name,
    outcome: selectedOutcome,
    invested: amount,
    shares: shares
  });

  const optIdx = currentMarket.options.findIndex(o => o.id === selectedOption.id);
  const delta = selectedOutcome === "YES" ? 2 : -2;
  applyProbabilityShift(currentMarket.options, optIdx, delta);

  await setDoc(doc(db, "users", currentUser.uid), userData);
  await updateDoc(doc(db, "markets", currentMarketId), {
    options: currentMarket.options,
    volume: (currentMarket.volume || 1845000) + amount
  });

  updateUI();
});

function applyProbabilityShift(options, targetIdx, delta) {
  const oldVal = options[targetIdx].probability;
  const newVal = Math.min(95, Math.max(5, oldVal + delta));
  const diff = newVal - oldVal;
  if (diff === 0) return;

  options[targetIdx].probability = newVal;
  const others = options.length - 1;
  options.forEach((opt, idx) => {
    if (idx !== targetIdx) {
      opt.probability = Math.min(95, Math.max(1, opt.probability - Math.round(diff / others)));
    }
  });

  const sum = options.reduce((s, o) => s + o.probability, 0);
  const adjust = 100 - sum;
  if (adjust !== 0) {
    const oIdx = targetIdx === 0 ? 1 : 0;
    options[oIdx].probability += adjust;
  }
}

// PORTAFOLIO Y RESET
portfolioBtn.addEventListener("click", () => {
  renderPortfolio();
  document.getElementById("portfolio-modal").classList.remove("hidden");
});

settingsBtn.addEventListener("click", () => {
  document.getElementById("settings-modal").classList.remove("hidden");
});

document.getElementById("confirm-reset-btn").addEventListener("click", async () => {
  if (!currentUser) return;
  userData.stars = 5000;
  userData.positions = [];
  await setDoc(doc(db, "users", currentUser.uid), userData);
  updateUI();
  document.getElementById("settings-modal").classList.add("hidden");
  alert("Balance reiniciado a 5,000 ⭐");
});

function renderPortfolio() {
  const tbody = document.getElementById("portfolio-items-body");
  tbody.innerHTML = "";
  let total = 0;
  userData.positions.forEach(pos => {
    total += pos.invested;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${pos.optionName}</strong></td>
      <td><span style="color:${pos.outcome === 'YES' ? 'var(--poly-green)' : 'var(--poly-red)'}; font-weight:700;">${pos.outcome}</span></td>
      <td>⭐ ${pos.invested.toLocaleString()} (${pos.shares} acciones)</td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById("stat-portfolio-value").textContent = `⭐ ${total.toLocaleString()}`;
  document.getElementById("stat-net-worth").textContent = `⭐ ${(userData.stars + total).toLocaleString()}`;
}

document.querySelectorAll(".close-modal-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
  });
});

// SPOTIFY & EDITOR
adminEditorBtn.addEventListener("click", () => editorSection.classList.remove("hidden"));
closeEditorBtn.addEventListener("click", () => editorSection.classList.add("hidden"));

function generateRandomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
}

async function generateCodeChallenge(verifier) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

document.getElementById("spotify-login-btn").addEventListener("click", async () => {
  const verifier = generateRandomString(128);
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("spotify_verifier", verifier);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI,
    scope: "user-read-recently-played", code_challenge_method: "S256", code_challenge: challenge
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
});

async function checkSpotifyRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const verifier = sessionStorage.getItem("spotify_verifier");
  if (!code || !verifier) return;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID, grant_type: "authorization_code", code,
      redirect_uri: REDIRECT_URI, code_verifier: verifier
    })
  });
  const data = await res.json();
  if (data.access_token) {
    spotifyToken = data.access_token;
    sessionStorage.setItem("spotify_access_token", spotifyToken);
  }
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function loadRecentlyPlayed() {
  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=30", {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return;
  const data = await res.json();
  const seen = new Set();
  const tracks = [];
  (data.items || []).forEach(item => {
    if (!seen.has(item.track.id)) {
      seen.add(item.track.id);
      tracks.push({
        id: item.track.id, name: item.track.name,
        subtitle: item.track.artists.map(a => a.name).join(", "),
        imageUrl: item.track.album.images[1]?.url || ""
      });
    }
  });
  renderEditorResults(tracks);
}

document.getElementById("tab-recent-tracks").addEventListener("click", () => {
  document.getElementById("spotify-search-input").classList.add("hidden");
  loadRecentlyPlayed();
});

document.getElementById("tab-search").addEventListener("click", () => {
  const input = document.getElementById("spotify-search-input");
  input.classList.remove("hidden");
  input.focus();
});

document.getElementById("spotify-search-input").addEventListener("input", async (e) => {
  const q = e.target.value.trim();
  if (!q) return;
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track,artist&limit=8`, {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  const data = await res.json();
  const items = [
    ...(data.tracks?.items || []).map(t => ({ id: t.id, name: t.name, subtitle: t.artists.map(a=>a.name).join(", "), imageUrl: t.album.images[1]?.url || "" })),
    ...(data.artists?.items || []).map(a => ({ id: a.id, name: a.name, subtitle: "Artista", imageUrl: a.images[1]?.url || "" }))
  ];
  renderEditorResults(items);
});

function renderEditorResults(items) {
  const box = document.getElementById("spotify-results-list");
  box.innerHTML = "";
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "result-item";
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <img src="${item.imageUrl || ''}">
        <div style="font-size:0.8rem;"><strong>${item.name}</strong><br><span style="color:#8292a8;">${item.subtitle}</span></div>
      </div>
      <button class="btn-primary-blue" style="padding:4px 8px;font-size:0.75rem;">+ Añadir</button>
    `;
    div.querySelector("button").addEventListener("click", () => {
      if (!currentStagedOptions.some(o => o.id === item.id)) {
        currentStagedOptions.push({ ...item, probability: 0 });
        recalcEditorProbs();
      }
    });
    box.appendChild(div);
  });
}

function recalcEditorProbs() {
  const count = currentStagedOptions.length;
  if (!count) return renderEditorStaged();
  const base = Math.floor(100 / count);
  currentStagedOptions.forEach((o, i) => o.probability = base + (i === 0 ? 100 % count : 0));
  renderEditorStaged();
}

function renderEditorStaged() {
  const list = document.getElementById("selected-options-list");
  list.innerHTML = "";
  currentStagedOptions.forEach((opt, idx) => {
    const row = document.createElement("div");
    row.className = "builder-row";
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <img src="${opt.imageUrl}">
        <span style="font-size:0.85rem;">${opt.name}</span>
      </div>
      <div>
        <input type="number" class="builder-prob-input" value="${opt.probability}" data-idx="${idx}">%
        <button class="btn-icon" data-del="${idx}">✕</button>
      </div>
    `;
    row.querySelector("input").addEventListener("input", (e) => {
      currentStagedOptions[idx].probability = parseInt(e.target.value) || 0;
      updateEditorBar();
    });
    row.querySelector("[data-del]").addEventListener("click", () => {
      currentStagedOptions.splice(idx, 1);
      recalcEditorProbs();
    });
    list.appendChild(row);
  });
  updateEditorBar();
}

function updateEditorBar() {
  const sum = currentStagedOptions.reduce((s, o) => s + o.probability, 0);
  const ind = document.getElementById("total-prob-indicator");
  const bar = document.getElementById("distribution-bar");
  const btn = document.getElementById("confirm-publish-btn");

  ind.textContent = `Total: ${sum}% / 100%`;
  bar.innerHTML = "";
  currentStagedOptions.forEach((o, i) => {
    const seg = document.createElement("div");
    seg.className = "dist-segment";
    seg.style.width = `${o.probability}%`;
    seg.style.backgroundColor = PALETTE[i % PALETTE.length];
    bar.appendChild(seg);
  });

  const valid = sum === 100 && currentStagedOptions.length >= 2;
  ind.className = valid ? "prob-valid" : "prob-invalid";
  btn.disabled = !valid;
}

document.getElementById("confirm-publish-btn").addEventListener("click", async () => {
  const title = document.getElementById("market-title").value.trim();
  if (!title) return;

  await setDoc(doc(db, "markets", "market_" + Date.now()), {
    title,
    options: currentStagedOptions,
    volume: 1845000,
    createdAt: Date.now()
  });

  editorSection.classList.add("hidden");
  currentStagedOptions = [];
});
