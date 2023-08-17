# websocketfs

Like sshfs, but over a WebSocket and implemented in Typescript

I wish there was something like sshfs, but entirely over a websocket that doesn't use ssh at all. **Amazingly... I just implemented a prototype of exactly this!** Anyway, I'm pretty excited to see this work. I found this [ancient and forgotten project from 8 years ago](https://github.com/lukaaash/vfs/tree/master), then rewrote it to not use sshfs at all and instead use libfuse2 bindings to nodejs. It really is going to be exactly like what provides, except entirely 100% using Typescript \+ a websocket for the transport and fuse bindings, instead of ssh \+ sshfs. This could also "easily" be extended to work in browser \(for WebAssembly\), providing basically "sshfs for the browser". The real work is in [this also ancient forgotten implementation of the entire sftp protocol](https://github.com/lukaaash/sftp-ws) in Typescript from 8 years ago as explained in [this blogpost](https://lukas.pokorny.eu/sftp-over-websockets/). 

Anyway, I so far have a proof of concept of this working, though to get this to be robust, I'll have to clean up and modernize this stuff, add some missing functionality, add more tests, etc. But it has to work. The actual work feels similar to what was involved in building https://cowasm.org/ , but of course much easier, since it's javascript instead of massive amounts of decades old C. Will live here: https://github.com/sagemathinc/websocketfs and https://www.npmjs.com/package/websocketfs


## sftp protocol -- verview

SFTP is a simple remote filesystem protocol misnamed as _SSH File Transfer
Protocol_. This package provides SFTP v3, but layers it on top of WebSockets
instead of SSH. This makes it possible to run an SFTP client without using ssh.

Check out [Lukas's blogpost](https://lukas.pokorny.eu/sftp-over-websockets/) for
some background.

## Installing

To install from [npm](https://www.npmjs.com/package/@cocalc/sftp-ws):

```sh
pnpm install @cocalc/sftp-ws
```

Or use Yarn:

```shell
pnpm add @cocalc/sftp-ws
```

## Using with Webpack in a Browser-based/SPA App

I'm not worried about this right now. See upstream https://github.com/inveniem/sftp-ws if you are.

## API

The SFTP client provides a high\-level API for multi\-file operations, but it also
aims to be compatible with SFTP client in
[ssh2 module](https://github.com/mscdex/ssh2) by Brian White.

Einaros [ws module](https://github.com/einaros/ws) is used to provide WebSockets
connectivity when used with NodeJS (not used in the web-browser-only package).

### Examples

Sample code is available in
[this project's GitHub repository](https://github.com/inveniem/sftp-ws/tree/master/examples).

A stand-alone Browser-based SFTP/WS client is available as well. Check out the
[web client sample](https://github.com/inveniem/sftp-ws/tree/master/examples/web-client)
to see it in action.

### SFTP client - example (Node.js-style API):

```javascript
var SFTP = require("@cocalc/sftp-ws");

// url, credentials and options
var url = "ws://nuane.com/sftp";
var options = { username: "guest", password: "none" };

// connect to the server
var client = new SFTP.Client();
client.connect(url, options, function (err) {
  if (err) {
    // handle error
    console.log("Error: %s", err.message);
    return;
  }

  // display a message
  console.log("Connected to the server.");

  // retrieve directory listing
  client.list(".", function (err, list) {
    if (err) {
      // handle error
      console.log("Error: %s", err.message);
      return;
    }

    // display the listing
    list.forEach(function (item) {
      console.log(item.longname);
    });

    // disconnect
    client.end();
  });
});
```

### SFTP client - example (Promise-based API):

```javascript
var SFTP = require("@cocalc/sftp-ws");

// url, credentials and options
var url = "ws://nuane.com/sftp";
var options = {
  username: "guest",
  password: "none",
  promise: null, // you can supply a custom Promise implementation
};

// connect to the server
var client = new SFTP.Client();
client
  .connect(url, options)
  .then(function () {
    // display a message
    console.log("Connected to %s", url);

    // retrieve directory listing
    return client.list(".");
  })
  .then(function (list) {
    // display the listing
    list.forEach(function (item) {
      console.log(item.longname);
    });
  })
  .catch(function (err) {
    // handle errors
    console.log("Error: %s", err.message);
  })
  .then(function () {
    // disconnect
    client.end();
  });
```

### SFTP client - downloading files

```javascript
// initialize an SFTP client object here

// download all files matching the pattern
// (into the current local directory)
client.download("sftp-ws-*.tgz", ".");
```

### SFTP server - listening for connections:

```javascript
var SFTP = require("@cocalc/sftp-ws");

// start SFTP over WebSockets server
var server = new SFTP.Server({
  port: 3004,
  virtualRoot: ".",
  readOnly: true,
});
```

## Virtual filesystems

This SFTP package is built around the `IFilesystem` interface:

```typescript
interface IFilesystem {
  open(
    path: string,
    flags: string,
    attrs: IStats,
    callback: (err: Error, handle: any) => any
  ): void;
  close(handle: any, callback: (err: Error) => any): void;
  read(
    handle: any,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error, buffer: Buffer, bytesRead: number) => any
  ): void;
  write(
    handle: any,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error) => any
  ): void;
  lstat(path: string, callback: (err: Error, attrs: IStats) => any): void;
  fstat(handle: any, callback: (err: Error, attrs: IStats) => any): void;
  setstat(path: string, attrs: IStats, callback: (err: Error) => any): void;
  fsetstat(handle: any, attrs: IStats, callback: (err: Error) => any): void;
  opendir(path: string, callback: (err: Error, handle: any) => any): void;
  readdir(
    handle: any,
    callback: (err: Error, items: IItem[] | boolean) => any
  ): void;
  unlink(path: string, callback: (err: Error) => any): void;
  mkdir(path: string, attrs: IStats, callback: (err: Error) => any): void;
  rmdir(path: string, callback: (err: Error) => any): void;
  realpath(
    path: string,
    callback: (err: Error, resolvedPath: string) => any
  ): void;
  stat(path: string, callback: (err: Error, attrs: IStats) => any): void;
  rename(
    oldPath: string,
    newPath: string,
    flags: RenameFlags,
    callback: (err: Error) => any
  ): void;
  readlink(
    path: string,
    callback: (err: Error, linkString: string) => any
  ): void;
  symlink(
    oldPath: string,
    newPath: string,
    callback: (err: Error) => any
  ): void;
  link(oldPath: string, newPath: string, callback: (err: Error) => any): void;
}

interface IStats {
  mode?: number;
  uid?: number;
  gid?: number;
  size?: number;
  atime?: Date;
  mtime?: Date;

  isFile?(): boolean;
  isDirectory?(): boolean;
  isSymbolicLink?(): boolean;
}

interface IItem {
  filename: string;
  stats: IStats;

  longname?: string;
  path?: string;
}

const enum RenameFlags {
  OVERWRITE = 1,
  //ATOMIC = 2,
  //NATIVE = 4,
}
```

- The functions of `IFilesystem` interface represent SFTP protocol commands and
  resemble the `fs` module that comes with Node.js.
- The SFTP client object implements this interface (and other useful wrapper
  methods).
- The SFTP server object makes instances of this interface accessible by
  clients.

This package comes with an implementation of 'virtual filesystem' that uses `fs`
to make parts of the local filesystem accessible to SFTP clients. However, you
can easily implement a custom virtual filesystem and use it instead of the
built-in one - just supply an instance of `IFilesystem` to SFTP server's
constructor as `filesystem' option.

## Future

List of things I would like to add soon:

- More powerful API
- More unit tests
- Even more unit tests
- Better documentation
- SFTP/WS to SFTP/SSH proxy

## Contributors

- Guy Elsmore-Paddock at Inveniem
