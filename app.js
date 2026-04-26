const LOCAL_KEYS = {
  content: "sincity-local-content",
  runtime: "sincity-local-runtime",
  applications: "sincity-local-applications",
  sync: "sincity-local-sync",
  draft: "sincity-whitelist-draft"
};

const LOCAL_CHANNEL_NAME = "sincity-local-channel";

const state = {
  mode: "loading",
  theme: "neon",
  content: null,
  runtime: null,
  applications: [],
  activeBulletin: null,
  activeIncident: 0,
  selectedTier: null,
  currentStep: 0,
  galleryIndex: 0,
  localChannel: "BroadcastChannel" in window ? new BroadcastChannel(LOCAL_CHANNEL_NAME) : null,
  formState: {
    discord: "",
    displayName: "",
    characterAge: "",
    timezone: "",
    playstyle: "",
    hours: "",
    concept: "",
    voice: "",
    rules: "",
    availability: "",
    notes: ""
  }
};

const refs = {
  brandName: document.getElementById("brand-name"),
  brandTag: document.getElementById("brand-tag"),
  navLinks: document.getElementById("nav-links"),
  heroEyebrow: document.getElementById("hero-eyebrow"),
  heroTitleMain: document.getElementById("hero-title-main"),
  heroTitleAccent: document.getElementById("hero-title-accent"),
  heroDescription: document.getElementById("hero-description"),
  heroMetrics: document.getElementById("hero-metrics"),
  sceneCopy: document.getElementById("scene-copy"),
  randomizeScene: document.getElementById("randomize-scene"),
  headerOnline: document.getElementById("header-online"),
  onlineCount: document.getElementById("online-count"),
  queueCount: document.getElementById("queue-count"),
  heatLevel: document.getElementById("heat-level"),
  economyShift: document.getElementById("economy-shift"),
  serverClock: document.getElementById("server-clock"),
  restartCountdown: document.getElementById("restart-countdown"),
  weatherLabel: document.getElementById("weather-label"),
  dispatchMood: document.getElementById("dispatch-mood"),
  eventList: document.getElementById("event-list"),
  bulletinTabs: document.getElementById("bulletin-tabs"),
  bulletinTitle: document.getElementById("bulletin-title"),
  bulletinSummary: document.getElementById("bulletin-summary"),
  bulletinPoints: document.getElementById("bulletin-points"),
  newsList: document.getElementById("news-list"),
  quickLinks: document.getElementById("quick-links"),
  rhythmList: document.getElementById("rhythm-list"),
  cityZones: document.getElementById("city-zones"),
  galleryGrid: document.getElementById("gallery-grid"),
  tierGrid: document.getElementById("tier-grid"),
  faqList: document.getElementById("faq-list"),
  stepper: document.getElementById("stepper"),
  form: document.getElementById("application-form"),
  formFields: document.getElementById("form-fields"),
  stepLabel: document.getElementById("step-label"),
  draftNote: document.getElementById("draft-note"),
  prevStep: document.getElementById("prev-step"),
  nextStep: document.getElementById("next-step"),
  clearDraft: document.getElementById("clear-draft"),
  pendingCount: document.getElementById("pending-count"),
  previewName: document.getElementById("preview-name"),
  previewAge: document.getElementById("preview-age"),
  previewConcept: document.getElementById("preview-concept"),
  previewStyle: document.getElementById("preview-style"),
  previewHours: document.getElementById("preview-hours"),
  previewReady: document.getElementById("preview-ready"),
  previewVoice: document.getElementById("preview-voice"),
  summaryTier: document.getElementById("summary-tier"),
  summaryQueue: document.getElementById("summary-queue"),
  summaryImports: document.getElementById("summary-imports"),
  summaryTotal: document.getElementById("summary-total"),
  summaryTone: document.getElementById("summary-tone"),
  summaryAudience: document.getElementById("summary-audience"),
  summarySkip: document.getElementById("summary-skip"),
  extraCc: document.getElementById("extra-cc"),
  extraCcValue: document.getElementById("extra-cc-value"),
  checkoutButton: document.getElementById("checkout-button"),
  toastStack: document.getElementById("toast-stack"),
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxTitle: document.getElementById("lightbox-title"),
  lightboxDescription: document.getElementById("lightbox-description"),
  lightboxCounter: document.getElementById("lightbox-counter"),
  closeLightbox: document.getElementById("close-lightbox"),
  prevGallery: document.getElementById("prev-gallery"),
  nextGallery: document.getElementById("next-gallery"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon")
};

function showToast(title, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  refs.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function readLocalJson(key, fallback = null) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected ${contentType || "response"} from ${url}.`);
  }
  const payload = JSON.parse(text);
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function loadSeedJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  return payload;
}

function enrichRuntime(runtime, applications) {
  const pendingApplications = applications.filter((item) => item.status === "pending").length;
  return {
    ...runtime,
    localMode: state.mode === "local",
    adminProtected: false,
    applicationCount: applications.length,
    pendingApplications
  };
}

async function loadLocalBootstrap() {
  const [seedContent, seedRuntime] = await Promise.all([
    loadSeedJson("data/content.json"),
    loadSeedJson("data/runtime.json")
  ]);
  const content = readLocalJson(LOCAL_KEYS.content, seedContent);
  const runtime = readLocalJson(LOCAL_KEYS.runtime, seedRuntime);
  const applications = readLocalJson(LOCAL_KEYS.applications, []);
  return {
    content,
    runtime: enrichRuntime(runtime, applications),
    applications
  };
}

function persistLocalState() {
  writeLocalJson(LOCAL_KEYS.content, state.content);
  writeLocalJson(LOCAL_KEYS.runtime, state.runtime);
  writeLocalJson(LOCAL_KEYS.applications, state.applications);
}

function broadcastLocalUpdate(type) {
  const payload = { type, at: Date.now() };
  localStorage.setItem(LOCAL_KEYS.sync, JSON.stringify(payload));
  if (state.localChannel) {
    state.localChannel.postMessage(payload);
  }
}

async function syncFromLocalStore() {
  if (state.mode !== "local") {
    return;
  }
  const payload = await loadLocalBootstrap();
  hydrateContent(payload, { preserveSelections: true });
}

function attachLocalSync() {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCAL_KEYS.sync) {
      syncFromLocalStore().catch(() => {});
    }
  });
  if (state.localChannel) {
    state.localChannel.addEventListener("message", () => {
      syncFromLocalStore().catch(() => {});
    });
  }
}

function formatRuntime() {
  const runtime = state.runtime;
  refs.headerOnline.textContent = runtime.online;
  refs.onlineCount.textContent = `${runtime.online}/${runtime.maxPlayers}`;
  refs.queueCount.textContent = String(runtime.queue);
  refs.heatLevel.textContent = runtime.heatLevel;
  refs.economyShift.textContent = `${runtime.economyShift >= 0 ? "+" : ""}${Number(runtime.economyShift).toFixed(1)}%`;
  refs.weatherLabel.textContent = runtime.weatherLabel;
  refs.dispatchMood.textContent = runtime.dispatchMood;
  refs.pendingCount.textContent = String(runtime.pendingApplications || 0);
}

function updateClocks() {
  if (!state.runtime) {
    return;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: state.runtime.serverTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  refs.serverClock.textContent = formatter.format(new Date());

  const diff = Math.max(0, new Date(state.runtime.restartAt).getTime() - Date.now());
  const hours = String(Math.floor(diff / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
  refs.restartCountdown.textContent = `${hours}:${minutes}:${seconds}`;
}

function renderNav() {
  refs.navLinks.innerHTML = "";
  state.content.navigation.forEach((item) => {
    const link = document.createElement("a");
    link.className = "nav-link";
    link.href = `#${item.id}`;
    link.textContent = item.label;
    refs.navLinks.appendChild(link);
  });
}

