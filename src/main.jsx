import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { ArrowDownToLine, ArrowLeft, Check, CheckCircle2, Clipboard, CloudUpload, File, FileArchive, FileAudio2, FileImage, FileText, FileVideo2, Link2, LoaderCircle, LockKeyhole, MonitorSmartphone, Plus, QrCode, Share2, Trash2, Upload, Wifi, X } from 'lucide-react';
import './style.css';

const formatSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;
const fileIcon = (type = '') => type.startsWith('image/') ? FileImage : type.startsWith('video/') ? FileVideo2 : type.startsWith('audio/') ? FileAudio2 : type.includes('zip') || type.includes('compressed') ? FileArchive : type.includes('text') || type.includes('pdf') ? FileText : File;
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not complete that action.');
  return data;
}

function App() {
  const shareMatch = window.location.pathname.match(/^\/s\/([^/]+)/);
  return shareMatch ? <Recipient id={shareMatch[1]} /> : <Host />;
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Share2 size={18} strokeWidth={2.4} /></span><span>nearby</span></div>;
}
function Header({ recipient = false }) {
  return <header className="topbar"><Brand /><div className="local-tag"><span className="wifi-dot"><Wifi size={14} /></span>{recipient ? 'Shared nearby' : 'Local network'}</div></header>;
}
function FileGlyph({ type }) {
  const Icon = fileIcon(type);
  return <span className="file-glyph"><Icon size={20} strokeWidth={1.8} /></span>;
}

