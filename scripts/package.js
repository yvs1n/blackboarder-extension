import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const ROOT_DIR = path.resolve('.');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const EXT_SRC_DIR = path.join(ROOT_DIR, 'dist');
const WEB_SRC_DIR = path.join(ROOT_DIR, 'mobile-web');
// The public copy of the repository has no web app, only the extension
const HAS_WEB = fs.existsSync(WEB_SRC_DIR);

const RELEASE_EXT_DIR = path.join(RELEASE_DIR, 'extension');
const RELEASE_WEB_DIR = path.join(RELEASE_DIR, 'website');

const EXT_ZIP = path.join(RELEASE_DIR, 'blackboarder-extension.zip');
const WEB_ZIP = path.join(RELEASE_DIR, 'blackboarder-website.zip');
const FULL_ZIP = path.join(RELEASE_DIR, 'blackboarder-full-product.zip');

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function getSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(rootDir, currentDir = rootDir, out = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(rootDir, full, out);
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      out.push({ full, rel });
    }
  }
  return out;
}

/**
 * Pure Node.js ZIP builder that always writes POSIX forward-slash ('/') entry names.
 * PowerShell's Compress-Archive on Windows writes '\' separators which Firefox AMO rejects.
 */
function zipDirectory(sourceDir, outputZipPath) {
  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
  }
  fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });

  const files = collectFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { full, rel } of files) {
    const nameBuf = Buffer.from(rel, 'utf8');
    const raw = fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const data = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outputZipPath, Buffer.concat([...localParts, ...centralParts, eocd]));
}