function renderHero() {
  const { site, metrics } = state.content;
  refs.brandName.textContent = site.name;
  refs.brandTag.textContent = site.tag;
  refs.heroEyebrow.textContent = site.eyebrow + (state.mode === "local" ? " Local preview mode." : "");
  refs.heroTitleMain.textContent = site.heroTitle;
  refs.heroTitleAccent.textContent = site.heroAccent;
  refs.heroDescription.textContent = site.heroDescription;
  refs.sceneCopy.textContent = site.quickPitch;

  refs.heroMetrics.innerHTML = "";
  metrics.forEach((metric) => {
    const article = document.createElement("article");
    article.className = "metric";
    const value = metric.key ? `${state.runtime[metric.key]}${metric.suffix || ""}` : metric.value;
    article.innerHTML = `<div class="metric-label">${metric.label}</div><div class="metric-value">${value}</div><div class="metric-note">${metric.note}</div>`;
    refs.heroMetrics.appendChild(article);
  });
}

function renderIncidents() {
  refs.eventList.innerHTML = "";
  refs.eventList.classList.add("stagger-list");
  state.content.incidents.forEach((event, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-item${index === state.activeIncident ? " active" : ""}`;
    const badge = event.severity === "high" ? "severity-high" : event.severity === "medium" ? "severity-medium" : "severity-low";
    button.innerHTML = `<div class="event-topline"><span>${event.title}</span><span class="severity-badge ${badge}">${event.severity}</span></div><div class="event-meta">${event.details} - ${event.time}</div>`;
    button.addEventListener("click", () => {
      state.activeIncident = index;
      renderIncidents();
    });
    refs.eventList.appendChild(button);
  });
  observeReveals();
}

function renderBulletins() {
  const current = state.content.bulletins.find((item) => item.id === state.activeBulletin) || state.content.bulletins[0];
  state.activeBulletin = current.id;

  refs.bulletinTabs.innerHTML = "";
  refs.newsList.innerHTML = "";
  refs.newsList.classList.add("stagger-list");
  refs.bulletinPoints.innerHTML = "";
  refs.bulletinTitle.textContent = current.title;
  refs.bulletinSummary.textContent = current.summary;

  current.points.forEach((point) => {
    const tag = document.createElement("span");
    tag.className = "bulletin-point";
    tag.textContent = point;
    refs.bulletinPoints.appendChild(tag);
  });

  state.content.bulletins.forEach((bulletin) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `bulletin-tab${bulletin.id === current.id ? " active" : ""}`;
    tab.textContent = bulletin.label;
    tab.addEventListener("click", () => {
      state.activeBulletin = bulletin.id;
      renderBulletins();
    });
    refs.bulletinTabs.appendChild(tab);

    const item = document.createElement("button");
    item.type = "button";
    item.className = `news-item${bulletin.id === current.id ? " active" : ""}`;
    item.innerHTML = `<div class="news-topline"><span>${bulletin.headline}</span><span>${bulletin.label}</span></div><div class="news-meta">${bulletin.summary}</div>`;
    item.addEventListener("click", () => {
      state.activeBulletin = bulletin.id;
      renderBulletins();
    });
    refs.newsList.appendChild(item);
  });
}

function renderQuickLinks() {
  refs.quickLinks.innerHTML = "";
  state.content.quickLinks.forEach((link) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "news-item";
    button.innerHTML = `<div class="news-topline"><span>${link.title}</span><span>${link.tag}</span></div><div class="news-meta">${link.description}</div>`;
    button.addEventListener("click", () => {
      document.querySelector(link.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    refs.quickLinks.appendChild(button);
  });

  refs.rhythmList.innerHTML = "";
  state.content.rhythmCards.forEach((card) => {
    const badgeTone = card.badge.includes("Serious") ? "severity-medium" : "severity-low";
    const item = document.createElement("div");
    item.className = "event-item";
    item.innerHTML = `<div class="event-topline"><span>${card.title}</span><span class="severity-badge ${badgeTone}">${card.badge}</span></div><div class="event-meta">${card.description}</div>`;
    refs.rhythmList.appendChild(item);
  });
}

function renderZones() {
  refs.cityZones.innerHTML = "";
  state.content.zones.forEach((zone) => {
    const card = document.createElement("article");
    card.className = "zone-card reveal";
    card.innerHTML = `<div><div class="zone-icon">${zone.icon}</div><h3 class="zone-title">${zone.title}</h3><p class="zone-copy">${zone.description}</p></div><div class="zone-meter"><div class="meter-row"><span>${zone.meterLabel}</span><span>${zone.meterValue}%</span></div><div class="meter-bar"><div class="meter-fill" style="width:${zone.meterValue}%"></div></div></div>`;
    refs.cityZones.appendChild(card);
  });
  observeReveals();
}

function renderGallery() {
  refs.galleryGrid.innerHTML = "";
  state.content.gallery.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gallery-item ${item.layout} reveal`;
    button.innerHTML = `<img src="${item.image}" alt="${item.title}"><span class="gallery-overlay"><span class="gallery-label">${item.title}</span><span class="gallery-caption">${item.description}</span></span>`;
    button.addEventListener("click", () => openLightbox(index));
    refs.galleryGrid.appendChild(button);
  });
  observeReveals();
}

