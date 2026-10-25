import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

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

function zipDirectory(sourceDir, outputZipPath) {
  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
  }

  const isWindows = process.platform === 'win32';
  if (isWindows) {
    // PowerShell Compress-Archive
    const normalizedSource = path.resolve(sourceDir).replace(/'/g, "''");
    const normalizedZip = path.resolve(outputZipPath).replace(/'/g, "''");
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${normalizedSource}\\*' -DestinationPath '${normalizedZip}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
  } else {
    // Unix / macOS zip
    const parentDir = path.dirname(outputZipPath);
    fs.mkdirSync(parentDir, { recursive: true });
    execSync(`cd "${sourceDir}" && zip -r "${outputZipPath}" .`, { stdio: 'inherit' });
  }
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
