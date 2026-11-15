import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const uploadRoot = path.join(os.tmpdir(), 'nearby-shares');
fs.mkdirSync(uploadRoot, { recursive: true });
app.use(express.json({ limit: '1mb' }));

let share = null;
let cleanupTimer = null;
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, share?.directory || uploadRoot),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}-${path.basename(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 30 } });

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
function hostOnly(req, res, next) {
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
  if (normalized === '::1' || normalized.startsWith('127.') || localAddresses.includes(normalized)) return next();
  res.status(403).json({ error: 'Only the computer hosting this share can change it.' });
}
function safeFile(file) {
  return { id: file.id, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
}
function publicShare() {
  if (!share) return null;
  return { id: share.id, files: share.files.map(safeFile), message: share.message, createdAt: share.createdAt };
}
function ensureShare() {
  if (!share) {
    const id = crypto.randomBytes(16).toString('hex');
    const directory = path.join(uploadRoot, id);
    fs.mkdirSync(directory, { recursive: true });
    share = { id, directory, files: [], message: '', createdAt: Date.now() };
  }
  clearTimeout(cleanupTimer);
  return share;
}
function scheduleCleanup() {
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => {
    if (share) fs.rm(share.directory, { recursive: true, force: true }, () => {});
    share = null;
  }, 30 * 60 * 1000);
}

app.get('/api/network', (_req, res) => res.json({ address: localAddress(), devPort: 5173, prodPort: port }));
app.get('/api/share', hostOnly, (_req, res) => res.json({ share: publicShare() }));
app.post('/api/share', hostOnly, (_req, res) => {
  const current = ensureShare();
  res.json({ share: publicShare(), id: current.id });
});
app.post('/api/files', hostOnly, (req, res, next) => {
  if (!share) return res.status(409).json({ error: 'Start sharing before adding files.' });
  upload.array('files', 30)(req, res, (error) => {
    if (error) return next(error);
    for (const file of req.files || []) {
      share.files.push({ id: crypto.randomUUID(), name: file.originalname, size: file.size, type: file.mimetype, path: file.path });
    }
    res.json({ share: publicShare() });
  });
});
app.delete('/api/files/:id', hostOnly, (req, res) => {
  if (!share) return res.status(404).json({ error: 'No active share.' });
  const index = share.files.findIndex((file) => file.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'File not found.' });
  const [file] = share.files.splice(index, 1);
  fs.rm(file.path, { force: true }, () => {});
  res.json({ share: publicShare() });
});
app.put('/api/message', hostOnly, (req, res) => {
  if (!share) return res.status(404).json({ error: 'Start sharing before adding a note.' });
  share.message = String(req.body?.message || '').slice(0, 2000);
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
  res.download(file.path, file.name);
});
app.delete('/api/share', hostOnly, (_req, res) => {
  clearTimeout(cleanupTimer);
  if (share) fs.rm(share.directory, { recursive: true, force: true }, () => {});
  share = null;
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({ error: error.message || 'Something went wrong.' });
});

const dist = path.resolve(here, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.listen(port, '0.0.0.0', () => {
  console.log(`nearby server listening on http://0.0.0.0:${port} (LAN: http://${localAddress()}:${port})`);
});
