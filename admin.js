const LOCAL_KEYS = {
  content: "sincity-local-content",
  runtime: "sincity-local-runtime",
  applications: "sincity-local-applications",
  sync: "sincity-local-sync",
  adminKey: "sincity-admin-key"
};

const LOCAL_CHANNEL_NAME = "sincity-local-channel";

const adminState = {
  mode: "loading",
  channel: "BroadcastChannel" in window ? new BroadcastChannel(LOCAL_CHANNEL_NAME) : null
};

const adminRefs = {
  key: document.getElementById("admin-key"),
  saveKey: document.getElementById("save-admin-key"),
  runtimeForm: document.getElementById("runtime-form"),
  incidentForm: document.getElementById("incident-form"),
  contentEditor: document.getElementById("content-editor"),
  saveContent: document.getElementById("save-content"),
  refreshContent: document.getElementById("refresh-content"),
  exportSnapshot: document.getElementById("export-snapshot"),
  exportApplications: document.getElementById("export-applications"),
  importSnapshot: document.getElementById("import-snapshot"),
  applications: document.getElementById("application-admin-list"),
  toastStack: document.getElementById("toast-stack"),
  search: document.getElementById("admin-search")
};

function adminToast(title, message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  adminRefs.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function getAdminKey() {
  return localStorage.getItem(LOCAL_KEYS.adminKey) || "";
}

function setAdminKey(value) {
  localStorage.setItem(LOCAL_KEYS.adminKey, value);
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected ${contentType || "response"} from ${url}.`);
  }
  const payload = JSON.parse(text);
  if (!response.ok) {
    throw new Error(payload.error || "Admin request failed.");
  }
  return payload;
}

async function loadSeedJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  return response.json();
}

async function adminFetch(url, options = {}) {
  if (adminState.mode === "local") {
    throw new Error("API request attempted in local mode.");
  }
  const key = getAdminKey();
  return fetchJson(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
      ...(options.headers || {})
    }
  });
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function broadcastLocalUpdate(type) {
  const payload = { type, at: Date.now() };
  localStorage.setItem(LOCAL_KEYS.sync, JSON.stringify(payload));
  adminState.channel?.postMessage(payload);
}

function normalizeLocalRuntime(runtime, applications) {
  return {
    ...runtime,
    localMode: true,
    adminProtected: false,
    applicationCount: applications.length,
    pendingApplications: applications.filter((item) => item.status === "pending").length
  };
}

async function loadLocalSnapshot() {
  const [seedContent, seedRuntime] = await Promise.all([
    loadSeedJson("data/content.json"),
    loadSeedJson("data/runtime.json")
  ]);
  const content = readLocalJson(LOCAL_KEYS.content, seedContent);
  const runtime = readLocalJson(LOCAL_KEYS.runtime, seedRuntime);
  const applications = readLocalJson(LOCAL_KEYS.applications, []);
  return {
    content,
    runtime: normalizeLocalRuntime(runtime, applications),
    applications
  };
}

function persistLocalSnapshot(snapshot) {
  writeLocalJson(LOCAL_KEYS.content, snapshot.content);
  writeLocalJson(LOCAL_KEYS.runtime, snapshot.runtime);
  writeLocalJson(LOCAL_KEYS.applications, snapshot.applications);
}

function populateRuntimeForm(runtime) {
  Object.entries(runtime).forEach(([key, value]) => {
    const field = adminRefs.runtimeForm.elements.namedItem(key);
    if (field) {
      field.value = value;
    }
  });
}

function renderApplications(applications) {
  const searchTerm = adminRefs.search.value.toLowerCase();
  const filtered = applications.filter((app) => 
    app.displayName.toLowerCase().includes(searchTerm) || 
    app.discord.toLowerCase().includes(searchTerm)
  );

  adminRefs.applications.innerHTML = "";
  if (filtered.length === 0) {
    adminRefs.applications.innerHTML = `<div class="application-admin-item">${searchTerm ? "No matches found." : "No whitelist applications yet."}</div>`;
    return;
  }

  filtered.forEach((application) => {
    const item = document.createElement("article");
    item.className = "application-admin-item";
    item.innerHTML = `
      <div class="application-admin-top">
        <div>
          <strong>${application.displayName}</strong>
          <div class="inline-note">${application.discord} - ${application.timezone}</div>
        </div>
        <div class="inline-actions">
          <select class="field-select status-select">
            <option value="pending"${application.status === "pending" ? " selected" : ""}>pending</option>
            <option value="approved"${application.status === "approved" ? " selected" : ""}>approved</option>
            <option value="rejected"${application.status === "rejected" ? " selected" : ""}>rejected</option>
          </select>
          <button class="ghost-button" type="button">Delete</button>
        </div>
      </div>
      <div class="application-admin-meta">
        <span class="admin-tag">${application.characterAge}</span>
        <span class="admin-tag">${application.playstyle}</span>
        <span class="admin-tag">${application.hours}</span>
        <span class="admin-tag">${application.voice}</span>
        <span class="admin-tag">${application.rules}</span>
      </div>
      <div class="application-admin-copy"><strong>Concept:</strong> ${application.concept}</div>
      <div class="application-admin-copy"><strong>Notes:</strong> ${application.notes || "None"}</div>
    `;

    const select = item.querySelector("select");
    const removeButton = item.querySelector("button");

    select.addEventListener("change", async () => {
      if (adminState.mode === "local") {
        const snapshot = await loadLocalSnapshot();
        const current = snapshot.applications.find((entry) => entry.id === application.id);
        if (!current) {
          return;
        }
        current.status = select.value;
        current.updatedAt = new Date().toISOString();
        persistLocalSnapshot(snapshot);
        broadcastLocalUpdate("applications");
        adminToast("Application updated", `${application.displayName} is now ${select.value}.`);
        refreshAll().catch((error) => adminToast("Reload failed", error.message));
        return;
      }

      try {
        await adminFetch(`/api/admin/applications/${application.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: select.value })
        });
        adminToast("Application updated", `${application.displayName} is now ${select.value}.`);
      } catch (error) {
        adminToast("Update failed", error.message);
      }
    });

    removeButton.addEventListener("click", async () => {
      if (adminState.mode === "local") {
        const snapshot = await loadLocalSnapshot();
        snapshot.applications = snapshot.applications.filter((entry) => entry.id !== application.id);
        snapshot.runtime = normalizeLocalRuntime(snapshot.runtime, snapshot.applications);
        persistLocalSnapshot(snapshot);
        broadcastLocalUpdate("applications");
        adminToast("Application removed", `${application.displayName} was removed from the queue.`);
        refreshAll().catch((error) => adminToast("Reload failed", error.message));
        return;
      }

      try {
        await adminFetch(`/api/admin/applications/${application.id}`, { method: "DELETE" });
        adminToast("Application removed", `${application.displayName} was removed from the queue.`);
        refreshApplications();
      } catch (error) {
        adminToast("Delete failed", error.message);
      }
    });

    adminRefs.applications.appendChild(item);
  });
}

