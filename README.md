# nearby

A small React app for sending files and a note or link to another device on the same local network. Files are stored temporarily by the computer hosting the share and downloaded directly from it; there is no cloud relay or account.

## Run it

Install dependencies once:

```sh
npm install
```

Start the app for development:

```sh
npm run dev
```

Open `http://localhost:5173` on the computer that has the files. The share link and QR code use that computer’s local IPv4 address on port `5173`. Other devices need to join the same Wi-Fi/network. Keep the terminal and host computer on while people download.

For a production-style local run:

```sh
npm run build
npm start
```

Then open `http://localhost:3000`. The LAN address will use port `3000` instead.

## Sharing and privacy

- Add files, then select **Start sharing**. You can add more files, remove individual files, or add an optional note/link while sharing.
- Share the QR code or address with people you trust on the same network. Anyone who gets the link can open the files while the share is active.
- Only the computer hosting the share can change or stop it. The server prefers a Wi-Fi or Ethernet address when several network adapters are available.
- Select **Stop sharing** to remove the active share and its temporary files. The server keeps one active share at a time.
- Files are written to the operating system’s temporary directory (`nearby-shares`) while the server is running. If the server is stopped unexpectedly, remove that directory from your temp folder if you want to clear leftover files.
- The server accepts up to 30 files per upload, with a 2 GB per-file limit. Browser, disk, router, and firewall limits may be lower. Large files need enough free disk space on the host.
- On Windows, allow Node.js through Windows Defender Firewall for **Private networks** if other devices cannot connect. Avoid sharing on a public or untrusted Wi-Fi network.

The server binds to `0.0.0.0` for local-network access. It does not use TLS or authenticate recipients; the unguessable share URL is the access check, so only share it with the intended people.
