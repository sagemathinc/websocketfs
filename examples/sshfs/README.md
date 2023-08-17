# DEMO: sshfs over a websocket

This example shows how to use sftp-ws combined with sshfs via
directly controlling a subprocess. It makes it possible to mount remote filesystems accessible through [SFTP over WebSockets](http://sftp.ws/)
(instead of common SFTP over SSH).

**Note:** At the client side, Linux with `sshfs` and Node.js is required.

## Getting started

1. Setup an [SFTP over WebSockets server](https://www.npmjs.com/package/sftp-ws/) at the remote machine (or skip this step and try `wss://nuane.com/sftp`).
2. Install `sshfs` at the client (in Debian/Ubuntu, run `apt-get install sshfs` as root).
3. Type `pnpm install` here to install deps.
4. Mount a remote filesystem to a local directory by running `mkdir -p /tmp/mnt; ./run.js ws://localhost:4001 /tmp/mnt`. Optionally, add `--path=path_name` to specify a remote path if you only wish to mount a part of the remote filesystem.
5. Enjoy the remote filesystem! :-)

## Upstream

See https://github.com/lukaaash/vfs
