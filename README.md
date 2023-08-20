# websocketfs

**websocketfs:** like sshfs, but over a WebSocket and implemented in Typescript

[![Install, build and run tests](https://github.com/sagemathinc/websocketfs/actions/workflows/test-all.yml/badge.svg)](https://github.com/sagemathinc/websocketfs/actions/workflows/test-all.yml)

This project is not done. See [the todo](./TODO.md).

## Quickstart

So far we have only implemented running on localhost.

```sh
~$ git clone https://github.com/sagemathinc/websocketfs
~/websocketfs$ pnpm install && pnpm build && pnpm test
~/websocketfs$ node
Welcome to Node.js v16.20.1.
Type ".help" for more information.
> a = require('./dist/lib/fuse/bind')
> await a.default(process.env.HOME,'/tmp/mnt'); null
```

Then in another terminal, type `ls /tmp/mnt`:

```sh
~/websocketfs$ ls /tmp/mnt
LICENSE    dist      node_modules    tmp
README.md  examples  package.json    tsconfig.json
TODO.md    lib       pnpm-lock.yaml  websocketfs.term
```

You can do `ls -l`, and read and write files.

### A Note about Fuse

FUSE is really weird on MacOS due to security constraints and commercial interests.
I'm developing this for linux. To install or build, you need to have the fuse C library
available:

```sh
sudo apt-get install libfuse-dev
```

Also, you need to be able to use FUSE at all under Linux, e.g., you can't
use FUSE in a Docker container unless you run it with these options:

```
--cap-add SYS_ADMIN --device /dev/fuse
```

The problem that this module will hopefully solve someday is "a FUSE filesystem
implemented in Javascript over websockets that is similar to sshfs in its
underlying wire protocol". It doesn't do anything at all, of course, to make
it easier to use FUSE itself. The goal is to provide a foundation for network mounted
POSIX filesystems that is _served_ and authenticated entirely through a website via HTTP,
without involving ssh at all.

In the context of WebAssembly and WASI, it may of course actually provide a filesystem
without FUSE.

## Background

I wish there was something like sshfs, but entirely over a websocket that doesn't use ssh at all. I found this [ancient and forgotten project from 8 years ago](https://github.com/lukaaash/vfs/tree/master), then rewrote it to not use sshfs at all and instead use libfuse2 bindings to nodejs. It is going to be like what sshfs provides, except entirely 100% using Typescript/Nodejs \+ a websocket for the transport and fuse bindings. This could also be extended to work in browser \(for WebAssembly with WASI\), providing basically "sshfs for the browser". The real work to make this possible is in [this also ancient forgotten implementation of the entire sftp protocol](https://github.com/lukaaash/sftp-ws) in Typescript from 8 years ago, as explained in [this blogpost](https://lukas.pokorny.eu/sftp-over-websockets/).

Anyway, I so far have a proof of concept of this working, though to get this to be robust, I'll have to clean up and modernize this stuff, add some missing functionality, add more tests, etc. The actual work feels similar to what was involved in building https://cowasm.org/ , but easier, since it's javascript instead of massive amounts of decades old C.