function renderStore() {
  refs.tierGrid.innerHTML = "";
  state.content.tiers.forEach((tier) => {
    const card = document.createElement("article");
    card.className = `tier-card reveal${tier.id === state.selectedTier ? " selected" : ""}`;
    card.innerHTML = `<div class="mini-chip" style="width:max-content;color:${tier.accent};border-color:${tier.accent}55;">${tier.label}</div><h3 class="tier-name">${tier.name}</h3><div class="tier-price" style="color:${tier.accent};">${tier.price} CC</div><div class="tier-description">${tier.description}</div><div class="perk-list">${tier.perks.map((perk) => `<div class="perk-item">${perk}</div>`).join("")}</div><button class="secondary-button tier-action" type="button">Select ${tier.name}</button>`;
    card.addEventListener("click", () => {
      state.selectedTier = tier.id;
      renderStore();
      renderTierSummary();
    });
    refs.tierGrid.appendChild(card);
  });
  observeReveals();
}

function renderTierSummary() {
  const tier = state.content.tiers.find((item) => item.id === state.selectedTier) || state.content.tiers[0];
  const extra = Number(refs.extraCc.value);
  refs.summaryTier.textContent = tier.name;
  refs.summaryQueue.textContent = tier.queue;
  refs.summaryImports.textContent = String(tier.imports);
  refs.summaryTotal.textContent = `${tier.price + extra} CC`;
  refs.summaryTone.textContent = tier.tone;
  refs.summaryAudience.textContent = tier.audience;
  refs.summarySkip.textContent = tier.skip;
  refs.extraCcValue.textContent = `${extra} CC`;
}

