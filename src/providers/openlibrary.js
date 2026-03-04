import { REQUEST_TIMEOUT_MS } from "../config/constants.js";

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Open Library request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function first(value, fallback = "") {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

export async function searchOpenLibrary(normalizedQuery) {
  const query = encodeURIComponent(normalizedQuery.query || normalizedQuery.raw);
  if (!query) return [];

  const url = `https://openlibrary.org/search.json?title=${query}&limit=5`;
  const data = await fetchJson(url);
  const docs = data.docs || [];

  return docs.map((doc) => ({
    id: doc.key,
    provider: "openlibrary",
    mediaType: "book",
    title: doc.title,
    year: doc.first_publish_year,
    authorOrDirector: first(doc.author_name),
  }));
}

function extractDescription(payload) {
  if (!payload?.description) return "";
  if (typeof payload.description === "string") return payload.description;
  if (typeof payload.description?.value === "string") return payload.description.value;
  return "";
}

export async function fetchOpenLibraryDetails(candidate) {
  const workKey = candidate.id?.startsWith("/works/") ? candidate.id : null;
  let description = "";

  if (workKey) {
    const work = await fetchJson(`https://openlibrary.org${workKey}.json`);
    description = extractDescription(work);
  }

  return {
    title: candidate.title,
    mediaType: "book",
    year: candidate.year,
    author: candidate.authorOrDirector,
    synopsisSource: description,
    cast: [],
    directorOrCreator: undefined,
    sourceAttribution: "Open Library",
  };
}
