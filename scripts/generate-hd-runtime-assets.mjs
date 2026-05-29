import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SCALE = 4;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const HD_SOURCE_IMAGE_SIZES = {
  'images/backgrounds/bg_start_menu.png': { width: 1280, height: 960 },
  'images/backgrounds/bg_goal.png': { width: 1280, height: 960 },
  'images/backgrounds/bg_shop.png': { width: 1280, height: 960 },
  'images/backgrounds/bg_top.png': { width: 1280, height: 160 },
  'images/backgrounds/bg_level_A.png': { width: 1280, height: 800 },
  'images/backgrounds/bg_level_B.png': { width: 1280, height: 800 },
  'images/backgrounds/bg_level_C.png': { width: 1280, height: 800 },
  'images/backgrounds/bg_level_D.png': { width: 1280, height: 800 },
  'images/backgrounds/bg_level_E.png': { width: 1280, height: 800 },
  'images/characters/miner_sheet.png': { width: 1024, height: 160 },
  'images/characters/shopkeeper_sheet.png': { width: 640, height: 320 },
  'images/characters/mole_sheet.png': { width: 504, height: 52 },
  'images/characters/mole_with_diamond_sheet.png': { width: 504, height: 52 },
  'images/tools/hook_sheet.png': { width: 156, height: 60 },
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceAssetsDir = path.join(repoRoot, 'assets');
const runtimeAssetsDir = path.join(repoRoot, 'frontend', 'public', 'assets');
const manifestPath = path.join(sourceAssetsDir, 'phaser-asset-manifest.json');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function removeDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

async function statImage(filePath) {
  const { stdout } = await execFileAsync('sips', [
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    filePath,
  ]);

  const widthMatch = stdout.match(/pixelWidth:\s+(\d+)/);
  const heightMatch = stdout.match(/pixelHeight:\s+(\d+)/);

  if (!widthMatch || !heightMatch) {
    throw new Error(`Unable to read image size from ${filePath}`);
  }

  return {
    width: Number(widthMatch[1]),
    height: Number(heightMatch[1]),
  };
}

async function resizeImage(sourcePath, targetPath) {
  const { width, height } = await statImage(sourcePath);
  await ensureDir(path.dirname(targetPath));
  await execFileAsync('sips', [
    '--resampleHeightWidth',
    String(height * SCALE),
    String(width * SCALE),
    sourcePath,
    '--out',
    targetPath,
  ]);
}

function shouldCopyWithoutScaling(relativePath, size) {
  const normalizedPath = relativePath.replaceAll(path.sep, '/');
  const targetSize =
    HD_SOURCE_IMAGE_SIZES[normalizedPath] ??
    HD_SOURCE_IMAGE_SIZES[`images/${normalizedPath}`];

  if (!targetSize) {
    return false;
  }

  return size.width === targetSize.width && size.height === targetSize.height;
}

async function copyFile(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

async function processDirectory(sourceDir, targetDir, relativeDir = '') {
  const currentSourceDir = path.join(sourceDir, relativeDir);
  const entries = await fs.readdir(currentSourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const nextRelativePath = path.join(relativeDir, entry.name);
    const sourcePath = path.join(sourceDir, nextRelativePath);
    const targetPath = path.join(targetDir, nextRelativePath);

    if (entry.isDirectory()) {
      await processDirectory(sourceDir, targetDir, nextRelativePath);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
      const size = await statImage(sourcePath);

      if (shouldCopyWithoutScaling(nextRelativePath, size)) {
        await copyFile(sourcePath, targetPath);
        continue;
      }

      await resizeImage(sourcePath, targetPath);
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

async function buildRuntimeManifest() {
  const manifest = await readJson(manifestPath);
  const nextManifest = {
    ...manifest,
    spriteSheets: Object.fromEntries(
      Object.entries(manifest.spriteSheets).map(([key, config]) => [
        key,
        {
          ...config,
          frameWidth: config.frameWidth * SCALE,
          frameHeight: config.frameHeight * SCALE,
        },
      ]),
    ),
  };

  await writeJson(path.join(runtimeAssetsDir, 'phaser-asset-manifest.json'), nextManifest);
}

async function main() {
  await removeDir(runtimeAssetsDir);
  await ensureDir(runtimeAssetsDir);

  await Promise.all([
    processDirectory(path.join(sourceAssetsDir, 'images'), path.join(runtimeAssetsDir, 'images')),
    processDirectory(path.join(sourceAssetsDir, 'audio'), path.join(runtimeAssetsDir, 'audio')),
    processDirectory(path.join(sourceAssetsDir, 'fonts'), path.join(runtimeAssetsDir, 'fonts')),
  ]);

  await buildRuntimeManifest();

  console.log(
    [
      'Generated temporary 4x HD runtime assets.',
      `Source: ${sourceAssetsDir}`,
      `Runtime: ${runtimeAssetsDir}`,
      `Sprite frame scale: ${SCALE}x`,
    ].join('\n'),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
