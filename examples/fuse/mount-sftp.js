#!/usr/bin/env node

const fuse = require("node-fuse-bindings");
const parse = require("parse-mount-argv");
const SFTP = require("../..");

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
const args = parse(argv.slice(2));
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
