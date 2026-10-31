#!/usr/bin/env node

/**
 * scripts/lint-check.js
 * Zero-dependency code-style and repository hygiene checker for Blackboarder.
 *
 * Verifies:
 * 1. TypeScript compilation (tsc --noEmit)
 * 2. Swiss Grid 0px border-radius system in popup.css and styles.css
 * 3. Two-Tone color compliance (no prohibited neon greens #10b981 / #34d399 in UI styling)
 * 4. No em-dashes (— / \u2014) in user-facing UI text, buttons, or docs
 * 5. Strict JSON syntax validation on all project JSON files
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let hasError = false;
// The web app lives outside the public copy of the repository; its checks are skipped when it is absent
const HAS_WEB = fs.existsSync(path.join(ROOT, 'mobile-web'));

function pass(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function fail(msg, details = []) {
  hasError = true;
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  details.forEach(d => console.error(`  - ${d}`));
}

// 1. TypeScript check
console.log('\n--- Checking TypeScript Compilation ---');
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
  pass('TypeScript passes with 0 errors');
} catch (err) {
  fail('TypeScript compiler reported errors', [err.stdout?.toString() || err.message]);
}

// JavaScript syntax checks
if (HAS_WEB) {
  const jsFilesToCheck = [
    'mobile-web/companion/app.js',
    'mobile-web/companion/sw.js',
    'mobile-web/_worker.js'
  ];
  for (const relPath of jsFilesToCheck) {
    const fullPath = path.join(ROOT, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        execSync('node --check "' + fullPath + '"', { cwd: ROOT, stdio: 'pipe' });
        pass(relPath + ' syntax is valid');
      } catch (err) {
        fail(relPath + ' has JavaScript syntax errors', [err.stderr?.toString() || err.message]);
      }
    }
  }
}

// 2. Swiss Grid 0px border-radius check
console.log('\n--- Checking Swiss Grid 0px Compliance ---');
const popupCss = fs.readFileSync(path.join(ROOT, 'src/popup/popup.css'), 'utf8');
const mobileCss = HAS_WEB ? fs.readFileSync(path.join(ROOT, 'mobile-web/companion/styles.css'), 'utf8') : '';

if (popupCss.includes('*, *::before, *::after') && popupCss.includes('border-radius: 0 !important;')) {
  pass('src/popup/popup.css enforces universal 0px border-radius');
} else {
  fail('src/popup/popup.css is missing universal 0px border-radius rule');
}

if (!HAS_WEB) {
  pass('web app not present; skipping its border-radius check');
} else if (mobileCss.includes('*, *::before, *::after') && mobileCss.includes('border-radius: 0 !important;')) {
  pass('mobile-web/companion/styles.css enforces universal 0px border-radius');
} else {
  fail('mobile-web/companion/styles.css is missing universal 0px border-radius rule');
}

// 3. Two-Tone theme compliance (prohibited neon green in UI styles)
console.log('\n--- Checking Two-Tone Styling (No Neon Green Highlights) ---');
const greenRegex = /#(?:10b981|34d399|059669|166534|065f46|6ee7b7|d1fae5|a7f3d0)\b/i;

const popupGreenMatches = popupCss.match(greenRegex);
if (!popupGreenMatches) {
  pass('src/popup/popup.css contains 0 prohibited neon green hex codes');
} else {
  fail('src/popup/popup.css contains prohibited green colors', [popupGreenMatches[0]]);
}

// 4. JSON Syntax Validation
console.log('\n--- Checking JSON File Integrity ---');
const jsonFiles = [
  'package.json',
  'public/manifest.json',
  'database.rules.json'
];

jsonFiles.forEach(rel => {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) {
    try {
      JSON.parse(fs.readFileSync(full, 'utf8'));
      pass(`${rel} is valid JSON`);
    } catch (e) {
      fail(`${rel} contains invalid JSON`, [e.message]);
    }
  }
});

// 5. Check for Em-Dashes in user-facing markdown
console.log('\n--- Checking Typography (No Em-Dashes in Documentation) ---');
const docsFiles = ['README.md', 'docs/INSTALL_EXTENSION.md', 'docs/HOSTING_GUIDE.md', 'docs/WALKTHROUGH.md', 'AGENTS.md'];
docsFiles.forEach(rel => {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) {
    const content = fs.readFileSync(full, 'utf8');
    if (content.includes('—') || content.includes('\u2014')) {
      fail(`${rel} contains em-dashes (—)`);
    } else {
      pass(`${rel} contains zero em-dashes`);
    }
  }
});

// 6. Universal Multi-Component Version Synchronization Check
console.log('\n--- Checking Universal Multi-Component Version Synchronization ---');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const manifestVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8')).version;
const landingHtml = HAS_WEB ? fs.readFileSync(path.join(ROOT, 'mobile-web/index.html'), 'utf8') : '';
const readmeContent = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

if (manifestVersion !== pkgVersion) {
  fail(`public/manifest.json version (${manifestVersion}) does not match package.json version (${pkgVersion})`);
} else {
  pass(`public/manifest.json version matches package.json (v${pkgVersion})`);
}

if (!HAS_WEB) {
  pass('landing page not present; skipping its version check');
} else if (!landingHtml.includes(`Blackboarder v${pkgVersion}`)) {
  fail(`mobile-web/index.html (landing page) does not display current version (expected "Blackboarder v${pkgVersion}")`);
} else {
  pass(`mobile-web/index.html (landing page) displays matching version (v${pkgVersion})`);
}

if (!readmeContent.includes(`badge/Version-v${pkgVersion}-blue`)) {
  fail(`README.md does not have matching Version badge for v${pkgVersion}`);
} else {
  pass(`README.md displays matching Version badge (v${pkgVersion})`);
} 

const agentsPath = path.join(ROOT, 'AGENTS.md');
if (!fs.existsSync(agentsPath)) {
  fail('AGENTS.md does not exist in repository root');
} else {
  pass('AGENTS.md exists');
}

const distVersionPath = path.join(ROOT, 'dist/version.json');
if (fs.existsSync(distVersionPath)) {
  try {
    const distVer = JSON.parse(fs.readFileSync(distVersionPath, 'utf8')).version;
    if (distVer !== pkgVersion) {
      fail(`dist/version.json version (${distVer}) does not match package.json (${pkgVersion})`);
    } else {
      pass(`dist/version.json matches package.json (v${pkgVersion})`);
    }
  } catch (e) {
    fail('dist/version.json could not be parsed');
  }
}

const rootVersionPath = path.join(ROOT, 'version.json');
if (fs.existsSync(rootVersionPath)) {
  try {
    const rootVer = JSON.parse(fs.readFileSync(rootVersionPath, 'utf8')).version;
    if (rootVer !== pkgVersion) {
      fail(`version.json version (${rootVer}) does not match package.json (${pkgVersion})`);
    } else {
      pass(`version.json matches package.json (v${pkgVersion})`);
    }
  } catch (e) {
    fail('version.json could not be parsed');
  }
}

const rootUpdateBat = path.join(ROOT, 'update.bat');
const updaterUpdateBat = path.join(ROOT, 'updater/update.bat');
if (fs.existsSync(rootUpdateBat) && fs.existsSync(updaterUpdateBat)) {
  const rootText = fs.readFileSync(rootUpdateBat, 'utf8').replace(/\r\n?/g, '\n');
  const updaterText = fs.readFileSync(updaterUpdateBat, 'utf8').replace(/\r\n?/g, '\n');
  if (rootText !== updaterText) {
    fail('update.bat in root does not match updater/update.bat');
  } else {
    pass('update.bat matches updater/update.bat');
  }
}

const rootUpdateSh = path.join(ROOT, 'update.sh');
const updaterUpdateSh = path.join(ROOT, 'updater/update.sh');
if (fs.existsSync(rootUpdateSh) && fs.existsSync(updaterUpdateSh)) {
  const rootText = fs.readFileSync(rootUpdateSh, 'utf8').replace(/\r\n?/g, '\n');
  const updaterText = fs.readFileSync(updaterUpdateSh, 'utf8').replace(/\r\n?/g, '\n');
  if (rootText !== updaterText) {
    fail('update.sh in root does not match updater/update.sh');
  } else {
    pass('update.sh matches updater/update.sh');
  }
}

const webVersionPath = path.join(ROOT, 'mobile-web/companion/version.json');
if (fs.existsSync(webVersionPath)) {
  try {
    const webVer = JSON.parse(fs.readFileSync(webVersionPath, 'utf8')).version;
    if (webVer !== pkgVersion) {
      fail(`mobile-web/companion/version.json version (${webVer}) does not match package.json (${pkgVersion})`);
    } else {
      pass(`mobile-web/companion/version.json matches package.json (v${pkgVersion})`);
    }
  } catch (e) {
    fail('mobile-web/companion/version.json could not be parsed');
  }
}

// 7. SEO & Discoverability Check
console.log('\n--- Checking SEO & Discoverability ---');
const robotsPath = path.join(ROOT, 'mobile-web/robots.txt');
const sitemapPath = path.join(ROOT, 'mobile-web/sitemap.xml');

if (!HAS_WEB) {
  pass('website not present; skipping its SEO checks');
} else if (!fs.existsSync(robotsPath)) {
  fail('mobile-web/robots.txt is missing');
} else {
  const robotsTxt = fs.readFileSync(robotsPath, 'utf8');
  if (robotsTxt.includes('Sitemap: https://blackboarder.pages.dev/sitemap.xml')) {
    pass('mobile-web/robots.txt exists and references valid sitemap');
  } else {
    fail('mobile-web/robots.txt is missing sitemap reference');
  }
}

if (!HAS_WEB) {
  // nothing to check
} else if (!fs.existsSync(sitemapPath)) {
  fail('mobile-web/sitemap.xml is missing');
} else {
  const sitemapXml = fs.readFileSync(sitemapPath, 'utf8');
  if (sitemapXml.includes('<urlset') && sitemapXml.includes('https://blackboarder.pages.dev/')) {
    pass('mobile-web/sitemap.xml exists and defines canonical URLs');
  } else {
    fail('mobile-web/sitemap.xml is missing valid urlset schema');
  }
}

if (!HAS_WEB) {
  // nothing to check
} else if (landingHtml.includes('rel="canonical"') && landingHtml.includes('application/ld+json')) {
  pass('mobile-web/index.html includes canonical link and JSON-LD structured data');
} else {
  fail('mobile-web/index.html is missing canonical link or JSON-LD structured data');
}

console.log('\n----------------------------------------');
if (hasError) {
  console.error('\x1b[31mLint & Hygiene Check Failed!\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32mAll Lint & Hygiene Checks Passed Successfully!\x1b[0m\n');
  process.exit(0);
}
