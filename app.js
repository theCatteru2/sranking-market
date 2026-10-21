import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ====================================================
// 1. CONFIGURACIÓN Y ESTADO GLOBAL
// ====================================================
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
const SCOPES = ["user-read-recently-played"];
const REDIRECT_URI = window.location.origin + window.location.pathname;
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

let currentUser = null;
let userData = { stars: 5000, positions: [] };
let activeMarkets = new Map();
let currentStagedOptions = [];
let spotifyToken = sessionStorage.getItem("spotify_access_token") || null;
let activeTradeContext = null;

// Referencias del DOM
const googleLoginBtn = document.getElementById("google-login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminEditorBtn = document.getElementById("admin-editor-btn");
const editorSection = document.getElementById("editor-section");
const portfolioBtn = document.getElementById("portfolio-btn");
const settingsBtn = document.getElementById("settings-btn");
const userBalanceBadge = document.getElementById("user-balance-badge");
const userStarsAmount = document.getElementById("user-stars-amount");
const marketsGrid = document.getElementById("markets-grid");

// Modales
const tradeModal = document.getElementById("trade-modal");
const portfolioModal = document.getElementById("portfolio-modal");
const settingsModal = document.getElementById("settings-modal");

// Elementos de Trade
const tradeSharesInput = document.getElementById("trade-shares-input");
const tradeTotalCost = document.getElementById("trade-total-cost");
const tradePayout = document.getElementById("trade-payout");
const confirmBuyBtn = document.getElementById("confirm-buy-btn");

// ====================================================
// 2. AUTENTICACIÓN Y GESTIÓN DE PERFIL (5,000 ⭐)
// ====================================================
googleLoginBtn.addEventListener("click", () => signInWithPopup(auth, googleProvider));
logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    googleLoginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    portfolioBtn.classList.remove("hidden");
    settingsBtn.classList.remove("hidden");
    userBalanceBadge.classList.remove("hidden");

    // Permisos exclusivos de administración
    if (user.email === ADMIN_EMAIL) {
      adminEditorBtn.classList.remove("hidden");
    }

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
    portfolioBtn.classList.add("hidden");
    settingsBtn.classList.add("hidden");
    adminEditorBtn.classList.add("hidden");
    editorSection.classList.add("hidden");
    userBalanceBadge.classList.add("hidden");
    userData = { stars: 5000, positions: [] };
  }
  renderPortfolio();
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
  updateUIBalance();
}

function updateUIBalance() {
  userStarsAmount.textContent = Number(userData.stars).toLocaleString();
  document.getElementById("stat-available-stars").textContent = `${Number(userData.stars).toLocaleString()} ⭐`;
}

adminEditorBtn.addEventListener("click", () => {
  editorSection.classList.toggle("hidden");
});

// ====================================================
// 3. MOTOR DE MERCADO (AMM - DINÁMICA DE PRECIOS)
// ====================================================
window.openTradeModal = function(marketId, optionId, outcome) {
  if (!currentUser) {
    alert("Inicia sesión con Google para comprar acciones.");
    return;
  }

  const market = activeMarkets.get(marketId);
  if (!market) return;
  const option = market.options.find(o => o.id === optionId);
  if (!option) return;

  const currentPrice = outcome === "YES" ? option.probability : (100 - option.probability);

  activeTradeContext = {
    marketId,
    marketTitle: market.title,
    optionId,
    optionName: option.name,
    optionImg: option.imageUrl,
    outcome,
    price: currentPrice
  };

  document.getElementById("trade-modal-title").textContent = `Comprar Acción: ${outcome}`;
  document.getElementById("trade-target-name").textContent = option.name;
  document.getElementById("trade-target-market").textContent = market.title;
  document.getElementById("trade-target-img").src = option.imageUrl || "https://via.placeholder.com/44";
  
  const badge = document.getElementById("trade-type-badge");
  badge.textContent = outcome;
  badge.className = `trade-type-badge ${outcome === "YES" ? "type-yes" : "type-no"}`;
  
  document.getElementById("trade-share-price").textContent = `${currentPrice} ⭐`;
  tradeSharesInput.value = 10;
  recalcTradeSummary();
  tradeModal.classList.remove("hidden");
};

