/* Progressive enhancement for the release download button.
 *
 * Without JavaScript (or if the API is unreachable) the button already points at
 * the GitHub "latest release" page, which always works. When the public API
 * answers we upgrade the button to the direct browser_download_url of the
 * Windows x64 portable ZIP and show its version and size.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-download]");
  if (!root) return;

  var link = root.querySelector("[data-download-link]");
  var label = root.querySelector("[data-download-label]");
  var status = root.querySelector("[data-download-status]");
  var api = root.getAttribute("data-api");
  var prefix = root.getAttribute("data-asset-prefix") || "";
  if (!link || !label || !api || typeof window.fetch !== "function") return;

  function formatSize(bytes) {
    if (typeof bytes !== "number" || !isFinite(bytes) || bytes <= 0) return null;
    var mb = bytes / (1024 * 1024);
    return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + " MB";
  }

  function pickAsset(release) {
    var assets = (release && release.assets) || [];
    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var name = asset && asset.name;
      if (
        typeof name === "string" &&
        name.indexOf(prefix) === 0 &&
        /\.zip$/i.test(name) &&
        asset.browser_download_url
      ) {
        return asset;
      }
    }
    return null;
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  root.setAttribute("data-state", "loading");

  fetch(api, {
    headers: { Accept: "application/vnd.github+json" },
    referrerPolicy: "no-referrer",
  })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (release) {
      var asset = pickAsset(release);
      if (!asset) throw new Error("no matching release asset");

      var version = release.tag_name || release.name || "";
      var size = formatSize(asset.size);

      link.href = asset.browser_download_url;
      label.textContent = version
        ? "Download " + version + " for Windows"
        : "Download for Windows";

      var parts = ["Portable Windows x64 ZIP"];
      if (size) parts.push(size);
      setStatus(parts.join(" · ") + ".");
      root.setAttribute("data-state", "ready");
    })
    .catch(function () {
      root.setAttribute("data-state", "fallback");
      setStatus(
        "Could not reach the GitHub API. The button opens the latest release page, " +
          "where you can download the portable ZIP manually."
      );
    });
})();