async function refreshContent() {
  if (adminState.mode === "local") {
    const snapshot = await loadLocalSnapshot();
    adminRefs.contentEditor.value = JSON.stringify(snapshot.content, null, 2);
    return;
  }
  const content = await adminFetch("/api/admin/content", { method: "GET" });
  adminRefs.contentEditor.value = JSON.stringify(content, null, 2);
}

async function refreshRuntime() {
  if (adminState.mode === "local") {
    const snapshot = await loadLocalSnapshot();
    populateRuntimeForm(snapshot.runtime);
    return;
  }
  const runtime = await adminFetch("/api/admin/runtime", { method: "GET" });
  populateRuntimeForm(runtime);
}

async function refreshApplications() {
  if (adminState.mode === "local") {
    const snapshot = await loadLocalSnapshot();
    renderApplications(snapshot.applications);
    return;
  }
  const applications = await adminFetch("/api/admin/applications", { method: "GET" });
  adminState.allApplications = applications;
  renderApplications(applications);
}

adminRefs.search.addEventListener("input", () => {
  if (adminState.mode === "local") {
    refreshApplications();
  } else {
    renderApplications(adminState.allApplications || []);
  }
});

async function refreshAll() {
  await Promise.all([refreshContent(), refreshRuntime(), refreshApplications()]);
}

function attachLocalSync() {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCAL_KEYS.sync) {
      refreshAll().catch(() => {});
    }
  });
  adminState.channel?.addEventListener("message", () => {
    refreshAll().catch(() => {});
  });
}

async function bootstrapAdmin() {
  adminRefs.key.value = getAdminKey();
  const preferLocalMode = window.location.protocol === "file:" || window.location.pathname.endsWith(".html");
  if (preferLocalMode) {
    adminState.mode = "local";
    attachLocalSync();
    await refreshAll();
    return;
  }
  try {
    await fetchJson("/api/bootstrap");
    adminState.mode = "api";
  } catch {
    adminState.mode = "local";
    attachLocalSync();
  }
  await refreshAll();
}

adminRefs.saveKey.addEventListener("click", () => {
  setAdminKey(adminRefs.key.value.trim());
  adminToast("Admin key saved", adminState.mode === "local" ? "Stored locally, but not needed for preview mode." : "The local admin key has been stored in this browser.");
});

