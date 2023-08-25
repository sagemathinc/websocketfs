import { Server as SftpServer } from "websocket-sftp/lib/sftp";
import getPort from "port-get";
import debug from "debug";

const log = debug("websocketfs:serve");

export default async function serve({
  path,
  host = "localhost",
  port,
  noServer,
  options,
}: {
  path: string;
  host?: string;
  port?: number;
  noServer?: boolean;
  options?: any;
}): Promise<{ port?: number; server: SftpServer }> {
  if (port == null && !noServer) {
    // get an available port
    port = await getPort();
  }

  // start SFTP server on localhost
  const server = new SftpServer({
    ...options,
    noServer,
    host,
    port,
    virtualRoot: path,
  });
  if (!noServer) {
    log("Created Sftp server listening on port ", port);
  } else {
    log("Created Sftp websocket server but no http server");
  }

  return { port, server };
}