async function runPackaging() {
  console.log('====================================================');
  console.log('📦 Blackboarder - Production Packaging Pipeline');
  console.log('====================================================\n');

  // Step 1: Run production build
  console.log('🔨 Step 1: Compiling extension with Vite...');
  execSync('node scripts/build.js', { stdio: 'inherit', cwd: ROOT_DIR });

  // Step 2: Clean and prepare release directory
  console.log('\n🧹 Step 2: Preparing release directories...');
  if (fs.existsSync(RELEASE_DIR)) {
    fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.mkdirSync(RELEASE_EXT_DIR, { recursive: true });
  if (HAS_WEB) fs.mkdirSync(RELEASE_WEB_DIR, { recursive: true });

  // Step 3: Copy extension files
  console.log('📁 Step 3: Staging extension files...');
  fs.cpSync(EXT_SRC_DIR, RELEASE_EXT_DIR, { recursive: true });

  // Copy the quick install guide (the updater is already part of dist/)
  const installGuideSrc = path.join(ROOT_DIR, 'docs', 'INSTALL_EXTENSION.md');
  if (fs.existsSync(installGuideSrc)) {
    fs.copyFileSync(installGuideSrc, path.join(RELEASE_EXT_DIR, 'INSTALL_EXTENSION.md'));
  }

  // Step 4: Copy website files (only where the web app is present)
  const hostingGuideSrc = path.join(ROOT_DIR, 'docs', 'HOSTING_GUIDE.md');
  const widgetsSrc = path.join(ROOT_DIR, 'widgets');
  if (HAS_WEB) {
    console.log('🌐 Step 4: Staging website / PWA files...');
    fs.cpSync(WEB_SRC_DIR, RELEASE_WEB_DIR, { recursive: true });

    if (fs.existsSync(hostingGuideSrc)) {
      fs.copyFileSync(hostingGuideSrc, path.join(RELEASE_WEB_DIR, 'HOSTING_GUIDE.md'));
    }

    if (fs.existsSync(widgetsSrc)) {
      fs.cpSync(widgetsSrc, path.join(RELEASE_DIR, 'widgets'), { recursive: true });
    }
  }

  // Step 5: Create compressed zips
  console.log('\n🗜️ Step 5: Compressing release archives...');

  console.log('  -> Compressing blackboarder-extension.zip...');
  zipDirectory(RELEASE_EXT_DIR, EXT_ZIP);

  // The same extension without the self-updater, the file to upload to the Chrome Web Store and Edge Add-ons
  const STORE_SRC_DIR = path.join(ROOT_DIR, 'build', 'store');
  if (fs.existsSync(STORE_SRC_DIR)) {
    console.log('  -> Compressing blackboarder-extension-store.zip...');
    zipDirectory(STORE_SRC_DIR, path.join(RELEASE_DIR, 'blackboarder-extension-store.zip'));
  }

  // Firefox & Firefox for Android build (no Chromium-only sidePanel or nativeMessaging permissions)
  const FIREFOX_SRC_DIR = path.join(ROOT_DIR, 'build', 'firefox');
  if (fs.existsSync(FIREFOX_SRC_DIR)) {
    console.log('  -> Compressing blackboarder-android-firefox.zip...');
    zipDirectory(FIREFOX_SRC_DIR, path.join(RELEASE_DIR, 'blackboarder-android-firefox.zip'));
  }

  if (HAS_WEB) {
  console.log('  -> Compressing blackboarder-website.zip...');
  zipDirectory(RELEASE_WEB_DIR, WEB_ZIP);

  console.log('  -> Compressing blackboarder-full-product.zip...');
  // For full product, create a temporary bundle containing both
  const tempFullDir = path.join(RELEASE_DIR, '_temp_full');
  fs.mkdirSync(tempFullDir, { recursive: true });
  fs.cpSync(RELEASE_EXT_DIR, path.join(tempFullDir, 'extension'), { recursive: true });
  fs.cpSync(RELEASE_WEB_DIR, path.join(tempFullDir, 'website'), { recursive: true });
  if (fs.existsSync(widgetsSrc)) {
    fs.cpSync(widgetsSrc, path.join(tempFullDir, 'widgets'), { recursive: true });
  }

  if (fs.existsSync(installGuideSrc)) {
    fs.copyFileSync(installGuideSrc, path.join(tempFullDir, 'INSTALL_EXTENSION.md'));
  }
  if (fs.existsSync(hostingGuideSrc)) {
    fs.copyFileSync(hostingGuideSrc, path.join(tempFullDir, 'HOSTING_GUIDE.md'));
  }
  const readmeSrc = path.join(ROOT_DIR, 'README.md');
  if (fs.existsSync(readmeSrc)) {
    fs.copyFileSync(readmeSrc, path.join(tempFullDir, 'README.md'));
  }

  zipDirectory(tempFullDir, FULL_ZIP);
  fs.rmSync(tempFullDir, { recursive: true, force: true });
  }

  // Step 6: Summary and stats
  console.log('\n====================================================');
  console.log('🎉 Packaging Complete! Release bundles ready:');
  console.log('====================================================');

  const releaseFiles = [
    { name: 'Extension Zip (for students/users)', path: EXT_ZIP },
    { name: 'Website Zip (for hosting)', path: WEB_ZIP },
    { name: 'Full Product Zip (everything)', path: FULL_ZIP }
  ];

  for (const item of releaseFiles) {
    if (fs.existsSync(item.path)) {
      const stats = fs.statSync(item.path);
      const sha256 = getSha256(item.path).slice(0, 16);
      console.log(`\n• ${item.name}:`);
      console.log(`  File:   ${path.relative(ROOT_DIR, item.path)}`);
      console.log(`  Size:   ${formatBytes(stats.size)}`);
      console.log(`  SHA256: ${sha256}...`);
    }
  }

  console.log('\n📋 Quick Distribution Instructions:');
  console.log('1. Give "blackboarder-extension.zip" to any student.');
  console.log('   They unzip it and load it via chrome://extensions -> "Load unpacked".');
  console.log('2. Upload "blackboarder-website.zip" (or folder) to Cloudflare Pages / Vercel.');
  console.log('   They get a live web dashboard + iOS/Android calendar subscription feed.');
  console.log('3. All student accounts are isolated via personal Sync Pairing Keys!\n');
}

runPackaging().catch(err => {
  console.error('\n❌ Packaging failed:', err);
  process.exit(1);
});
