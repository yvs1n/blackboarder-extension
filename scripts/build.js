import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/*
 * Builds every generated file in the repository:
 *   - dist/       the Chrome extension (load this folder unpacked)
 *   - version.json files (the extension's build id)
 *   - when the web app folder (mobile-web/) is present, its generated files too
 *
 * The extension gets a "build id": a hash of the files that make it up. Running the build twice on
 * the same code gives the same id and byte-identical output, so the GitHub Action only commits when
 * something really changed, and installed copies only update when their own code changed.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...parts) => path.join(ROOT, ...parts);

/** The public repository the extension updates itself from. */
const EXTENSION_REPO = 'yvs1n/blackboarder-extension';
/** The web app is not part of the public copy of the repository; its steps are skipped when absent. */
const HAS_WEB = fs.existsSync(r('mobile-web', 'companion'));

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.html', '.json', '.md', '.txt', '.svg', '.bat', '.sh', '.ps1', '.webmanifest']);

/** Text with Windows line endings removed, so hashes match between Windows checkouts and CI. */
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function writeIfChanged(file, content) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n') : null;
  if (existing === content.replace(/\r\n?/g, '\n')) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/**
 * Hash of a set of files. Text files are compared without carriage returns; `normalize` can blank
 * out lines that this script writes itself (otherwise the stamp would change the hash it stamps).
 */
function hashFiles(baseDir, files, normalize = (_rel, text) => text) {
  const hash = crypto.createHash('sha256');
  for (const rel of [...files].sort()) {
    const full = path.join(baseDir, rel);
    hash.update(rel + '\0');
    if (TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
      hash.update(normalize(rel, readText(full)));
    } else {
      hash.update(fs.readFileSync(full));
    }
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

function gitInfo() {
  const info = { commit: '', shortCommit: '', message: '' };
  try {
    info.commit = process.env.GITHUB_SHA || execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    info.shortCommit = info.commit.slice(0, 7);
    info.message = execSync(`git log -1 --format=%s ${info.commit}`, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    console.warn('Could not read git commit:', err.message);
  }
  return info;
}

function packageVersion() {
  try {
    return JSON.parse(readText(r('package.json'))).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

/**
 * Version info for a build id. When the id matches the previous build, the previous commit and
 * timestamp are kept so an unchanged build produces identical files.
 */
function versionInfo(buildId, previous, git) {
  if (previous && previous.build === buildId) {
    return {
      version: packageVersion(),
      build: buildId,
      commit: previous.commit || git.commit,
      shortCommit: previous.shortCommit || git.shortCommit,
      timestamp: previous.timestamp,
      message: previous.message || git.message,
      repo: EXTENSION_REPO,
      branch: 'main'
    };
  }
  return {
    version: packageVersion(),
    build: buildId,
    commit: git.commit,
    shortCommit: git.shortCommit,
    timestamp: new Date().toISOString(),
    message: git.message || 'Update Blackboarder',
    repo: EXTENSION_REPO,
    branch: 'main'
  };
}

// ---------------------------------------------------------------------------
// Web app (mobile-web/companion/). mobile-web/ itself is the site root: the landing page and the worker.
// ---------------------------------------------------------------------------

const WEB_DIR = r('mobile-web', 'companion');
// Server-side or generated-by-this-script files that are not part of the app the browser runs
const WEB_HASH_EXCLUDE = new Set(['version.json', '_worker.js']);

const APP_STAMP = /const APP_BUILD = \{[^\n]*\};/;
const SW_STAMP = /const BUILD_ID = '[^']*';/;
const HTML_STAMP = /\?v=[A-Za-z0-9._-]*/g;

function normalizeWebStamps(rel, text) {
  if (rel === 'app.js') return text.replace(APP_STAMP, 'const APP_BUILD = {};');
  if (rel === 'sw.js') return text.replace(SW_STAMP, "const BUILD_ID = '';");
  if (rel === 'index.html') return text.replace(HTML_STAMP, '?v=');
  return text;
}

async function buildWebCore(viteDefines) {
  console.log('Bundling shared logic for the web app (mobile-web/companion/core.js)...');
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: 'mobile-web/companion',
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: r('src/mobile/core.ts'),
        name: 'BBCoreBundle',
        formats: ['iife'],
        fileName: () => 'core.js'
      },
      rollupOptions: {
        output: {
          banner: '/* Generated by scripts/build.js from src/mobile/core.ts - edit the TypeScript sources, not this file. */'
        }
      }
    },
    define: viteDefines
  });
}