tradeSharesInput.addEventListener("input", recalcTradeSummary);

function recalcTradeSummary() {
  if (!activeTradeContext) return;
  const shares = Math.max(1, parseInt(tradeSharesInput.value) || 1);
  const cost = shares * activeTradeContext.price;
  const payout = shares * 100;

  tradeTotalCost.textContent = `${cost.toLocaleString()} ⭐`;
  tradePayout.textContent = `${payout.toLocaleString()} ⭐`;

  if (cost > userData.stars) {
    confirmBuyBtn.disabled = true;
    confirmBuyBtn.textContent = "Estrellas insuficientes";
  } else {
    confirmBuyBtn.disabled = false;
    confirmBuyBtn.textContent = `Confirmar Compra (${cost.toLocaleString()} ⭐)`;
  }
}

confirmBuyBtn.addEventListener("click", async () => {
  if (!activeTradeContext || !currentUser) return;
  const shares = Math.max(1, parseInt(tradeSharesInput.value) || 1);
  const cost = shares * activeTradeContext.price;

  if (cost > userData.stars) return;

  // 1. Debitar saldo
  userData.stars -= cost;

  // 2. Registrar en la cartera
  const existingPos = userData.positions.find(
    p => p.marketId === activeTradeContext.marketId && 
         p.optionId === activeTradeContext.optionId && 
         p.outcome === activeTradeContext.outcome
  );

  if (existingPos) {
    const totalSpent = (existingPos.shares * existingPos.avgPrice) + cost;
    existingPos.shares += shares;
    existingPos.avgPrice = Math.round(totalSpent / existingPos.shares);
  } else {
    userData.positions.push({
      marketId: activeTradeContext.marketId,
      marketTitle: activeTradeContext.marketTitle,
      optionId: activeTradeContext.optionId,
      optionName: activeTradeContext.optionName,
      optionImg: activeTradeContext.optionImg,
      outcome: activeTradeContext.outcome,
      shares: shares,
      avgPrice: activeTradeContext.price
    });
  }

  // 3. Aplicar slippage al mercado (Ajuste de probabilidades sumando 100%)
  const market = activeMarkets.get(activeTradeContext.marketId);
  const optIndex = market.options.findIndex(o => o.id === activeTradeContext.optionId);
  
  // Desplazamiento proporcional al tamaño del trade
  const shift = Math.min(12, Math.max(1, Math.round(shares / 10)));
  const delta = activeTradeContext.outcome === "YES" ? shift : -shift;

  applyProbabilityShift(market.options, optIndex, delta);

  // 4. Guardar en Firestore
  await setDoc(doc(db, "users", currentUser.uid), userData);
  await updateDoc(doc(db, "markets", activeTradeContext.marketId), {
    options: market.options
  });

  updateUIBalance();
  tradeModal.classList.add("hidden");
});

// Función de balanceo proporcional para garantizar suma constante de 100%
function applyProbabilityShift(options, targetIdx, delta) {
  const oldVal = options[targetIdx].probability;
  const newVal = Math.min(95, Math.max(5, oldVal + delta));
  const realDelta = newVal - oldVal;

  if (realDelta === 0) return;
  options[targetIdx].probability = newVal;

  // Distribuir el delta inverso entre las demás opciones
  const remainingCount = options.length - 1;
  let remainingDelta = -realDelta;

  options.forEach((opt, idx) => {
    if (idx !== targetIdx) {
      const adjustment = Math.trunc(remainingDelta / remainingCount);
      opt.probability = Math.min(95, Math.max(5, opt.probability + adjustment));
    }
  });

  // Ajuste por redondeo
  const currentSum = options.reduce((sum, o) => sum + o.probability, 0);
  const diff = 100 - currentSum;
  if (diff !== 0) {
    const otherIdx = targetIdx === 0 ? 1 : 0;
    options[otherIdx].probability = Math.min(95, Math.max(5, options[otherIdx].probability + diff));
  }
}

