import * as SFTP from "../sftp";
import getPort from "port-get";
import { callback } from "awaiting";

let port;

async function startServer(): Promise<SFTP.Server> {
  port = await getPort();
  const server = new SFTP.Server({
    port,
    virtualRoot: "/this-directory-should-not-exist/another-one",
  });

  return server;
}

async function startClient() {
  const client = new SFTP.Client();
  await callback(client.connect.bind(client), `ws://localhost:${port}`);
  return client;
}

let server;
beforeAll(async () => {
  server = await startServer();
});

describe("Server Tests", () => {
  it("tests creating a server with a bad root directory", async () => {
    await expect(startClient()).rejects.toThrow("Unable to access file system");
    server.end();
  });
});
