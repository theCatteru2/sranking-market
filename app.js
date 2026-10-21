import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ====================================================
// 1. CREDENCIALES
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

// Solo se solicita historial reciente, sin métricas ni posiciones
const SCOPES = ["user-read-recently-played"];
const REDIRECT_URI = window.location.origin + window.location.pathname;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

// Estado local
let isEditorActive = false;
let spotifyToken = sessionStorage.getItem("spotify_access_token") || null;
let currentStagedOptions = []; // Array de opciones para el nuevo mercado
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];

// Elementos del DOM
const editorSection = document.getElementById("editor-section");
const googleLoginBtn = document.getElementById("google-login-btn");
const marketsGrid = document.getElementById("markets-grid");
const spotifyLoginBtn = document.getElementById("spotify-login-btn");
const spotifyControls = document.getElementById("spotify-controls");
const listContainer = document.getElementById("spotify-results-list");
const selectedOptionsList = document.getElementById("selected-options-list");
const distributionBar = document.getElementById("distribution-bar");
const totalProbIndicator = document.getElementById("total-prob-indicator");
const confirmPublishBtn = document.getElementById("confirm-publish-btn");
const marketTitleInput = document.getElementById("market-title");
const searchInput = document.getElementById("spotify-search-input");

// ====================================================
// 2. AUTENTICACIÓN GOOGLE
// ====================================================
googleLoginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("Error al autenticar:", err);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user && user.email !== ADMIN_EMAIL) {
    alert("Acceso denegado: cuenta no autorizada.");
    await signOut(auth);
    return;
  }

  isEditorActive = !!user;
  editorSection.classList.toggle("hidden", !isEditorActive);
  googleLoginBtn.classList.toggle("hidden", isEditorActive);

  document.querySelectorAll(".admin-card-actions").forEach(el => {
    el.classList.toggle("hidden", !isEditorActive);
  });

  if (isEditorActive) {
    await checkSpotifyRedirect();
    if (spotifyToken) {
      spotifyLoginBtn.classList.add("hidden");
      spotifyControls.classList.remove("hidden");
      loadRecentlyPlayed();
    }
  }
});

// ====================================================
// 3. SPOTIFY API (PKCE - Sin Spoilers de Ranking)
// ====================================================
function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join("");
}

async function generateCodeChallenge(verifier) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

