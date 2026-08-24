// Helper function to preserve all original URL parameters when modifying URL
// This ensures tracking parameters (bbg_*, mb, account, angle, key, channel, etc.) are never lost
function preserveUrlParams(url) {
  const storedParams = sessionStorage.getItem("original_url_params");
  if (storedParams) {
    try {
      const originalParams = JSON.parse(storedParams);
      for (const [k, v] of Object.entries(originalParams)) {
        if (!url.searchParams.has(k) && v != null && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    } catch (e) {
      console.error("Error preserving original params:", e);
    }
  }
  return url;
}

function buildUrlWithCurrentParams() {
  let url = new URL(window.location.href);
  url = preserveUrlParams(url);
  return url;
}

function navigateToPage(filename, url) {
  const target = new URL(filename, window.location.href);
  target.search = url.search;
  window.location.href = target.toString();
}

const CALLGRID_NUMBER_TIMEOUT_MS = 2000;
const DOMAIN_ROUTE_API = "/api/v1/domain-route-details";

function getDomainAndRoute() {
  const url = new URL(window.location.href);
  // Match BE / PHP: hostname without www.
  const domain = url.hostname.replace(/^www\./, "");
  const pathSegments = url.pathname
    .split("/")
    .filter((segment) => segment && !segment.includes("."));
  const route = pathSegments[0] || "";
  return { domain, route };
}

function normalizePhoneDigits(phoneNumber) {
  return String(phoneNumber || "").replace(/\D/g, "");
}

function getRequiredCallgridFields(routeData) {
  if (!routeData || typeof routeData !== "object") return null;
  const organizationId = routeData.callgridOrganizationId;
  const campaignId = routeData.callgridCampaignId;
  const campaignSourceId = routeData.callgridCampaignSourceId;
  const phoneNumber = normalizePhoneDigits(routeData.phoneNumber);
  if (!organizationId || !campaignId || !campaignSourceId || phoneNumber.length < 10) {
    return null;
  }
  return {
    organizationId: String(organizationId),
    campaignId: String(campaignId),
    campaignSourceId: String(campaignSourceId),
    phoneNumber,
    mediaBuyerName: routeData.callgridMediaBuyerName || "",
    rtkID: routeData.rtkID || null,
  };
}

function showTrackingConfigError(message) {
  window.callgridConfigOk = false;
  const el = document.getElementById("tracking-config-error");
  if (el) {
    el.textContent =
      message ||
      "Call tracking is not configured for this page. Please try again later.";
    el.classList.remove("hidden");
    el.style.display = "block";
  }
  const link = document.getElementById("phone-number");
  if (link) {
    link.href = "javascript:void(0)";
    link.style.pointerEvents = "none";
    link.setAttribute("aria-disabled", "true");
  }
  console.error("CallGrid config error:", message);
}

function hideTrackingConfigError() {
  const el = document.getElementById("tracking-config-error");
  if (el) {
    el.classList.add("hidden");
    el.style.display = "none";
  }
}

async function fetchDomainRouteDetails() {
  const { domain, route } = getDomainAndRoute();
  if (!domain) {
    return { ok: false, error: "Missing domain for route lookup" };
  }

  let apiUrl =
    DOMAIN_ROUTE_API + "?domain=" + encodeURIComponent(domain);
  if (route) {
    apiUrl += "&route=" + encodeURIComponent(route);
  }

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!response.ok) {
      return {
        ok: false,
        error: "domain-route-details HTTP " + response.status,
      };
    }
    const data = await response.json();
    if (!data || data.success !== true || !data.routeData) {
      return { ok: false, error: "domain-route-details success=false" };
    }

    const callgrid = getRequiredCallgridFields(data.routeData);
    if (!callgrid) {
      return {
        ok: false,
        error:
          "Missing callgridOrganizationId, callgridCampaignId, callgridCampaignSourceId, or phoneNumber",
        data,
      };
    }

    return {
      ok: true,
      data,
      callgrid,
      domainContext: data.domainContext || {},
    };
  } catch (error) {
    console.error("Error fetching domain-route-details:", error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

// Page-load fetch: stash config for CallGrid + clickid. No hardcoded IDs.
// May already be started from index.html (before clickid mint).
if (!window.domainRoutePromise) {
  window.domainRoutePromise = (async function initDomainRouteData() {
    const result = await fetchDomainRouteDetails();
    window.domainRouteResult = result;

    if (!result.ok) {
      showTrackingConfigError(
        "Tracking unavailable for this page. Route is missing CallGrid configuration.",
      );
      window.domainRouteData = null;
      window.callgridConfig = null;
      window.callgridConfigOk = false;
      return result;
    }

    hideTrackingConfigError();
    window.callgridConfigOk = true;
    window.domainRouteData = result.data;
    window.callgridConfig = result.callgrid;
    window.domainContext = result.domainContext;

    applyPhoneToDom(result.callgrid.phoneNumber);
    console.log("CallGrid config from API:", {
      organizationId: result.callgrid.organizationId,
      campaignId: result.callgrid.campaignId,
      campaignSourceId: result.callgrid.campaignSourceId,
      phoneNumber: result.callgrid.phoneNumber,
      mediaBuyerName: result.callgrid.mediaBuyerName,
    });
    return result;
  })();
} else {
  window.domainRoutePromise.then(function (result) {
    if (result && result.ok && result.callgrid) {
      applyPhoneToDom(result.callgrid.phoneNumber);
    } else if (result && !result.ok) {
      showTrackingConfigError(
        "Tracking unavailable for this page. Route is missing CallGrid configuration.",
      );
    }
  });
}

// Show loader on phone button while CallGrid assigns a tracking number
function setPhoneButtonLoading(loading) {
  const link = document.getElementById("phone-number");
  const textEl = document.getElementById("phone_retreaver");
  if (!link || !textEl) return;
  if (loading) {
    link.classList.add("phone-number-loading");
    link.href = "javascript:void(0)";
    link.style.pointerEvents = "none";
    textEl.textContent = "Loading...";
  } else {
    link.classList.remove("phone-number-loading");
    link.style.pointerEvents = "";
  }
}

function formatPhoneDisplay(phoneNumber) {
  const raw = String(phoneNumber).replace(/\D/g, "");
  if (raw.length >= 11) {
    return (
      "+1 (" +
      raw.slice(1, 4) +
      ") " +
      raw.slice(4, 7) +
      "-" +
      raw.slice(7, 11)
    );
  }
  if (raw.length === 10) {
    return (
      "+1 (" +
      raw.slice(0, 3) +
      ") " +
      raw.slice(3, 6) +
      "-" +
      raw.slice(6, 10)
    );
  }
  return raw;
}

function applyPhoneToDom(phoneNumber) {
  if (!window.updatePhoneNumberInDOM) return;
  const digits = String(phoneNumber).replace(/\D/g, "");
  const formatted = formatPhoneDisplay(digits);
  window.updatePhoneNumberInDOM(digits, formatted);
  window.phoneNumberData = {
    phone_number: digits,
    formatted_number: formatted,
  };
}

function buildCallGridTags() {
  const params = new URL(window.location.href).searchParams;
  const tags = {
    type: "RT",
    track_attempted: "yes",
    qualified: params.get("qualified") || "unknown",
    age: params.get("age") || "unknown",
  };

  const gtgValue = localStorage.getItem("gtg");
  if (gtgValue !== null && gtgValue !== undefined && gtgValue !== "") {
    tags.gtg = gtgValue;
  }

  const clickid =
    (window.testData && window.testData.rtkcid) ||
    localStorage.getItem("rt_clickid") ||
    params.get("clickid");
  if (clickid) {
    tags.clickid = clickid;
    tags.rtkcid = clickid;
  }

  const mb = params.get("mb");
  if (mb) tags.mb = mb;

  if (window.callgridConfig && window.callgridConfig.mediaBuyerName) {
    tags.mediaBuyerName = window.callgridConfig.mediaBuyerName;
  }

  return tags;
}

function watchCallGridClickidTags(callgrid) {
  if (!callgrid || typeof callgrid.addTags !== "function") return;

  var intervalId = setInterval(() => {
    if (window.testData && window.testData.rtkcid !== undefined) {
      const tags = {
        clickid: window.testData.rtkcid,
        rtkcid: window.testData.rtkcid,
        qualified:
          new URL(window.location.href).searchParams.get("qualified") ||
          "unknown",
        age:
          new URL(window.location.href).searchParams.get("age") || "unknown",
      };
      const gtgValue = localStorage.getItem("gtg");
      if (gtgValue) tags.gtg = gtgValue;
      const mb = new URL(window.location.href).searchParams.get("mb");
      if (mb) tags.mb = mb;

      callgrid.addTags(tags);
      console.log("Sending click tags to CallGrid:", tags);
      clearInterval(intervalId);
    }
  }, 500);
}

async function ensureCallgridConfig() {
  if (window.callgridConfig && window.callgridConfigOk) {
    return window.callgridConfig;
  }
  const result = await (window.domainRoutePromise || fetchDomainRouteDetails());
  if (!result || !result.ok || !result.callgrid) {
    showTrackingConfigError(
      "Tracking unavailable for this page. Route is missing CallGrid configuration.",
    );
    return null;
  }
  window.callgridConfigOk = true;
  window.callgridConfig = result.callgrid;
  window.domainRouteData = result.data;
  window.domainContext = result.domainContext;
  return result.callgrid;
}

// Load CallGrid CDN once and initialize from API routeData (no hardcodes)
function loadCallGrid(config) {
  return new Promise((resolve, reject) => {
    if (!config) {
      reject(new Error("CallGrid config missing"));
      return;
    }

    if (window.callgridInstance) {
      resolve(window.callgridInstance);
      return;
    }

    const initInstance = () => {
      if (window.callgridInstance) {
        resolve(window.callgridInstance);
        return;
      }
      window.callgridInstance = new CallGrid({
        organizationId: config.organizationId,
        campaignSourceId: config.campaignSourceId,
        autoEnableDNI: true,
        targetPhoneNumber: config.phoneNumber,
        tags: buildCallGridTags(),
      });
      console.log("CallGrid initialized:", {
        organizationId: config.organizationId,
        campaignId: config.campaignId,
        campaignSourceId: config.campaignSourceId,
        targetPhoneNumber: config.phoneNumber,
        tags: buildCallGridTags(),
      });
      watchCallGridClickidTags(window.callgridInstance);
      resolve(window.callgridInstance);
    };

    if (window.CallGrid) {
      initInstance();
      return;
    }

    const existing = document.querySelector(
      'script[src*="cdn.callgrid.com/callgrid.js"]',
    );
    if (existing) {
      existing.addEventListener("load", initInstance);
      existing.addEventListener("error", () =>
        reject(new Error("CallGrid script failed to load")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.callgrid.com/callgrid.js";
    script.async = true;
    script.onload = initInstance;
    script.onerror = () => reject(new Error("CallGrid script failed to load"));
    document.head.appendChild(script);
  });
}

// Wait for CallGrid number assignment, fall back to API phoneNumber after timeout
function assignCallGridNumber(config) {
  return new Promise((resolve, reject) => {
    if (!config) {
      reject(new Error("CallGrid config missing"));
      return;
    }

    let settled = false;
    const fallbackPhone = config.phoneNumber;

    const finish = (phoneNumber) => {
      if (settled) return;
      settled = true;
      applyPhoneToDom(phoneNumber);
      setPhoneButtonLoading(false);
      resolve(phoneNumber);
    };

    const fallbackTimer = setTimeout(() => {
      console.log(
        "CallGrid timeout — using API phoneNumber:",
        fallbackPhone,
      );
      finish(fallbackPhone);
    }, CALLGRID_NUMBER_TIMEOUT_MS);

    const onAssigned = (event) => {
      document.removeEventListener("callgrid:numberAssigned", onAssigned);
      clearTimeout(fallbackTimer);
      const assigned =
        (event.detail && event.detail.phoneNumber) || fallbackPhone;
      console.log("CallGrid number assigned:", assigned);
      finish(assigned);
    };

    document.addEventListener("callgrid:numberAssigned", onAssigned);

    loadCallGrid(config)
      .then((callgrid) => {
        if (
          settled ||
          !callgrid ||
          typeof callgrid.getAssignedNumber !== "function"
        ) {
          return;
        }
        const already = callgrid.getAssignedNumber();
        if (already) {
          document.removeEventListener("callgrid:numberAssigned", onAssigned);
          clearTimeout(fallbackTimer);
          finish(already);
        }
      })
      .catch((error) => {
        console.error("CallGrid load error:", error);
        document.removeEventListener("callgrid:numberAssigned", onAssigned);
        clearTimeout(fallbackTimer);
        finish(fallbackPhone);
      });
  });
}

// Reactive phone number update - called ONLY when showing the phone step (qualified users).
async function updatePhoneNumberReactive() {
  if (!window.updatePhoneNumberInDOM) return;

  const link = document.getElementById("phone-number");
  const textEl = document.getElementById("phone_retreaver");
  if (!link || !textEl) return;

  setPhoneButtonLoading(true);

  try {
    const config = await ensureCallgridConfig();
    if (!config) {
      textEl.textContent = "Unavailable";
      setPhoneButtonLoading(false);
      return;
    }
    await assignCallGridNumber(config);
  } catch (error) {
    console.error("Error assigning CallGrid number (qualified step):", error);
    showTrackingConfigError(
      "Unable to load call tracking. Please try again later.",
    );
    setPhoneButtonLoading(false);
  }
}

function startCountdown() {
  var countdownElement = document.getElementById("countdown");
  if (!countdownElement) return;
  var timeLeft = 30;
  var countdownInterval = setInterval(function () {
    var minutes = Math.floor(timeLeft / 60);
    var seconds = timeLeft % 60;
    var formattedTime =
      (minutes < 10 ? "0" : "") + minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
    countdownElement.innerHTML = formattedTime;
    if (timeLeft <= 0) clearInterval(countdownInterval);
    timeLeft--;
  }, 1000);
}

function showResultPanel() {
  var questionPanel = document.getElementById("medicare-question");
  var resultPanel = document.getElementById("form-result");
  if (questionPanel) questionPanel.style.display = "none";
  if (resultPanel) {
    resultPanel.style.display = "block";
    resultPanel.classList.add("active");
  }
}

// Drop this HTML on your external host, then set CLAIM_REDIRECT_HREF to that full URL.
var CLAIM_REDIRECT_HREF = "https://plancompared.com/multi";
var CLAIM_CLOAK_FAIL_URL = "https://www.google.com";

function buildClaimNowHref() {
  var url = buildUrlWithCurrentParams();
  var clickID =
    url.searchParams.get("clickid") ||
    localStorage.getItem("rt_clickid") ||
    "";
  if (clickID) {
    url.searchParams.set("clickid", clickID);
  }

  var target = new URL(CLAIM_REDIRECT_HREF, window.location.href);
  target.search = url.search;
  return target.toString();
}

function showClaimNowButton() {
  var claimContactCta = document.getElementById("claim-now-contact-button");
  var claimWrapper = document.getElementById("claim-now-wrapper");
  if (claimWrapper) {
    claimWrapper.style.display = "none";
    var iframe = document.getElementById("claim-now-iframe");
    if (iframe) iframe.src = "";
  }
  if (claimContactCta) {
    claimContactCta.style.display = "block";
  }
}

function handleClaimNowClick(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  try {
    if (typeof fbq === "function") {
      fbq("track", "Lead");
    }
  } catch (err) {}

  var url = buildUrlWithCurrentParams();
  // Cloak here too: no key must never hit /contact or the offer hop
  if (url.searchParams.get("key") !== "X184GA") {
    window.location.replace(CLAIM_CLOAK_FAIL_URL);
    return;
  }

  // Same tab only
  window.location.replace(buildClaimNowHref());
}

// html1: Get Started → html2
$("#get-started-btn").on("click", function () {
  var url = buildUrlWithCurrentParams();
  window.history.replaceState({}, "", url);
  navigateToPage("html2.html", url);
});

// html2: Age → html3
$("button.form-step-btn[data-form-step='2']").on("click", function () {
  var buttonValue = $(this).attr("data-form-value");
  var newUrl = buildUrlWithCurrentParams();

  newUrl.searchParams.delete("age");
  newUrl.searchParams.delete("u65consumer");
  newUrl.searchParams.delete("o65consumer");

  if (buttonValue === "below 65") {
    newUrl.searchParams.set("age", "65");
  } else if (buttonValue === "65 - 70") {
    newUrl.searchParams.set("age", "70");
  } else if (buttonValue === "71 - 75") {
    newUrl.searchParams.set("age", "75");
  } else if (buttonValue === "76 and older") {
    newUrl.searchParams.set("age", "80");
  }

  navigateToPage("html3.html", newUrl);
});

// html3: Medicare → result (same page)
$("button.form-step-btn[data-form-step='3']").on("click", function () {
  var buttonValue = $(this).attr("data-form-value");
  var newUrl = buildUrlWithCurrentParams();

  if (buttonValue === "Yes") {
    newUrl.searchParams.delete("qualified");
    newUrl.searchParams.set("qualified", "yes");
  } else if (buttonValue === "No") {
    newUrl.searchParams.delete("qualified");
    newUrl.searchParams.set("qualified", "no");
  }

  window.history.replaceState({}, "", newUrl);
  showResultPanel();

  var phoneCta = document.getElementById("phone-number");
  var claimContactCta = document.getElementById("claim-now-contact-button");
  var claimWrapper = document.getElementById("claim-now-wrapper");
  var resultInstruction = document.getElementById("form-result-instruction");

  if (phoneCta) phoneCta.style.display = "none";
  if (claimContactCta) claimContactCta.style.display = "none";
  if (claimWrapper) claimWrapper.style.display = "none";

  if (buttonValue === "Yes") {
    if (window.callgridConfigOk === false) {
      showTrackingConfigError(
        "Tracking unavailable for this page. Route is missing CallGrid configuration.",
      );
    }
    if (resultInstruction) {
      resultInstruction.textContent =
        "Click the button below to speak with a licensed insurance agent to claim your grocery card!";
    }
    (async function () {
      await updatePhoneNumberReactive();
      var phoneEl = document.getElementById("phone-number");
      if (phoneEl) {
        phoneEl.style.display = "block";
      }
      startCountdown();
    })();
  } else {
    if (resultInstruction) {
      resultInstruction.textContent =
        "Click the button below to claim your grocery card now.";
    }
    showClaimNowButton();
    startCountdown();
  }
});

$("#claim-now-contact-button").on("click", handleClaimNowClick);

let userId = localStorage.getItem("user_id");
if (!userId) {
  userId = Math.random().toString(36).substring(2) + Date.now().toString(36);
  localStorage.setItem("user_id", userId);
}

function gtag_report_conversion(url) {
  console.log("Google Tag Manager conversion event fired", {
    url: url,
    send_to: "AW-16921817895/4s4iCJv-wb8bEKfm-YQ_",
  });
  var callback = function () {
    if (typeof url != "undefined") {
      window.location = url;
    }
  };
  gtag("event", "conversion", {
    send_to: "AW-16921817895/4s4iCJv-wb8bEKfm-YQ_",
    value: 1.0,
    currency: "USD",
    event_callback: callback,
  });
  return false;
}
