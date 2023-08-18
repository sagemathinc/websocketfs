/*
Implement a very inefficient version of "bind" over wsftp and a websocket,
for testing and dev purposes only.
*/

import { Server as SftpServer } from "../sftp/sftp";
import getPort from "port-get";
import mount from "./mount";

export default async function bind(source: string, target: string) {
  const port = await startServer(source);
  const remote = `ws://localhost:${port}`;
  await mount({ path: target, remote });
  console.log(`FUSE mounted ${source} to ${target} via websocketfs`);
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
  console.log(`SFTP server listening on port ${port}`);

  return port;
}
