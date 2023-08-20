/*
convertOpenFlags

SFTP supports these flags:

  READ = 0x0001,
  WRITE = 0x0002,
  APPEND = 0x0004,
  CREATE = 0x0008,
  TRUNC = 0x0010,
  EXCL = 0x0020,

The flags that come in from constants are:

> Object.keys(require('fs').constants).filter((x)=>x.startsWith('O_'))
[
  'O_RDONLY',    'O_WRONLY',
  'O_RDWR',      'O_CREAT',
  'O_EXCL',      'O_NOCTTY',
  'O_TRUNC',     'O_APPEND',
  'O_DIRECTORY', 'O_NOATIME',
  'O_NOFOLLOW',  'O_SYNC',
  'O_DSYNC',     'O_DIRECT',
  'O_NONBLOCK'
]

I guess these match up as follows:

READ <--> O_RDONLY
WRITE <--> O_WRONLY
APPEND <--> O_APPEND
CREATE <--> O_CREAT
TRUNC <--> O_TRUNC
EXCL <--> O_EXCL

We ignore everything else.

NOTE that this sort of conversion of flags between different protocols
is very similar (but easier?) to the sort of thing needed in WASI (e.g.,
in CoWasm)...
*/

import { constants } from "fs";
import { SftpOpenFlags } from "../sftp/sftp-enums";

const FLAG_MAP = {
  O_RDONLY: SftpOpenFlags.READ,
  O_WRONLY: SftpOpenFlags.WRITE,
  O_APPEND: SftpOpenFlags.APPEND,
  O_CREATE: SftpOpenFlags.CREATE,
  O_TRUNC: SftpOpenFlags.TRUNC,
  O_EXCL: SftpOpenFlags.EXCL,
} as const;

export function convertOpenFlags(flags: number | string): number | string {
  if (typeof flags == "string") {
    return flags;
  }
  let r = 0;
  for (const systemFlag in FLAG_MAP) {
    if (flags & constants[systemFlag]) {
      r |= FLAG_MAP[systemFlag];
    }
  }
  return r;
}
