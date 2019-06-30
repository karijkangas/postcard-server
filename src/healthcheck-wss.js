/*
 *
 */
const WebSocket = require('ws');

const message = 'HELLO';

try {
  const ws = new WebSocket(process.argv[2]);

  ws.on('open', function open() {
    ws.send(message);
  });

  ws.on('message', data => {
    ws.close();
    process.exit(data === message ? 0 : 1);
  });
} catch (e) {
  /* */
  process.exit(1);
}