function renderFaq() {
  refs.faqList.innerHTML = "";
  state.content.faq.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = `faq-card reveal${index === 0 ? " open" : ""}`;
    article.innerHTML = `<button class="faq-button" type="button"><span class="faq-question">${item.question}</span><span>+</span></button><div class="faq-answer"><div class="faq-answer-inner">${item.answer}</div></div>`;
    article.querySelector(".faq-button").addEventListener("click", () => article.classList.toggle("open"));
    refs.faqList.appendChild(article);
  });
  observeReveals();
}

function createField(field) {
  const wrapper = document.createElement("label");
  wrapper.className = `field-stack${field.full ? " full" : ""}`;
  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = `${field.label}${field.required ? " *" : ""}`;
  wrapper.appendChild(label);

  let input;
  if (field.type === "textarea") {
    input = document.createElement("textarea");
    input.className = "field-textarea";
  } else if (field.type === "select") {
    input = document.createElement("select");
    input.className = "field-select";
    input.innerHTML = '<option value="">Select an option</option>';
    field.options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option;
      item.textContent = option;
      input.appendChild(item);
    });
  } else {
    input = document.createElement("input");
    input.className = "field-input";
    input.type = field.type;
  }

  input.name = field.key;
  input.placeholder = field.placeholder || "";
  input.value = state.formState[field.key] || "";
  input.addEventListener("input", handleFieldChange);
  input.addEventListener("change", handleFieldChange);
  wrapper.appendChild(input);
  return wrapper;
}

function renderReviewStep() {
  const wrapper = document.createElement("div");
  wrapper.className = "field-stack full";
  wrapper.innerHTML = `
    <div class="summary-card">
      <div class="summary-line"><span>Discord</span><strong>${state.formState.discord || "Missing"}</strong></div>
      <div class="summary-line"><span>Name</span><strong>${state.formState.displayName || "Missing"}</strong></div>
      <div class="summary-line"><span>Character age</span><strong>${state.formState.characterAge || "Missing"}</strong></div>
      <div class="summary-line"><span>Timezone</span><strong>${state.formState.timezone || "Missing"}</strong></div>
      <div class="summary-line"><span>Playstyle</span><strong>${state.formState.playstyle || "Missing"}</strong></div>
      <div class="summary-line"><span>RP experience</span><strong>${state.formState.hours || "Missing"}</strong></div>
    </div>
    <label class="field-stack full">
      <span class="field-label">Character summary</span>
      <textarea class="field-textarea" readonly>${state.formState.concept || "No concept yet."}</textarea>
    </label>
    <label class="field-stack full">
      <span class="field-label">Extra notes</span>
      <textarea class="field-textarea" readonly>${state.formState.notes || "No extra notes."}</textarea>
    </label>
  `;
  refs.formFields.appendChild(wrapper);
}

