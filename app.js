import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ====================================================
// 1. REEMPLAZA ESTOS 3 DATOS CON LOS TUYOS
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

// ====================================================
// 2. INICIALIZACIÓN Y LOGIN CON GOOGLE
// ====================================================
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = ["user-top-read"];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

let isEditorActive = false;
let spotifyToken = sessionStorage.getItem("spotify_access_token") || null;
let currentSelectedItem = null;

const editorSection = document.getElementById("editor-section");
const googleLoginBtn = document.getElementById("google-login-btn");
const marketsGrid = document.getElementById("markets-grid");
const spotifyLoginBtn = document.getElementById("spotify-login-btn");
const spotifyControls = document.getElementById("spotify-controls");
const listContainer = document.getElementById("spotify-results-list");
const publishForm = document.getElementById("publish-form");

googleLoginBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("Error al iniciar sesión con Google:", err);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user && user.email !== ADMIN_EMAIL) {
    alert("Esta cuenta no tiene permisos de editor.");
    await signOut(auth);
    return;
  }

  isEditorActive = !!user;
  editorSection.classList.toggle("hidden", !isEditorActive);
  googleLoginBtn.classList.toggle("hidden", isEditorActive);

  document.querySelectorAll(".admin-controls").forEach(el => {
    el.classList.toggle("hidden", !isEditorActive);
  });

  if (isEditorActive) {
    await checkSpotifyRedirect();
    if (spotifyToken) {
      spotifyLoginBtn.classList.add("hidden");
      spotifyControls.classList.remove("hidden");
      loadTopTracks();
    }
  }
});

// ====================================================
// 3. CONEXIÓN CON SPOTIFY API (PKCE)
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

async function loadTopTracks() {
  const res = await fetch("https://api.spotify.com/v1/me/top/tracks?limit=15&time_range=short_term", {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return handleExpiredSpotifyToken();
  const data = await res.json();
  renderSpotifyList((data.items || []).map(t => ({
    type: "track",
    id: t.id,
    name: t.name,
    subtitle: t.artists.map(a => a.name).join(", "),
    imageUrl: t.album.images[1]?.url || t.album.images[0]?.url || ""
  })));
}

async function loadTopArtists() {
  const res = await fetch("https://api.spotify.com/v1/me/top/artists?limit=15&time_range=short_term", {
    headers: { Authorization: `Bearer ${spotifyToken}` }
  });
  if (!res.ok) return handleExpiredSpotifyToken();
  const data = await res.json();
  renderSpotifyList((data.items || []).map(a => ({
    type: "artist",
    id: a.id,
    name: a.name,
    subtitle: a.genres.slice(0, 2).join(", ") || "Artista",
    imageUrl: a.images[1]?.url || a.images[0]?.url || ""
  })));
}

async function searchCatalog(query) {
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,artist&limit=8`,
    { headers: { Authorization: `Bearer ${spotifyToken}` } }
  );
  if (!res.ok) return handleExpiredSpotifyToken();
  const data = await res.json();

  const artists = (data.artists?.items || []).map(a => ({
    type: "artist", id: a.id, name: a.name, subtitle: "Artista",
    imageUrl: a.images[1]?.url || a.images[0]?.url || ""
  }));
  const tracks = (data.tracks?.items || []).map(t => ({
    type: "track", id: t.id, name: t.name, subtitle: t.artists.map(a => a.name).join(", "),
    imageUrl: t.album?.images[1]?.url || t.album?.images[0]?.url || ""
  }));
  renderSpotifyList([...artists, ...tracks]);
}

function handleExpiredSpotifyToken() {
  sessionStorage.removeItem("spotify_access_token");
  spotifyToken = null;
  spotifyLoginBtn.classList.remove("hidden");
  spotifyControls.classList.add("hidden");
}

document.getElementById("tab-top-tracks").addEventListener("click", (e) => {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  loadTopTracks();
});

document.getElementById("tab-top-artists").addEventListener("click", (e) => {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  e.target.classList.add("active");
  loadTopArtists();
});

let searchTimeout;
document.getElementById("spotify-search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const q = e.target.value.trim();
    if (q) searchCatalog(q);
    else loadTopTracks();
  }, 350);
});

function renderSpotifyList(items) {
  listContainer.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "result-item";
    row.innerHTML = `
      <img src="${item.imageUrl || 'https://via.placeholder.com/42'}" alt="${item.name}">
      <div class="result-info">
        <span class="result-name">${item.name}</span>
        <span class="result-sub">${item.subtitle}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      currentSelectedItem = item;
      publishForm.classList.remove("hidden");
      document.getElementById("preview-img").src = item.imageUrl || "https://via.placeholder.com/56";
      document.getElementById("preview-title").textContent = item.name;
      document.getElementById("preview-subtitle").textContent = item.subtitle;
      document.getElementById("market-title").focus();
    });
    listContainer.appendChild(row);
  });
}

// ====================================================
// 4. GUARDADO Y LECTURA EN TIEMPO REAL (FIRESTORE)
// ====================================================
document.getElementById("confirm-publish-btn").addEventListener("click", async () => {
  const title = document.getElementById("market-title").value.trim();
  const prob = Number(document.getElementById("item-prob").value);

  if (!currentSelectedItem || !title || isNaN(prob)) return;

  const docId = `${currentSelectedItem.type}_${currentSelectedItem.id}`;
  await setDoc(doc(db, "markets", docId), {
    marketTitle: title,
    itemName: currentSelectedItem.name,
    itemSubtitle: currentSelectedItem.subtitle,
    probability: Math.min(100, Math.max(0, prob)),
    imageUrl: currentSelectedItem.imageUrl,
    updatedAt: Date.now()
  });

  publishForm.classList.add("hidden");
  document.getElementById("market-title").value = "";
  document.getElementById("item-prob").value = "";
  currentSelectedItem = null;
});

onSnapshot(collection(db, "markets"), (snapshot) => {
  marketsGrid.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const id = docSnap.id;
    const noProb = 100 - data.probability;

    const card = document.createElement("div");
    card.className = "market-card";
    card.innerHTML = `
      <div class="card-header">
        <img src="${data.imageUrl || 'https://via.placeholder.com/52'}" alt="${data.itemName}">
        <div>
          <div class="card-question">${data.marketTitle}</div>
          <div class="item-title">${data.itemName}</div>
          <div class="item-subtitle">${data.itemSubtitle || ""}</div>
        </div>
      </div>

      <div class="prob-display">
        <span class="prob-number">${data.probability}%</span>
        <span class="card-question">Probabilidad</span>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" style="width: ${data.probability}%"></div>
      </div>

      <div class="shares-buttons">
        <button class="btn-yes">Yes ${data.probability}¢</button>
        <button class="btn-no">No ${noProb}¢</button>
      </div>

      <div class="admin-controls ${isEditorActive ? '' : 'hidden'}">
        <input type="range" min="0" max="100" value="${data.probability}" data-id="${id}" class="quick-slider">
        <button class="btn-danger delete-btn" data-id="${id}">Eliminar</button>
      </div>
    `;
    marketsGrid.appendChild(card);
  });

  document.querySelectorAll(".quick-slider").forEach(slider => {
    slider.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      await updateDoc(doc(db, "markets", id), { probability: Number(e.target.value) });
    });
  });

  document.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      await deleteDoc(doc(db, "markets", id));
    });
  });
});