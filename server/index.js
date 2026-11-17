import express from 'express';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
// Keep only share metadata and original paths. Downloads are read from the
// selected locations on demand; the server does not make file copies.
const dataRoot = path.join(here, 'data');
const stateFile = path.join(dataRoot, 'active-share.json');
fs.mkdirSync(dataRoot, { recursive: true });
app.use(express.json({ limit: '1mb' }));

let share = null;

function localAddress() {
  const interfaces = os.networkInterfaces();
  const usable = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        usable.push({ name, address: entry.address });
      }
    }
  }
  const preferred = usable.find(({ name }) => /wi-?fi|wlan|ethernet/i.test(name));
  return (preferred || usable[0])?.address || '127.0.0.1';
}
function isHostRequest(req) {
  const remote = req.socket.remoteAddress || '';
  const remoteNormalized = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  const forwarded = remoteNormalized.startsWith('127.') || remoteNormalized === '::1'
    ? req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    : null;
  const client = forwarded || remoteNormalized;
  const normalized = client.startsWith('::ffff:') ? client.slice(7) : client;
  const localAddresses = Object.values(os.networkInterfaces()).flatMap((entries) =>
    (entries || []).filter((entry) => entry.family === 'IPv4').map((entry) => entry.address)
  );
  return normalized === '::1' || normalized.startsWith('127.') || localAddresses.includes(normalized);
}
function hostOnly(req, res, next) {
  if (isHostRequest(req)) return next();
  res.status(403).json({ error: 'Only the computer hosting this share can change it.' });
}
function safeFile(file) {
  return { id: file.id, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}
function publicShare() {
  if (!share) return null;
  return { id: share.id, files: share.files.map(safeFile), message: share.message, createdAt: share.createdAt };
}
function persistShare() {
  if (!share) {
    fs.rmSync(stateFile, { force: true });
    return;
  }
  const state = {
    id: share.id,
    message: share.message,
    createdAt: share.createdAt,
    files: share.files.map(({ id, name, size, type, path: filePath }) => ({ id, name, size, type, path: filePath }))
  };
  const temporary = `${stateFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), 'utf8');
  fs.renameSync(temporary, stateFile);
}
function restoreShare() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!/^[a-f0-9]{32}$/.test(state.id) || !Array.isArray(state.files)) throw new Error('Invalid share state');
    const files = state.files.flatMap((file) => {
      if (typeof file.path !== 'string' || !path.isAbsolute(file.path)) return [];
      const filePath = file.path;
      try { if (!fs.statSync(filePath).isFile()) return []; } catch { return []; }
      return [{ id: file.id, name: file.name, size: file.size, type: file.type, path: filePath }];
    });
    share = { id: state.id, files, message: String(state.message || ''), createdAt: state.createdAt || Date.now() };
    persistShare();
  } catch {
    share = null;
    fs.rmSync(stateFile, { force: true });
  }
}
function ensureShare() {
  if (!share) {
    const id = crypto.randomBytes(16).toString('hex');
    share = { id, files: [], message: '', createdAt: Date.now() };
  }
  persistShare();
  return share;
}

restoreShare();
// Remove uploads made by older versions of the app, which stored copies here.
fs.rmSync(path.join(dataRoot, 'shares'), { recursive: true, force: true });

app.get('/api/network', (_req, res) => res.json({ address: localAddress(), devPort: 5173, prodPort: port }));
// The LAN dashboard can show the current share to nearby devices, but only
// requests from the host computer can change it.
app.get('/api/share', (req, res) => res.json({ share: publicShare(), canManage: isHostRequest(req) }));
app.post('/api/share', hostOnly, (_req, res) => {
  const current = ensureShare();
  res.json({ share: publicShare(), id: current.id });
});
app.post('/api/pick', hostOnly, (req, res) => {
  if (process.platform !== 'win32') return res.status(501).json({ error: 'Location-only picking currently requires Windows.' });
  if (!share) return res.status(409).json({ error: 'Start sharing before adding files.' });
  try {
    const mode = req.body?.mode === 'folder' ? 'folder' : 'files';
    const script = mode === 'folder'
      ? `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder to share'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $p = Get-ChildItem -LiteralPath $d.SelectedPath -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }; ConvertTo-Json -InputObject @{ root = $d.SelectedPath; paths = @($p) } -Compress } else { '{\"root\":\"\",\"paths\":[]}' }`
      : `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Choose files to share'; $d.Multiselect = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ConvertTo-Json -InputObject @{ root = ''; paths = @($d.FileNames) } -Compress } else { '{\"root\":\"\",\"paths\":[]}' }`;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false, maxBuffer: 16 * 1024 * 1024 }).trim();
    const result = JSON.parse(output || '{"root":"","paths":[]}');
    const paths = Array.isArray(result.paths) ? result.paths : [result.paths].filter(Boolean);
    const additions = paths.flatMap((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return [];
        const name = mode === 'folder' ? path.relative(result.root, filePath) : path.basename(filePath);
        return [{ id: crypto.randomUUID(), name: name.replaceAll('\\', '/'), size: stat.size, type: 'application/octet-stream', path: filePath }];
      } catch { return []; }
    });
    share.files.push(...additions);
    persistShare();
    res.json({ share: publicShare(), added: additions.length });
  } catch (error) {
    res.status(500).json({ error: `Could not open the Windows picker: ${error.message}` });
  }
});
app.delete('/api/files/:id', hostOnly, (req, res) => {
  if (!share) return res.status(404).json({ error: 'No active share.' });
  const index = share.files.findIndex((file) => file.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'File not found.' });
  share.files.splice(index, 1);
  persistShare();
  res.json({ share: publicShare() });
});
app.put('/api/message', hostOnly, (req, res) => {
  if (!share) return res.status(404).json({ error: 'Start sharing before adding a note.' });
  share.message = String(req.body?.message || '').slice(0, 2000);
  persistShare();
  res.json({ share: publicShare() });
});
app.get('/api/public/:id', (req, res) => {
  if (!share || share.id !== req.params.id) return res.status(404).json({ error: 'This share has ended or the link is incorrect.' });
  res.json({ share: publicShare() });
});
app.get('/api/public/:id/files/:fileId', (req, res) => {
  if (!share || share.id !== req.params.id) return res.status(404).send('This share has ended.');
  const file = share.files.find((item) => item.id === req.params.fileId);
  if (!file || !fs.existsSync(file.path)) return res.status(404).send('File not found.');
  res.download(file.path, path.basename(file.name));
});
app.delete('/api/share', hostOnly, (_req, res) => {
  share = null;
  persistShare();
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message || 'Something went wrong.' });
});

const dist = path.resolve(here, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.listen(port, '0.0.0.0', () => {
  console.log(`nearby server listening on http://0.0.0.0:${port} (LAN: http://${localAddress()}:${port})`);
});