function renderForm() {
  const step = state.content.applicationSteps[state.currentStep];
  refs.stepLabel.textContent = `Step ${state.currentStep + 1} of ${state.content.applicationSteps.length}`;
  refs.nextStep.textContent = step.button;
  refs.prevStep.style.visibility = state.currentStep === 0 ? "hidden" : "visible";
  refs.formFields.innerHTML = "";
  refs.stepper.innerHTML = "";

  state.content.applicationSteps.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = `step-node${index === state.currentStep ? " active" : ""}`;
    card.innerHTML = `<div class="step-count">${index + 1}</div><div class="step-name">${item.name}</div><div class="step-help">${item.help}</div>`;
    refs.stepper.appendChild(card);
  });

  if (step.fields.length === 0) {
    renderReviewStep();
    return;
  }

  step.fields.forEach((field) => refs.formFields.appendChild(createField(field)));
}

function updatePreview() {
  refs.previewName.textContent = state.formState.displayName || "Unregistered";
  refs.previewAge.textContent = state.formState.characterAge ? `Age ${state.formState.characterAge}` : "Age not set";
  refs.previewConcept.textContent = state.formState.concept || "No concept written yet. The right side of the page mirrors what the application currently says.";
  refs.previewStyle.textContent = state.formState.playstyle || "No selected roleplay lane";
  refs.previewHours.textContent = state.formState.hours || "Hours unknown";
  refs.previewReady.textContent = state.formState.rules === "Yes" ? "Rules confirmed" : "Rules pending";
  refs.previewVoice.textContent = state.formState.voice === "Yes" ? "Mic ready" : "Voice check pending";
}

function saveDraft() {
  writeLocalJson(LOCAL_KEYS.draft, state.formState);
  refs.draftNote.textContent = "Draft saved automatically in this browser. Final applications save locally on this machine.";
}

function loadDraft() {
  const stored = readLocalJson(LOCAL_KEYS.draft, null);
  if (!stored) {
    return;
  }
  Object.assign(state.formState, stored);
  refs.draftNote.textContent = "Recovered your saved draft from this browser.";
}

function clearDraftState() {
  localStorage.removeItem(LOCAL_KEYS.draft);
  Object.keys(state.formState).forEach((key) => {
    state.formState[key] = "";
  });
  state.currentStep = 0;
  refs.form.reset();
  renderForm();
  updatePreview();
  refs.draftNote.textContent = "Draft cleared. Fresh slate.";
  showToast("Draft cleared", "The local whitelist draft has been removed.");
}

function handleFieldChange(event) {
  state.formState[event.target.name] = event.target.value;
  updatePreview();
  saveDraft();
}

function validateCurrentStep() {
  const fields = state.content.applicationSteps[state.currentStep].fields;
  for (const field of fields) {
    if (field.required && !String(state.formState[field.key] || "").trim()) {
      showToast("Missing field", `Please complete ${field.label} before moving on.`);
      return false;
    }
  }
  return true;
}

