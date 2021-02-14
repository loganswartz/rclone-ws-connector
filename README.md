# rclone-ws-connector
Expose an Rclone HTTP API endpoint as a Websocket endpoint.

## Purpose
I made this as a connector between my Rclone instance and my
[rclone-web-progress](https://github.com/loganswartz/rclone-web-progress)
project so that the web interface didn't need to constantly poll the backend.

## Usage
```bash
~ $ git clone https://github.com/loganswartz/rclone-ws-connector && cd rclone-ws-connector
~/rclone-ws-connector $ RCLONE_URL="http://localhost:5572" npm start
```
To build a production version, run `npm build`.
