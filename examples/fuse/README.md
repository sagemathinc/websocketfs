# fs-fuse

Export any Node.js `fs`-like object as a FUSE filesystem

NOTE: This is based on https://www.npmjs.com/package/fs-fuse which is MIT licensed.

## Node.js `fs` methods

The following `fs` methods' behavior directly maps to corresponding FUSE operations:

`chmod`, `chown`, `fsync`, `ftruncate`, `link`, `mkdir`, `read`, `readdir`,
`readlink`, `rename`, `rmdir`, `symlink`, `truncate`, `unlink`, `write`

Other FUSE operations internally use the following `fs` methods:

| FUSE op               | `fs` methods             |
| --------------------- | ------------------------ |
| _wrapFd_              | `open`, `close`          |
| _getattr_, _fgetattr_ | `stat`, `fstat`, `lstat` |
| _read_                | `createReadStream`       |
| _write_               | `createWriteStream`      |
| _release_             | `close`                  |
| _utimens_             | `futimes`, `utimes`      |

Not all of these fs methods need to be implemented. For example, the file
descriptor ones are not needed if their path based counterparts are implemented,
and viceversa.

## Non standard `FUSE` methods

If available on the `fs` object, the following FUSE compatible methods can be used
too:

`fuse_access`, `create`, `destroy`, `flush`, `fsyncdir`, `getxattr`, `init`,
`listxattr`, `mknod`, `opendir`, `releasedir`, `removexattr`, `setxattr`,
`statfs`

Note that these are FUSE functions and need to have the **EXACT**
signature and behaviour expected by FUSE, which is different from the Node.js `fs` API.