function createApplication(payload) {
  const now = new Date().toISOString();
  return {
    id: `app-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    ...payload
  };
}

async function submitApplication(event) {
  event.preventDefault();
  if (state.currentStep < state.content.applicationSteps.length - 1) {
    if (!validateCurrentStep()) {
      return;
    }
    state.currentStep += 1;
    renderForm();
    return;
  }

  if (!validateCurrentStep()) {
    return;
  }

  let application;
  if (state.mode === "api") {
    const result = await fetchJson("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.formState)
    });
    application = result.application;
  } else {
    application = createApplication(clone(state.formState));
    state.applications.unshift(application);
    state.runtime = enrichRuntime(state.runtime, state.applications);
    persistLocalState();
    broadcastLocalUpdate("applications");
  }

  localStorage.removeItem(LOCAL_KEYS.draft);
  Object.keys(state.formState).forEach((key) => {
    state.formState[key] = "";
  });
  state.currentStep = 0;
  refs.form.reset();
  renderForm();
  updatePreview();
  formatRuntime();
  refs.draftNote.textContent = "Submission complete. Draft cleared.";
  showToast("Application sent", `${application.displayName || "Citizen"} has been added to the whitelist queue.`);
}

function renderLightbox(index) {
  const gallery = state.content.gallery;
  const item = gallery[(index + gallery.length) % gallery.length];
  state.galleryIndex = gallery.indexOf(item);
  refs.lightboxImage.src = item.image;
  refs.lightboxImage.alt = item.title;
  refs.lightboxTitle.textContent = item.title;
  refs.lightboxDescription.textContent = item.description;
  refs.lightboxCounter.textContent = `${state.galleryIndex + 1} / ${gallery.length}`;
}

function openLightbox(index) {
  renderLightbox(index);
  refs.lightbox.classList.add("open");
  refs.lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  refs.lightbox.classList.remove("open");
  refs.lightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function observeReveals() {
  const observer = window.__sincityRevealObserver || new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  window.__sincityRevealObserver = observer;
  document.querySelectorAll(".reveal").forEach((node) => {
    if (!node.classList.contains("visible")) {
      observer.observe(node);
    }
  });
}

function initParticles() {
  const canvas = document.getElementById("particle-field");
  const context = canvas.getContext("2d");
  if (!context) return;

  const particles = [];
  const total = window.innerWidth < 700 ? 40 : 80;
  const mouse = { x: -100, y: -100 };

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function makeParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1 + Math.random() * 2,
      vx: -0.5 + Math.random(),
      vy: -0.5 + Math.random(),
      a: 0.1 + Math.random() * 0.4
    };
  }

  resize();
  for (let i = 0; i < total; i++) particles.push(makeParticle());

  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 150) {
        const force = (150 - dist) / 1500;
        p.vx -= dx * force;
        p.vy -= dy * force;
      }

      context.beginPath();
      context.fillStyle = `rgba(149,255,110,${p.a})`;
      context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      context.fill();
      
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.vy *= 0.99;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  draw();
}

function rotateScene() {
  const scenes = state.content.sceneOptions;
  const next = scenes[Math.floor(Math.random() * scenes.length)];
  refs.sceneCopy.textContent = next;
  
  // Add screen shake
  document.body.style.animation = "none";
  document.body.offsetHeight; // trigger reflow
  document.body.style.animation = "shake 0.4s cubic-bezier(.36,.07,.19,.97) both";
  
  showToast("City vibe updated", "The hero panel just cycled to a new SinCity mood.");
}

function toggleTheme() {
  state.theme = state.theme === "neon" ? "heat" : "neon";
  document.body.classList.toggle("theme-heat", state.theme === "heat");
  refs.themeIcon.textContent = state.theme === "neon" ? "🟢" : "🔴";
  showToast("Theme switched", `City atmosphere shifted to ${state.theme === "neon" ? "Neon Noir" : "High Heat"}.`);
}

function hydrateContent(payload, options = {}) {
  const preserveSelections = Boolean(options.preserveSelections);
  const previousBulletin = state.activeBulletin;
  const previousTier = state.selectedTier;

  state.content = payload.content;
  state.applications = payload.applications || state.applications || [];
  state.runtime = enrichRuntime(payload.runtime, state.applications);
  state.activeBulletin = preserveSelections ? previousBulletin : payload.content.bulletins[0]?.id || null;
  state.selectedTier = preserveSelections ? previousTier : payload.content.tiers[0]?.id || null;
  renderNav();
  renderHero();
  renderIncidents();
  renderBulletins();
  renderQuickLinks();
  renderZones();
  renderGallery();
  renderStore();
  renderTierSummary();
  renderFaq();
  renderForm();
  updatePreview();
  formatRuntime();
  updateClocks();
  observeReveals();
}

function attachApiLiveStream() {
  const source = new EventSource("/api/live");
  source.addEventListener("runtime", (event) => {
    state.runtime = enrichRuntime(JSON.parse(event.data), state.applications);
    renderHero();
    formatRuntime();
    updateClocks();
  });
  source.addEventListener("content", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.incidents) {
      state.content.incidents = payload.incidents;
      state.activeIncident = 0;
      renderIncidents();
    }
    if (payload.bulletins) {
      state.content.bulletins = payload.bulletins;
      renderBulletins();
    }
    if (payload.gallery) {
      state.content.gallery = payload.gallery;
      renderGallery();
    }
    if (payload.quickLinks) {
      state.content.quickLinks = payload.quickLinks;
      renderQuickLinks();
    }
  });
  source.addEventListener("applications", async () => {
    const payload = await fetchJson("/api/bootstrap");
    hydrateContent(payload, { preserveSelections: true });
  });
}

function mutateLocalRuntime() {
  if (state.mode !== "local") {
    return;
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const nextRuntime = clone(state.runtime);
  nextRuntime.online = clamp(nextRuntime.online + Math.floor(Math.random() * 7) - 3, 90, nextRuntime.maxPlayers);
  nextRuntime.queue = clamp(nextRuntime.queue + Math.floor(Math.random() * 5) - 2, 8, 70);
  nextRuntime.storyDensity = clamp(nextRuntime.storyDensity + Math.floor(Math.random() * 5) - 2, 88, 100);
  nextRuntime.economyShift = Math.round((Number(nextRuntime.economyShift) + (Math.random() * 1.8 - 0.9)) * 10) / 10;

  const heatOptions = ["Low", "Moderate", "Hot", "Messy"];
  if (Math.random() > 0.72) {
    nextRuntime.heatLevel = heatOptions[Math.floor(Math.random() * heatOptions.length)];
  }
  if (Math.random() > 0.75) {
    nextRuntime.weatherLabel = state.content.weatherModes[Math.floor(Math.random() * state.content.weatherModes.length)];
  }
  if (Math.random() > 0.76) {
    nextRuntime.dispatchMood = state.content.dispatchModes[Math.floor(Math.random() * state.content.dispatchModes.length)];
  }

  state.runtime = enrichRuntime(nextRuntime, state.applications);
  persistLocalState();
  formatRuntime();
  renderHero();
  broadcastLocalUpdate("runtime");
}

async function bootstrap() {
  const preferLocalMode = window.location.protocol === "file:" || window.location.pathname.endsWith(".html");
  if (preferLocalMode) {
    state.mode = "local";
    return loadLocalBootstrap();
  }
  try {
    const payload = await fetchJson("/api/bootstrap");
    state.mode = "api";
    return {
      ...payload,
      applications: []
    };
  } catch {
    state.mode = "local";
    return loadLocalBootstrap();
  }
}

async function init() {
  const payload = await bootstrap();
  hydrateContent(payload);
  loadDraft();
  renderForm();
  updatePreview();
  initParticles();

  if (state.mode === "api") {
    attachApiLiveStream();
  } else {
    attachLocalSync();
    window.setInterval(mutateLocalRuntime, 8000);
    showToast("Local preview mode", "Running fully in-browser. Content and applications save locally for preview.");
  }

  refs.randomizeScene.addEventListener("click", rotateScene);
  refs.themeToggle.addEventListener("click", toggleTheme);
  refs.prevStep.addEventListener("click", () => {
    state.currentStep = Math.max(0, state.currentStep - 1);
    renderForm();
  });
  refs.clearDraft.addEventListener("click", clearDraftState);
  refs.form.addEventListener("submit", (event) => {
    submitApplication(event).catch((error) => showToast("Submission failed", error.message));
  });
  refs.extraCc.addEventListener("input", renderTierSummary);
  refs.checkoutButton.addEventListener("click", () => {
    const tier = state.content.tiers.find((item) => item.id === state.selectedTier);
    showToast("Supporter pack ready", `${tier.name} bundle prepared with ${refs.extraCc.value} CC extra.`);
  });
  refs.closeLightbox.addEventListener("click", closeLightbox);
  refs.prevGallery.addEventListener("click", () => renderLightbox(state.galleryIndex - 1));
  refs.nextGallery.addEventListener("click", () => renderLightbox(state.galleryIndex + 1));
  refs.lightbox.addEventListener("click", (event) => {
    if (event.target === refs.lightbox) {
      closeLightbox();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && refs.lightbox.classList.contains("open")) {
      closeLightbox();
    }
    if (refs.lightbox.classList.contains("open") && event.key === "ArrowRight") {
      renderLightbox(state.galleryIndex + 1);
    }
    if (refs.lightbox.classList.contains("open") && event.key === "ArrowLeft") {
      renderLightbox(state.galleryIndex - 1);
    }
  });
  window.setInterval(updateClocks, 1000);
}

init().catch((error) => {
  showToast("Load failed", error.message);
});
