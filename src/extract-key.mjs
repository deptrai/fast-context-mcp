/**
 * Windsurf / Devin Desktop API Key extraction from local installation.
 *
 * Cross-platform: macOS / Windows / Linux.
 * Supports both Devin Desktop (post-rebrand) and legacy Windsurf paths.
 * Uses sql.js (pure JS/WASM) to read state.vscdb — no native compilation needed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import initSqlJs from "sql.js";

/**
 * Get the platform-specific path to Windsurf's state.vscdb.
 * @returns {string}
 */
export function getDbPath() {
  const plat = platform();
  const home = homedir();

  // Try Devin Desktop first (post-rebrand), then fall back to Windsurf (legacy)
  const appNames = ["Devin", "Windsurf"];

  if (plat === "darwin") {
    for (const app of appNames) {
      const p = join(home, "Library", "Application Support", app, "User", "globalStorage", "state.vscdb");
      if (existsSync(p)) return p;
    }
    // Default path (for error messaging)
    return join(home, "Library", "Application Support", "Devin", "User", "globalStorage", "state.vscdb");
  } else if (plat === "win32") {
    const appdata = process.env.APPDATA || "";
    if (!appdata) throw new Error("Cannot determine APPDATA path");
    for (const app of appNames) {
      const p = join(appdata, app, "User", "globalStorage", "state.vscdb");
      if (existsSync(p)) return p;
    }
    return join(appdata, "Devin", "User", "globalStorage", "state.vscdb");
  } else {
    // Linux
    const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
    for (const app of appNames) {
      const p = join(config, app, "User", "globalStorage", "state.vscdb");
      if (existsSync(p)) return p;
    }
    return join(config, "Devin", "User", "globalStorage", "state.vscdb");
  }
}

/**
 * Extract API Key from Windsurf state.vscdb.
 * @param {string} [dbPath]
 * @returns {Promise<{ api_key?: string, db_path: string, error?: string, hint?: string }>}
 */
export async function extractKey(dbPath) {
  if (!dbPath) {
    dbPath = getDbPath();
  }

  if (!existsSync(dbPath)) {
    return {
      error: `Windsurf database not found: ${dbPath}`,
      hint: "Ensure Windsurf is installed and logged in.",
      db_path: dbPath,
    };
  }

  let db;
  try {
    const SQL = await initSqlJs();
    const buf = readFileSync(dbPath);
    db = new SQL.Database(buf);
  } catch (e) {
    return { error: `Failed to open database: ${e.message}`, db_path: dbPath };
  }

  try {
    const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus'");
    if (!stmt.step()) {
      stmt.free();
      return {
        error: "windsurfAuthStatus record not found",
        hint: "Ensure Windsurf is logged in.",
        db_path: dbPath,
      };
    }

    const row = stmt.getAsObject();
    stmt.free();

    let data;
    try {
      data = JSON.parse(row.value);
    } catch {
      return { error: "windsurfAuthStatus data parse failed", db_path: dbPath };
    }

    const apiKey = data.apiKey || "";
    if (!apiKey) {
      return { error: "apiKey field is empty", db_path: dbPath };
    }

    return { api_key: apiKey, db_path: dbPath };
  } catch (e) {
    return { error: `Extraction failed: ${e.message}`, db_path: dbPath };
  } finally {
    db.close();
  }
}
