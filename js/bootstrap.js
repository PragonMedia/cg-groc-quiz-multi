var PLANCOMPARE_BASE = "https://plancompared.com/";
var PLANCOMPARE_REDIRECT_DELAY_MS = 7000;
var plancompareRedirectTimerId = null;

function isMobileForPlancompareRedirect() {
  if (typeof window.innerWidth === "number" && window.innerWidth < 768) {
    return true;
  }
  var ua = navigator.userAgent || "";
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
    ua.toLowerCase(),
  );
}

function passesPlancompareUrlGate() {
  var params = new URLSearchParams(window.location.search);
  if (params.get("key") !== "X184GA") return false;
  var mb = params.get("mb");
  if (mb == null || String(mb).trim() === "") return false;
  return true;
}

function trackGTG(e) {
  e.preventDefault();

  const phoneLink = document.getElementById("phone-number").href;
  if (!phoneLink || phoneLink.indexOf("tel:") !== 0) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  dataLayer.push({ event: "gtg_clicked" });

  try {
    if (typeof fbq === "function") {
      fbq("track", "Lead");
    }
  } catch (err) {}

  if (
    localStorage.getItem("gtg") === null &&
    passesPlancompareUrlGate() &&
    isMobileForPlancompareRedirect()
  ) {
    if (plancompareRedirectTimerId != null) {
      clearTimeout(plancompareRedirectTimerId);
      plancompareRedirectTimerId = null;
    }
    plancompareRedirectTimerId = setTimeout(function () {
      plancompareRedirectTimerId = null;
      if (localStorage.getItem("gtg") !== null) return;
      if (!passesPlancompareUrlGate()) return;
      if (!isMobileForPlancompareRedirect()) return;
      var q = window.location.search || "";
      window.location.href =
        PLANCOMPARE_BASE.replace(/\/?$/, "/") + (q || "");
    }, PLANCOMPARE_REDIRECT_DELAY_MS);
  }

  setTimeout(() => {
    window.location.href = phoneLink;
  }, 150);
}

(function captureOriginalUrlParams() {
  try {
    if (sessionStorage.getItem("original_url_params")) return;

    const originalUrl = new URL(window.location.href);
    const originalParams = {};
    originalUrl.searchParams.forEach((value, key) => {
      originalParams[key] = value;
    });
    sessionStorage.setItem(
      "original_url_params",
      JSON.stringify(originalParams),
    );

    if (Object.keys(originalParams).length > 0) {
      console.log("Original URL parameters captured:", originalParams);
    } else {
      console.log("No URL parameters found on initial load");
    }
  } catch (e) {
    console.error("Error capturing original URL parameters:", e);
  }
})();

window.phoneNumberData = null;

function updatePhoneNumberInDOM(phoneNumber, formattedNumber) {
  const digits = String(phoneNumber).replace(/\D/g, "");
  const phoneElement = document.getElementById("phone-number");
  if (phoneElement && digits.length >= 10) {
    phoneElement.href = "tel:+" + digits;
  }
  const phoneTextElement = document.getElementById("phone_retreaver");
  if (phoneTextElement && formattedNumber) {
    phoneTextElement.textContent = formattedNumber;
  }
}

window.updatePhoneNumberInDOM = updatePhoneNumberInDOM;

function showTrackingConfigErrorEarly(message) {
  window.callgridConfigOk = false;
  const el = document.getElementById("tracking-config-error");
  if (el) {
    el.textContent =
      message ||
      "Call tracking is not configured for this page. Please try again later.";
    el.classList.remove("hidden");
    el.style.display = "block";
  }
}

