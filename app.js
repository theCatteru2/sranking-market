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

// Estados globales
let currentUser = null;
let userData = { stars: 5000, positions: [] };
let allMarkets = new Map();
let currentMarket = null;
let currentMarketId = null;
let selectedOption = null;
let selectedOutcome = "YES";
let currentStagedOptions = [];
let spotifyToken = sessionStorage.getItem("spotify_access_token") || null;

// Estados del Editor
let editorMode = "multi";
let binarySelectedTrack = null;
let binaryYesProb = 50;

// Configuración del Gráfico
let chartConfig = {
  viewMode: "multi",
  autoScale: true,
  timeframe: "ALL"
};
let chartDataCache = [];
let activeTimeLabels = [];

// Elementos de Navegación
const homeView = document.getElementById("home-view");
const marketDetailView = document.getElementById("market-detail-view");
const marketsCatalogGrid = document.getElementById("markets-catalog-grid");
const marketsCountBadge = document.getElementById("markets-count-badge");
const brandHomeBtn = document.getElementById("brand-home-btn");
const navMarketsBtn = document.getElementById("nav-markets-btn");
const backToHomeBtn = document.getElementById("back-to-home-btn");

// Botones y Modales
const googleLoginBtn = document.getElementById("google-login-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminEditorBtn = document.getElementById("admin-editor-btn");
const editorSection = document.getElementById("editor-section");
const userBalanceBadge = document.getElementById("user-balance-badge");
const userStarsAmount = document.getElementById("user-stars-amount");
const portfolioBtn = document.getElementById("portfolio-btn");
const settingsBtn = document.getElementById("settings-btn");

const adminResolveMarketBtn = document.getElementById("admin-resolve-market-btn");
const resolveModal = document.getElementById("resolve-modal");
const resolveOptionsList = document.getElementById("resolve-options-list");
const marketResolvedBanner = document.getElementById("market-resolved-banner");
const resolvedWinnerText = document.getElementById("resolved-winner-text");

// Order Slip
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

// ====================================================
// 1. MANEJO DE VISTAS (HOME <-> DETALLE)
// ====================================================
function showHomeView() {
  marketDetailView.classList.add("hidden");
  homeView.classList.remove("hidden");
  window.scrollTo(0, 0);
}

function showDetailView(marketId) {
  if (!allMarkets.has(marketId)) return;
  currentMarketId = marketId;
  currentMarket = allMarkets.get(marketId);

  homeView.classList.add("hidden");
  marketDetailView.classList.remove("hidden");
  window.scrollTo(0, 0);

  renderMarketView();
}

brandHomeBtn.addEventListener("click", showHomeView);
navMarketsBtn.addEventListener("click", showHomeView);
backToHomeBtn.addEventListener("click", showHomeView);

// ====================================================
// 2. AUTHENTICATION Y PERFIL DE USUARIO
// ====================================================
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
  processResolvedMarketPayouts();
  updateUI();
}

function updateUI() {
  userStarsAmount.textContent = Number(userData.stars).toLocaleString();
  slipBalanceHint.textContent = `Balance ⭐ ${Number(userData.stars).toLocaleString()}`;
  document.getElementById("stat-available-stars").textContent = `${Number(userData.stars).toLocaleString()} ⭐`;
  recalculateSlip();
}

// ====================================================
// 3. GENERADOR DE HISTORIAL BASE
// ====================================================
function createInitialHistorySnapshots(options) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const history = [];
  const points = 7;

  for (let i = points - 1; i >= 0; i--) {
    const timestamp = now - i * (dayMs * 2);
    const snapshotValues = {};

    options.forEach((opt, idx) => {
      if (i === 0) {
        snapshotValues[opt.id] = opt.probability;
      } else {
        const volatility = i * 1.5;
        const wave = Math.sin((idx * 2 + (points - i)) * 1.2) * volatility;
        snapshotValues[opt.id] = Math.max(1, Math.min(99, Math.round(opt.probability + wave)));
      }
    });

    history.push({ timestamp, values: snapshotValues });
  }

  return history;
}

