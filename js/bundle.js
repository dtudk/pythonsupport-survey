var SurveyApp = (() => {
  // js/config.js
  var CONFIG = {
    endpoints: {
      survey: "https://python-support-proxy.azurewebsites.net/api/surveyProxy",
      // Update this URL for new SharePoint list
      token: "https://python-support-proxy.azurewebsites.net/api/issueToken",
      qrSign: "https://python-support-proxy.azurewebsites.net/api/qrRedirect"
    },
    // SharePoint configuration (if using direct integration)
    sharepoint: {
      siteUrl: "",
      // Your SharePoint site URL
      listName: "",
      // Your SharePoint list name
      tenantId: "",
      // Your Azure tenant ID
      clientId: ""
      // App registration client ID
    },
    storage: {
      auth: "surveySupportAuth",
      building: "selectedBuilding",
      workshopDay: "workshopDay"
    },
    urls: {
      pythonSupport: "https://pythonsupport.dtu.dk/"
    },
    timing: {
      thankYouDisplay: 3e3,
      redirectDelay: 7e3
    }
  };
  var QR_CONFIG = {
    size: 280,
    margin: 2,
    fallbackServices: [
      "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=",
      "https://chart.googleapis.com/chart?chs=280x280&cht=qr&chl="
    ]
  };

  // js/auth.js
  var AuthManager = class {
    constructor() {
      this.handleReset();
      this.setupLoginHandler();
    }
    handleReset() {
      const params = new URLSearchParams(location.search);
      if (params.get("reset") === "1") {
        try {
          localStorage.removeItem(CONFIG.storage.auth);
          localStorage.removeItem(CONFIG.storage.building);
        } catch {
        }
        params.delete("reset");
        params.delete("t");
        params.delete("token");
        params.delete("b");
        params.delete("wd");
        const next = location.pathname + (params.toString() ? `?${params.toString()}` : "");
        location.replace(next);
      }
    }
    getSavedKey() {
      const saved = localStorage.getItem(CONFIG.storage.auth);
      if (!saved) return [null, null];
      return saved.split("|");
    }
    isAuthValid() {
      const [date] = this.getSavedKey();
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      return date === today;
    }
    showLogin() {
      document.getElementById("loginModal").classList.remove("hidden");
      document.getElementById("mainWrapper").classList.add("pointer-events-none", "opacity-40");
    }
    hideLogin() {
      document.getElementById("loginModal").classList.add("hidden");
      document.getElementById("mainWrapper").classList.remove("pointer-events-none", "opacity-40");
    }
    checkAuthStatus() {
      const urlParams = new URLSearchParams(window.location.search);
      const hasOneTimeToken = urlParams.get("t") || urlParams.get("token");
      const hasQRCode = urlParams.get("b");
      if (hasOneTimeToken || hasQRCode) {
        this.hideLogin();
      } else if (this.isAuthValid()) {
        this.hideLogin();
      } else {
        this.showLogin();
      }
    }
    setupLoginHandler() {
      document.getElementById("codeSubmit").addEventListener("click", async () => {
        const input = document.getElementById("accessCodeInput").value.trim();
        const ok = await fetch(CONFIG.endpoints.survey, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": input },
          body: JSON.stringify({ ping: true })
        }).then((r) => r.ok).catch(() => false);
        if (ok) {
          const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
          localStorage.setItem(CONFIG.storage.auth, `${today}|${input}`);
          this.hideLogin();
          document.getElementById("loginError").classList.add("hidden");
          document.getElementById("accessCodeInput").value = "";
        } else {
          document.getElementById("loginError").classList.remove("hidden");
        }
      });
    }
    getApiKey() {
      return this.getSavedKey()[1] || "";
    }
  };

  // js/errors.js
  function friendlyError(raw, status = 0, usingToken = false) {
    const text = typeof raw === "string" ? raw : raw?.message || "";
    const l = (text || "").toLowerCase();
    let title = "We couldn't submit your response";
    let message = "Please try again in a moment.";
    const roleNow = document.querySelector('input[name="role"]:checked')?.value || "student";
    if (l.includes("study number does not exist") || l.includes("student number does not exist")) {
      if (roleNow === "employee") {
        title = "DTU username not found";
        message = "We couldn't find that DTU username. Please enter your DTU credentials (letters only, e.g. 'manufer') and try again.";
      } else {
        title = "Student number not found";
        message = "We couldn't find that student number. Please check the six digits after 's' on your DTU ID (e.g. s123456) and try again.";
      }
    } else if (l.includes("invalid or used token") || l.includes("token expired") || status === 401 && usingToken || l.includes("link has expired")) {
      title = "Oops, this link has expired";
      message = "This one-time link has already been used or expired. Please request a new link from your supporter.";
    } else if (l.includes("unauthorized")) {
      title = "Not authorised";
      message = "Your session has expired. Please refresh and try again.";
    } else if (l.includes("triggerinputschemamismatch") || l.includes("invalid type") || l.includes("schema")) {
      title = "Form not recognised";
      message = "Some information was in the wrong format. Please refresh the page and try again.";
    } else if (status >= 500) {
      title = "Service temporarily unavailable";
      message = "We are experiencing a temporary problem. Please try again in a minute.";
    } else if (status === 429) {
      title = "Too many attempts";
      message = "Please wait a moment and try again.";
    } else if (l.includes("could not generate link")) {
      title = "Could not generate link";
      message = "Please confirm you are signed in and try again.";
    } else if (l.includes("qr generator failed")) {
      title = "QR generator unavailable";
      message = "Network access to the QR service is blocked. Try again or use the copy-link option.";
    } else if (text && text.trim()) {
      try {
        const maybe = JSON.parse(text);
        if (maybe && typeof maybe.message === "string") {
          message = maybe.message;
        } else {
          message = text;
        }
      } catch {
        message = text;
      }
    }
    return { title, message };
  }
  function showError(input, status) {
    const linkToken = new URLSearchParams(window.location.search).get("t") || new URLSearchParams(window.location.search).get("token");
    const usingToken = !!linkToken;
    const { title, message } = typeof input === "string" ? friendlyError(input, status, usingToken) : input && typeof input === "object" ? input : friendlyError("", status, usingToken);
    const titleEl = document.getElementById("errorTitle");
    if (titleEl) titleEl.textContent = title;
    const messageEl = document.querySelector(".error-message");
    if (messageEl) messageEl.textContent = message;
    let redirectOnErrorClose = false;
    const combo = (title + " " + message).toLowerCase();
    const isExpiredTokenError = usingToken && (combo.includes("link has expired") || combo.includes("invalid or used token") || combo.includes("token expired"));
    const closeBtn = document.getElementById("closeErrorModal");
    if (closeBtn) {
      if (isExpiredTokenError) {
        redirectOnErrorClose = true;
        closeBtn.textContent = "Go to Python Support";
      } else {
        closeBtn.textContent = "Try Again";
      }
      closeBtn.onclick = () => {
        document.getElementById("errorModal").classList.add("hidden");
        if (redirectOnErrorClose && linkToken) {
          window.location.replace(CONFIG.urls.pythonSupport);
        }
      };
    }
    document.getElementById("errorModal").classList.remove("hidden");
  }

  // js/building.js
  var BuildingManager = class {
    constructor() {
      this.selectedBuilding = this.loadSelectedBuilding();
      this.setupEventListeners();
    }
    loadSelectedBuilding() {
      const saved = localStorage.getItem(CONFIG.storage.building);
      if (saved) return Number(saved);
      const urlParams = new URLSearchParams(location.search);
      const qpBuilding = urlParams.get("b");
      if (qpBuilding) {
        const building = Number(qpBuilding);
        localStorage.setItem(CONFIG.storage.building, building);
        return building;
      }
      return null;
    }
    selectBuilding(buildingNumber) {
      this.selectedBuilding = buildingNumber;
      localStorage.setItem(CONFIG.storage.building, buildingNumber);
      this.showSurveyForm();
    }
    selectCustomBuilding() {
      const customInput = document.getElementById("customBuilding");
      const buildingNumber = parseInt(customInput.value);
      if (!customInput.value || isNaN(buildingNumber) || buildingNumber <= 100 || buildingNumber >= 500) {
        showError("Please enter a valid building number (101-499).");
        return;
      }
      this.selectBuilding(buildingNumber);
    }
    handleEnterKey(event) {
      if (event.key === "Enter") {
        this.selectCustomBuilding();
      }
    }
    showBuildingSelection() {
      localStorage.removeItem(CONFIG.storage.building);
      this.selectedBuilding = null;
      document.getElementById("buildingSelectionPage").classList.remove("hidden");
      document.getElementById("surveyPage").classList.add("hidden");
      document.getElementById("analyticsPage").classList.add("hidden");
      const workshopToggle = document.getElementById("workshopDayToggle");
      if (workshopToggle) {
        const isWorkshopDay = localStorage.getItem(CONFIG.storage.workshopDay) === "true";
        workshopToggle.checked = isWorkshopDay;
      }
    }
    showSurveyForm() {
      document.getElementById("buildingSelectionPage").classList.add("hidden");
      document.getElementById("surveyPage").classList.remove("hidden");
      document.getElementById("analyticsPage").classList.add("hidden");
      const urlParams = new URLSearchParams(location.search);
      const qpWD = urlParams.get("wd") === "1";
      const preferWD = qpWD || localStorage.getItem(CONFIG.storage.workshopDay) === "true";
      const workshopYes = document.getElementById("workshop_yes");
      const workshopNo = document.getElementById("workshop_no");
      if (workshopYes && workshopNo) {
        workshopYes.checked = !!preferWD;
        workshopNo.checked = !preferWD;
      }
    }
    setupEventListeners() {
      window.selectBuilding = (buildingNumber) => this.selectBuilding(buildingNumber);
      window.selectCustomBuilding = () => this.selectCustomBuilding();
      window.handleEnterKey = (event) => this.handleEnterKey(event);
      window.showBuildingSelection = () => this.showBuildingSelection();
    }
    getSelectedBuilding() {
      return this.selectedBuilding;
    }
  };

  // js/survey.js
  var SurveyManager = class {
    constructor(authManager, buildingManager) {
      this.authManager = authManager;
      this.buildingManager = buildingManager;
      this.setupForm();
      this.loadCourseData();
    }
    setupForm() {
      const form = document.getElementById("surveyForm");
      const roleInputs = form.querySelectorAll('input[name="role"]');
      const studentWrapper = document.getElementById("studentWrapper");
      const usernameWrapper = document.getElementById("usernameWrapper");
      const studentNumInput = document.getElementById("student_number");
      roleInputs.forEach((radio) => radio.addEventListener("change", () => this.toggleRole()));
      if (studentNumInput) {
        studentNumInput.addEventListener("input", () => {
          studentNumInput.setCustomValidity("");
        });
        studentNumInput.addEventListener("blur", () => this.setStudentCustomValidation());
        studentNumInput.addEventListener("invalid", () => this.setStudentCustomValidation());
      }
      form.addEventListener("submit", (e) => this.handleSubmit(e));
      document.getElementById("closeModal").addEventListener("click", () => {
        this.handleThankYouClose();
      });
      this.toggleRole();
    }
    toggleRole() {
      const form = document.getElementById("surveyForm");
      const studentWrapper = document.getElementById("studentWrapper");
      const usernameWrapper = document.getElementById("usernameWrapper");
      const isStudent = form.role.value === "student";
      studentWrapper.classList.toggle("hidden", !isStudent);
      usernameWrapper.classList.toggle("hidden", isStudent);
      form.student_number.required = isStudent;
      form.dtu_username.required = !isStudent;
      this.setStudentCustomValidation();
    }
    setStudentCustomValidation() {
      const form = document.getElementById("surveyForm");
      const studentNumInput = document.getElementById("student_number");
      const isStudent = form.role.value === "student";
      if (!isStudent) {
        studentNumInput.setCustomValidity("");
        return;
      }
      const v = (studentNumInput.value || "").trim();
      if (!v) {
        studentNumInput.setCustomValidity("Please enter your student number: type the 6 digits after 's' (e.g. s123456).");
      } else if (!/^\d{6}$/.test(v)) {
        studentNumInput.setCustomValidity("Format: exactly 6 digits. Example: s123456. Don't type the 's'\u2014it's already filled in.");
      } else {
        studentNumInput.setCustomValidity("");
      }
    }
    async loadCourseData() {
      try {
        const res = await fetch("./data/courses.csv");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csv = await res.text();
        const lines = csv.split("\n");
        const records = [];
        let buffer = "";
        let inQuotes = false;
        lines.forEach((line) => {
          const quoteCount = (line.match(/"/g) || []).length;
          if (!inQuotes) {
            buffer = line;
            if (quoteCount % 2 !== 0) {
              inQuotes = true;
            } else {
              records.push(buffer);
            }
          } else {
            buffer += "\n" + line;
            if (quoteCount % 2 !== 0) {
              inQuotes = false;
              records.push(buffer);
            }
          }
        });
        records.shift();
        const dl = document.getElementById("courses");
        records.forEach((record) => {
          const idx = record.indexOf(",");
          const code = record.slice(0, idx).trim();
          let rawName = record.slice(idx + 1).replace(/\r/g, "").replace(/CR$/, "").replace(/^"+|"+$/g, "").trim();
          const opt = document.createElement("option");
          opt.value = `${code} - ${rawName}`;
          dl.appendChild(opt);
        });
      } catch (err) {
        console.error("Error loading courses.csv:", err);
      }
    }
    async verifyOneTimeToken() {
      const linkToken = this.getLinkToken();
      if (!linkToken) return true;
      try {
        const resp = await fetch(CONFIG.endpoints.survey, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-token": linkToken },
          body: JSON.stringify({ ping: true })
        });
        if (!resp.ok) {
          showError("Oops, this link has expired. Please request a new one-time link from your supporter.");
          document.querySelectorAll("#surveyForm input, #surveyForm select, #surveyForm textarea, #surveyForm button").forEach((el) => {
            if (el.id !== "closeErrorModal") el.disabled = true;
          });
          return false;
        }
        return true;
      } catch {
        return true;
      }
    }
    getLinkToken() {
      const urlParams = new URLSearchParams(location.search);
      return urlParams.get("t") || urlParams.get("token");
    }
    async handleSubmit(e) {
      e.preventDefault();
      const form = document.getElementById("surveyForm");
      const submitButton = document.getElementById("submitButton");
      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
      submitButton.classList.add("opacity-50", "cursor-not-allowed");
      const isStudent = form.role.value === "student";
      const linkToken = this.getLinkToken();
      const payload = {
        role: form.role.value,
        student_number: isStudent ? "s" + form.student_number.value.trim() : null,
        username: !isStudent ? form.dtu_username.value.trim() : null,
        satisfaction: Number(form.querySelector('input[name="satisfaction"]:checked').value),
        course_number: form.course_number.value.trim() || null,
        building_Number: this.buildingManager.getSelectedBuilding(),
        workshop: form.elements["workshop"] && form.elements["workshop"].value === "yes",
        token: linkToken || null
      };
      try {
        const headers = { "Content-Type": "application/json" };
        if (linkToken) {
          headers["x-token"] = linkToken;
        } else {
          headers["x-api-key"] = this.authManager.getApiKey();
        }
        const response = await fetch(CONFIG.endpoints.survey, {
          method: "POST",
          headers,
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          this.handleSuccessfulSubmission(linkToken);
        } else {
          await this.handleSubmissionError(response, linkToken);
        }
      } catch (err) {
        console.error("Background submit failed:", err);
        showError("A network error occurred. Please check your connection and try again.");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Submit Survey";
        submitButton.classList.remove("opacity-50", "cursor-not-allowed");
      }
    }
    handleSuccessfulSubmission(linkToken) {
      const thankYouModal = document.getElementById("thankYouModal");
      if (linkToken) {
        thankYouModal.classList.remove("hidden");
        this.redirectOnThankYouClose = true;
        setTimeout(() => {
          window.location.replace(CONFIG.urls.pythonSupport);
        }, CONFIG.timing.redirectDelay);
        return;
      }
      thankYouModal.classList.remove("hidden");
      this.resetForm();
      setTimeout(() => {
        thankYouModal.classList.add("hidden");
      }, CONFIG.timing.thankYouDisplay);
    }
    async handleSubmissionError(response, linkToken) {
      let raw = "";
      try {
        const ct = (response.headers.get("Content-Type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const j = await response.json();
          raw = j?.message || (typeof j === "string" ? j : JSON.stringify(j));
        } else {
          const t = await response.text();
          if (t && t.trim().length) raw = t.trim();
        }
      } catch {
      }
      showError(friendlyError(raw, response.status, !!linkToken), response.status);
      const form = document.getElementById("surveyForm");
      if (form.role.value === "student") {
        form.student_number.focus();
      } else {
        form.dtu_username?.focus();
      }
    }
    resetForm() {
      const form = document.getElementById("surveyForm");
      form.reset();
      form.role.value = "student";
      this.toggleRole();
      const urlParams = new URLSearchParams(location.search);
      const qpWD = urlParams.get("wd") === "1";
      const preferWD = qpWD || localStorage.getItem(CONFIG.storage.workshopDay) === "true";
      const workshopYes = document.getElementById("workshop_yes");
      const workshopNo = document.getElementById("workshop_no");
      if (workshopYes && workshopNo) {
        workshopYes.checked = !!preferWD;
        workshopNo.checked = !preferWD;
      }
      document.getElementById("student_number").value = "";
      document.getElementById("student_number").focus();
      document.activeElement?.blur();
    }
    handleThankYouClose() {
      const linkToken = this.getLinkToken();
      if (this.redirectOnThankYouClose && linkToken) {
        window.location.replace(CONFIG.urls.pythonSupport);
      } else {
        document.getElementById("thankYouModal").classList.add("hidden");
      }
    }
  };

  // js/qr.js
  var QRManager = class {
    constructor(authManager, buildingManager) {
      this.authManager = authManager;
      this.buildingManager = buildingManager;
      this.setupEventListeners();
    }
    setupEventListeners() {
      const qrModal = document.getElementById("qrModal");
      const qrCreate = document.getElementById("qrCreate");
      const qrClose = document.getElementById("qrClose");
      const qrCopy = document.getElementById("qrCopy");
      const qrBuildingInp = document.getElementById("qrBuilding");
      const qrWorkshopDay = document.getElementById("qrWorkshopDay");
      const qrInlineError = document.getElementById("qrInlineError");
      document.getElementById("btnGenerateQR")?.addEventListener("click", () => {
        this.openQrModal();
      });
      qrModal.querySelectorAll(".qr-quick").forEach((btn) => {
        btn.addEventListener("click", () => {
          const v = btn.getAttribute("data-building");
          qrBuildingInp.value = v;
          if (qrInlineError) {
            qrInlineError.textContent = "";
            qrInlineError.classList.add("hidden");
          }
        });
      });
      if (qrBuildingInp) {
        qrBuildingInp.addEventListener("input", () => {
          if (qrInlineError) {
            qrInlineError.textContent = "";
            qrInlineError.classList.add("hidden");
          }
        });
      }
      qrCreate.addEventListener("click", () => this.createQr());
      qrClose.addEventListener("click", () => this.closeQrModal());
      qrCopy.addEventListener("click", async () => {
        const qrLinkInp = document.getElementById("qrLink");
        try {
          await navigator.clipboard.writeText(qrLinkInp.value);
        } catch {
        }
      });
    }
    openQrModal() {
      const qrBuildingInp = document.getElementById("qrBuilding");
      const qrWorkshopDay = document.getElementById("qrWorkshopDay");
      const qrImg = document.getElementById("qrImg");
      const qrCanvas = document.getElementById("qrCanvas");
      const qrResult = document.getElementById("qrResult");
      const qrInlineError = document.getElementById("qrInlineError");
      const qrModal = document.getElementById("qrModal");
      const selectedBuilding = this.buildingManager.getSelectedBuilding();
      if (selectedBuilding !== null && !isNaN(selectedBuilding)) {
        qrBuildingInp.value = String(selectedBuilding);
      } else {
        qrBuildingInp.value = "";
      }
      qrWorkshopDay.checked = localStorage.getItem(CONFIG.storage.workshopDay) === "true";
      if (qrImg) {
        qrImg.src = "";
        qrImg.classList.add("hidden");
      }
      qrCanvas.classList.remove("hidden");
      qrResult.classList.add("hidden");
      if (qrInlineError) {
        qrInlineError.textContent = "";
        qrInlineError.classList.add("hidden");
      }
      qrModal.classList.remove("hidden");
    }
    closeQrModal() {
      document.getElementById("qrModal").classList.add("hidden");
    }
    async createQr() {
      const qrBuildingInp = document.getElementById("qrBuilding");
      const qrWorkshopDay = document.getElementById("qrWorkshopDay");
      const qrInlineError = document.getElementById("qrInlineError");
      const qrCanvas = document.getElementById("qrCanvas");
      const qrImg = document.getElementById("qrImg");
      const qrLinkInp = document.getElementById("qrLink");
      const qrResult = document.getElementById("qrResult");
      const bVal = qrBuildingInp.value.trim();
      const bNum = Number(bVal);
      if (bVal === "" || isNaN(bNum) || bNum < 0 || bNum > 990) {
        if (qrInlineError) {
          qrInlineError.textContent = "Please enter a valid building between 000 and 990 or use a quick option.";
          qrInlineError.classList.remove("hidden");
        }
        return;
      } else if (qrInlineError) {
        qrInlineError.textContent = "";
        qrInlineError.classList.add("hidden");
      }
      try {
        const resp = await fetch(`${CONFIG.endpoints.qrSign}?sign=1&b=${encodeURIComponent(String(bNum))}&wd=${qrWorkshopDay.checked ? 1 : 0}`, {
          method: "GET",
          headers: { "x-api-key": this.authManager.getApiKey() }
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          showError("Could not create static QR. " + (txt || ""), resp.status);
          return;
        }
        const data = await resp.json();
        const url = data.url;
        qrLinkInp.value = url;
        const hasLib = !!(window.QRCode && QRCode.toCanvas);
        if (hasLib) {
          const ctx = qrCanvas.getContext("2d");
          ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
          await QRCode.toCanvas(qrCanvas, url, {
            width: QR_CONFIG.size,
            margin: QR_CONFIG.margin
          });
          qrCanvas.classList.remove("hidden");
          qrImg.classList.add("hidden");
        } else {
          const encoded = encodeURIComponent(url);
          qrCanvas.classList.add("hidden");
          qrImg.classList.remove("hidden");
          qrImg.src = `${QR_CONFIG.fallbackServices[0]}${encoded}`;
          qrImg.onerror = function() {
            qrImg.onerror = null;
            qrImg.src = `${QR_CONFIG.fallbackServices[1]}${encoded}`;
          };
        }
        if (qrInlineError) {
          qrInlineError.textContent = "";
          qrInlineError.classList.add("hidden");
        }
        qrResult.classList.remove("hidden");
      } catch (e) {
        console.error(e);
        showError("Unexpected error while generating the QR.");
      }
    }
  };

  // js/links.js
  var LinkManager = class {
    constructor(authManager, buildingManager) {
      this.authManager = authManager;
      this.buildingManager = buildingManager;
      this.setupEventListeners();
    }
    setupEventListeners() {
      const btnGenerateLink = document.getElementById("btnGenerateLink");
      if (btnGenerateLink) {
        btnGenerateLink.addEventListener("click", () => this.generateOneTimeLink());
      }
      const wdToggle = document.getElementById("workshopDayToggle");
      if (wdToggle) {
        wdToggle.checked = localStorage.getItem(CONFIG.storage.workshopDay) === "true";
        wdToggle.addEventListener("change", () => {
          localStorage.setItem(CONFIG.storage.workshopDay, String(wdToggle.checked));
        });
      }
    }
    async generateOneTimeLink() {
      try {
        const expiresHours = 24;
        const selectedBuilding = this.buildingManager.getSelectedBuilding();
        const buildingPayload = selectedBuilding === null ? "Online" : selectedBuilding;
        const resp = await fetch(CONFIG.endpoints.token, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.authManager.getApiKey()
          },
          body: JSON.stringify({
            expiresHours,
            building_Number: buildingPayload
          })
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          showError("Could not generate link. " + (txt || ""), resp.status);
          return;
        }
        const data = await resp.json().catch(() => ({}));
        const baseUrl = window.location.origin + window.location.pathname;
        const addB = selectedBuilding !== null;
        const wd = document.getElementById("workshopDayToggle")?.checked ? "&wd=1" : "";
        const url = data.url || `${baseUrl}?t=${encodeURIComponent(data.token)}${addB ? `&b=${encodeURIComponent(String(selectedBuilding))}` : ""}${wd}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
        }
        alert("One-time survey link copied to clipboard:\n" + url);
      } catch (e) {
        console.error(e);
        showError("Unexpected error while generating the link.");
      }
    }
  };

  // js/kiosk.js
  var KioskManager = class {
    constructor() {
      this.isKioskMode = false;
      this.setupKioskMode();
    }
    setupKioskMode() {
      const urlParams = new URLSearchParams(window.location.search);
      const kioskMode = urlParams.get("kiosk") === "1" || urlParams.get("tablet") === "1";
      if (kioskMode) {
        this.enableKioskMode();
      }
      this.addKioskToggle();
    }
    async enableKioskMode() {
      this.isKioskMode = true;
      document.body.classList.add("kiosk-mode");
      await this.requestFullscreen();
      this.disableContextMenu();
      this.disableTextSelection();
      this.disableKeyboardShortcuts();
      this.hideNavigationElements();
      this.preventPageUnload();
      this.setupHiddenExit();
      console.log("Kiosk mode enabled");
    }
    disableKioskMode() {
      this.isKioskMode = false;
      document.body.classList.remove("kiosk-mode");
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
      document.removeEventListener("contextmenu", this.preventEvent);
      document.removeEventListener("selectstart", this.preventEvent);
      document.removeEventListener("dragstart", this.preventEvent);
      document.removeEventListener("keydown", this.handleKeyDown);
      window.removeEventListener("beforeunload", this.preventUnload);
      if (this.exitCornerZone) {
        this.exitCornerZone.remove();
        this.exitCornerZone = null;
      }
      const exitBtn = document.getElementById("kioskExitBtn");
      if (exitBtn) {
        exitBtn.remove();
      }
      this.showNavigationElements();
      const toggle = document.getElementById("kioskToggle");
      if (toggle) {
        toggle.innerHTML = "Enter Tablet Mode";
        toggle.title = "Enter Tablet Mode";
      }
      console.log("Kiosk mode disabled");
    }
    async requestFullscreen() {
      const element = document.documentElement;
      try {
        if (element.requestFullscreen) {
          await element.requestFullscreen();
          console.log("Fullscreen activated via requestFullscreen");
        } else if (element.webkitRequestFullscreen) {
          await element.webkitRequestFullscreen();
          console.log("Fullscreen activated via webkitRequestFullscreen");
        } else if (element.msRequestFullscreen) {
          await element.msRequestFullscreen();
          console.log("Fullscreen activated via msRequestFullscreen");
        } else {
          console.warn("Fullscreen API not supported by this browser");
        }
      } catch (error) {
        console.error("Fullscreen request failed:", error);
        if (error.name === "NotAllowedError") {
          console.warn("Fullscreen was denied by user or browser policy");
          this.showFullscreenMessage();
        } else {
          console.warn("Fullscreen request failed with error:", error.message);
        }
      }
    }
    showFullscreenMessage() {
      const message = document.createElement("div");
      message.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #3b82f6;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 10000;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-width: 300px;
    `;
      message.textContent = "For the best tablet experience, allow fullscreen when prompted or press F11";
      document.body.appendChild(message);
      setTimeout(() => {
        if (message.parentNode) {
          message.remove();
        }
      }, 5e3);
    }
    disableContextMenu() {
      this.preventEvent = (e) => {
        e.preventDefault();
        return false;
      };
      document.addEventListener("contextmenu", this.preventEvent);
    }
    disableTextSelection() {
      document.addEventListener("selectstart", this.preventEvent);
      document.addEventListener("dragstart", this.preventEvent);
    }
    disableKeyboardShortcuts() {
      this.handleKeyDown = (e) => {
        if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === "e" || e.key === "E")) {
          this.disableKioskMode();
          return;
        }
        if (e.key === "F5" || e.key === "F11" || e.key === "F12" || e.ctrlKey && (e.key === "r" || e.key === "R") || // Ctrl+R (refresh)
        e.ctrlKey && (e.key === "w" || e.key === "W") || // Ctrl+W (close)
        e.ctrlKey && (e.key === "t" || e.key === "T") || // Ctrl+T (new tab)
        e.ctrlKey && e.shiftKey && (e.key === "i" || e.key === "I") || // Ctrl+Shift+I (dev tools)
        e.altKey && e.key === "F4" || // Alt+F4
        e.key === "Escape") {
          e.preventDefault();
          return false;
        }
      };
      document.addEventListener("keydown", this.handleKeyDown);
    }
    hideNavigationElements() {
      const header = document.querySelector("header");
      if (header) {
        header.classList.add("hidden");
      }
      const sidebar = document.getElementById("sidebar");
      if (sidebar) {
        sidebar.style.display = "none";
      }
      const navElements = document.querySelectorAll("[data-nav]");
      navElements.forEach((el) => el.classList.add("hidden"));
    }
    showNavigationElements() {
      const header = document.querySelector("header");
      if (header) {
        header.classList.remove("hidden");
      }
      const sidebar = document.getElementById("sidebar");
      if (sidebar) {
        sidebar.style.display = "";
      }
      const navElements = document.querySelectorAll("[data-nav]");
      navElements.forEach((el) => el.classList.remove("hidden"));
    }
    preventPageUnload() {
      this.preventUnload = (e) => {
        e.preventDefault();
        e.returnValue = "";
        return "";
      };
      window.addEventListener("beforeunload", this.preventUnload);
    }
    addKioskToggle() {
      const toggle = document.createElement("button");
      toggle.innerHTML = "Enter Tablet Mode";
      toggle.className = "fixed bottom-4 right-4 bg-gray-800 text-white rounded-lg shadow-lg hover:bg-gray-700 transition-colors z-50 text-sm px-4 py-2 kiosk-hide";
      toggle.title = "Enter Tablet Mode";
      toggle.id = "kioskToggle";
      toggle.addEventListener("click", async () => {
        if (this.isKioskMode) {
          this.disableKioskMode();
          toggle.innerHTML = "Enter Tablet Mode";
          toggle.title = "Enter Tablet Mode";
        } else {
          await this.enableKioskMode();
          toggle.innerHTML = "Exit Tablet Mode";
          toggle.title = "Exit Tablet Mode";
        }
      });
      document.body.appendChild(toggle);
      this.updateKioskToggleVisibility();
      this.setupPageChangeListeners();
    }
    updateKioskToggleVisibility() {
      const toggle = document.getElementById("kioskToggle");
      if (!toggle) return;
      const surveyPage = document.getElementById("surveyPage");
      const buildingSelectionPage = document.getElementById("buildingSelectionPage");
      const isSurveyVisible = surveyPage && !surveyPage.classList.contains("hidden");
      const isBuildingSelectionVisible = buildingSelectionPage && !buildingSelectionPage.classList.contains("hidden");
      if (isSurveyVisible && !isBuildingSelectionVisible) {
        toggle.style.display = "block";
      } else {
        toggle.style.display = "none";
      }
    }
    setupPageChangeListeners() {
      const observer = new MutationObserver(() => {
        this.updateKioskToggleVisibility();
      });
      const surveyPage = document.getElementById("surveyPage");
      const buildingSelectionPage = document.getElementById("buildingSelectionPage");
      if (surveyPage) {
        observer.observe(surveyPage, { attributes: true, attributeFilter: ["class"] });
      }
      if (buildingSelectionPage) {
        observer.observe(buildingSelectionPage, { attributes: true, attributeFilter: ["class"] });
      }
    }
    // Auto-return to survey after timeout
    setupAutoReturn() {
      let timeoutId;
      const returnTimeout = 3e5;
      const resetTimeout = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          window.showBuildingSelection();
        }, returnTimeout);
      };
      ["click", "touch", "keypress"].forEach((event) => {
        document.addEventListener(event, resetTimeout);
      });
      resetTimeout();
    }
    setupHiddenExit() {
      this.exitTapCount = 0;
      this.exitTapTimer = null;
      const cornerZone = document.createElement("div");
      cornerZone.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 50px;
      height: 50px;
      background: transparent;
      z-index: 9998;
      cursor: default;
    `;
      cornerZone.addEventListener("click", () => {
        this.exitTapCount++;
        if (this.exitTapTimer) {
          clearTimeout(this.exitTapTimer);
        }
        if (this.exitTapCount >= 5) {
          this.showExitButton();
          this.exitTapCount = 0;
        } else {
          this.exitTapTimer = setTimeout(() => {
            this.exitTapCount = 0;
          }, 3e3);
        }
      });
      document.body.appendChild(cornerZone);
      this.exitCornerZone = cornerZone;
    }
    showExitButton() {
      const existingBtn = document.getElementById("kioskExitBtn");
      if (existingBtn) {
        existingBtn.remove();
      }
      const exitBtn = document.createElement("button");
      exitBtn.id = "kioskExitBtn";
      exitBtn.innerHTML = "\u2715 Exit Kiosk";
      exitBtn.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      background: #dc2626;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      font-size: 14px;
      z-index: 9999;
      cursor: pointer;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    `;
      exitBtn.addEventListener("click", () => {
        this.disableKioskMode();
      });
      document.body.appendChild(exitBtn);
      setTimeout(() => {
        if (exitBtn && exitBtn.parentNode) {
          exitBtn.remove();
        }
      }, 1e4);
    }
    isKioskModeActive() {
      return this.isKioskMode;
    }
  };

  // js/app.js
  var SurveyApp = class {
    constructor() {
      this.init();
    }
    init() {
      this.authManager = new AuthManager();
      this.buildingManager = new BuildingManager();
      this.surveyManager = new SurveyManager(this.authManager, this.buildingManager);
      this.qrManager = new QRManager(this.authManager, this.buildingManager);
      this.linkManager = new LinkManager(this.authManager, this.buildingManager);
      this.kioskManager = new KioskManager();
      this.setupSidebar();
      this.initializeAppState();
    }
    setupSidebar() {
      const toggleSidebarBtn = document.getElementById("openSidebar");
      const sidebarOverlay = document.getElementById("sidebarOverlay");
      const sidebar = document.getElementById("sidebar");
      const toggleSidebar = () => {
        const isOpen = sidebar.classList.contains("sidebar-open");
        if (isOpen) {
          sidebar.classList.remove("sidebar-open");
          sidebarOverlay.classList.add("hidden");
        } else {
          sidebar.classList.add("sidebar-open");
          sidebarOverlay.classList.remove("hidden");
        }
      };
      const closeSidebar = () => {
        sidebar.classList.remove("sidebar-open");
        sidebarOverlay.classList.add("hidden");
      };
      if (toggleSidebarBtn) toggleSidebarBtn.addEventListener("click", toggleSidebar);
      if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);
      document.getElementById("surveyTab")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.showSurveySection();
      });
      document.getElementById("analyticsTab")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.showAnalyticsSection();
      });
      document.getElementById("logoutTab")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.logout();
      });
      document.getElementById("backToSetupBtn")?.addEventListener("click", (e) => {
        e.preventDefault();
        this.showBuildingSelection();
      });
    }
    showSurveySection() {
      const selectedBuilding = this.buildingManager.getSelectedBuilding();
      if (selectedBuilding === null) {
        this.showBuildingSelection();
      } else {
        document.getElementById("buildingSelectionPage")?.classList.add("hidden");
        document.getElementById("surveyPage")?.classList.remove("hidden");
        document.getElementById("analyticsPage")?.classList.add("hidden");
      }
      document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
        item.classList.remove("active");
      });
      document.getElementById("surveyTab")?.classList.add("active");
    }
    showBuildingSelection() {
      document.getElementById("buildingSelectionPage")?.classList.remove("hidden");
      document.getElementById("surveyPage")?.classList.add("hidden");
      document.getElementById("analyticsPage")?.classList.add("hidden");
      document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
        item.classList.remove("active");
      });
      document.getElementById("surveyTab")?.classList.add("active");
    }
    showAnalyticsSection() {
      document.getElementById("buildingSelectionPage")?.classList.add("hidden");
      document.getElementById("surveyPage")?.classList.add("hidden");
      document.getElementById("analyticsPage")?.classList.remove("hidden");
      document.querySelectorAll(".sidebar-nav-item").forEach((item) => {
        item.classList.remove("active");
      });
      document.getElementById("analyticsTab")?.classList.add("active");
    }
    initializeAppState() {
      this.authManager.checkAuthStatus();
      const urlParams = new URLSearchParams(window.location.search);
      const linkToken = urlParams.get("t") || urlParams.get("token");
      const qrBuilding = urlParams.get("b");
      if (linkToken || qrBuilding) {
        document.body.classList.add("compact-mode");
        this.buildingManager.showSurveyForm();
        if (linkToken) {
          this.surveyManager.verifyOneTimeToken();
        }
      } else {
        this.buildingManager.showBuildingSelection();
      }
    }
    logout() {
      localStorage.removeItem("surveySupportAuth");
      localStorage.removeItem("selectedBuilding");
      localStorage.removeItem("workshopDay");
      this.authManager.showLogin();
      this.showBuildingSelection();
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    new SurveyApp();
  });
})();