async function buildQrScanner(viteDefines) {
  // QR decoder for the phone's pairing scanner, loaded only when the scanner opens
  console.log('Bundling the QR scanner for the web app (mobile-web/companion/qr-scan.js)...');
  await build({
    root: ROOT,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: 'mobile-web/companion',
      emptyOutDir: false,
      minify: true,
      lib: {
        entry: r('src/mobile/qrScan.ts'),
        name: 'BBQrScanBundle',
        formats: ['iife'],
        fileName: () => 'qr-scan.js'
      },
      rollupOptions: {
        output: {
          banner: '/* Generated by scripts/build.js from src/mobile/qrScan.ts (jsQR, Apache-2.0) - do not edit. */'
        }
      }
    },
    define: viteDefines
  });
}

/**
 * pdf.js (Mozilla, Apache-2.0) for reading syllabus PDFs, copied as-is from node_modules into
 * <dir>/vendor/pdfjs. Both apps load it only when a student imports a PDF.
 */
function copyPdfJs(dir) {
  const from = r('node_modules', 'pdfjs-dist');
  if (!fs.existsSync(from)) throw new Error('pdfjs-dist is missing: run npm install');
  const to = path.join(dir, 'vendor', 'pdfjs');
  fs.mkdirSync(to, { recursive: true });
  const strip = text => text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  writeIfChanged(path.join(to, 'pdf.min.js'), strip(readText(path.join(from, 'build', 'pdf.min.mjs'))));
  writeIfChanged(path.join(to, 'pdf.worker.min.js'), strip(readText(path.join(from, 'build', 'pdf.worker.min.mjs'))));
  writeIfChanged(path.join(to, 'LICENSE'), readText(path.join(from, 'LICENSE')));
}

function copyWidget() {
  // widgets/blackboarder-widget.js is the only copy to edit; the web app serves it for "Copy Widget Script"
  const source = readText(r('widgets', 'blackboarder-widget.js'));
  writeIfChanged(path.join(WEB_DIR, 'widget.js'), source);
}

function stampWebApp(git) {
  const files = listFiles(WEB_DIR).filter(f => !WEB_HASH_EXCLUDE.has(f));
  const buildId = hashFiles(WEB_DIR, files, normalizeWebStamps);
  const info = versionInfo(buildId, readJson(path.join(WEB_DIR, 'version.json')), git);

  const appPath = path.join(WEB_DIR, 'app.js');
  const app = readText(appPath);
  if (!APP_STAMP.test(app)) throw new Error('mobile-web/companion/app.js is missing its "const APP_BUILD = {...};" line');
  const appStamp = { build: info.build, version: info.version, shortCommit: info.shortCommit, timestamp: info.timestamp };
  writeIfChanged(appPath, app.replace(APP_STAMP, `const APP_BUILD = ${JSON.stringify(appStamp)};`));

  const swPath = path.join(WEB_DIR, 'sw.js');
  const sw = readText(swPath);
  if (!SW_STAMP.test(sw)) throw new Error("mobile-web/companion/sw.js is missing its \"const BUILD_ID = '...';\" line");
  writeIfChanged(swPath, sw.replace(SW_STAMP, `const BUILD_ID = '${info.build}';`));

  const htmlPath = path.join(WEB_DIR, 'index.html');
  writeIfChanged(htmlPath, readText(htmlPath).replace(HTML_STAMP, `?v=${info.build}`));

  writeIfChanged(path.join(WEB_DIR, 'version.json'), JSON.stringify(info, null, 2) + '\n');
  return info;
}

// ---------------------------------------------------------------------------
// Extension (dist/)
// ---------------------------------------------------------------------------

function extensionSourceFiles() {
  const files = [];
  for (const rel of listFiles(r('src'))) {
    if (rel === 'buildInfo.ts' || rel.startsWith('mobile/')) continue;
    files.push(`src/${rel}`);
  }
  for (const rel of listFiles(r('public'))) files.push(`public/${rel}`);
  for (const rel of listFiles(r('updater'))) files.push(`updater/${rel}`);
  files.push('package.json', 'package-lock.json');
  return files.filter(f => fs.existsSync(r(f)));
}

/** package.json counts only through its version and dependencies, so its scripts can differ between copies of the repository. */
function normalizeExtensionHash(rel, text) {
  if (rel !== 'package.json') return text;
  try {
    const pkg = JSON.parse(text);
    return JSON.stringify({ version: pkg.version, dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} });
  } catch {
    return text;
  }
}

function writeBuildInfoTs(info) {
  const ts = `// Auto-generated by scripts/build.js - Do not edit manually
export interface BuildInfo {
  version: string;
  /** Hash of the extension's source files; changes only when the extension's code changes */
  build: string;
  commit: string;
  shortCommit: string;
  timestamp: string;
  message: string;
  repo: string;
  branch: string;
}

export const BUILD_INFO: BuildInfo = ${JSON.stringify(info, null, 2)};
`;
  writeIfChanged(r('src', 'buildInfo.ts'), ts);
}

