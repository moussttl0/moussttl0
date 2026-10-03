const form = document.querySelector("#search-form");
const input = document.querySelector("#location-input");
const results = document.querySelector("#search-results");
const weatherSection = document.querySelector("#weather-section");
const weatherContent = document.querySelector("#weather-content");
const welcomeCard = document.querySelector("#welcome-card");
const searchButton = form.querySelector("button[type='submit']");

let requestId = 0;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;

  const id = ++requestId;
  setSearching(true);
  results.hidden = true;
  weatherSection.hidden = false;
  welcomeCard.hidden = true;
  weatherContent.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Recherche du lieu et des prévisions marines…</div>';

  try {
    const locations = await searchLocations(query);
    if (id !== requestId) return;
    if (!locations.length) {
      showMessage("Aucun lieu trouvé. Essayez le nom d’une ville côtière, d’un port ou d’une île.");
      return;
    }
    if (locations.length === 1) {
      await showForecast(locations[0], id);
      return;
    }
    showLocations(locations, id);
  } catch (error) {
    if (id === requestId) showMessage(error.message);
  } finally {
    if (id === requestId) setSearching(false);
  }
});

async function searchLocations(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "5", language: "fr", format: "json" });
  const response = await fetch(url);
  if (!response.ok) throw new Error("La recherche du lieu a échoué. Vérifiez votre connexion puis réessayez.");
  const data = await response.json();
  return data.results ?? [];
}

function showLocations(locations, id) {
  results.replaceChildren();
  for (const location of locations) {
    const button = document.createElement("button");
    button.className = "location-option";
    button.type = "button";
    button.setAttribute("role", "option");
    const country = [location.admin1, location.country].filter(Boolean).join(", ");
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20 10.2c0 5.1-8 11-8 11s-8-5.9-8-11a8 8 0 1 1 16 0Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.7"/></svg>';
    const label = document.createElement("span");
    label.append(document.createTextNode(location.name));
    if (country) {
      const detail = document.createElement("small");
      detail.textContent = country;
      label.append(detail);
    }
    button.append(label);
    button.addEventListener("click", async () => {
      results.hidden = true;
      weatherSection.hidden = false;
      welcomeCard.hidden = true;
      setSearching(true);
      weatherContent.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span>Chargement des prévisions marines…</div>';
      try {
        await showForecast(location, id);
      } catch (error) {
        if (id === requestId) showMessage(error.message);
      } finally {
        if (id === requestId) setSearching(false);
      }
    });
    results.append(button);
  }
  results.hidden = false;
  weatherSection.hidden = true;
  welcomeCard.hidden = false;
  setSearching(false);
}

async function showForecast(location, id) {
  const params = {
    latitude: location.latitude,
    longitude: location.longitude,
    hourly: "wave_height,wave_direction,swell_wave_height,swell_wave_period,sea_surface_temperature",
    daily: "wave_height_max",
    timezone: "auto",
    forecast_days: "3"
  };
  const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
  marineUrl.search = new URLSearchParams(params);
  const windUrl = new URL("https://api.open-meteo.com/v1/forecast");
  windUrl.search = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    hourly: "wind_speed_10m,wind_direction_10m",
    wind_speed_unit: "kn",
    timezone: "auto",
    forecast_days: "3"
  });

  const [marineResponse, windResponse] = await Promise.all([fetchWithRetry(marineUrl), fetchWithRetry(windUrl)]);
  if (!marineResponse.ok || !windResponse.ok) {
    throw new Error("Les prévisions ne sont pas disponibles pour ce lieu pour le moment. Essayez un autre lieu ou réessayez plus tard.");
  }
  const [marine, wind] = await Promise.all([marineResponse.json(), windResponse.json()]);
  if (id !== requestId) return;
  if (!marine.hourly?.time?.length || !wind.hourly?.wind_speed_10m?.length) {
    showMessage("Aucune prévision marine n’est disponible pour ce lieu. Essayez un port ou une ville côtière.");
    return;
  }
  renderForecast(location, marine, wind);
}

async function fetchWithRetry(url) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(url);
    if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 1) return response;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return response;
}