// Venta de posiciones en portafolio
window.sellPosition = async function(posIndex) {
  const pos = userData.positions[posIndex];
  if (!pos || !currentUser) return;

  const market = activeMarkets.get(pos.marketId);
  let currentPrice = pos.avgPrice;

  if (market) {
    const opt = market.options.find(o => o.id === pos.optionId);
    if (opt) {
      currentPrice = pos.outcome === "YES" ? opt.probability : (100 - opt.probability);
      // Desplazamiento inverso al vender
      const optIdx = market.options.findIndex(o => o.id === pos.optionId);
      const shift = Math.min(12, Math.max(1, Math.round(pos.shares / 10)));
      const delta = pos.outcome === "YES" ? -shift : shift;
      applyProbabilityShift(market.options, optIdx, delta);
      await updateDoc(doc(db, "markets", pos.marketId), { options: market.options });
    }
  }

  const proceeds = pos.shares * currentPrice;
  userData.stars += proceeds;
  userData.positions.splice(posIndex, 1);

  await setDoc(doc(db, "users", currentUser.uid), userData);
  updateUIBalance();
  renderPortfolio();
};

// ====================================================
// 4. PORTAFOLIO Y CONFIGURACIÓN (REINICIO)
// ====================================================
portfolioBtn.addEventListener("click", () => {
  renderPortfolio();
  portfolioModal.classList.remove("hidden");
});

settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});

document.getElementById("confirm-reset-btn").addEventListener("click", async () => {
  if (!currentUser) return;
  userData.stars = 5000;
  userData.positions = [];
  await setDoc(doc(db, "users", currentUser.uid), userData);
  updateUIBalance();
  renderPortfolio();
  settingsModal.classList.add("hidden");
  alert("Tu cuenta ha sido reiniciada a 5,000 ⭐ y tus compras han sido canceladas.");
});

function renderPortfolio() {
  const tbody = document.getElementById("portfolio-items-body");
  tbody.innerHTML = "";
  let portfolioTotalValue = 0;

  if (userData.positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">No posees acciones activas en este momento.</td></tr>`;
  } else {
    userData.positions.forEach((pos, idx) => {
      const market = activeMarkets.get(pos.marketId);
      let spotPrice = pos.avgPrice;
      if (market) {
        const opt = market.options.find(o => o.id === pos.optionId);
        if (opt) {
          spotPrice = pos.outcome === "YES" ? opt.probability : (100 - opt.probability);
        }
      }

      const totalVal = pos.shares * spotPrice;
      const initialVal = pos.shares * pos.avgPrice;
      const pnl = totalVal - initialVal;
      const pnlPercent = initialVal > 0 ? ((pnl / initialVal) * 100).toFixed(1) : 0;
      portfolioTotalValue += totalVal;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="${pos.optionImg || 'https://via.placeholder.com/28'}" style="width:28px;height:28px;border-radius:4px;object-fit:cover;">
            <div>
              <strong>${pos.optionName}</strong>
              <span style="display:block;font-size:0.75rem;color:var(--text-muted);">${pos.marketTitle}</span>
            </div>
          </div>
        </td>
        <td><span class="trade-type-badge ${pos.outcome === 'YES' ? 'type-yes' : 'type-no'}">${pos.outcome}</span></td>
        <td>${pos.shares}</td>
        <td>${pos.avgPrice} ⭐</td>
        <td>${spotPrice} ⭐</td>
        <td><strong>${totalVal.toLocaleString()} ⭐</strong></td>
        <td style="color:${pnl >= 0 ? 'var(--green-yes)' : 'var(--red-no)'};">
          ${pnl >= 0 ? '+' : ''}${pnl} ⭐ (${pnlPercent}%)
        </td>
        <td>
          <button class="btn-danger" onclick="sellPosition(${idx})" style="padding:4px 8px;font-size:0.75rem;">Vender</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById("stat-portfolio-value").textContent = `${portfolioTotalValue.toLocaleString()} ⭐`;
  document.getElementById("stat-net-worth").textContent = `${(userData.stars + portfolioTotalValue).toLocaleString()} ⭐`;
}

// Cierre de Modales
document.querySelectorAll(".close-modal-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const target = e.target.getAttribute("data-target");
    document.getElementById(target).classList.add("hidden");
  });
});

