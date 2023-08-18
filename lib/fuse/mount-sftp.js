const fuse = require("node-fuse-bindings");
const SFTP = require("../sftp/sftp");

//////// SERVER

// prepare host and port
var host = "localhost";
var port = process.env.port || 4001;

// start SFTP over WebSockets server
var sftp = new SFTP.Server({
  host: host,
  port: port,
  virtualRoot: ".",
  //readOnly: false,
  //verifyClient: verifyClientCallback, //TODO: add authentication, check origin, etc.
  // log: console, // log to console
});

console.log("SFTP server listening at ws://%s:%s", host, port);


//////// CLIENT

// NOW make the client:

const url = "ws://localhost:4001";

class FS extends SFTP.Client {
  readdir(handle, cb) {
    super.readdir(handle, (err, items) => {
      cb(
        err,
        items?.map((item) => item.filename),
      );
    });
  }
}
const client = new FS();

const argv = process.argv;
if (argv.length < 3) {
  console.error("Usage:", argv[1], "<path>");
  process.exit(1);
}
const path = argv[2];

client.connect(url, {}, function (err) {
  if (err) {
    // handle error
    console.log("Error: %s", err.message);
    return;
  }

  // display a message
  console.log("Connected to %s", url);

  const FsFuse = require(".");

  fuse.mount(path, FsFuse(client), function (error) {
    if (error) console.error(argv[1] + " failed to mount:", error);
  });

  process.on("SIGINT", function () {
    console.log("unmounting");
    fuse.unmount(path, function (error) {
      if (error) {
        console.log(error);
      }
      process.exit();
    });
  });
});
