import express from 'express';
import AsyncPolling from 'async-polling';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import http from 'http';
import url from 'url';
import util from 'util';
import { performance } from 'perf_hooks';


const testing = false;
const port = process.env.PORT || 5573;
const rcloneURL = (process.env.RCLONE_URL || 'http://localhost:5572') + '/core/stats';
let pollInterval = 1;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
let cached = null;


const testTransfers = [
  {
    name: "[HorribleSubs]Shingeki.no.Kyojin.Season.4.The.Final.Season.E4.Pain.(1080p).mkv",
    size: 937912872,
  },
  {
    name: "[Golumpa]Your.Name.2018.(1080p).mkv",
    size: 14532678327,
  },
];

type Transfer = {
  bytes: number,
  speed: number,
  eta: number,
  name: string,
  percentage: number,
  speedAvg: number,
  size: number,
};

export type RawStatsReport = {
  speed: number,
  bytes: number,
  errors: number,
  fatalError: boolean,
  retryError: boolean,
  checks: number,
  transfers: number,
  deletes: number,
  renames: number,
  transferTime: number,
  elapsedTime: number,
  lastError?: string,
  transferring: Transfer[],
  checking?: string[],
}

type MockTransfer = {
  name: string,
  size: number,
  minSpeed?: number,
  maxSpeed?: number,
  maxAcceleration?: number
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) ) + min;
}

function constrain(value: number, min: number, max: number) {
  if (value < min) {
    return min;
  } else if (value > max) {
    return max;
  } else {
    return value;
  }
}

function mockTransfer(props: MockTransfer) {
  const {
    name,
    size,
    minSpeed = 100,
    maxSpeed = 50000000,
    maxAcceleration = 1000000,
  } = props;

  function* mock() {
    let progress = 0;
    let transferRate = 1000000;
    let acceleration = 0;
    let timeElapsed = 0;
    let speedHistory = [];
    let lastCallTime = performance.now();
    let lastTransfer: Transfer;

    while (progress < size) {
      // calculate time since last call
      let now = performance.now();
      timeElapsed = (now - lastCallTime) / 1000;
      lastCallTime = now;
      speedHistory.push([transferRate, timeElapsed]);

      // if the transfer rate is below 60% of the max, it'll only go up
      let top = 1;
      let bottom = 0.6;
      const range_eccentricity = (value: number, bottom: number, top: number) => {
        // eccentricity of a value in the context of bottom and top
        // eccentricity < 0 means value < bottom, eccentricity > 1 means value > top
        return (value - bottom) * (top / (top - bottom));
      }

      let eccentricity = constrain(range_eccentricity(transferRate/maxSpeed, bottom, top), 0.000001, 1);
      let rand = Math.random() / eccentricity;
      let directionality = Math.round(rand) ? 1 : -1;
      acceleration = randInt(0, maxSpeed / eccentricity) * directionality;
      acceleration = constrain(acceleration, -maxAcceleration, maxAcceleration);
      transferRate = constrain(transferRate + (acceleration * timeElapsed), minSpeed, maxSpeed);
      // console.log(`${name[1]}: ${transferRate}`);
      // console.log(`R: ${transferRate}`);
      // console.log(`E: ${eccentricity}`);
      // console.log(`D: ${directionality}`);
      // console.log(`A: ${acceleration}`);

      // calculate total transferred in interval
      let transferred = Math.round(transferRate * timeElapsed);
      progress = progress + transferred;

      const transfer: Transfer = {
        bytes: constrain(progress, 0, size),
        speed: transferRate,
        eta: constrain(Math.round((size - progress) / transferRate), 0, Infinity),
        name: name,
        percentage: constrain(Math.round((progress / size) * 100), 0, 100),
        speedAvg: Math.round(
          speedHistory.reduce((acc, [speed, time]) => acc + (speed * time), 0)
          / speedHistory.reduce(((acc, [_, time]) => acc + time), 0)
        ) || 0,
        size: size,
      }
      lastTransfer = transfer;
      yield transfer;
    }
    while (true) {
      yield Object.assign({}, lastTransfer, { bytes: size, percentage: 100, speed: 0, eta: 0 });
    }
    return lastTransfer;
  }
  return mock();
}

const mockGenerators = testTransfers.map(mockTransfer);
const mockAPI = AsyncPolling((end: Function) => {
  const transferring: Transfer[] = mockGenerators.map((generator) => generator.next().value);
  const report: RawStatsReport = {
    speed: transferring.reduce((acc, item) => acc + item.speed, 0) / transferring.length,
    bytes: transferring.reduce((acc, item) => acc + item.size, 0),
    errors: 0,
    fatalError: false,
    retryError: false,
    checks: 0,
    transfers: transferring.length,
    deletes: 0,
    renames: 0,
    transferTime: 0,
    elapsedTime: 0,
    transferring: transferring,
  }
  console.log("Got updated info.");
  wss.clients.forEach((socket: WebSocket) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(report));
    }
  });
  cached = report;
  end();
}, pollInterval * 1000);

app.get('/', (req, res) => {
  res.send('Hello World');
});

function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws: WebSocket, req: Request) => {
  console.log('> Client connected.');

  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.on('message', (msg: string) => {
    ws.send(msg);
  });

  if (cached !== null) {
    ws.send(JSON.stringify(cached));
  }
});

wss.on('close', (ws: WebSocket) => {
  console.log('< Client Disconnected.');
});

server.on('upgrade', (request, socket, head) => {
  const baseURL = `http://${request.headers.host}/`;
  const pathname = new url.URL(request.url, baseURL).pathname;

  if (pathname === '/stats') {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const rcloneAPI = AsyncPolling((end: Function) => {
  fetch(rcloneURL, { method: 'POST' }).then((res: Response) => res.json()).then((data: object) => {
    const cloned = Object.assign({}, data, { elapsedTime: undefined });
    const previous = Object.assign({}, cached, { elapsedTime: undefined });
    if (!util.isDeepStrictEqual(cloned, previous)) {
      console.log("Got updated info.");
      wss.clients.forEach((socket: WebSocket) => {
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
      wss.clients.forEach(function each(ws: WebSocket) {
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
  if (testing) {
    mockAPI.run();
  } else {
    rcloneAPI.run();
  }
  const heartbeat = new Heartbeat(wss, 30);
  heartbeat.start();

  console.log(`Server is listening on ${port}`);
});
