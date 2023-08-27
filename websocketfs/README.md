# websocketfs

**websocketfs:** like sshfs, but over a WebSocket and implemented in Typescript

[![Install, build and run tests](https://github.com/sagemathinc/websocketfs/actions/workflows/test-all.yml/badge.svg)](https://github.com/sagemathinc/websocketfs/actions/workflows/test-all.yml)

## Status

This project is mostly finished. See [the todo](./TODO.md).  All the main functionality and unit testing is done, and the code is in pretty good modern shape.  We are mainly thinking about ways to enable caching that go beyond what sshfs does, in order to provide better speed for certain applications.

## Quickstart

You can try this out on localhost very easily as illustrated below.  

From NPM

```sh
pnpm install websocketfs
require('websocketfs').serve({path, port, host})

# then somewhere else:

require('websocketfs').mount({path, remote:'ws://host:port'})

```

You can also run a script to do bind on localhost as a demo:

```sh
/tmp$ mkdir zz; cd zz
/tmp/zz$ pnpm init
/tmp/zz$ pnpm install websocketfs
/tmp/zz$ mkdir /tmp/mnt
/tmp/zz$ pnpm exec websocketfs-bind $HOME /tmp/mnt
... (hit control+c when done)
```

and in another terminal:

```sh
/tmp$ cd /tmp/mnt
/tmp/mnt$ ls
...
```

## Try building and bind mounting using the source code from github

```sh
~$ git clone https://github.com/sagemathinc/websocketfs
~/websocketfs$ pnpm install && pnpm build && pnpm test
...
~/websocketfs$ node
Welcome to Node.js v16.20.1.
Type ".help" for more information.
> // serve HOME and mount it at /tmp/mnt all over websocketfs
> await require('./websocketfs').bind(process.env.HOME,'/tmp/mnt'); null
```

Then in another terminal, type `ls /tmp/mnt`:

```sh
~/websocketfs$ ls /tmp/mnt
LICENSE    dist      node_modules    tmp
README.md  examples  package.json    tsconfig.json
TODO.md    lib       pnpm-lock.yaml  websocketfs.term
```

You can do `ls -l`, and read and write files, etc.

### Cacheing

Stat, directory listing, and link caching is on by default with a timeout of 20 seconds. This is the same as sshfs.  To disable it:

```sh
z = await require('.').bind(process.env.HOME, '/tmp/mnt', {cacheTimeout:0});
```

You can set cacheTimeout to a value in seconds, or 0 to disable.  You can also explicitly set cacheStatTimeout, cacheDirTimeout, and cacheLinkTimeout, just like with sshfs.

## Nodejs 20 Support

Do NOT try to run both the client and server in the same nodejs
process, since [it will deadlock](https://github.com/sagemathinc/websocketfs/issues/1).
This is not something you would want to do except maybe for
unit testing.

### Building Fuse

To install or build, you need to have the fuse C library
available:

```sh
sudo apt-get install libfuse-dev
```

Also, you need to be able to use FUSE at all under Linux, e.g., you can't
use FUSE in a Docker container unless you create the Docker container with these options:

```
--cap-add SYS_ADMIN --device /dev/fuse
```

The problem that this module will hopefully solve someday is "a FUSE filesystem
implemented in Javascript over websockets that is similar to sshfs in its
underlying wire protocol". It doesn't do anything at all, of course, to make
it easier to use FUSE itself. The goal is to provide a foundation for network mounted
read/write POSIX filesystems that is _served_ entirely through a website via HTTP,
without involving ssh at all.

In the context of WebAssembly and WASI, it may of course actually provide a filesystem
without FUSE.

**MacOS?:** I don't know if it will work or not. FUSE is weird on MacOS due to security constraints and commercial interests.
_I'm developing this for Linux._

### Installing just the sftp protocol

You can install the module `websocket-sftp` alone, which doesn't depend
on fuse-native, and provides the client and server for communicating over
sftp, but not the FUSE bindings.