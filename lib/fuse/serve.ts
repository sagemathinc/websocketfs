import { Server as SftpServer } from "../sftp/sftp";
import getPort from "port-get";
import debug from "debug";

const log = debug("websocketfs:fuse:serve");

export default async function serve({
  path,
  host = "localhost",
  port,
  options,
}: {
  path: string;
  host?: string;
  port?: number;
  options?: any;
}): Promise<{ port: number; server: SftpServer }> {
  if (port == null) {
    // get an available port
    port = await getPort();
  }
  if (port == null) {
    throw Error("bug");
  }

  // start SFTP server on localhost
  const server = new SftpServer({
    ...options,
    host,
    port,
    virtualRoot: path,
  });
  log("SFTP server listening on port ", port);

  return { port, server };
}