// ====================================================
// 4. LECTURA EN TIEMPO REAL
// ====================================================
onSnapshot(collection(db, "markets"), async (snapshot) => {
  allMarkets.clear();

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const id = docSnap.id;

    if (!data.history || !Array.isArray(data.history) || data.history.length === 0) {
      data.history = createInitialHistorySnapshots(data.options);
      await updateDoc(doc(db, "markets", id), { history: data.history });
    }

    allMarkets.set(id, data);
  }

  marketsCountBadge.textContent = `${allMarkets.size} mercado${allMarkets.size === 1 ? '' : 's'}`;
  renderCatalogGrid();

  if (currentUser) {
    processResolvedMarketPayouts();
  }

  if (currentMarketId && allMarkets.has(currentMarketId)) {
    currentMarket = allMarkets.get(currentMarketId);
    renderMarketView();
  }
});

function renderCatalogGrid() {
  marketsCatalogGrid.innerHTML = "";

  if (allMarkets.size === 0) {
    marketsCatalogGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--poly-text-muted); padding: 40px;">
        No hay mercados activos. Conéctate como administrador y pulsa "Modo Editor" para crear uno.
      </div>
    `;
    return;
  }

  allMarkets.forEach((marketData, marketId) => {
    const sorted = [...(marketData.options || [])].sort((a, b) => b.probability - a.probability);
    const topImg = marketData.mainCover || sorted[0]?.imageUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' fill='%231e293b'%3E%3Crect width='48' height='48'/%3E%3C/svg%3E";

    let previewsHtml = "";
    sorted.slice(0, 3).forEach(opt => {
      previewsHtml += `
        <div class="catalog-row-item">
          <span>${opt.name}</span>
          <strong>${opt.probability}%</strong>
        </div>
      `;
    });

    const isResolved = marketData.resolved === true;

    const card = document.createElement("div");
    card.className = "catalog-card";
    card.innerHTML = `
      <div class="card-top-row">
        <img class="card-thumb" src="${topImg}" alt="Cover">
        <div class="card-title-text">${marketData.title}</div>
      </div>
      <div class="catalog-outcomes-preview">
        ${previewsHtml}
      </div>
      <div class="card-bottom-meta">
        <span>⭐ ${Number(marketData.volume || 1845000).toLocaleString()} Vol.</span>
        <span style="color:${isResolved ? 'var(--poly-green)' : 'inherit'}; font-weight:${isResolved ? '700' : 'normal'}">
          ${isResolved ? 'FINALIZADO' : (marketData.marketType === 'binary' ? 'Binario' : `${sorted.length} opciones`)}
        </span>
      </div>
    `;

    card.addEventListener("click", () => showDetailView(marketId));
    marketsCatalogGrid.appendChild(card);
  });
}

// ====================================================
// 5. VISTA DE DETALLE DEL MERCADO
// ====================================================
function renderMarketView() {
  if (!currentMarket || !currentMarket.options) return;

  const isResolved = currentMarket.resolved === true;

  if (isResolved) {
    marketResolvedBanner.classList.remove("hidden");
    const winner = currentMarket.options.find(o => o.id === currentMarket.winningOptionId);
    resolvedWinnerText.textContent = `Resultado: ${winner ? winner.name : 'Cerrado'}`;
  } else {
    marketResolvedBanner.classList.add("hidden");
  }

  if (currentUser && currentUser.email === ADMIN_EMAIL && !isResolved) {
    adminResolveMarketBtn.classList.remove("hidden");
  } else {
    adminResolveMarketBtn.classList.add("hidden");
  }

  document.getElementById("display-market-title").textContent = currentMarket.title;
  document.getElementById("display-market-vol").textContent = `⭐ ${Number(currentMarket.volume || 1845000).toLocaleString()} Vol.`;
  
  const sorted = [...currentMarket.options].sort((a, b) => b.probability - a.probability);
  document.getElementById("market-main-img").src = currentMarket.mainCover || sorted[0]?.imageUrl || "";

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
          <button class="tbl-btn-yes" data-id="${opt.id}" ${isResolved ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>Buy Yes ${opt.probability}¢</button>
          <button class="tbl-btn-no" data-id="${opt.id}" ${isResolved ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>Buy No ${100 - opt.probability}¢</button>
        </div>
      </td>
    `;

    if (!isResolved) {
      tr.querySelector(".tbl-btn-yes").addEventListener("click", () => {
        selectedOption = opt;
        selectedOutcome = "YES";
        updateSlipView();
        if (chartConfig.viewMode === "focus") renderSvgChart();
      });

      tr.querySelector(".tbl-btn-no").addEventListener("click", () => {
        selectedOption = opt;
        selectedOutcome = "NO";
        updateSlipView();
        if (chartConfig.viewMode === "focus") renderSvgChart();
      });
    }

    tbody.appendChild(tr);
  });

  updateSlipView();
  prepareChartDataFromHistory();
  renderSvgChart();
}

