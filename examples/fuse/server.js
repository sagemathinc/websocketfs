#!/usr/bin/env node

const fuse = require("node-fuse-bindings");
const parse = require("parse-mount-argv");

const FsFuse = require(".");

const argv = process.argv;
if (argv.length < 3) {
  console.error("Usage:", argv[1], "<path>");
  process.exit(1);
}

const args = parse(argv.slice(2));
const path = argv[2];
const fs = require("fs");

fuse.mount(path, FsFuse(fs), function (error) {
  if (error) console.error(argv[1] + " failed to mount:", error);
});

process.on("SIGINT", function () {
  console.log("unmounting")
  fuse.unmount(path, function (error) {
    if (error) {
      console.log(error);
    }
    process.exit();
  });
});