(async () => {
  function pushParams(params) {
    // Start from the current URL so page-added params (age, qualified, etc.) are never wiped
    const u = new URL(location.href);
    const storedParams = sessionStorage.getItem("original_url_params");

    if (storedParams) {
      try {
        const originalParams = JSON.parse(storedParams);
        for (const [k, v] of Object.entries(originalParams)) {
          if (!u.searchParams.has(k) && v != null && v !== "") {
            u.searchParams.set(k, v);
          }
        }
      } catch (e) {
        console.error("Error restoring original params:", e);
      }
    }

    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") u.searchParams.set(k, v);
    }

    const newUrl = u.toString();
    if (newUrl !== location.href) {
      history.replaceState({}, "", newUrl);
    }
  }

  function getDomainAndRouteEarly() {
    const url = new URL(window.location.href);
    const domain = url.hostname.replace(/^www\./, "");
    const pathSegments = url.pathname
      .split("/")
      .filter((segment) => segment && !segment.includes("."));
    return { domain, route: pathSegments[0] || "" };
  }

  function normalizePhoneDigitsEarly(phoneNumber) {
    return String(phoneNumber || "").replace(/\D/g, "");
  }

  function parseCallgridConfig(routeData) {
    if (!routeData) return null;
    const organizationId = routeData.callgridOrganizationId;
    const campaignId = routeData.callgridCampaignId;
    const campaignSourceId = routeData.callgridCampaignSourceId;
    const phoneNumber = normalizePhoneDigitsEarly(routeData.phoneNumber);
    if (
      !organizationId ||
      !campaignId ||
      !campaignSourceId ||
      phoneNumber.length < 10
    ) {
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

  // Fetch domain-route-details first (CallGrid + rtkID). No invented IDs.
  window.domainRoutePromise = (async function () {
    const { domain, route } = getDomainAndRouteEarly();
    if (!domain) {
      const fail = { ok: false, error: "Missing domain" };
      window.domainRouteResult = fail;
      window.callgridConfigOk = false;
      return fail;
    }

    let apiUrl =
      "/api/v1/domain-route-details?domain=" + encodeURIComponent(domain);
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
        const fail = {
          ok: false,
          error: "domain-route-details HTTP " + response.status,
        };
        window.domainRouteResult = fail;
        window.callgridConfigOk = false;
        showTrackingConfigErrorEarly(
          "Tracking unavailable for this page. Route is missing CallGrid configuration.",
        );
        return fail;
      }

      const data = await response.json();
      if (!data || data.success !== true || !data.routeData) {
        const fail = {
          ok: false,
          error: "domain-route-details success=false",
          data,
        };
        window.domainRouteResult = fail;
        window.callgridConfigOk = false;
        showTrackingConfigErrorEarly(
          "Tracking unavailable for this page. Route is missing CallGrid configuration.",
        );
        return fail;
      }

      const callgrid = parseCallgridConfig(data.routeData);
      if (!callgrid) {
        const fail = {
          ok: false,
          error: "Missing required CallGrid fields",
          data,
        };
        window.domainRouteResult = fail;
        window.callgridConfigOk = false;
        showTrackingConfigErrorEarly(
          "Tracking unavailable for this page. Route is missing CallGrid configuration.",
        );
        return fail;
      }

      const ok = {
        ok: true,
        data,
        callgrid,
        domainContext: data.domainContext || {},
      };
      window.domainRouteResult = ok;
      window.domainRouteData = data;
      window.callgridConfig = callgrid;
      window.domainContext = ok.domainContext;
      window.callgridConfigOk = true;
      if (typeof window.updatePhoneNumberInDOM === "function") {
        const digits = callgrid.phoneNumber;
        let formatted = digits;
        if (digits.length >= 11) {
          formatted =
            "+1 (" +
            digits.slice(1, 4) +
            ") " +
            digits.slice(4, 7) +
            "-" +
            digits.slice(7, 11);
        } else if (digits.length === 10) {
          formatted =
            "+1 (" +
            digits.slice(0, 3) +
            ") " +
            digits.slice(3, 6) +
            "-" +
            digits.slice(6, 10);
        }
        window.updatePhoneNumberInDOM(digits, formatted);
        window.phoneNumberData = {
          phone_number: digits,
          formatted_number: formatted,
        };
      }
      console.log("domain-route-details loaded:", {
        organizationId: callgrid.organizationId,
        campaignId: callgrid.campaignId,
        campaignSourceId: callgrid.campaignSourceId,
        phoneNumber: callgrid.phoneNumber,
        rtkID: callgrid.rtkID,
      });
      return ok;
    } catch (error) {
      console.error("domain-route-details fetch error:", error);
      const fail = { ok: false, error: String(error) };
      window.domainRouteResult = fail;
      window.callgridConfigOk = false;
      showTrackingConfigErrorEarly(
        "Tracking unavailable for this page. Route is missing CallGrid configuration.",
      );
      return fail;
    }
  })();

  const routeResult = await window.domainRoutePromise;

  const clickBody = new URLSearchParams();
  if (routeResult && routeResult.ok && routeResult.callgrid) {
    if (routeResult.callgrid.rtkID) {
      clickBody.set("rtkID", routeResult.callgrid.rtkID);
    }
    const rtDomain =
      routeResult.domainContext &&
      routeResult.domainContext.redtrackTrackingDomain;
    if (rtDomain) {
      clickBody.set("redtrackTrackingDomain", rtDomain);
    }
  }

  const clickReq = fetch("./clickid.php", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: clickBody.toString(),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .catch(() => null);

  const clickRes = await clickReq;

  const updates = {};

  if (clickRes && clickRes.debug && clickRes.debug.rtkID) {
    console.log("rtkID used for clickid:", clickRes.debug.rtkID);
  }

  if (clickRes && clickRes.ok && clickRes.clickid) {
    localStorage.setItem("rt_clickid", clickRes.clickid);
    updates.clickid = clickRes.clickid;
  } else {
    const u = new URL(location.href);
    const fromUrl = u.searchParams.get("clickid");
    const fromLS = localStorage.getItem("rt_clickid");
    if (fromUrl && !fromLS) localStorage.setItem("rt_clickid", fromUrl);
    if (!fromUrl && fromLS) updates.clickid = fromLS;
  }

  if (Object.keys(updates).length) pushParams(updates);
})();

(async () => {
  try {
    const gtgReq = fetch("./gtg.php?" + window.location.search, {
      method: "GET",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .catch(() => null);

    const gtgRes = await gtgReq;

    if (gtgRes && gtgRes.success) {
      if (gtgRes.gtg !== null) {
        localStorage.setItem("gtg", gtgRes.gtg);
      } else {
        localStorage.removeItem("gtg");
      }
    }
  } catch (error) {
    console.error("GTG fetch error:", error);
  }
})();

/** Navigate to a sibling quiz page while keeping the current query string. */
function navigateWithParams(pathname) {
  const url = new URL(pathname, window.location.href);
  url.search = window.location.search;
  window.location.href = url.toString();
}

window.navigateWithParams = navigateWithParams;
