import express from 'express';
import AsyncPolling from 'async-polling';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import util from 'util';


const port = process.env.PORT || 5573;
const rcloneURL = (process.env.RCLONE_URL || 'http://localhost:5572') + '/core/stats';
let pollInterval = 1;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
let cached = null;

app.get('/', (req, res) => {
  res.send('Hello World');
});

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws, req) => {
  console.log('> Client connected.');

  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.on('message', (msg) => {
    ws.send(msg);
  });

  ws.send(JSON.stringify(cached));
});

wss.on('close', (ws) => {
  console.log('< Client Disconnected.');
});

server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;

  if (pathname === '/stats') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const rcloneAPI = AsyncPolling(end => {
  fetch(rcloneURL, { method: 'POST' }).then(res => res.json()).then(data => {
    const cloned = Object.assign({}, data, { elapsedTime: undefined });
    const previous = Object.assign({}, cached, { elapsedTime: undefined });
    if (!util.isDeepStrictEqual(cloned, previous)) {
      console.log("Got updated info.");
      wss.clients.forEach(socket => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(data));
        }
      });
    }
    cached = data;
    end();
  });
}, pollInterval * 1000);

class Heartbeat {
  wss: any;
  time_interval: number;
  interval: NodeJS.Timeout;

  constructor(wss: any, interval: number) {
    this.wss = wss;
    this.time_interval = interval;
  }

  start() {
    this.interval = setInterval(function ping() {
      wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) {
          console.log('Heartbeat lost');
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping(() => {});
      });
    }, this.time_interval*1000);
  }

  stop() {
    clearInterval(this.interval);
  }
}

server.listen(port, () => {
  rcloneAPI.run();
  const heartbeat = new Heartbeat(wss, 30);
  heartbeat.start();

  console.log(`Server is listening on ${port}`);
});
