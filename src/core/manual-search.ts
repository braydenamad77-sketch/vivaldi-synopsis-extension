export interface ManualSearchAvailability {
  enabled: boolean;
  pageLabel: string;
  message: string;
}

export const SUPPORTED_LOOKUP_PAGE_PATTERNS = ["http://*/*", "https://*/*"] as const;

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const BROWSER_PROTOCOLS = new Set(["about:", "chrome:", "chrome-extension:", "chrome-search:", "devtools:", "edge:", "vivaldi:"]);

function formatHostLabel(parsedUrl: URL) {
  return parsedUrl.hostname.replace(/^www\./, "") || parsedUrl.host;
}

function formatBrowserPageLabel(parsedUrl: URL) {
  if (parsedUrl.protocol === "about:") {
    return parsedUrl.href;
  }

  const target = parsedUrl.host || parsedUrl.pathname.replace(/^\/+/, "") || "page";
  return `${parsedUrl.protocol}//${target}`;
}

export function getManualSearchAvailability(url?: string | null): ManualSearchAvailability {
  if (!url) {
    return {
      enabled: false,
      pageLabel: "No active page",
      message: "Open a regular website tab to use manual search.",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      enabled: false,
      pageLabel: "Unknown page",
      message: "Open a regular website tab to use manual search.",
    };
  }

  if (WEB_PROTOCOLS.has(parsedUrl.protocol)) {
    return {
      enabled: true,
      pageLabel: formatHostLabel(parsedUrl),
      message: "Manual search opens directly inside this page.",
    };
  }

  if (parsedUrl.protocol === "file:") {
    return {
      enabled: false,
      pageLabel: "Local file tab",
      message: "Manual search only works on regular websites right now. Local file tabs are not supported.",
    };
  }

  if (BROWSER_PROTOCOLS.has(parsedUrl.protocol)) {
    return {
      enabled: false,
      pageLabel: formatBrowserPageLabel(parsedUrl),
      message: "Manual search only works on regular websites. Built-in browser pages block extension overlays.",
    };
  }

  return {
    enabled: false,
    pageLabel: "Unsupported page",
    message: "Manual search only works on http and https pages right now.",
  };
}
