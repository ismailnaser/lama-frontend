// Runtime config for static deployments.
// This keeps both environments working:
// - Local frontend (localhost/127.0.0.1) -> local backend
// - Hosted frontend -> hosted backend
(function () {
  function normalizeApiUrl(url) {
    var trimmed = String(url || "").trim().replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : trimmed + "/api";
  }

  var isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  var hostedApiUrl = "https://surgical-dressing-log-z4xd6.ondigitalocean.app/api";
  var localApiUrl = "http://127.0.0.1:8000/api";

  window.__LAMA_API_URL__ = normalizeApiUrl(isLocalHost ? localApiUrl : hostedApiUrl);
})();

