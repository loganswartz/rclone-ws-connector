# rclone-ws-connector
Expose an Rclone HTTP API endpoint as a Websocket endpoint.

## Purpose
I made this as a connector between my Rclone instance and my
[rclone-web-progress](https://github.com/loganswartz/rclone-web-progress)
project so that the web interface didn't need to constantly poll the backend.

## Usage
```bash
~ $ git clone https://github.com/loganswartz/rclone-ws-connector && cd rclone-ws-connector
~/rclone-ws-connector $ npm install
~/rclone-ws-connector $ RCLONE_URL="http://localhost:5572" npm start
```
To build a production version, run `npm run build`, and then run the compiled
version with `node dist/app.js`.

## Installation as a service
Link the service file into your systemd service folder (typically
`/etc/systemd/system/`) by running `sudo ln -s
/path/to/rclone-ws-connector/rclone-ws-connector.service /etc/systemd/system/`.
Then, create an override for the service file like so:
```bash
~ $ sudo mkdir /etc/systemd/system/rclone-ws-connector.service.d
~ $ sudo nvim /etc/systemd/system/rclone-ws-connector.service.d/override.conf
```
(if you don't know how to use vim / neovim, substitute `nvim` for `nano`.)
Then, paste the following into that file, and save it:
```
[Service]
Environment="RCLONE_URL=<URL or IP + Port of your Rclone API>"
```
Reload the systemctl daemon with `sudo systemctl daemon-reload` and then start
the service with `sudo systemctl start rclone-ws-connector`.