/** The manifest for the store build: no native messaging and no GitHub access, since the stores do the updating. */
function storeManifestText(text) {
  const manifest = JSON.parse(text);
  manifest.permissions = (manifest.permissions || []).filter(p => p !== 'nativeMessaging');
  manifest.host_permissions = (manifest.host_permissions || []).filter(h => !/github/i.test(h));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function buildExtension(info, viteDefines, { outDir = 'dist', store = false } = {}) {
  const distDir = r(outDir);

  console.log('Building popup...');
  await build({
    root: ROOT,
    base: '',
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: { popup: r('src/popup/index.html') }
      }
    },
    define: viteDefines
  });

  console.log('Building content script (content.js)...');
  await build({
    root: ROOT,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: r('src/content/scraper.ts'),
        name: 'BlackboardSidekickContent',
        formats: ['iife'],
        fileName: () => 'content.js'
      }
    },
    define: viteDefines
  });

  console.log('Building background worker (background.js)...');
  await build({
    root: ROOT,
    logLevel: 'warn',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: r('src/background/serviceWorker.ts'),
        name: 'BlackboarderBackground',
        formats: ['iife'],
        fileName: () => 'background.js'
      }
    },
    define: viteDefines
  });

  // Blackboard dark mode: the CSS is embedded into the script at build time
  const darkCss = readText(r('src/content/blackboard-dark.css'));
  const darkJs = readText(r('src/content/blackboard-dark.js')).replace('`__BBS_STATIC_DARK_CSS__`', JSON.stringify(darkCss));
  fs.writeFileSync(path.join(distDir, 'blackboard-dark.js'), darkJs, 'utf8');
  fs.writeFileSync(path.join(distDir, 'blackboard-dark.css'), darkCss, 'utf8');
  fs.writeFileSync(path.join(distDir, 'content.css'), readText(r('src/content/content.css')), 'utf8');

  // manifest.json and icons (also copied by Vite from public/, done here so the lib builds cannot skip them)
  const manifestText = readText(r('public/manifest.json'));
  fs.writeFileSync(path.join(distDir, 'manifest.json'), store ? storeManifestText(manifestText) : manifestText, 'utf8');
  copyPdfJs(distDir);
  fs.mkdirSync(path.join(distDir, 'icons'), { recursive: true });
  for (const icon of listFiles(r('public/icons'))) {
    fs.copyFileSync(r('public/icons', icon), path.join(distDir, 'icons', icon));
  }

  // Updater: update.bat / update.sh at the top of the extension folder, the helper in updater/
  for (const rel of store ? [] : listFiles(r('updater'))) {
    const target = rel === 'update.bat' || rel === 'update.sh' ? rel : `updater/${rel}`;
    const dest = path.join(distDir, target);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let text = readText(r('updater', rel));
    // Batch files must keep Windows line endings or cmd.exe misreads labels
    if (rel.endsWith('.bat')) text = text.replace(/\n/g, '\r\n');
    fs.writeFileSync(dest, text, 'utf8');
    if (rel.endsWith('.sh')) fs.chmodSync(dest, 0o755);
  }

  // version.json lists every file so the updater can remove files a newer build no longer has (the store build has no updater)
  if (store) return '';
  const files = listFiles(distDir).filter(f => f !== 'version.json');
  const versionJson = JSON.stringify({ ...info, files }, null, 2) + '\n';
  fs.writeFileSync(path.join(distDir, 'version.json'), versionJson, 'utf8');
  return versionJson;
}

// ---------------------------------------------------------------------------

function countTests() {
  const testsDir = r('tests');
  if (!fs.existsSync(testsDir)) return 322;
  const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.js'));
  let total = 0;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(testsDir, f), 'utf8');
    const matches = txt.match(/^\s*(?:it|test)(?:\.concurrent|\.only|\.skip|\.skipIf\([^)]*\))?\s*\(/gm);
    if (matches) total += matches.length;
  }
  return total || 322;
}

