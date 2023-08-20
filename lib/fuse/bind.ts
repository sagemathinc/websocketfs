/*
Implement a inefficient version of "bind" over wsftp and a websocket,
for testing and dev purposes only.
*/

import { Server as SftpServer } from "../sftp/sftp";
import getPort from "port-get";
import mount from "./mount";
import debug from "debug";
import { callback } from "awaiting";

const log = debug("websocketfs:fuse:bind");

export default async function bind(source: string, target: string) {
  const { port, server } = await startServer(source);
  const remote = `ws://localhost:${port}`;
  const { fuse, client } = await mount({ path: target, remote });
  log("mounted websocketfs on localhost:", source, "-->", target);
  return {
    unmount: async () => {
      await callback(fuse.unmount.bind(fuse));
      client.end();
      server.end();
    },
    fuse,
    server,
    client
  };
}

async function startServer(
  virtualRoot: string,
): Promise<{ port: number; server: SftpServer }> {
  // get an available port
  const port = await getPort();

  // start SFTP server on localhost
  const server = new SftpServer({
    host: "localhost",
    port,
    virtualRoot,
  });
  log("SFTP server listening on port ", port);

  return { port, server };
}
