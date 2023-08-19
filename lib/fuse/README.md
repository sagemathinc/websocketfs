Do this to mount an sftp\-based FUSE filesystem at /tmp/mnt

```sh
cd dist/lib/fuse
mkdir -p /tmp/mnt; fusermount -u /tmp/mnt; node mount-sftp.js /tmp/mnt
```

Then in a different terminal type `ls /tmp/mnt`

Hit control\+c when done.