spotifyLoginBtn.addEventListener("click", async () => {
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

  const response = await fetch("https://accounts.spotify.com/api/token", {
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

  const data = await response.json();
  if (data.access_token) {
    spotifyToken = data.access_token;
    sessionStorage.setItem("spotify_access_token", spotifyToken);
  }
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Carga las últimas canciones reproducidas en orden cronológico inverso
async function loadRecentlyPlayed() {
  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=40", {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return handleSessionExpired();
  const data = await res.json();

  // Deduplicación por ID de canción
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
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,artist&limit=10`,
    { headers: { Authorization: `Bearer ${spotifyToken}` } }
  );
  if (!res.ok) return handleSessionExpired();
  const data = await res.json();

  const artists = (data.artists?.items || []).map(a => ({
    id: a.id, name: a.name, subtitle: "Artista",
    imageUrl: a.images[1]?.url || a.images[0]?.url || ""
  }));
  const tracks = (data.tracks?.items || []).map(t => ({
    id: t.id, name: t.name, subtitle: t.artists.map(a => a.name).join(", "),
    imageUrl: t.album?.images[1]?.url || t.album?.images[0]?.url || ""
  }));

  renderSpotifyResults([...artists, ...tracks]);
}

function handleSessionExpired() {
  sessionStorage.removeItem("spotify_access_token");
  spotifyToken = null;
  spotifyLoginBtn.classList.remove("hidden");
  spotifyControls.classList.add("hidden");
}

// Pestañas
document.getElementById("tab-recent-tracks").addEventListener("click", (e) => {
  setActiveTab(e.target);
  searchInput.classList.add("hidden");
  loadRecentlyPlayed();
});

document.getElementById("tab-search").addEventListener("click", (e) => {
  setActiveTab(e.target);
  searchInput.classList.remove("hidden");
  searchInput.focus();
  listContainer.innerHTML = "<p class='empty-hint'>Escribe arriba para buscar en el catálogo.</p>";
});

function setActiveTab(element) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  element.classList.add("active");
}

let searchTimer;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    if (q) searchSpotify(q);
  }, 350);
});

function renderSpotifyResults(items) {
  listContainer.innerHTML = "";
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
    row.querySelector(".add-btn").addEventListener("click", () => addOptionToDraft(item));
    listContainer.appendChild(row);
  });
}

// ====================================================
// 4. CONSTRUCTOR DE MERCADO Y GRÁFICO PREVIO (SUMA 100%)
// ====================================================
function addOptionToDraft(item) {
  if (currentStagedOptions.find(o => o.id === item.id)) {
    return; // Evitar duplicar la misma opción en el mercado
  }

  // Porcentaje inicial por defecto sugerido
  currentStagedOptions.push({
    ...item,
    probability: 0
  });

  renderStagedOptions();
  recalculateProbabilities();
}

function renderStagedOptions() {
  selectedOptionsList.innerHTML = "";
  if (currentStagedOptions.length === 0) {
    selectedOptionsList.innerHTML = "<p class='empty-hint'>Selecciona canciones o artistas de la lista superior para añadirlos a este mercado.</p>";
    return;
  }

  currentStagedOptions.forEach((opt, index) => {
    const row = document.createElement("div");
    row.className = "builder-row";
    row.innerHTML = `
      <div class="builder-row-info">
        <img src="${opt.imageUrl || 'https://via.placeholder.com/34'}" alt="${opt.name}">
        <div class="builder-row-names">
          <strong>${opt.name}</strong>
          <span style="color:var(--text-muted); display:block;">${opt.subtitle}</span>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="number" min="0" max="100" class="builder-prob-input" value="${opt.probability}" data-index="${index}">
        <span>%</span>
        <button class="btn-danger remove-btn" data-index="${index}" style="padding: 6px 10px;">✕</button>
      </div>
    `;

    row.querySelector(".builder-prob-input").addEventListener("input", (e) => {
      currentStagedOptions[index].probability = Number(e.target.value) || 0;
      updateDistributionPreview();
    });

    row.querySelector(".remove-btn").addEventListener("click", () => {
      currentStagedOptions.splice(index, 1);
      renderStagedOptions();
      updateDistributionPreview();
    });

    selectedOptionsList.appendChild(row);
  });
}

function updateDistributionPreview() {
  const sum = currentStagedOptions.reduce((acc, curr) => acc + curr.probability, 0);
  totalProbIndicator.textContent = `Total: ${sum}% / 100%`;

  distributionBar.innerHTML = "";

  if (sum > 0) {
    currentStagedOptions.forEach((opt, idx) => {
      const seg = document.createElement("div");
      seg.className = "dist-segment";
      const color = PALETTE[idx % PALETTE.length];
      seg.style.backgroundColor = color;
      seg.style.width = `${(opt.probability / Math.max(sum, 100)) * 100}%`;
      seg.title = `${opt.name}: ${opt.probability}%`;
      distributionBar.appendChild(seg);
    });
  }

  if (sum === 100 && currentStagedOptions.length >= 2) {
    totalProbIndicator.className = "prob-valid";
    confirmPublishBtn.disabled = false;
    confirmPublishBtn.textContent = "Publicar Mercado";
  } else {
    totalProbIndicator.className = "prob-invalid";
    confirmPublishBtn.disabled = true;
    confirmPublishBtn.textContent = `Debe sumar exactamente 100% (Actual: ${sum}%)`;
  }
}

function recalculateProbabilities() {
  if (currentStagedOptions.length === 0) {
    updateDistributionPreview();
    return;
  }
  // Reparto equitativo inicial
  const base = Math.floor(100 / currentStagedOptions.length);
  const remainder = 100 % currentStagedOptions.length;

  currentStagedOptions.forEach((opt, idx) => {
    opt.probability = base + (idx === 0 ? remainder : 0);
  });

  renderStagedOptions();
  updateDistributionPreview();
}

// ====================================================
// 5. PUBLICACIÓN Y TIEMPO REAL (FIRESTORE)
// ====================================================
confirmPublishBtn.addEventListener("click", async () => {
  const title = marketTitleInput.value.trim();
  if (!title || currentStagedOptions.length < 2) return;

  const docId = "market_" + Date.now();
  await setDoc(doc(db, "markets", docId), {
    title: title,
    options: currentStagedOptions,
    createdAt: Date.now()
  });

  // Resetear formulario
  marketTitleInput.value = "";
  currentStagedOptions = [];
  renderStagedOptions();
  updateDistributionPreview();
});

// Listener en tiempo real del tablero
onSnapshot(collection(db, "markets"), (snapshot) => {
  marketsGrid.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const id = docSnap.id;

    const card = document.createElement("div");
    card.className = "market-card";

    // Barra de distribución multicandidato arriba
    let barSegments = "";
    data.options.forEach((opt, i) => {
      barSegments += `<div class="dist-segment" style="width:${opt.probability}%; background-color:${PALETTE[i % PALETTE.length]};"></div>`;
    });

    // Filas para cada opción del mercado
    let optionsHtml = "";
    data.options.forEach((opt) => {
      optionsHtml += `
        <div class="card-option-row">
          <div class="option-main">
            <div class="option-details">
              <img src="${opt.imageUrl || 'https://via.placeholder.com/38'}" alt="${opt.name}">
              <div class="option-titles">
                <strong>${opt.name}</strong>
                <span>${opt.subtitle}</span>
              </div>
            </div>
            <div class="option-prob-value">${opt.probability}%</div>
          </div>
          <div class="option-bar-container">
            <div class="option-bar-fill" style="width: ${opt.probability}%"></div>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="market-card-title">${data.title}</div>
      <div class="multi-progress-bar">${barSegments}</div>
      <div class="market-card-options">
        ${optionsHtml}
      </div>
      <div class="admin-card-actions ${isEditorActive ? '' : 'hidden'}">
        <span style="font-size:0.75rem; color:var(--text-muted);">ID: ${id}</span>
        <button class="btn-danger delete-market-btn" data-id="${id}" style="padding: 6px 12px; font-size: 0.8rem;">Eliminar Mercado</button>
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
});
