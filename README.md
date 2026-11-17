# nearby

A small React app for sending files and a note or link to another device on the same local network. The host saves only original file locations; file contents are read and streamed directly from those locations when recipients download them. There is no cloud relay or account.

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

- On Windows, choose files or a folder using the host computer's native picker. The app saves the selected paths and file details, not file contents. Folder selection adds its files recursively.
- The host computer and Nearby server must remain on, and the original files must remain at the selected locations, while recipients download them.
- Add an optional note/link while sharing. You can add more files or remove entries from the share at any time.
- Share the QR code or address with people you trust on the same network. Anyone who gets the link can open the files while the share is active.
- Only the computer hosting the share can change or stop it. The server prefers a Wi-Fi or Ethernet address when several network adapters are available.
- Select **Stop sharing** to clear the active share and its saved locations. This does not delete or move the original files. The server keeps one active share at a time.
- Share metadata and original paths are stored in `server/data/active-share.json` on the host computer. They remain available after a browser reload or server restart.
- The app no longer creates file-content copies on the host. Old copies from earlier versions in `server/data/shares/` are removed when the new server starts.
- On Windows, allow Node.js through Windows Defender Firewall for **Private networks** if other devices cannot connect. Avoid sharing on a public or untrusted Wi-Fi network.

The server binds to `0.0.0.0` for local-network access. It does not use TLS or authenticate recipients; the unguessable share URL is the access check, so only share it with the intended people.
