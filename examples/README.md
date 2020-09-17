# SFTP over WebSockets - sample code

Run `npm install` in this directory to install the packages used by the samples.

## Samples

| Example         | Description
|-----------------|-------------------------------------------------------------
|`simple-client`  | simple SFTP/WS client (uses Node.js-style API)
|`promise-client` | simple SFTP/WS client (uses Promise-based API)
|`simple-server`  | simple SFTP/WS server
|`console-client` | command-line interface SFTP/WS client
|`web-benchmark`  | SFTP/WS server with *browser-based* SFTP/WS client benchmark
|`web-client`     | SFTP/WS server with *browser-based* SFTP/WS client

## Building
In order to run examples, first perform the following commands from the
repository root:
```bash
yarn install
./node_modules/.bin/gulp build

cd examples
yarn install
```
