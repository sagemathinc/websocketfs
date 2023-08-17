import assert = require("assert");
import SFTP = require("../lib/sftp");
import getPort = require("get-port");

let port;

async function startServer(): Promise<SFTP.Server> {
  port = await getPort();
  var server = new SFTP.Server({
    port,
    virtualRoot: "/this-directory-should-not-exist/another-one",
  });

  return server;
}

function startClient(): SFTP.Client {
  var client = new SFTP.Client();
  client.connect(`sws://localhost:${port}`);
  return client;
}

let server;
beforeAll(async () => {
  server = await startServer();
});

describe("Server Tests", () => {
  it("bad_root", (done) => {
    var client = startClient();

    client.on("ready", () => {
      done(new Error("Connection attempt should fail"));
      server.end();
    });

    client.on("error", (err) => {
      try {
        assert.equal(err.message, "Unable to access file system");
        done();
      } catch (err) {
        done(err);
      }
      server.end();
    });
  });
});
