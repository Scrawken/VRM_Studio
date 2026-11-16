import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class SecurityValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SecurityValidationError';
    this.statusCode = statusCode;
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveLoopbackHost(requestedHost?: string): string {
  const candidate = (requestedHost || process.env.VRM_FORGE_HOST || '127.0.0.1').trim();
  if (LOOPBACK_HOSTS.has(candidate)) {
    return candidate === 'localhost' ? '127.0.0.1' : candidate;
  }
  if (process.env.VRM_FORGE_ALLOW_NON_LOOPBACK === '1') {
    return candidate;
  }
  return '127.0.0.1';
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function assertValidProjectId(id: string): string {
  if (typeof id !== 'string') {
    throw new SecurityValidationError('Project ID must be a string.', 400);
  }
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(trimmed)) {
    throw new SecurityValidationError(
      'Invalid project ID: only alphanumeric characters, hyphens, and underscores are allowed.',
      400
    );
  }
  return trimmed;
}

const ALLOWED_ARTIFACT_FILES = new Set([
  'character.vrm',
  'character.glb',
  'source_high.glb',
  'external_source.glb',
  'spec.json',
  'validation.json',
  'blender_build.py',
  'blender_report.json',
  'character_blender.vrm',
  'character_blender.blend',
]);

export function assertAllowedArtifactFileName(fileName: string): string {
  if (typeof fileName !== 'string' || !ALLOWED_ARTIFACT_FILES.has(fileName)) {
    throw new SecurityValidationError('Requested artifact filename is not allowed.', 400);
  }
  return fileName;
}

export function resolveSafePathWithinRoot(rootDir: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(rootDir);
  for (const seg of segments) {
    if (!seg || seg.includes('\0')) {
      throw new SecurityValidationError('Invalid path segment.', 400);
    }
  }
  const target = path.resolve(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SecurityValidationError('Path traversal outside authorized directory is forbidden.', 403);
  }

  // Verify realpath containment when the target or its parent already exists
  let checkPath = target;
  while (!fs.existsSync(checkPath)) {
    const parent = path.dirname(checkPath);
    if (parent === checkPath) break;
    checkPath = parent;
  }
  if (fs.existsSync(checkPath) && fs.existsSync(resolvedRoot)) {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realCheck = fs.realpathSync(checkPath);
    const realRel = path.relative(realRoot, realCheck);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new SecurityValidationError('Symlink escape outside authorized directory is forbidden.', 403);
    }
  }

  return target;
}

export function sanitizeDownloadFilename(projectId: string, fileName: string): string {
  const safeId = assertValidProjectId(projectId);
  const safeFile = assertAllowedArtifactFileName(fileName);
  return `${safeId}_${safeFile}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const SHELL_META_REGEX = /[;&|`$<>!?\n\r\0]/;

export function getTrustedBlenderDirectories(platform: NodeJS.Platform = os.platform()): string[] {
  if (platform === 'win32') {
    const dirs: string[] = [];
    const envRoots = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      process.env['LOCALAPPDATA'] ? path.win32.join(process.env['LOCALAPPDATA'], 'Programs') : undefined,
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ];
    for (const root of envRoots) {
      if (root) {
        dirs.push(path.win32.join(root, 'Blender Foundation'));
      }
    }
    return Array.from(new Set(dirs.map((d) => path.win32.resolve(d).toLowerCase())));
  }
  if (platform === 'darwin') {
    return ['/applications/blender.app', '/usr/local/bin', '/opt/homebrew/bin'];
  }
  return ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/blender'];
}

export function isStrictBlenderFilename(
  candidatePath: string,
  platform: NodeJS.Platform = os.platform()
): boolean {
  const base =
    platform === 'win32' ? path.win32.basename(candidatePath) : path.posix.basename(candidatePath);
  if (platform === 'win32') {
    return base.toLowerCase() === 'blender.exe';
  }
  return base === 'blender';
}

export function validateBlenderExecutablePath(
  rawPath: string,
  options?: {
    platform?: NodeJS.Platform;
    allowCustomFolderIfVerified?: boolean;
    requireExistingFile?: boolean;
  }
): { valid: boolean; normalizedPath?: string; reason?: string } {
  const platform = options?.platform ?? os.platform();
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { valid: false, reason: 'Blender executable path is empty.' };
  }
  const trimmed = rawPath.trim();
  if (SHELL_META_REGEX.test(trimmed)) {
    return { valid: false, reason: 'Executable path contains forbidden characters.' };
  }
  if (trimmed.includes('..')) {
    return { valid: false, reason: 'Path traversal segments are not permitted.' };
  }
  const isAbs = platform === 'win32' ? /^[a-zA-Z]:[\\/]/.test(trimmed) : path.isAbsolute(trimmed);
  if (!isAbs) {
    return { valid: false, reason: 'Custom Blender path must be an absolute path.' };
  }
  if (!isStrictBlenderFilename(trimmed, platform)) {
    return {
      valid: false,
      reason:
        platform === 'win32'
          ? 'Executable filename must strictly be blender.exe.'
          : 'Executable filename must strictly be blender.',
    };
  }

  const normalized = platform === 'win32' ? path.win32.normalize(trimmed) : path.posix.normalize(trimmed);
  const trustedDirs = getTrustedBlenderDirectories(platform);
  const lowerNorm = normalized.toLowerCase();
  const inTrustedRoot = trustedDirs.some((dir) => lowerNorm.startsWith(dir.toLowerCase()));

  if (!inTrustedRoot && !options?.allowCustomFolderIfVerified) {
    return {
      valid: false,
      reason:
        'Custom Blender path must reside in a standard Blender installation directory or be chosen via the desktop file picker.',
    };
  }

  if (options?.requireExistingFile !== false) {
    if (!fs.existsSync(normalized)) {
      return { valid: false, reason: `Blender executable does not exist at ${normalized}.` };
    }
    const stat = fs.statSync(normalized);
    if (!stat.isFile()) {
      return { valid: false, reason: 'Target path is not a regular executable file.' };
    }
  }

  return { valid: true, normalizedPath: normalized };
}
