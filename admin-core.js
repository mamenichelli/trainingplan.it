(() => {
    "use strict";

    const STORE_KEY = "trainingplan_text_overrides_v1";
    const SESSION_KEY = "trainingplan_admin_session_v1";
    const SESSION_DURATION = 4 * 60 * 60 * 1000;
    const encoder = new TextEncoder();

    function readStore() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function writeStore(store) {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
        window.dispatchEvent(new CustomEvent("planadmin:change"));
    }

    function getPlan(planId) {
        return readStore()[planId] || {};
    }

    function get(planId, key, fallback = "") {
        const plan = getPlan(planId);
        return Object.prototype.hasOwnProperty.call(plan, key) ? plan[key] : String(fallback ?? "");
    }

    function set(planId, key, value) {
        const store = readStore();
        if (!store[planId]) store[planId] = {};
        store[planId][key] = String(value ?? "");
        writeStore(store);
    }

    function removePlan(planId) {
        const store = readStore();
        delete store[planId];
        writeStore(store);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function mark(planId, key, fallback, className = "") {
        const css = className ? ` class="${escapeHtml(className)}"` : "";
        return `<span data-admin-plan="${escapeHtml(planId)}" data-admin-text="${escapeHtml(key)}"${css}>${escapeHtml(get(planId, key, fallback))}</span>`;
    }

    function setElement(element, planId, key, fallback) {
        if (!element) return;
        element.dataset.adminPlan = planId;
        element.dataset.adminText = key;
        element.textContent = get(planId, key, fallback);
        if (isEditMode()) bindEditable(element);
    }

    function bytesFromBase64(value) {
        return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    }

    function constantTimeEqual(left, right) {
        if (left.length !== right.length) return false;
        let result = 0;
        for (let index = 0; index < left.length; index += 1) result |= left[index] ^ right[index];
        return result === 0;
    }

    async function authenticate(password) {
        const response = await fetch(`admin-auth.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Configurazione amministratore non disponibile.");
        const config = await response.json();
        const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({
            name: "PBKDF2",
            hash: "SHA-256",
            salt: bytesFromBase64(config.salt),
            iterations: config.iterations
        }, key, 256);
        const valid = constantTimeEqual(new Uint8Array(bits), bytesFromBase64(config.hash));
        if (valid) sessionStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_DURATION));
        return valid;
    }

    function sessionActive() {
        const expiresAt = Number(sessionStorage.getItem(SESSION_KEY) || 0);
        if (expiresAt > Date.now()) return true;
        sessionStorage.removeItem(SESSION_KEY);
        return false;
    }

    function logout() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    function isEditMode() {
        return new URLSearchParams(location.search).get("admin") === "1" && sessionActive();
    }

    let saveTimer = null;

    function signalSaved(element) {
        const toolbarStatus = document.getElementById("admin-edit-status");
        if (toolbarStatus) toolbarStatus.textContent = "Salvataggio…";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const planId = element.dataset.adminPlan;
            const key = element.dataset.adminText;
            if (planId && key) set(planId, key, element.innerText.trim());
            if (toolbarStatus) toolbarStatus.textContent = "Salvato nel browser";
        }, 180);
    }

    function bindEditable(element) {
        if (!element || element.dataset.adminBound === "1") return;
        element.dataset.adminBound = "1";
        element.setAttribute("contenteditable", "plaintext-only");
        element.setAttribute("spellcheck", "true");
        element.classList.add("admin-editable-text");
        element.addEventListener("input", () => signalSaved(element));
        element.addEventListener("blur", () => {
            clearTimeout(saveTimer);
            const planId = element.dataset.adminPlan;
            const key = element.dataset.adminText;
            if (planId && key) set(planId, key, element.innerText.trim());
            const toolbarStatus = document.getElementById("admin-edit-status");
            if (toolbarStatus) toolbarStatus.textContent = "Salvato nel browser";
        });
    }

    function installEditingStyles() {
        if (document.getElementById("admin-edit-styles")) return;
        const style = document.createElement("style");
        style.id = "admin-edit-styles";
        style.textContent = `
            .admin-editable-text { outline: 1px dashed rgba(34,211,238,.42); outline-offset: 2px; border-radius: 3px; cursor: text; }
            .admin-editable-text:hover, .admin-editable-text:focus { outline: 2px solid rgba(34,211,238,.9); background: rgba(8,145,178,.14); }
            #admin-edit-toolbar { position: fixed; z-index: 9999; left: 50%; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; align-items: center; gap: 10px; width: min(calc(100% - 24px), 620px); padding: 10px 12px; border: 1px solid rgba(34,211,238,.35); border-radius: 16px; background: rgba(2,6,23,.94); box-shadow: 0 20px 55px rgba(0,0,0,.5); backdrop-filter: blur(16px); color: #e2e8f0; font: 600 12px/1.2 Inter, sans-serif; }
            #admin-edit-toolbar button { border: 1px solid rgba(148,163,184,.25); border-radius: 10px; padding: 9px 12px; background: #0f172a; color: #e2e8f0; font-weight: 800; cursor: pointer; }
            #admin-edit-toolbar button:last-child { background: #22d3ee; color: #020617; }
            body { padding-bottom: 92px !important; }
        `;
        document.head.appendChild(style);
    }

    function installToolbar(planId) {
        if (document.getElementById("admin-edit-toolbar")) return;
        const toolbar = document.createElement("div");
        toolbar.id = "admin-edit-toolbar";
        toolbar.dataset.adminNoedit = "1";
        toolbar.innerHTML = `
            <div style="min-width:0;flex:1"><strong style="display:block;color:#67e8f9">MODIFICA ${escapeHtml(planId)}</strong><span id="admin-edit-status" style="color:#94a3b8">Tocca qualsiasi testo evidenziato</span></div>
            <button type="button" id="admin-edit-reload">Ricarica</button>
            <button type="button" id="admin-edit-back">Pannello</button>
        `;
        document.body.appendChild(toolbar);
        document.getElementById("admin-edit-reload").addEventListener("click", () => location.reload());
        document.getElementById("admin-edit-back").addEventListener("click", () => { top.location.href = "admin.html"; });
    }

    function activate(planId) {
        if (!isEditMode()) return false;
        installEditingStyles();
        document.querySelectorAll("[data-admin-text]").forEach(bindEditable);
        installToolbar(planId);
        const observer = new MutationObserver(() => {
            document.querySelectorAll("[data-admin-text]:not([data-admin-bound='1'])").forEach(bindEditable);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return true;
    }

    function elementPath(element) {
        const parts = [];
        let current = element;
        while (current && current !== document.body) {
            const parent = current.parentElement;
            if (!parent) break;
            const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
            parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
            current = parent;
        }
        return parts.join(">");
    }

    function activateAuto(planId) {
        const excluded = "script,style,svg,path,img,iframe,noscript,input,textarea,select,option,[data-admin-noedit]";
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent || parent.closest(excluded)) return NodeFilter.FILTER_REJECT;
                if (parent.closest("[data-admin-text]")) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const records = nodes.map((node) => {
            const parent = node.parentElement;
            const textNodes = [...parent.childNodes].filter((item) => item.nodeType === Node.TEXT_NODE && item.textContent.trim());
            const key = `auto:${elementPath(parent)}:text(${textNodes.indexOf(node) + 1})`;
            return { node, key, raw: node.textContent };
        });
        records.forEach(({ node, key, raw }) => {
            const leading = raw.match(/^\s*/)?.[0] || "";
            const trailing = raw.match(/\s*$/)?.[0] || "";
            const fallback = raw.trim();
            const span = document.createElement("span");
            span.dataset.adminPlan = planId;
            span.dataset.adminText = key;
            span.textContent = get(planId, key, fallback);
            const fragment = document.createDocumentFragment();
            if (leading) fragment.append(document.createTextNode(leading));
            fragment.append(span);
            if (trailing) fragment.append(document.createTextNode(trailing));
            node.replaceWith(fragment);
        });
        activate(planId);
    }

    function exportAll() {
        const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), plans: readStore() }, null, 2);
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `trainingplan-testi-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function importAll(payload) {
        const plans = payload && payload.plans ? payload.plans : payload;
        if (!plans || typeof plans !== "object" || Array.isArray(plans)) throw new Error("File non valido.");
        writeStore(plans);
    }

    window.PlanAdmin = {
        activate,
        activateAuto,
        authenticate,
        exportAll,
        get,
        getPlan,
        importAll,
        isEditMode,
        logout,
        mark,
        removePlan,
        sessionActive,
        set,
        setElement
    };
})();