function renderForecast(location, marine, wind) {
  const hours = marine.hourly.time;
  const currentIndex = Math.max(0, hours.findIndex((time) => time >= localHour(marine.timezone)));
  const windIndex = wind.hourly.time.findIndex((time) => time === hours[currentIndex]);
  const currentWave = marine.hourly.wave_height?.[currentIndex];
  const waveDirection = marine.hourly.wave_direction?.[currentIndex];
  const swell = marine.hourly.swell_wave_height?.[currentIndex];
  const swellPeriod = marine.hourly.swell_wave_period?.[currentIndex];
  const seaTemp = marine.hourly.sea_surface_temperature?.[currentIndex];
  const windSpeed = windIndex >= 0 ? wind.hourly.wind_speed_10m?.[windIndex] : null;
  const windDirection = windIndex >= 0 ? wind.hourly.wind_direction_10m?.[windIndex] : null;
  const place = [location.name, location.admin1, location.country].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(", ");
  const dateLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${hours[currentIndex].slice(0, 10)}T12:00:00Z`));
  const chartEnd = Math.min(currentIndex + 24, hours.length);

  weatherContent.innerHTML = `
    <div class="weather-heading">
      <div class="weather-title-wrap">
        <p class="weather-kicker">VOTRE POINT DE REPÈRE</p>
        <h2>${escapeHtml(place)}</h2>
        <p>${escapeHtml(dateLabel)} <span aria-hidden="true">·</span> Conditions heure par heure</p>
      </div>
      <span class="updated-label">Prévisions sur 3 jours</span>
    </div>
    <div class="weather-grid">
      <section class="panel current-panel" aria-label="État de la mer">
        <p class="panel-label">HAUTEUR DES VAGUES</p>
        <div class="current-condition">
          <div>
            <div class="wave-number">${formatNumber(currentWave)}<small>m</small></div>
            <div class="wave-caption">À l’heure actuelle</div>
          </div>
          <span class="condition-divider" aria-hidden="true"></span>
          <div class="condition-note">${waveDirection == null ? "—" : `${compass(waveDirection)} ${Math.round(waveDirection)}°`}<br><span>direction des vagues</span></div>
        </div>
        ${buildChart(hours.slice(currentIndex, chartEnd), marine.hourly.wave_height?.slice(currentIndex, chartEnd) ?? [])}
      </section>
      <section class="panel stats-panel" aria-label="Conditions marines complémentaires">
        ${statRow("vent", "Vent", formatNumber(windSpeed), "nd", windDirection == null ? "Direction indisponible" : compass(windDirection) + " " + Math.round(windDirection) + "°")}
        ${statRow("swell", "Houle", formatNumber(swell), "m", swellPeriod == null ? "Période indisponible" : `${formatNumber(swellPeriod)} s de période`)}
        ${statRow("water", "Température de la mer", formatNumber(seaTemp), "°C", "Température de surface")}
      </section>
    </div>
    <div class="forecast-title"><h3>Les prochains jours</h3><span>Hauteur maximale des vagues</span></div>
    <div class="forecast-grid">${buildDailyForecast(marine, wind)}</div>
  `;
}

function buildChart(times, values) {
  const points = values.map((value) => value == null ? null : Number(value));
  const valid = points.filter((value) => value !== null && Number.isFinite(value));
  if (valid.length < 2) return '<p class="wave-caption">Graphique des vagues indisponible.</p>';
  const width = 600;
  const height = 98;
  const max = Math.max(...valid, .5) * 1.2;
  const coords = points.map((value, index) => value === null ? null : [index * width / (points.length - 1), height - (value / max) * (height - 10) + 5]);
  const path = coords.reduce((segments, point) => {
    if (!point) return segments;
    segments.push(`${segments.length ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`);
    return segments;
  }, []).join(" ");
  const first = coords.find(Boolean);
  const last = [...coords].reverse().find(Boolean);
  const area = `${path} L${last[0].toFixed(1)},${height} L${first[0].toFixed(1)},${height} Z`;
  const markers = coords.filter((_, index) => index % 6 === 0 && coords[index]).map(([x, y]) => `<circle class="chart-dot" cx="${x}" cy="${y}" r="3.5"/>`).join("");
  const labels = [times[0], times[Math.floor((times.length - 1) / 2)], times[times.length - 1]].map((time) => time ? time.slice(11, 16) : "").join("</span><span>");
  return `<svg class="wave-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Évolution de la hauteur des vagues dans les prochaines heures">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5de0d0" stop-opacity=".25"/><stop offset="100%" stop-color="#5de0d0" stop-opacity="0"/></linearGradient></defs>
    <path class="chart-gridline" d="M0 30H${width}M0 63H${width}M0 ${height}H${width}"/>
    <path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${markers}
  </svg><div class="chart-times"><span>${labels}</span></div>`;
}

function buildDailyForecast(marine, wind) {
  return marine.daily.time.map((day, index) => {
    const date = new Date(`${day}T12:00:00Z`);
    const label = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric" }).format(date);
    const datePrefix = day;
    const windValues = wind.hourly.time.reduce((values, time, hour) => {
      if (time.startsWith(datePrefix)) {
        const speed = wind.hourly.wind_speed_10m[hour];
        if (speed != null) values.push(speed);
      }
      return values;
    }, []);
    const averageWind = windValues.length ? windValues.reduce((sum, value) => sum + value, 0) / windValues.length : null;
    const waveHeight = marine.daily.wave_height_max?.[index];
    return `<article class="day-card">
      <p class="day-name">${escapeHtml(label)}</p>
      <p class="day-wave">${formatNumber(waveHeight)} <small>m de vagues</small></p>
      <div class="day-detail"><span>Vent moyen</span><strong>${averageWind == null ? "—" : `${formatNumber(averageWind)} nd`}</strong></div>
    </article>`;
  }).join("");
}

function statRow(icon, label, value, unit, detail) {
  const paths = {
    vent: '<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1-2.5 2.5M4 16h7"/>',
    swell: '<path d="M3 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2M3 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 3 2"/>',
    water: '<path d="M12 3v11.2a4 4 0 1 1-4 0V3a2 2 0 1 1 4 0Z"/><path d="M10 17V7"/>'
  };
  return `<div class="stat-row">
    <div class="stat-label"><span class="stat-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</svg></span>
      <span>${label}<br><small>${detail}</small></span>
    </div>
    <span class="stat-value">${value} <small>${unit}</small></span>
  </div>`;
}

function showMessage(message) {
  results.hidden = true;
  weatherSection.hidden = false;
  weatherContent.innerHTML = `<p class="message" role="alert">${escapeHtml(message)}</p>`;
}

function setSearching(searching) {
  searchButton.disabled = searching;
  searchButton.querySelector("span").textContent = searching ? "Recherche…" : "Voir la météo";
}

function localHour(timeZone = "UTC") {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).format(new Date()).replace(" ", "T");
}

function formatNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function compass(degrees) {
  return ["N", "NE", "E", "SE", "S", "SO", "O", "NO"][Math.round(degrees / 45) % 8];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