// ====================================================
// 6. FINALIZAR MERCADO (ADMIN)
// ====================================================
adminResolveMarketBtn.addEventListener("click", () => {
  if (!currentMarket) return;
  resolveOptionsList.innerHTML = "";

  currentMarket.options.forEach(opt => {
    const row = document.createElement("div");
    row.className = "resolve-item-row";
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <img src="${opt.imageUrl || ''}">
        <div>
          <strong>${opt.name}</strong>
          <span style="display:block; font-size:0.75rem; color:var(--poly-text-muted);">${opt.subtitle || ''}</span>
        </div>
      </div>
      <button class="btn-primary-blue" data-win="${opt.id}">Declarar Ganador</button>
    `;

    row.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`¿Confirmas que "${opt.name}" es la opción ganadora? Esto finalizará el mercado de forma irreversible.`)) return;

      const finalOptions = currentMarket.options.map(o => ({
        ...o,
        probability: o.id === opt.id ? 100 : 0
      }));

      const finalValues = {};
      finalOptions.forEach(o => finalValues[o.id] = o.probability);
      const updatedHistory = [...(currentMarket.history || [])];
      updatedHistory.push({
        timestamp: Date.now(),
        values: finalValues
      });

      await updateDoc(doc(db, "markets", currentMarketId), {
        resolved: true,
        winningOptionId: opt.id,
        options: finalOptions,
        history: updatedHistory
      });

      resolveModal.classList.add("hidden");
    });

    resolveOptionsList.appendChild(row);
  });

  resolveModal.classList.remove("hidden");
});

async function processResolvedMarketPayouts() {
  if (!currentUser || !userData.positions || userData.positions.length === 0) return;

  let totalPayout = 0;
  let modified = false;
  const remainingPositions = [];

  for (const pos of userData.positions) {
    const market = allMarkets.get(pos.marketId);
    if (market && market.resolved === true) {
      modified = true;
      const isWinner = (pos.outcome === "YES" && pos.optionId === market.winningOptionId) ||
                       (pos.outcome === "NO" && pos.optionId !== market.winningOptionId);

      if (isWinner) {
        totalPayout += pos.shares * 100;
      }
    } else {
      remainingPositions.push(pos);
    }
  }

  if (modified) {
    userData.stars += totalPayout;
    userData.positions = remainingPositions;
    await setDoc(doc(db, "users", currentUser.uid), userData);
    updateUI();
    if (totalPayout > 0) {
      alert(`¡Has ganado ⭐ ${totalPayout.toLocaleString()} por tus posiciones en mercados finalizados!`);
    }
  }
}

// ====================================================
// 7. MOTOR DEL GRÁFICO
// ====================================================
document.getElementById("view-mode-multi")?.addEventListener("click", (e) => {
  chartConfig.viewMode = "multi";
  updateViewModeButtons(e.target);
  renderSvgChart();
});

document.getElementById("view-mode-focus")?.addEventListener("click", (e) => {
  chartConfig.viewMode = "focus";
  updateViewModeButtons(e.target);
  renderSvgChart();
});

document.getElementById("toggle-autoscale-btn")?.addEventListener("click", (e) => {
  chartConfig.autoScale = !chartConfig.autoScale;
  e.target.textContent = chartConfig.autoScale ? "🔍 Auto-Zoom: ON" : "🔍 Auto-Zoom: OFF";
  e.target.classList.toggle("active", chartConfig.autoScale);
  renderSvgChart();
});

document.querySelectorAll(".time-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    chartConfig.timeframe = e.target.getAttribute("data-time");
    prepareChartDataFromHistory();
    renderSvgChart();
  });
});

function updateViewModeButtons(activeBtn) {
  document.querySelectorAll(".chart-view-modes .tool-btn").forEach(b => b.classList.remove("active"));
  activeBtn.classList.add("active");
}

function prepareChartDataFromHistory() {
  if (!currentMarket || !currentMarket.history || currentMarket.history.length === 0) return;

  const now = Date.now();
  let cutoff = 0;

  switch (chartConfig.timeframe) {
    case "1D": cutoff = now - 24 * 60 * 60 * 1000; break;
    case "1W": cutoff = now - 7 * 24 * 60 * 60 * 1000; break;
    case "1M": cutoff = now - 30 * 24 * 60 * 60 * 1000; break;
    case "ALL":
    default:   cutoff = 0; break;
  }

  let filteredHistory = currentMarket.history.filter(pt => pt.timestamp >= cutoff);
  if (filteredHistory.length < 2) filteredHistory = currentMarket.history.slice(-2);

  activeTimeLabels = filteredHistory.map(pt => {
    const d = new Date(pt.timestamp);
    if (chartConfig.timeframe === "1D") {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });

  const sortedOptions = [...currentMarket.options].sort((a, b) => b.probability - a.probability);

  chartDataCache = sortedOptions.map((opt, idx) => {
    const series = filteredHistory.map(pt => {
      return pt.values && pt.values[opt.id] !== undefined ? pt.values[opt.id] : opt.probability;
    });

    return {
      ...opt,
      color: PALETTE[idx % PALETTE.length],
      series
    };
  });
}

function renderSvgChart() {
  if (chartDataCache.length === 0) prepareChartDataFromHistory();

  const svg = document.getElementById("polySvgChart");
  const legendBox = document.getElementById("chart-legend-row");
  if (!svg) return;

  legendBox.innerHTML = "";
  svg.innerHTML = "";

  const width = 800;
  const height = 240;
  const paddingX = 20;

  let visibleSeries = chartDataCache;
  if (chartConfig.viewMode === "focus") {
    const focused = chartDataCache.find(o => o.id === selectedOption?.id) || chartDataCache[0];
    visibleSeries = [focused];
  }

  let minY = 0;
  let maxY = 100;

  if (chartConfig.autoScale) {
    let allPoints = [];
    visibleSeries.forEach(s => allPoints.push(...s.series));
    const rawMin = Math.min(...allPoints);
    const rawMax = Math.max(...allPoints);

    minY = Math.max(0, rawMin - 4);
    maxY = Math.min(100, rawMax + 4);
    if (maxY - minY < 6) {
      maxY = Math.min(100, maxY + 3);
      minY = Math.max(0, minY - 3);
    }
  }

  const mapX = (idx, total) => total === 1 ? width / 2 : paddingX + (idx / (total - 1)) * (width - paddingX * 2);
  const mapY = (val) => height - ((val - minY) / (maxY - minY)) * height;

  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const val = Math.round(minY + (i / gridSteps) * (maxY - minY));
    const yPos = mapY(val);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", yPos.toString());
    line.setAttribute("x2", width.toString());
    line.setAttribute("y2", yPos.toString());
    line.setAttribute("stroke", "rgba(255,255,255,0.06)");
    line.setAttribute("stroke-dasharray", "4");
    svg.appendChild(line);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", (yPos - 4).toString());
    text.setAttribute("fill", "#64748b");
    text.setAttribute("font-size", "10");
    text.textContent = `${val}%`;
    svg.appendChild(text);
  }

  visibleSeries.forEach((item) => {
    const legItem = document.createElement("div");
    legItem.className = "chart-legend-item";
    legItem.innerHTML = `<span class="legend-dot" style="background:${item.color}"></span> ${item.name} <strong>${item.probability}%</strong>`;
    legendBox.appendChild(legItem);

    const totalPoints = item.series.length;
    let d = "";
    item.series.forEach((val, i) => {
      const cx = mapX(i, totalPoints);
      const cy = mapY(val);
      d += `${i === 0 ? "M" : "L"} ${cx} ${cy} `;
    });

    if (chartConfig.viewMode === "focus") {
      const startX = mapX(0, totalPoints);
      const endX = mapX(totalPoints - 1, totalPoints);
      const areaPathD = `${d} L ${endX} ${height} L ${startX} ${height} Z`;

      const areaPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      areaPath.setAttribute("d", areaPathD);
      areaPath.setAttribute("fill", item.color);
      areaPath.setAttribute("fill-opacity", "0.15");
      svg.appendChild(areaPath);
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", item.color);
    path.setAttribute("stroke-width", chartConfig.viewMode === "focus" ? "3" : "2.2");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);

    const endX = mapX(totalPoints - 1, totalPoints);
    const endY = mapY(item.probability);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", endX.toString());
    circle.setAttribute("cy", endY.toString());
    circle.setAttribute("r", "4");
    circle.setAttribute("fill", item.color);
    svg.appendChild(circle);
  });

  setupChartCrosshair(svg, visibleSeries, mapX);
}

function setupChartCrosshair(svg, seriesList, mapX) {
  const container = document.getElementById("chart-container");
  const tooltip = document.getElementById("chart-tooltip");
  const tooltipDate = document.getElementById("tooltip-date");
  const tooltipBody = document.getElementById("tooltip-body");
  if (!container || !tooltip) return;

  const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
  crosshair.setAttribute("stroke", "rgba(255, 255, 255, 0.25)");
  crosshair.setAttribute("stroke-width", "1");
  crosshair.setAttribute("stroke-dasharray", "3");
  crosshair.setAttribute("y1", "0");
  crosshair.setAttribute("y2", "240");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  container.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const normX = Math.max(0, Math.min(800, (mouseX / rect.width) * 800));

    const totalPoints = activeTimeLabels.length;
    let closestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < totalPoints; i++) {
      const ptX = mapX(i, totalPoints);
      const dist = Math.abs(normX - ptX);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }

    const exactX = mapX(closestIdx, totalPoints);
    crosshair.setAttribute("x1", exactX.toString());
    crosshair.setAttribute("x2", exactX.toString());
    crosshair.style.display = "block";

    tooltipDate.textContent = `${activeTimeLabels[closestIdx]} (${chartConfig.timeframe})`;
    tooltipBody.innerHTML = "";

    seriesList.forEach(item => {
      const val = item.series[closestIdx];
      const row = document.createElement("div");
      row.className = "tooltip-row";
      row.innerHTML = `
        <span style="color:${item.color}">● ${item.name}</span>
        <strong>${val}%</strong>
      `;
      tooltipBody.appendChild(row);
    });

    tooltip.classList.remove("hidden");
    const tipLeft = Math.min(rect.width - 150, Math.max(10, mouseX - 60));
    tooltip.style.left = `${tipLeft}px`;
  };

  container.onmouseleave = () => {
    crosshair.style.display = "none";
    tooltip.classList.add("hidden");
  };
}

// ====================================================
// 8. ORDER SLIP (COMPRA MEDIANTE CPMM REAL)
// ====================================================
function updateSlipView() {
  if (!selectedOption) return;

  const isResolved = currentMarket && currentMarket.resolved === true;

  slipTargetImg.src = selectedOption.imageUrl || "";
  slipTargetName.textContent = selectedOption.name;
  slipTargetSub.textContent = selectedOption.subtitle || "Spotify Outcome";

  slipYesPrice.textContent = `${selectedOption.probability}¢`;
  slipNoPrice.textContent = `${100 - selectedOption.probability}¢`;

  slipBtnYes.className = `slip-outcome-btn ${selectedOutcome === "YES" ? "active-yes" : ""}`;
  slipBtnNo.className = `slip-outcome-btn ${selectedOutcome === "NO" ? "active-no" : ""}`;

  if (isResolved) {
    executeTradeBtn.disabled = true;
    executeTradeBtn.style.opacity = "0.4";
    executeTradeBtn.textContent = "Mercado Finalizado";
    return;
  }

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
  if (!selectedOption || (currentMarket && currentMarket.resolved)) return;
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
  if (currentMarket && currentMarket.resolved) return alert("Este mercado ya ha finalizado.");

  const amount = parseInt(tradeAmountInput.value) || 0;
  if (amount <= 0 || amount > userData.stars) return;

  const L = 10000;
  const currentProb = selectedOption.probability / 100;
  let y = L * (1 - currentProb);
  let n = L * currentProb;

  let sharesReceived = 0;
  let newProb = currentProb;

  if (selectedOutcome === "YES") {
    const newN = n + amount;
    const newY = (y * n) / newN;
    sharesReceived = y - newY;
    newProb = newN / (newY + newN);
  } else {
    const newY = y + amount;
    const newN = (y * n) / newY;
    sharesReceived = n - newN;
    newProb = (y * n / newY) / (newY + (y * n / newY));
  }

  const targetProbPercent = Math.min(99, Math.max(1, Math.round(newProb * 100)));
  const delta = targetProbPercent - selectedOption.probability;

  userData.stars -= amount;
  userData.positions.push({
    marketId: currentMarketId,
    marketTitle: currentMarket.title,
    optionId: selectedOption.id,
    optionName: selectedOption.name,
    outcome: selectedOutcome,
    invested: amount,
    shares: Math.max(1, Math.round(sharesReceived)),
    buyPrice: Math.round((amount / sharesReceived) * 100)
  });

  if (delta !== 0) {
    const optIdx = currentMarket.options.findIndex(o => o.id === selectedOption.id);
    applyProbabilityShift(currentMarket.options, optIdx, delta);

    const newSnapshotValues = {};
    currentMarket.options.forEach(o => {
      newSnapshotValues[o.id] = o.probability;
    });

    if (!currentMarket.history) currentMarket.history = [];
    currentMarket.history.push({
      timestamp: Date.now(),
      values: newSnapshotValues
    });

    if (currentMarket.history.length > 300) {
      currentMarket.history = currentMarket.history.slice(-300);
    }
  }

  await setDoc(doc(db, "users", currentUser.uid), userData);
  await updateDoc(doc(db, "markets", currentMarketId), {
    options: currentMarket.options,
    volume: (currentMarket.volume || 1845000) + amount,
    history: currentMarket.history
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

// ====================================================
// 9. PORTAFOLIO Y VENTA (CPMM)
// ====================================================
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
  let totalEquity = 0;

  if (!userData.positions || userData.positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--poly-text-muted); padding:20px;">No posees acciones activas en este momento.</td></tr>`;
  } else {
    userData.positions.forEach((pos, idx) => {
      const market = allMarkets.get(pos.marketId);
      let currentPrice = pos.buyPrice || 50;

      if (market && market.options) {
        const opt = market.options.find(o => o.id === pos.optionId);
        if (opt) {
          currentPrice = pos.outcome === "YES" ? opt.probability : (100 - opt.probability);
        }
      }

      const totalVal = Math.round(pos.shares * (currentPrice / 100) * 100);
      const initialVal = pos.invested;
      const pnl = totalVal - initialVal;
      const pnlPercent = initialVal > 0 ? ((pnl / initialVal) * 100).toFixed(1) : 0;
      totalEquity += totalVal;

      const isMarketResolved = market && market.resolved === true;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <strong>${pos.optionName}</strong>
          <span style="display:block; font-size:0.7rem; color:var(--poly-text-muted);">${pos.marketTitle || 'Mercado'}</span>
        </td>
        <td>
          <span style="color:${pos.outcome === 'YES' ? 'var(--poly-green)' : 'var(--poly-red)'}; font-weight:700;">
            ${pos.outcome}
          </span>
        </td>
        <td>${pos.shares.toLocaleString()}</td>
        <td><strong>⭐ ${totalVal.toLocaleString()}</strong></td>
        <td style="color:${pnl >= 0 ? 'var(--poly-green)' : 'var(--poly-red)'};">
          ${pnl >= 0 ? '+' : ''}${pnl} ⭐ (${pnlPercent}%)
        </td>
        <td>
          <button class="btn-sell" data-sell="${idx}" ${isMarketResolved ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
            ${isMarketResolved ? 'Finalizado' : 'Vender'}
          </button>
        </td>
      `;

      if (!isMarketResolved) {
        tr.querySelector(".btn-sell").addEventListener("click", () => sellPosition(idx));
      }

      tbody.appendChild(tr);
    });
  }

  document.getElementById("stat-portfolio-value").textContent = `⭐ ${totalEquity.toLocaleString()}`;
  document.getElementById("stat-net-worth").textContent = `⭐ ${(userData.stars + totalEquity).toLocaleString()}`;
}

async function sellPosition(index) {
  const pos = userData.positions[index];
  if (!pos || !currentUser) return;

  const market = allMarkets.get(pos.marketId);
  if (!market || market.resolved) return;

  const opt = market.options.find(o => o.id === pos.optionId);
  if (!opt) return;

  const L = 10000;
  const currentProb = opt.probability / 100;
  let y = L * (1 - currentProb);
  let n = L * currentProb;

  let payout = 0;
  let newProb = currentProb;

  if (pos.outcome === "YES") {
    const newY = y + pos.shares;
    const newN = (y * n) / newY;
    payout = n - newN;
    newProb = newN / (newY + newN);
  } else {
    const newN = n + pos.shares;
    const newY = (y * n) / newN;
    payout = y - newY;
    newProb = (newN) / (newY + newN);
  }

  const netPayout = Math.max(1, Math.round(payout * 0.985));
  const targetProbPercent = Math.min(99, Math.max(1, Math.round(newProb * 100)));
  const delta = targetProbPercent - opt.probability;

  if (delta !== 0) {
    const optIdx = market.options.findIndex(o => o.id === pos.optionId);
    applyProbabilityShift(market.options, optIdx, delta);

    const newSnapshotValues = {};
    market.options.forEach(o => newSnapshotValues[o.id] = o.probability);
    if (!market.history) market.history = [];
    market.history.push({ timestamp: Date.now(), values: newSnapshotValues });

    await updateDoc(doc(db, "markets", pos.marketId), {
      options: market.options,
      history: market.history
    });
  }

  userData.stars += netPayout;
  userData.positions.splice(index, 1);

  await setDoc(doc(db, "users", currentUser.uid), userData);
  updateUI();
  renderPortfolio();
  alert(`Has liquidado tu posición por ⭐ ${netPayout.toLocaleString()}`);
}

// ====================================================
// 10. CIERRE GLOBAL E INFALIBLE DE MODALES
// ====================================================
document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest(".close-modal-btn");
  if (closeBtn) {
    const modal = closeBtn.closest(".modal-overlay, .editor-modal-overlay");
    if (modal) modal.classList.add("hidden");
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay, .editor-modal-overlay").forEach(m => m.classList.add("hidden"));
  }
});

// ====================================================
// 11. SPOTIFY Y MODO EDITOR
// ====================================================
adminEditorBtn.addEventListener("click", () => editorSection.classList.remove("hidden"));

const modeMultiBtn = document.getElementById("mode-multi-btn");
const modeBinaryBtn = document.getElementById("mode-binary-btn");
const multiBuilderContainer = document.getElementById("multi-builder-container");
const binaryBuilderContainer = document.getElementById("binary-builder-container");

modeMultiBtn.addEventListener("click", () => {
  editorMode = "multi";
  modeMultiBtn.classList.add("active");
  modeBinaryBtn.classList.remove("active");
  multiBuilderContainer.classList.remove("hidden");
  binaryBuilderContainer.classList.add("hidden");
});

modeBinaryBtn.addEventListener("click", () => {
  editorMode = "binary";
  modeBinaryBtn.classList.add("active");
  modeMultiBtn.classList.remove("active");
  binaryBuilderContainer.classList.remove("hidden");
  multiBuilderContainer.classList.add("hidden");
});

const binaryProbSlider = document.getElementById("binary-prob-slider");
const binaryYesDisplay = document.getElementById("binary-yes-display");
const binaryYesFill = document.getElementById("binary-yes-fill");
const binaryNoFill = document.getElementById("binary-no-fill");
const binaryMarketTitle = document.getElementById("binary-market-title");
const confirmPublishBinaryBtn = document.getElementById("confirm-publish-binary-btn");

binaryProbSlider.addEventListener("input", (e) => {
  binaryYesProb = parseInt(e.target.value) || 50;
  updateBinaryProbVisuals();
});

function updateBinaryProbVisuals() {
  binaryYesDisplay.textContent = `${binaryYesProb}%`;
  binaryYesFill.style.width = `${binaryYesProb}%`;
  binaryYesFill.textContent = `Yes ${binaryYesProb}%`;
  
  const noProb = 100 - binaryYesProb;
  binaryNoFill.style.width = `${noProb}%`;
  binaryNoFill.textContent = `No ${noProb}%`;

  confirmPublishBinaryBtn.disabled = !binarySelectedTrack || !binaryMarketTitle.value.trim();
}

binaryMarketTitle.addEventListener("input", () => {
  confirmPublishBinaryBtn.disabled = !binarySelectedTrack || !binaryMarketTitle.value.trim();
});

document.querySelectorAll(".template-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    if (!binarySelectedTrack) return alert("Selecciona primero una canción de la lista de Spotify.");
    const cond = chip.getAttribute("data-condition");
    binaryMarketTitle.value = cond.replace("¿Estará en", `¿Estará "${binarySelectedTrack.name}" en`);
    updateBinaryProbVisuals();
  });
});

confirmPublishBinaryBtn.addEventListener("click", async () => {
  const title = binaryMarketTitle.value.trim();
  if (!binarySelectedTrack || !title) return;

  const options = [
    {
      id: "opt_yes",
      name: "Sí (Yes)",
      subtitle: binarySelectedTrack.name,
      imageUrl: binarySelectedTrack.imageUrl,
      probability: binaryYesProb
    },
    {
      id: "opt_no",
      name: "No",
      subtitle: binarySelectedTrack.name,
      imageUrl: binarySelectedTrack.imageUrl,
      probability: 100 - binaryYesProb
    }
  ];

  const initialHistory = createInitialHistorySnapshots(options);

  await setDoc(doc(db, "markets", "market_" + Date.now()), {
    title,
    options,
    marketType: "binary",
    mainCover: binarySelectedTrack.imageUrl,
    volume: 1845000,
    history: initialHistory,
    resolved: false,
    createdAt: Date.now()
  });

  editorSection.classList.add("hidden");
  binarySelectedTrack = null;
  binaryMarketTitle.value = "";
  document.getElementById("binary-track-selected").innerHTML = `<span class="empty-hint">Haz clic en "+ Añadir" en cualquier canción de arriba para elegirla.</span>`;
  confirmPublishBinaryBtn.disabled = true;
});

// Spotify PKCE
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
      if (editorMode === "binary") {
        binarySelectedTrack = item;
        document.getElementById("binary-track-selected").innerHTML = `
          <img class="binary-card-thumb" src="${item.imageUrl || ''}">
          <div>
            <strong>${item.name}</strong>
            <span style="display:block;font-size:0.75rem;color:var(--poly-text-muted);">${item.subtitle}</span>
          </div>
        `;
        if (!binaryMarketTitle.value.trim()) {
          binaryMarketTitle.value = `¿Estará "${item.name}" en el Top 5 este mes?`;
        }
        updateBinaryProbVisuals();
      } else {
        if (!currentStagedOptions.some(o => o.id === item.id)) {
          currentStagedOptions.push({ ...item, probability: 0 });
          recalcEditorProbs();
        }
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
        <button class="close-modal-btn" data-del="${idx}" style="width:24px;height:24px;font-size:0.8rem;" onclick="removeDraftOption(${idx})">✕</button>
      </div>
    `;
    row.querySelector("input").addEventListener("input", (e) => {
      currentStagedOptions[idx].probability = parseInt(e.target.value) || 0;
      updateEditorBar();
    });
    list.appendChild(row);
  });
  updateEditorBar();
}

window.removeDraftOption = function(idx) {
  currentStagedOptions.splice(idx, 1);
  recalcEditorProbs();
};

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

  const initialHistory = createInitialHistorySnapshots(currentStagedOptions);

  await setDoc(doc(db, "markets", "market_" + Date.now()), {
    title,
    options: currentStagedOptions,
    marketType: "multiple",
    volume: 1845000,
    history: initialHistory,
    resolved: false,
    createdAt: Date.now()
  });

  editorSection.classList.add("hidden");
  currentStagedOptions = [];
});
