import fs from 'fs';
import readline from 'readline';
import http from 'http';
import https from 'https';

const URLS_FILE = './to-verify-canonicals';

// Fetch URL and extract canonical link
async function fetchCanonical(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: 10000 }, (res) => {
      // Check for 404 status
      if (res.statusCode === 404) {
        req.destroy();
        resolve({ url, canonical: null, error: 'Page not found (404)', statusCode: 404 });
        return;
      }

      // Check for other non-200 status codes
      if (res.statusCode !== 200) {
        req.destroy();
        resolve({ url, canonical: null, error: `HTTP ${res.statusCode}`, statusCode: res.statusCode });
        return;
      }

      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
        // Stop collecting data once we have the head section
        if (data.includes('</head>')) {
          req.destroy();
        }
      });

      res.on('end', () => {
        // Extract canonical link from head
        const headMatch = data.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
        if (!headMatch) {
          resolve({ url, canonical: null, error: 'No <head> tag found' });
          return;
        }

        const head = headMatch[1];
        const canonicalMatch = head.match(/<link[^>]*rel=["']canonical["'][^>]*>/i) ||
                              head.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);

        if (!canonicalMatch) {
          resolve({ url, canonical: null, error: 'No canonical link found' });
          return;
        }

        // Extract href attribute
        const hrefMatch = canonicalMatch[0].match(/href=["']([^"']+)["']/i);
        if (!hrefMatch) {
          resolve({ url, canonical: null, error: 'Canonical link has no href' });
          return;
        }

        resolve({ url, canonical: hrefMatch[1], error: null });
      });
    });

    req.on('error', (err) => {
      resolve({ url, canonical: null, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url, canonical: null, error: 'Request timeout' });
    });
  });
}

// Normalize URLs for comparison (remove trailing slashes, etc.)
function normalizeUrl(url) {
  return url.replace(/\/$/, '').toLowerCase();
}

async function validateCanonicals() {
  const fileStream = fs.createReadStream(URLS_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const results = {
    valid: [],
    invalid: [],
    missing: [],
    notFound: [],
    errors: []
  };

  const urls = [];

  // Collect all URLs
  for await (const line of rl) {
    const url = line.trim();
    if (url) {
      urls.push(url);
    }
  }

  console.log(`Processing ${urls.length} URLs...\n`);

  // Process URLs with concurrency limit
  const concurrency = 10;
  let processed = 0;

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(url => fetchCanonical(url))
    );

    for (const result of batchResults) {
      processed++;

      if (result.error) {
        if (result.statusCode === 404) {
          results.notFound.push(result.url);
          console.log(`[${processed}/${urls.length}] 🚫 NOT FOUND (404): ${result.url}`);
        } else if (result.error === 'No canonical link found') {
          results.missing.push(result.url);
          console.log(`[${processed}/${urls.length}] ❌ MISSING: ${result.url}`);
        } else {
          results.errors.push({ url: result.url, error: result.error });
          console.log(`[${processed}/${urls.length}] ⚠️  ERROR: ${result.url} - ${result.error}`);
        }
      } else {
        const normalizedOriginal = normalizeUrl(result.url);
        const normalizedCanonical = normalizeUrl(result.canonical);

        if (normalizedOriginal === normalizedCanonical) {
          results.valid.push(result.url);
          console.log(`[${processed}/${urls.length}] ✅ VALID: ${result.url}`);
        } else {
          results.invalid.push({ url: result.url, canonical: result.canonical });
          console.log(`[${processed}/${urls.length}] ❌ MISMATCH: ${result.url}`);
          console.log(`    Expected: ${result.url}`);
          console.log(`    Got:      ${result.canonical}`);
        }
      }
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Valid canonicals:    ${results.valid.length}`);
  console.log(`❌ Mismatched:          ${results.invalid.length}`);
  console.log(`❌ Missing canonicals:  ${results.missing.length}`);
  console.log(`🚫 Not found (404):     ${results.notFound.length}`);
  console.log(`⚠️  Errors:             ${results.errors.length}`);
  console.log(`📊 Total processed:     ${urls.length}`);

  if (results.invalid.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('MISMATCHED CANONICALS:');
    console.log('-'.repeat(80));
    results.invalid.forEach(({ url, canonical }) => {
      console.log(`\n${url}`);
      console.log(`  → ${canonical}`);
    });
  }

  if (results.missing.length > 0 && results.missing.length <= 20) {
    console.log('\n' + '-'.repeat(80));
    console.log('MISSING CANONICALS:');
    console.log('-'.repeat(80));
    results.missing.forEach(url => console.log(`  ${url}`));
  }

  if (results.notFound.length > 0 && results.notFound.length <= 20) {
    console.log('\n' + '-'.repeat(80));
    console.log('NOT FOUND (404):');
    console.log('-'.repeat(80));
    results.notFound.forEach(url => console.log(`  ${url}`));
  }

  if (results.errors.length > 0 && results.errors.length <= 20) {
    console.log('\n' + '-'.repeat(80));
    console.log('ERRORS:');
    console.log('-'.repeat(80));
    results.errors.forEach(({ url, error }) => {
      console.log(`  ${url}: ${error}`);
    });
  }

  // Exit with error code if there are issues (excluding 404s as they're expected)
  const hasIssues = results.invalid.length > 0 || results.missing.length > 0 || results.errors.length > 0;
  process.exit(hasIssues ? 1 : 0);
}

validateCanonicals().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