// ====================================================
// 5. RENDERIZADO EN TIEMPO REAL DEL TABLERO
// ====================================================
onSnapshot(collection(db, "markets"), (snapshot) => {
  marketsGrid.innerHTML = "";
  activeMarkets.clear();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const id = docSnap.id;
    activeMarkets.set(id, data);

    const sortedOptions = [...data.options].sort((a, b) => b.probability - a.probability);

    let barSegments = "";
    sortedOptions.forEach((opt, i) => {
      barSegments += `<div class="dist-segment" style="width:${opt.probability}%; background-color:${PALETTE[i % PALETTE.length]};" title="${opt.name}: ${opt.probability}%"></div>`;
    });

    let optionsHtml = "";
    sortedOptions.forEach((opt) => {
      const yesPrice = opt.probability;
      const noPrice = 100 - opt.probability;

      optionsHtml += `
        <div class="poly-row">
          <div class="poly-row-left">
            <img class="poly-img" src="${opt.imageUrl || 'https://via.placeholder.com/32'}" alt="${opt.name}">
            <div class="poly-names">
              <span class="poly-title">${opt.name}</span>
              <span class="poly-sub">${opt.subtitle}</span>
            </div>
          </div>
          <div class="poly-row-right">
            <span class="poly-percentage">${opt.probability}%</span>
            <div class="poly-buttons">
              <button class="poly-btn-yes" onclick="openTradeModal('${id}', '${opt.id}', 'YES')">Yes ${yesPrice}¢</button>
              <button class="poly-btn-no" onclick="openTradeModal('${id}', '${opt.id}', 'NO')">No ${noPrice}¢</button>
            </div>
          </div>
        </div>
      `;
    });

    const topImg = sortedOptions[0]?.imageUrl || 'https://via.placeholder.com/44';
    const isOwner = currentUser && currentUser.email === ADMIN_EMAIL;

    const card = document.createElement("div");
    card.className = "market-card";
    card.innerHTML = `
      <div class="market-header-row">
        <img class="market-icon" src="${topImg}" alt="Cover">
        <div style="flex:1;">
          <h3 class="market-card-title">${data.title}</h3>
          <div class="multi-progress-bar">${barSegments}</div>
        </div>
      </div>
      <div class="market-card-options">${optionsHtml}</div>
      <div class="market-footer">
        <span>Volumen: ${Math.floor((data.createdAt || Date.now()) / 100000000)}k ⭐</span>
        <div class="admin-card-actions ${isOwner ? '' : 'hidden'}">
          <button class="btn-danger delete-market-btn" data-id="${id}" style="padding: 4px 10px; font-size: 0.75rem;">Eliminar</button>
        </div>
      </div>
    `;
    marketsGrid.appendChild(card);
  });

  document.querySelectorAll(".delete-market-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      await deleteDoc(doc(db, "markets", id));
    });
  });

  if (currentUser) renderPortfolio();
});

// ====================================================
// 6. SPOTIFY PKCE Y CONSTRUCTOR (MODO EDITOR)
// ====================================================
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
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
});

async function checkSpotifyRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const verifier = sessionStorage.getItem("spotify_verifier");
  if (!code || !verifier) return;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
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
  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=40", {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return;
  const data = await res.json();
  const seen = new Set();
  const uniqueTracks = [];
  (data.items || []).forEach(item => {
    if (!seen.has(item.track.id)) {
      seen.add(item.track.id);
      uniqueTracks.push({
        id: item.track.id,
        name: item.track.name,
        subtitle: item.track.artists.map(a => a.name).join(", "),
        imageUrl: item.track.album.images[1]?.url || item.track.album.images[0]?.url || ""
      });
    }
  });
  renderSpotifyResults(uniqueTracks);
}

