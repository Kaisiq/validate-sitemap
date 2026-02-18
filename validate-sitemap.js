/**
 * Sitemap Validation Script
 *
 * This script fetches sitemaps from localhost:5001 for all locales,
 * and validates that all URLs in the to-verify file are present.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseStringPromise } from "xml2js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES = ["en", "es", "pt", "cn", "kr", "jp", "de", "fr", "it"];
const BASE_URL = "http://localhost:5001";
const URLS_FILE = path.join(__dirname, "to-verify-sitemap");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Fetch sitemap XML from a given URL
 */
async function fetchSitemap(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

/**
 * Parse sitemap XML and extract URLs
 */
async function parseSitemap(xml) {
  try {
    const result = await parseStringPromise(xml);
    const urls = result.urlset?.url?.map((entry) => entry.loc[0]) || [];
    return urls;
  } catch (error) {
    throw new Error(`Failed to parse sitemap XML: ${error.message}`);
  }
}

/**
 * Load URLs from the to-verify text file
 */
function loadUrlsFromFile() {
  if (!fs.existsSync(URLS_FILE)) {
    throw new Error(`URLs file not found: ${URLS_FILE}`);
  }

  const content = fs.readFileSync(URLS_FILE, "utf-8");
  const urls = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")); // Filter empty lines and comments

  return urls;
}

/**
 * Fetch all sitemaps from localhost
 */
async function fetchAllSitemaps() {
  log("\n📥 Fetching sitemaps from localhost:5001...", "blue");

  const scrapedUrls = new Set();
  const results = [];

  for (const locale of LOCALES) {
    const url =
      locale === "en"
        ? `${BASE_URL}/sitemap.xml`
        : `${BASE_URL}/${locale}/sitemap.xml`;

    try {
      log(`  Fetching ${locale}: ${url}`, "reset");
      const xml = await fetchSitemap(url);
      const urls = await parseSitemap(xml);

      // Add URLs to the set
      urls.forEach((url) => scrapedUrls.add(url));

      log(`  ✓ Found ${urls.length} URLs`, "green");

      results.push({
        locale,
        url,
        success: true,
        urlCount: urls.length,
      });
    } catch (error) {
      log(`  ✗ Error: ${error.message}`, "red");
      results.push({
        locale,
        url,
        success: false,
        error: error.message,
      });
    }
  }

  return { scrapedUrls, results };
}

/**
 * Validate that all URLs from file are in scraped sitemaps
 * and check the HTTP status of missing URLs.
 */
async function validateUrls(fileUrls, scrapedUrls) {
  log("\n🔍 Validating URLs...", "blue");

  const missing = [];
  const found = [];

  for (const url of fileUrls) {
    if (scrapedUrls.has(url)) {
      found.push(url);
    } else {
      missing.push(url);
    }
  }

  if (missing.length === 0) {
    log("\n✓ All URLs found in scraped sitemaps!", "green");
    return { allFound: true, missing: [], found };
  }

  log(
    `\n⚠️  Found ${missing.length} URLs that are missing from scraped sitemaps.`,
    "red",
  );
  log("📡 Checking HTTP status for missing URLs...\n", "blue");

  // Group missing URLs by locale for better readability
  const missingByLocale = {};
  for (const url of missing) {
    const match =
      url.match(/localhost:5001\/([a-z]{2})\//) ||
      url.match(/localhost:5001\/(.*)/);
    const locale = match
      ? LOCALES.includes(match[1])
        ? match[1]
        : "en"
      : "unknown";

    if (!missingByLocale[locale]) {
      missingByLocale[locale] = [];
    }
    missingByLocale[locale].push(url);
  }

  for (const [locale, urls] of Object.entries(missingByLocale)) {
    log(`  ${locale.toUpperCase()} (${urls.length} missing):`, "yellow");
    for (const url of urls) {
      try {
        const response = await fetch(url);
        const status = response.status;
        if (status === 404) {
          log(`    ✗ [404] ${url}`, "red");
        } else if (response.ok) {
          log(`    ✓ [${status}] ${url}`, "green");
        } else {
          log(`    ⚠️ [${status}] ${url}`, "yellow");
        }
      } catch (error) {
        log(`    ✗ [ERR] ${url}: ${error.message}`, "red");
      }
    }
    log(""); // Add a newline between locales
  }

  return { allFound: false, missing, found };
}

/**
 * Print summary statistics
 */
function printSummary(results, fileUrls, scrapedUrls, validation) {
  log("\n" + "=".repeat(80), "bold");
  log("📊 SUMMARY", "bold");
  log("=".repeat(80), "bold");

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log(`\nLocales processed: ${results.length}`, "reset");
  log(`  ✓ Successful: ${successful}`, "green");
  if (failed > 0) {
    log(`  ✗ Failed: ${failed}`, "red");
  }

  log(`\nURLs in file: ${fileUrls.length}`, "reset");
  log(`Total unique URLs in scraped sitemaps: ${scrapedUrls.size}`, "reset");

  log(`\nValidation results:`, "reset");
  log(`  ✓ Found: ${validation.found.length}`, "green");
  if (validation.missing.length > 0) {
    log(`  ✗ Missing: ${validation.missing.length}`, "red");
  }

  const percentage = (
    (validation.found.length / fileUrls.length) *
    100
  ).toFixed(2);
  log(
    `\nCoverage: ${percentage}%`,
    percentage === "100.00" ? "green" : "yellow",
  );

  if (validation.allFound) {
    log(`\n✓ Validation: PASSED`, "green");
  } else {
    log(`\n⚠️  Validation: FAILED`, "red");
    log(
      `  ${validation.missing.length} URLs from file not found in scraped sitemaps`,
      "red",
    );
  }

  log("\n" + "=".repeat(80) + "\n", "bold");
}

/**
 * Main execution
 */
async function main() {
  try {
    log("🚀 Sitemap Validation Script", "bold");
    log("=".repeat(80), "bold");

    // Load URLs from file
    log(`\n📂 Loading URLs from ${path.basename(URLS_FILE)}...`, "blue");
    const fileUrls = loadUrlsFromFile();
    log(`  Loaded ${fileUrls.length} URLs to validate`, "green");

    // Fetch all sitemaps from localhost
    const { scrapedUrls, results } = await fetchAllSitemaps();

    // Validate URLs
    const validation = await validateUrls(fileUrls, scrapedUrls);

    // Print summary
    printSummary(results, fileUrls, scrapedUrls, validation);

    // Exit with appropriate code
    process.exit(validation.allFound ? 0 : 1);
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, "red");
    console.error(error);
    process.exit(1);
  }
}

main();
