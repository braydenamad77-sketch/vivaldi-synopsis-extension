import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function createCacheDatabase({ dbPath }) {
  ensureDir(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_results (
      cache_key TEXT PRIMARY KEY,
      lookup_query TEXT NOT NULL,
      title TEXT NOT NULL,
      media_type TEXT,
      year INTEGER,
      synopsis TEXT,
      source_attribution TEXT,
      artwork_url TEXT,
      artwork_kind TEXT,
      genre_label TEXT,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cached_results_updated_at
      ON cached_results(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_cached_results_title
      ON cached_results(title);
  `);

  const selectExisting = db.prepare("SELECT created_at FROM cached_results WHERE cache_key = ?");
  const upsert = db.prepare(`
    INSERT INTO cached_results (
      cache_key,
      lookup_query,
      title,
      media_type,
      year,
      synopsis,
      source_attribution,
      artwork_url,
      artwork_kind,
      genre_label,
      result_json,
      created_at,
      updated_at,
      expires_at
    ) VALUES (
      @cache_key,
      @lookup_query,
      @title,
      @media_type,
      @year,
      @synopsis,
      @source_attribution,
      @artwork_url,
      @artwork_kind,
      @genre_label,
      @result_json,
      @created_at,
      @updated_at,
      @expires_at
    )
    ON CONFLICT(cache_key) DO UPDATE SET
      lookup_query = excluded.lookup_query,
      title = excluded.title,
      media_type = excluded.media_type,
      year = excluded.year,
      synopsis = excluded.synopsis,
      source_attribution = excluded.source_attribution,
      artwork_url = excluded.artwork_url,
      artwork_kind = excluded.artwork_kind,
      genre_label = excluded.genre_label,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `);

  const getOne = db.prepare("SELECT * FROM cached_results WHERE cache_key = ?");
  const deleteExpired = db.prepare("DELETE FROM cached_results WHERE expires_at <= ?");
  const listAll = db.prepare(`
    SELECT cache_key, lookup_query, title, media_type, year, source_attribution, artwork_url, artwork_kind, genre_label, updated_at, expires_at
    FROM cached_results
    WHERE expires_at > @now
    ORDER BY updated_at DESC
    LIMIT @limit
  `);
  const listFiltered = db.prepare(`
    SELECT cache_key, lookup_query, title, media_type, year, source_attribution, artwork_url, artwork_kind, genre_label, updated_at, expires_at
    FROM cached_results
    WHERE expires_at > @now
      AND (
        lower(title) LIKE @query
        OR lower(lookup_query) LIKE @query
        OR lower(media_type) LIKE @query
      )
    ORDER BY updated_at DESC
    LIMIT @limit
  `);

  function mapRow(row) {
    if (!row) return null;
    return {
      cacheKey: row.cache_key,
      lookupQuery: row.lookup_query,
      title: row.title,
      mediaType: row.media_type,
      year: row.year,
      synopsis: row.synopsis,
      sourceAttribution: row.source_attribution,
      artworkUrl: row.artwork_url,
      artworkKind: row.artwork_kind,
      genreLabel: row.genre_label,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }

  return {
    dbPath,
    upsertCacheEntry({ cacheKey, lookupQuery, result, expiresAt }) {
      const now = Date.now();
      const existing = selectExisting.get(cacheKey);
      upsert.run({
        cache_key: cacheKey,
        lookup_query: String(lookupQuery || result?.lookupQuery || result?.title || "").trim(),
        title: String(result?.title || "").trim(),
        media_type: String(result?.mediaType || "").trim(),
        year: Number(result?.year) || null,
        synopsis: String(result?.synopsis || "").trim(),
        source_attribution: String(result?.sourceAttribution || "").trim(),
        artwork_url: String(result?.artworkUrl || "").trim(),
        artwork_kind: String(result?.artworkKind || "").trim(),
        genre_label: String(result?.genreLabel || "").trim(),
        result_json: JSON.stringify(result || {}),
        created_at: existing?.created_at || now,
        updated_at: now,
        expires_at: Number(expiresAt) || now,
      });
    },
    listCacheEntries({ query = "", limit = 200 } = {}) {
      const now = Date.now();
      deleteExpired.run(now);
      const trimmed = String(query || "").trim().toLowerCase();
      const rows = trimmed
        ? listFiltered.all({ now, query: `%${trimmed}%`, limit })
        : listAll.all({ now, limit });
      return rows.map(mapRow);
    },
    getCacheEntry(cacheKey) {
      deleteExpired.run(Date.now());
      return mapRow(getOne.get(cacheKey));
    },
    close() {
      db.close();
    },
  };
}