async function searchSpotify(query) {
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,artist&limit=10`, {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return;
  const data = await res.json();
  const artists = (data.artists?.items || []).map(a => ({
    id: a.id, name: a.name, subtitle: "Artista", imageUrl: a.images[1]?.url || a.images[0]?.url || ""
  }));
  const tracks = (data.tracks?.items || []).map(t => ({
    id: t.id, name: t.name, subtitle: t.artists.map(a => a.name).join(", "), imageUrl: t.album?.images[1]?.url || t.album?.images[0]?.url || ""
  }));
  renderSpotifyResults([...artists, ...tracks]);
}

function renderSpotifyResults(items) {
  const container = document.getElementById("spotify-results-list");
  container.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `
      <div class="result-left">
        <img src="${item.imageUrl || 'https://via.placeholder.com/40'}" alt="${item.name}">
        <div class="result-info">
          <span class="result-name">${item.name}</span>
          <span class="result-sub">${item.subtitle}</span>
        </div>
      </div>
      <button class="btn-secondary add-btn">+ Añadir</button>
    `;
    row.querySelector(".add-btn").addEventListener("click", () => {
      if (!currentStagedOptions.find(o => o.id === item.id)) {
        currentStagedOptions.push({ ...item, probability: 0 });
        recalculateDraftProbabilities();
      }
    });
    container.appendChild(row);
  });
}

function recalculateDraftProbabilities() {
  const total = currentStagedOptions.length;
  if (total === 0) return renderDraftOptions();
  const base = Math.floor(100 / total);
  const remainder = 100 % total;
  currentStagedOptions.forEach((o, i) => o.probability = base + (i === 0 ? remainder : 0));
  renderDraftOptions();
}

function renderDraftOptions() {
  const list = document.getElementById("selected-options-list");
  list.innerHTML = "";
  if (currentStagedOptions.length === 0) {
    list.innerHTML = "<p class='empty-hint'>Añade opciones desde la lista superior.</p>";
  } else {
    currentStagedOptions.forEach((opt, idx) => {
      const row = document.createElement("div");
      row.className = "builder-row";
      row.innerHTML = `
        <div class="builder-row-info">
          <img src="${opt.imageUrl || 'https://via.placeholder.com/34'}">
          <div class="builder-row-names"><strong>${opt.name}</strong></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="number" class="builder-prob-input" value="${opt.probability}" data-idx="${idx}">%
          <button class="btn-danger" onclick="removeDraftOption(${idx})" style="padding:4px 8px;">✕</button>
        </div>
      `;
      row.querySelector(".builder-prob-input").addEventListener("input", (e) => {
        currentStagedOptions[idx].probability = parseInt(e.target.value) || 0;
        updateDraftDistribution();
      });
      list.appendChild(row);
    });
  }
  updateDraftDistribution();
}

window.removeDraftOption = function(idx) {
  currentStagedOptions.splice(idx, 1);
  recalculateDraftProbabilities();
};

function updateDraftDistribution() {
  const bar = document.getElementById("distribution-bar");
  const indicator = document.getElementById("total-prob-indicator");
  const publishBtn = document.getElementById("confirm-publish-btn");
  const sum = currentStagedOptions.reduce((acc, c) => acc + c.probability, 0);

  indicator.textContent = `Total: ${sum}% / 100%`;
  bar.innerHTML = "";

  if (sum > 0) {
    currentStagedOptions.forEach((opt, i) => {
      const seg = document.createElement("div");
      seg.className = "dist-segment";
      seg.style.backgroundColor = PALETTE[i % PALETTE.length];
      seg.style.width = `${(opt.probability / Math.max(sum, 100)) * 100}%`;
      bar.appendChild(seg);
    });
  }

  const isValid = sum === 100 && currentStagedOptions.length >= 2;
  indicator.className = isValid ? "prob-valid" : "prob-invalid";
  publishBtn.disabled = !isValid;
}

document.getElementById("confirm-publish-btn").addEventListener("click", async () => {
  const title = document.getElementById("market-title").value.trim();
  if (!title || currentStagedOptions.length < 2) return;

  const docId = "market_" + Date.now();
  await setDoc(doc(db, "markets", docId), {
    title,
    options: currentStagedOptions,
    createdAt: Date.now()
  });

  document.getElementById("market-title").value = "";
  currentStagedOptions = [];
  renderDraftOptions();
  editorSection.classList.add("hidden");
});

// Pestañas y búsqueda en editor
document.getElementById("tab-recent-tracks").addEventListener("click", (e) => {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  document.getElementById("spotify-search-input").classList.add("hidden");
  loadRecentlyPlayed();
});

document.getElementById("tab-search").addEventListener("click", (e) => {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  const input = document.getElementById("spotify-search-input");
  input.classList.remove("hidden");
  input.focus();
});

let searchTimeout;
document.getElementById("spotify-search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const q = e.target.value.trim();
    if (q) searchSpotify(q);
  }, 350);
});
