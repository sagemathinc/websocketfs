#!/usr/bin/env node

// mkdir -p /tmp/mnt;   ./run.js ws://localhost:4001 /tmp/mnt

var spawn = require("child_process").spawn;
var Url = require("url");
var shell = require("minish");
var SFTP = require("sftp-ws");

var StreamChannel = SFTP.Internals.StreamChannel;
var WebSocketChannelFactory = SFTP.Internals.WebSocketChannelFactory;

// parse arguments with minimist
var args = shell.parse(process.argv);
console.log(args);
var url = args._[2];
var mountpoint = args._[3];
var path = "" + args.path;
path = "";

// handle arguments
if (args.h) {
  console.log("usage: vfs url mountpoint [options]");
  process.exit(1);
} else if (!url) {
  console.log("missing url");

  if (!mountpoint) {
    console.log("see `vfs -h` for usage");
  }

  process.exit(1);
} else if (!mountpoint) {
  console.log("missing mountpoint");
  process.exit(1);
}

// connect and authenticate
url = Url.parse(url);
var factory = new WebSocketChannelFactory();
//var options = { authenticate: authenticate, protocol: "sftp" };
var options = { protocol: "sftp" };
console.log("connecting to %s", url.host);
factory.connect(Url.format(url), options, function (err, remote) {
  if (err) return error(err);

  console.log("connected");

  // spawn `sshfs` in slave mode
  console.log([url.hostname + ":" + path, mountpoint, "-o", "slave"]);
  var child;
  try {
    child = spawn(
      "sshfs",
      [url.hostname + ":" + path, mountpoint, "-o", "slave"],
      { stdio: ["pipe", "pipe", process.stderr] },
    );
  } catch (err) {
    return error(err);
  }
  //console.log("child = ", child);

  var local = new StreamChannel(child.stdout);

  var state = 0;

  local.on("message", function (packet) {
    //     console.log("->", packet.toString());
    remote.send(packet);
  });

  local.on("close", function () {
    remote.close();
  });

  remote.on("message", function (packet) {
    //          console.log("<-", packet.toString());
    child.stdin.write(packet);
  });

  remote.on("close", function () {
    local.close();
  });

  child.on("exit", function (code, signal) {
    console.log("exit", signal);
    process.exit(code);
  });

  console.log("press Ctrl+C to exit");
});

function error(err) {
  console.log(err);
  process.exit(255);
}

// authenticate the client
function authenticate(instructions, queries, callback) {
  if (instructions) shell.write(instructions);

  var credentials = {};
  next();

  function next() {
    var query = queries.shift();

    // no more queries -> pass the credentials to the callback
    if (!query) return callback(credentials);

    // query the user for credentials
    if (query.secret) {
      shell.password(query.prompt, reply);
    } else {
      shell.question(query.prompt, reply);
    }

    function reply(value) {
      credentials[query.name] = value;
      next();
    }
  }
}