function Host() {
  const [files, setFiles] = useState([]);
  const [pending, setPending] = useState([]);
  const [share, setShare] = useState(null);
  const [address, setAddress] = useState('');
  const [port, setPort] = useState(5173);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState('');
  const inputRef = useRef(null);
  const activeUrl = useMemo(() => share && address ? `http://${address}:${port}/s/${share.id}` : '', [share, address, port]);

  useEffect(() => {
    api('/api/network').then((info) => { setAddress(info.address); setPort(window.location.port === '5173' ? info.devPort : info.prodPort); }).catch(() => {});
    api('/api/share').then(({ share: current }) => {
      if (current) { setShare(current); setFiles(current.files); setMessage(current.message || ''); }
    }).catch(() => {});
  }, []);
  useEffect(() => { if (activeUrl) QRCode.toDataURL(activeUrl, { width: 190, margin: 1, color: { dark: '#182441', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [activeUrl]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2800); return () => clearTimeout(timer); }, [notice]);

  const takeFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    if (share) { void addFiles(incoming); }
    else setPending((current) => [...current, ...incoming]);
  };
  const addFiles = async (incoming) => {
    setBusy(true);
    try {
      const form = new FormData(); incoming.forEach((file) => form.append('files', file));
      const result = await api('/api/files', { method: 'POST', body: form });
      setFiles(result.share.files); setShare(result.share); setNotice(incoming.length > 1 ? 'Files added to your share' : 'File added to your share');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true);
    try {
      const result = await api('/api/share', { method: 'POST' });
      setShare(result.share); setFiles(result.share.files);
      if (pending.length) {
        const form = new FormData(); pending.forEach((file) => form.append('files', file));
        const uploaded = await api('/api/files', { method: 'POST', body: form });
        setFiles(uploaded.share.files); setShare(uploaded.share); setPending([]);
      }
      if (message.trim()) {
        const noted = await api('/api/message', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
        setShare(noted.share);
      }
      setNotice('Your share is ready');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const removePending = (index) => setPending((items) => items.filter((_, i) => i !== index));
  const removeFile = async (id) => {
    try { const result = await api(`/api/files/${id}`, { method: 'DELETE' }); setFiles(result.share.files); setShare(result.share); }
    catch (error) { setNotice(error.message); }
  };
  const downloadFile = (file) => {
    const link = document.createElement('a');
    link.download = file.name;
    if (share) {
      link.href = `/api/public/${share.id}/files/${file.id}`;
    } else {
      link.href = URL.createObjectURL(file);
      window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const saveMessage = async () => {
    if (!share) { setNotice('Start sharing first to include a message'); return; }
    try { const result = await api('/api/message', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }); setShare(result.share); setNotice('Message saved'); }
    catch (error) { setNotice(error.message); }
  };
  const stop = async () => {
    setBusy(true);
    try { await api('/api/share', { method: 'DELETE' }); setShare(null); setFiles([]); setPending([]); setMessage(''); setQr(''); setNotice('Sharing stopped. Your files were cleared.'); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(activeUrl); setNotice('Share link copied'); }
    catch { setNotice(activeUrl); }
  };
  const allFiles = share ? files : pending;

  return <div className="app-shell" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={(e) => { e.preventDefault(); setDragging(false); takeFiles(e.dataTransfer.files); }}>
    <Header />
    <main className="host-layout">
      <section className="main-column">
        <div className="intro"><span className="eyebrow"><span className="eyebrow-line" /> SEND IT CLOSE BY</span><h1>Good things are<br /><em>better shared.</em></h1><p>Send files to people on the same Wi-Fi. No accounts, no cloud, just nearby.</p></div>
        <section className={`dropzone ${dragging ? 'is-dragging' : ''}`} aria-label="Add files" onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => { takeFiles(e.target.files); e.target.value = ''; }} />
          <span className="upload-icon"><CloudUpload size={24} /></span>
          <div className="drop-copy"><strong>Drop files here</strong><span>or browse from your device</span></div>
          <button className="outline-button" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}><Plus size={17} /> Choose files</button>
          <small>Up to 2 GB per file · stays on your local network</small>
        </section>

        <section className="file-section">
          <div className="section-heading"><div><span className="eyebrow muted">YOUR SHARE</span><h2>Files <span className="count">{allFiles.length}</span></h2></div>{share && <button className="text-button" onClick={() => inputRef.current?.click()}><Plus size={16} /> Add more</button>}</div>
          {allFiles.length === 0 ? <div className="empty-files"><span className="empty-icon"><Upload size={19} /></span><div><strong>Your files will show up here</strong><p>Pick a few things to get started.</p></div></div> : <ul className="file-list">{allFiles.map((file, index) => <li className="file-row" key={file.id || `${file.name}-${index}`}><FileGlyph type={file.type} /><div className="file-meta"><strong title={file.name}>{file.name}</strong><span>{formatSize(file.size)}</span></div><button className="icon-button download-control" type="button" aria-label={`Download ${file.name}`} title="Download file" onClick={() => downloadFile(file)}><ArrowDownToLine size={17} /></button><button className="icon-button" type="button" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => share ? removeFile(file.id) : removePending(index)}><X size={17} /></button></li>)}</ul>}
          {!share && <button className="primary-button start-button" disabled={busy} onClick={start}>{busy ? <LoaderCircle size={18} className="spin" /> : <Share2 size={18} />}{busy ? 'Getting things ready…' : 'Start sharing'}<span className="button-arrow">→</span></button>}
        </section>

        <section className="message-panel"><div className="message-icon"><Link2 size={18} /></div><div className="message-body"><div className="message-title"><div><strong>Add a note or link</strong><span>A little context makes sharing nicer.</span></div><span className="optional">OPTIONAL</span></div><textarea value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Here are the photos from today… or paste a link" rows={2} /><div className="message-actions"><span>{message.length}/2000</span><button className="text-button" onClick={saveMessage} disabled={!message.trim() && !share?.message}><Check size={15} /> Save note</button></div></div></section>
        <div className="reassurance"><LockKeyhole size={14} /><span>Only people with your link can open this share. Stop it any time.</span></div>
      </section>

      <aside className="share-column">
        {share ? <div className="share-card active-card">
          <div className="share-card-top"><span className="live-pill"><i /> LIVE NOW</span><button className="stop-button" onClick={stop} disabled={busy}><X size={15} /> Stop sharing</button></div>
          <div className="share-card-title"><h2>Ready when<br />they are.</h2><p>Ask them to scan this code<br />with their phone camera.</p></div>
          <div className="qr-wrap">{qr ? <img src={qr} alt="QR code for your share link" /> : <div className="qr-placeholder"><QrCode size={28} /></div>}<span className="qr-corner corner-a"/><span className="qr-corner corner-b"/><span className="qr-corner corner-c"/><span className="qr-corner corner-d"/></div>
          <div className="link-box"><span>{activeUrl.replace('http://', '')}</span><button aria-label="Copy share link" onClick={copyLink}><Clipboard size={17} /></button></div>
          <button className="copy-button" onClick={copyLink}><Clipboard size={16} /> Copy share link</button>
          <div className="online-note"><CheckCircle2 size={16} /> Anyone on your Wi-Fi can open it</div>
        </div> : <div className="share-card waiting-card">
          <div className="waiting-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="phone phone-back"><span/></span><span className="phone phone-front"><span/></span><span className="spark spark-one">✳</span><span className="spark spark-two">✳</span><span className="art-dot"/></div>
          <div className="waiting-text"><span className="eyebrow muted">A LITTLE CLOSER</span><h2>Your people,<br />one scan away.</h2><p>When you start sharing, your private QR code and link will appear right here.</p></div>
          <div className="steps"><div><span>1</span><p>Add your files</p></div><i/><div><span>2</span><p>Start sharing</p></div><i/><div><span>3</span><p>Share the link</p></div></div>
        </div>}
        <div className="same-network"><span className="same-icon"><MonitorSmartphone size={18} /></span><p><strong>Keep it on the same network</strong><br />The other device needs to be connected to the same Wi-Fi as you.</p></div>
        <div className="local-footer"><span><span className="local-light" /> Your files stay local</span><span>Private by design</span></div>
      </aside>
    </main>
    <footer className="page-footer"><span>nearby <span className="footer-dot">•</span> Share close by</span><span>Made for the moments right next to you.</span></footer>
    {dragging && <div className="drag-overlay"><div><CloudUpload size={38} /><strong>Drop them here</strong></div></div>}
    {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>;
}

function Recipient({ id }) {
  const [share, setShare] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/api/public/${id}`).then(({ share: data }) => setShare(data)).catch((e) => setError(e.message)); }, [id]);
  return <div className="recipient-shell"><Header recipient /><main className="recipient-main">
    <a className="back-link" href="/"><ArrowLeft size={15} /> Share something of your own</a>
    {error ? <section className="recipient-error"><span className="error-mark"><X size={20} /></span><h1>This share is no longer here.</h1><p>{error}</p><a className="primary-button" href="/">Go to nearby <span className="button-arrow">→</span></a></section> : !share ? <section className="recipient-loading"><LoaderCircle className="spin" size={22} /> Finding your files…</section> : <>
      <div className="recipient-heading"><span className="eyebrow"><span className="eyebrow-line" /> SHARED WITH YOU</span><h1>Something good,<br /><em>from nearby.</em></h1><p>Grab what you need. Files are ready to download.</p></div>
      <section className="recipient-card">
        <div className="recipient-card-head"><span><span className="local-light" /> AVAILABLE ON THIS NETWORK</span><span>{share.files.length} {share.files.length === 1 ? 'file' : 'files'}</span></div>
        {share.message && <div className="shared-note"><span className="message-icon"><Link2 size={17} /></span><p>{/^https?:\/\//i.test(share.message.trim()) ? <a href={share.message.trim()} target="_blank" rel="noreferrer">{share.message.trim()}</a> : share.message}</p></div>}
        {share.files.length ? <ul className="recipient-list">{share.files.map((file) => <li className="recipient-file" key={file.id}><FileGlyph type={file.type} /><div className="file-meta"><strong title={file.name}>{file.name}</strong><span>{formatSize(file.size)}</span></div><a className="download-button" href={`/api/public/${id}/files/${file.id}`}><ArrowDownToLine size={17} /><span>Download</span></a></li>)}</ul> : <div className="recipient-empty"><span className="empty-icon"><File size={20} /></span><strong>Files are on their way</strong><p>Check back in a moment.</p></div>}
        <div className="recipient-foot"><LockKeyhole size={14} /> Files are shared directly on your local network.</div>
      </section>
      <div className="recipient-tip"><Wifi size={16} /><span>Having trouble? Make sure you’re on the same Wi-Fi as the person sharing.</span></div>
    </>}
  </main><footer className="page-footer recipient-footer"><span>nearby <span className="footer-dot">•</span> Share close by</span><span>No account needed.</span></footer></div>;
}

createRoot(document.getElementById('root')).render(<App />);