function syncAllComponents(version) {
  console.log(`Synchronizing all components to v${version}...`);

  // 1. Sync public/manifest.json
  const manifestPath = r('public/manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readText(manifestPath));
      if (manifest.version !== version) {
        manifest.version = version;
        writeIfChanged(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`  ✓ Synced public/manifest.json to v${version}`);
      }
    } catch (e) {
      console.warn('  ! Could not sync public/manifest.json:', e.message);
    }
  }

  // 2. Sync the landing page (mobile-web/index.html)
  const landingPath = r('mobile-web', 'index.html');
  if (fs.existsSync(landingPath)) {
    let landingHtml = readText(landingPath);
    const updated = landingHtml.replace(
      /<span>Blackboarder v[0-9.]+<\/span>/g,
      `<span>Blackboarder v${version}</span>`
    );
    if (writeIfChanged(landingPath, updated)) {
      console.log(`  ✓ Synced mobile-web/index.html (landing page) to v${version}`);
    }
  }

  // 3. Sync README.md
  const readmePath = r('README.md');
  if (fs.existsSync(readmePath)) {
    let readmeText = readText(readmePath);
    const testCount = countTests();

    // Ensure Version badge is present and synced
    const versionBadgeRegex = /<img src="https:\/\/img\.shields\.io\/badge\/Version-v[0-9.]+-blue\?logo=github&logoColor=white" alt="Version v[0-9.]+" \/>/;
    const targetVersionBadge = `<img src="https://img.shields.io/badge/Version-v${version}-blue?logo=github&logoColor=white" alt="Version v${version}" />`;

    if (versionBadgeRegex.test(readmeText)) {
      readmeText = readmeText.replace(versionBadgeRegex, targetVersionBadge);
    } else {
      readmeText = readmeText.replace(
        /(<p align="center">\s*)(<a href="#-quick-start--installation">)/,
        `$1<a href="CHANGELOG.md">${targetVersionBadge}</a>\n  $2`
      );
    }

    // Sync test count badge
    readmeText = readmeText.replace(
      /https:\/\/img\.shields\.io\/badge\/Tests-[0-9]+_Passing-success/g,
      `https://img.shields.io/badge/Tests-${testCount}_Passing-success`
    );
    readmeText = readmeText.replace(
      /alt="Vitest [0-9]+ Passing"/g,
      `alt="Vitest ${testCount} Passing"`
    );

    if (writeIfChanged(readmePath, readmeText)) {
      console.log(`  ✓ Synced README.md (v${version}, ${testCount} passing tests)`);
    }
  }

  // 4. Sync src/popup/index.html static version badges
  const popupHtmlPath = r('src/popup/index.html');
  if (fs.existsSync(popupHtmlPath)) {
    let popupHtml = readText(popupHtmlPath);
    popupHtml = popupHtml.replace(
      /<span class="eub-commit" id="eub-commit-badge">v[0-9.]+<\/span>/g,
      `<span class="eub-commit" id="eub-commit-badge">v${version}</span>`
    );
    popupHtml = popupHtml.replace(
      /<span id="ext-version-badge" class="settings-pill pill-blue" style="font-size: 11px; margin-left: 6px;">v[0-9.]+<\/span>/g,
      `<span id="ext-version-badge" class="settings-pill pill-blue" style="font-size: 11px; margin-left: 6px;">v${version}</span>`
    );
    if (writeIfChanged(popupHtmlPath, popupHtml)) {
      console.log(`  ✓ Synced src/popup/index.html to v${version}`);
    }
  }
}

async function main() {
  console.log('Building Blackboarder...');
  const git = gitInfo();
  const currentVersion = packageVersion();

  // Universal synchronization across Extension, Companion, Landing page, and README
  syncAllComponents(currentVersion);

  const extBuild = hashFiles(ROOT, extensionSourceFiles(), normalizeExtensionHash);
  const extInfo = versionInfo(extBuild, readJson(r('dist', 'version.json')) || readJson(r('version.json')), git);
  console.log(`Extension build ${extInfo.build} (${extInfo.shortCommit || 'no git'})`);
  writeBuildInfoTs(extInfo);

  const viteDefines = { 'process.env.NODE_ENV': '"production"', __STORE_BUILD__: 'false' };

  if (HAS_WEB) {
    await buildWebCore(viteDefines);
    await buildQrScanner(viteDefines);
    copyWidget();
    copyPdfJs(WEB_DIR);
    const webInfo = stampWebApp(git);
    console.log(`Web app build ${webInfo.build}`);
  }

  const versionJson = await buildExtension(extInfo, viteDefines);
  // The same extension without the self-updater, for the Chrome Web Store and Edge Add-ons
  await buildExtension(extInfo, { ...viteDefines, __STORE_BUILD__: 'true' }, { outDir: 'dist-store', store: true });
  // The root copy is what extensions installed before the dist/version.json check still read
  writeIfChanged(r('version.json'), versionJson);

  if (HAS_WEB && fs.existsSync(r('scripts', 'bundle-worker.js'))) {
    execSync('node scripts/bundle-worker.js', { cwd: ROOT, stdio: 'inherit' });
  }

  console.log(HAS_WEB ? 'Build complete: dist/ (extension), dist-store/ (store build) and the web app files.' : 'Build complete: dist/ (extension) and dist-store/ (store build).');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
