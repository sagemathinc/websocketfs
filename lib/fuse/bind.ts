/*
Implement a very inefficient version of "bind" over wsftp and a websocket,
for testing and dev purposes only.
*/

import { Server as SftpServer } from "../sftp/sftp";
import getPort from "port-get";
import mount from "./mount";
import debug from "debug";

const log = debug("websocketfs:fuse:bind");

export default async function bind(source: string, target: string) {
  const port = await startServer(source);
  const remote = `ws://localhost:${port}`;
  const fuse = await mount({ path: target, remote });
  log("FUSE mounted websocketfs", { source, target });
  return fuse;
}

async function startServer(virtualRoot: string): Promise<number> {
  // get an available port
  const port = await getPort();

  // start SFTP server on localhost
  new SftpServer({
    host: "localhost",
    port,
    virtualRoot,
  });
  log("SFTP server listening on port ", port);

  return port;
}
