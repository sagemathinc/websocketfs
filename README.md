# websocketfs

I wish there was something like sshfs, but entirely over a websocket that doesn't use ssh at all. I found this [ancient and forgotten project from 8 years ago](https://github.com/lukaaash/vfs/tree/master), then rewrote it to not use sshfs at all and instead use libfuse2 bindings to nodejs. It is going to be like what sshfs provides, except entirely 100% using Typescript/Nodejs \+ a websocket for the transport and fuse bindings. This could also be extended to work in browser \(for WebAssembly with WASI\), providing basically "sshfs for the browser". The real work to make this possible is in [this also ancient forgotten implementation of the entire sftp protocol](https://github.com/lukaaash/sftp-ws) in Typescript from 8 years ago, as explained in [this blogpost](https://lukas.pokorny.eu/sftp-over-websockets/).

**I modernized and rewrote everything, and this now exists!**

## Packages

- [websocket\-sftp: The sftp protocol, over a WebSocket](./websocket-sftp)

- [websocketfs: Like sshfs, but over a WebSocket](./websocketfs)

To try this out, check out the readme for the websocketfs package.
