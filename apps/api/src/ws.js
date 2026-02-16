import crypto from 'node:crypto';

function sha1Base64(s) {
  return crypto.createHash('sha1').update(s).digest('base64');
}

function makeAcceptKey(secKey) {
  // WebSocket protocol magic GUID
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return sha1Base64(`${secKey}${GUID}`);
}

function encodeTextFrame(text) {
  const payload = Buffer.from(String(text ?? ''), 'utf8');
  const len = payload.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), payload]);
  }
  if (len < 65536) {
    const header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
    return Buffer.concat([header, payload]);
  }
  // Large payloads are not expected for realtime events; truncate.
  const truncated = payload.subarray(0, 65535);
  const header = Buffer.from([0x81, 126, 0xff, 0xff]);
  return Buffer.concat([header, truncated]);
}

export function acceptWebSocketUpgrade({ req, socket, head }) {
  const key = req.headers['sec-websocket-key'];
  if (!key || typeof key !== 'string') return false;
  const accept = makeAcceptKey(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`
  ];
  socket.write(headers.join('\r\n') + '\r\n\r\n');
  if (head && head.length) socket.unshift(head);
  return true;
}

export function createWsConnection({ socket, onClose }) {
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    try {
      socket.end();
    } catch {}
    onClose?.();
  }

  socket.on('error', close);
  socket.on('end', close);
  socket.on('close', close);

  return {
    sendJson(obj) {
      if (closed) return;
      const buf = encodeTextFrame(JSON.stringify(obj ?? null));
      socket.write(buf);
    },
    close
  };
}

