// HTTPS in front of `next dev`, so a phone on the same Wi-Fi can open /camera
// (browsers only allow camera access over HTTPS). Uses a self-signed cert in .certs/.
//   npm run dev        (in one terminal)
//   npm run dev:phone  (in another), then open https://<this-pc-ip>:3443/camera on the phone

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'

const TARGET_PORT = 3000
const PORT = 3443
const lanIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => a.address)

if (!fs.existsSync('.certs/key.pem')) {
  fs.mkdirSync('.certs', { recursive: true })
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps.map((ip) => `IP:${ip}`)].join(',')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
    '-keyout', '.certs/key.pem', '-out', '.certs/cert.pem',
    '-subj', '/CN=threshold-dev', '-addext', `subjectAltName=${san}`,
  ])
}

const server = https.createServer({ key: fs.readFileSync('.certs/key.pem'), cert: fs.readFileSync('.certs/cert.pem') }, (req, res) => {
  const upstream = http.request(
    { host: '127.0.0.1', port: TARGET_PORT, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Threshold is not running on port 3000. Start it with `npm run dev`.')
  })
  req.pipe(upstream)
})

// Pass websockets (hot reload) straight through.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET_PORT, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
    up.write(head)
    socket.pipe(up).pipe(socket)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(PORT, '0.0.0.0', () => {
  for (const ip of lanIps) console.log(`Phone camera: https://${ip}:${PORT}/camera`)
})