adminRefs.runtimeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(adminRefs.runtimeForm).entries());
  if (adminState.mode === "local") {
    const snapshot = await loadLocalSnapshot();
    snapshot.runtime = normalizeLocalRuntime({
      ...snapshot.runtime,
      online: Number(formData.online),
      queue: Number(formData.queue),
      storyDensity: Number(formData.storyDensity),
      heatLevel: String(formData.heatLevel),
      economyShift: Number(formData.economyShift),
      weatherLabel: String(formData.weatherLabel),
      dispatchMood: String(formData.dispatchMood),
      restartAt: String(formData.restartAt),
      serverTimeZone: String(formData.serverTimeZone),
      maxPlayers: Number(formData.maxPlayers)
    }, snapshot.applications);
    persistLocalSnapshot(snapshot);
    broadcastLocalUpdate("runtime");
    adminToast("Runtime saved", "Local preview values were updated.");
    return;
  }

  try {
    await adminFetch("/api/admin/runtime", {
      method: "PUT",
      body: JSON.stringify(formData)
    });
    adminToast("Runtime saved", "Live server values were updated.");
  } catch (error) {
    adminToast("Runtime failed", error.message);
  }
});

adminRefs.incidentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = Object.fromEntries(new FormData(adminRefs.incidentForm).entries());

  if (adminState.mode === "local") {
    const snapshot = await loadLocalSnapshot();
    const incident = {
      id: `evt-${Date.now()}`,
      title: String(formData.title || "New incident"),
      severity: ["low", "medium", "high"].includes(formData.severity) ? formData.severity : "medium",
      time: String(formData.time || "moments ago"),
      details: String(formData.details || "Something suspicious happened and the city is pretending not to notice.")
    };
    snapshot.content.incidents.unshift(incident);
    snapshot.content.incidents = snapshot.content.incidents.slice(0, 8);
    persistLocalSnapshot(snapshot);
    adminRefs.incidentForm.reset();
    broadcastLocalUpdate("content");
    adminToast("Incident broadcast", "The local live feed has a new incident.");
    return;
  }

  try {
    await adminFetch("/api/admin/incidents", {
      method: "POST",
      body: JSON.stringify(formData)
    });
    adminRefs.incidentForm.reset();
    adminToast("Incident broadcast", "The live feed has a new incident.");
  } catch (error) {
    adminToast("Broadcast failed", error.message);
  }
});

adminRefs.saveContent.addEventListener("click", async () => {
  try {
    const parsed = JSON.parse(adminRefs.contentEditor.value);
    if (adminState.mode === "local") {
      const snapshot = await loadLocalSnapshot();
      snapshot.content = parsed;
      persistLocalSnapshot(snapshot);
      broadcastLocalUpdate("content");
      adminToast("Content saved", "The local preview content has been updated.");
      return;
    }
    await adminFetch("/api/admin/content", {
      method: "PUT",
      body: JSON.stringify(parsed)
    });
    adminToast("Content saved", "The live site content has been updated.");
  } catch (error) {
    adminToast("Save failed", error.message);
  }
});

adminRefs.refreshContent.addEventListener("click", () => {
  refreshContent()
    .then(() => adminToast("Content reloaded", adminState.mode === "local" ? "Fresh content pulled from local preview storage." : "Fresh content pulled from the server."))
    .catch((error) => adminToast("Reload failed", error.message));
});

adminRefs.exportSnapshot.addEventListener("click", async () => {
  try {
    if (adminState.mode === "local") {
      const snapshot = await loadLocalSnapshot();
      downloadJson("sincity-snapshot.json", snapshot);
      adminToast("Snapshot exported", "Full local preview data was downloaded as JSON.");
      return;
    }
    const snapshot = await adminFetch("/api/admin/export", { method: "GET" });
    downloadJson("sincity-snapshot.json", snapshot);
    adminToast("Snapshot exported", "Full local site data was downloaded as JSON.");
  } catch (error) {
    adminToast("Export failed", error.message);
  }
});

adminRefs.exportApplications.addEventListener("click", async () => {
  try {
    if (adminState.mode === "local") {
      const snapshot = await loadLocalSnapshot();
      downloadJson("sincity-applications.json", snapshot.applications);
      adminToast("Applications exported", "Local preview whitelist applications were downloaded.");
      return;
    }
    const applications = await adminFetch("/api/admin/applications", { method: "GET" });
    downloadJson("sincity-applications.json", applications);
    adminToast("Applications exported", "Whitelist applications were downloaded as JSON.");
  } catch (error) {
    adminToast("Export failed", error.message);
  }
});

adminRefs.importSnapshot.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    if (adminState.mode === "local") {
      const snapshot = {
        content: parsed.content,
        runtime: normalizeLocalRuntime(parsed.runtime, parsed.applications || []),
        applications: parsed.applications || []
      };
      persistLocalSnapshot(snapshot);
      broadcastLocalUpdate("snapshot");
      await refreshAll();
      adminToast("Snapshot imported", "Local preview data has been restored from the file.");
    } else {
      await adminFetch("/api/admin/import", {
        method: "POST",
        body: JSON.stringify(parsed)
      });
      await refreshAll();
      adminToast("Snapshot imported", "Local site data has been restored from the file.");
    }
  } catch (error) {
    adminToast("Import failed", error.message);
  } finally {
    adminRefs.importSnapshot.value = "";
  }
});

bootstrapAdmin().catch((error) => {
  adminToast("Admin load failed", error.message);
});
