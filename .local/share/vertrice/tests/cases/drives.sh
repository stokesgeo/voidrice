# mounter and unmounter. The mock machine (see mock/disklabel): sd0 is the
# internal SSD, a softraid chunk in use; sd1 is the encrypted system volume
# on it; sd2 is a USB stick with one FAT partition; cd0 is empty. Both
# scripts need a terminal on stdin (else they reopen themselves in one),
# so they run under with_tty. doas runs only mocks, never real commands.

stick="💾sd2i (28.9G SanDisk 3.2Gen1) MSDOS"

# add_partition DISK LINE: the default label of DISK plus one partition.
add_partition() {
	disklabel "$1" >"$VT_STATE/disklabel.$1.new"
	printf '%s\n' "$2" >>"$VT_STATE/disklabel.$1.new"
	mv "$VT_STATE/disklabel.$1.new" "$VT_STATE/disklabel.$1"
}

t_mounter_fat() {
	mkdir "$T/mnt"
	answers "$stick" "$T/mnt"
	with_tty mounter
	eq "offered: the stick only" "$stick" "$(cat "$VT_STATE/menu.1")"
	eq "where: /mnt/sd2i first" /mnt/sd2i "$(sed -n 1p "$VT_STATE/menu.2")"
	logged '^doas true$'
	logged '^doas mount 7b3d0e9f1a2c5b84\.i$'
	u=$(id -u) g=$(id -g)
	logged "^mount_msdos -o nosuid,nodev -u $u -g $g /dev/sd2i $T/mnt\$"
	logged "^notify-send 💾 Drive mounted\. sd2i mounted to $T/mnt\.\$"
	notlogged '^(mount\.exfat|ntfs-3g)'
}

t_mounter_fstab() {
	echo 7b3d0e9f1a2c5b84.i >"$VT_STATE/fstab"
	answers "$stick"
	with_tty mounter
	logged '^notify-send 💾 Drive mounted\. sd2i mounted from fstab\.$'
	eq "no second question" 1 "$(cat "$VT_STATE/dmenu.n")"
	notlogged '^mount_msdos'
}

t_mounter_exfat_fallback() {
	mkdir "$T/mnt"
	echo 1 >"$VT_STATE/rc.mount_msdos"
	answers "$stick" "$T/mnt"
	with_tty mounter
	u=$(id -u) g=$(id -g)
	logged "^mount\.exfat -o allow_other,uid=$u,gid=$g,nosuid,nodev /dev/sd2i $T/mnt\$"
	notlogged '^ntfs-3g'
	logged '^notify-send 💾 Drive mounted\.'
}

t_mounter_create_dir() {
	answers "$stick" "$T/new" Yes
	with_tty mounter
	[ -d "$T/new" ] || fail "mount point not created"
	logged "^mount_msdos .* /dev/sd2i $T/new\$"
	answers "$stick" "$T/new2" No
	rm -f "$VT_STATE/dmenu.n"; : >"$VT_STATE/log"
	with_tty mounter
	[ -d "$T/new2" ] && fail "created after No"
	notlogged '^mount_msdos'
}

t_mounter_softraid() {
	add_partition sd2 "  a:            28.9G               64    RAID"
	echo sd3:5e6f7a8b9c0d1e2f >"$VT_STATE/bioctl.new"
	fx disklabel.sd3 <<'EOF'
label: SR CRYPTO
duid: 5e6f7a8b9c0d1e2f
16 partitions:
#                size           offset  fstype [fsize bsize   cpg]
  a:            28.8G               64  4.2BSD   2048 16384 12960
  c:            28.8G                0  unused
EOF
	crypt="🔒sd2a (28.9G SanDisk 3.2Gen1) CRYPTO"
	mkdir "$T/mnt"
	answers "$crypt" "$T/mnt"
	with_tty mounter
	has "offered: the locked volume" "$crypt" "$(cat "$VT_STATE/menu.1")"
	logged '^doas bioctl -c C -l /dev/sd2a softraid0$'
	logged '^notify-send 🔓 Decrypted\. sd3 unlocked\.$'
	logged '^doas mount 5e6f7a8b9c0d1e2f\.a$'
	logged "^mount -o nosuid,nodev /dev/sd3a $T/mnt\$"
	logged "^notify-send 💾 Drive mounted\. sd3a mounted to $T/mnt\.\$"
}

t_mounter_softraid_two_partitions() {
	add_partition sd2 "  a:            28.9G               64    RAID"
	echo sd3:5e6f7a8b9c0d1e2f >"$VT_STATE/bioctl.new"
	fx disklabel.sd3 <<'EOF'
label: SR CRYPTO
  a:            8.0G               64  4.2BSD   2048 16384 12960
  c:            28.8G                0  unused
  d:            20.8G         16777280  MSDOS
EOF
	mkdir "$T/mnt"
	answers "🔒sd2a (28.9G SanDisk 3.2Gen1) CRYPTO" "sd3d 20.8G MSDOS SR CRYPTO" "$T/mnt"
	with_tty mounter
	eq "which partition" "sd3a 8.0G 4.2BSD SR CRYPTO
sd3d 20.8G MSDOS SR CRYPTO" "$(cat "$VT_STATE/menu.2")"
	logged "^mount_msdos .* /dev/sd3d $T/mnt\$"
}

t_mounter_wrong_passphrase() {
	add_partition sd2 "  a:            28.9G               64    RAID"
	echo 1 >"$VT_STATE/rc.bioctl-unlock"
	answers "🔒sd2a (28.9G SanDisk 3.2Gen1) CRYPTO" "$T"
	with_tty mounter
	notlogged '^(mount|mount_msdos) '
	notlogged 'Decrypted'
}

t_mounter_typed_input() {
	# dmenu lets you type anything; only a line it offered is accepted.
	answers "💾sd9z (1G typed) MSDOS" "$T"
	with_tty mounter
	eq "one question only" 1 "$(cat "$VT_STATE/dmenu.n")"
	notlogged '^(mount|mount_msdos|mount\.exfat|ntfs-3g|doas mount)'
	answers "$stick x" "$T"
	rm -f "$VT_STATE/dmenu.n"
	with_tty mounter
	notlogged '^mount_msdos'
}

t_mounter_label_injection() {
	# The disklabel "label:" is 16 bytes the stick's maker chose. A written
	# "\n" there must not become a menu line naming the system disk's
	# unmounted partition sd1j; control characters are dropped.
	add_partition sd1 "  j:             2.0G        900000000  4.2BSD   2048 16384 12960"
	esc=$(printf '\033')
	fx disklabel.sd2 <<EOF
label: x\nsd1j 2G 4.2BSD$esc
duid: 7b3d0e9f1a2c5b84
16 partitions:
  c:            28.9G                0  unused
  i:            28.9G               64   MSDOS
EOF
	# A phone names itself too.
	printf '%s\n' '1: P\n💾sd1j 2G 4.2BSD' >"$VT_STATE/phones"
	answers
	with_tty mounter
	m=$(cat "$VT_STATE/menu.1")
	eq "two lines, the phone and the stick" 2 "$(printf '%s\n' "$m" | wc -l | tr -d ' ')"
	case $m in "💾sd1j"*|*"
💾sd1j"*) fail "a menu line starts with 💾sd1j: $m" ;; esac
	hasnt "no escape character" "$esc" "$m"
	has "stick still offered" "💾sd2i (28.9G " "$m"
}

t_mounter_softraid_typed_partition() {
	# The second question (which partition of the unlocked volume) takes
	# only a line it offered, like the first.
	add_partition sd2 "  a:            28.9G               64    RAID"
	echo sd3:5e6f7a8b9c0d1e2f >"$VT_STATE/bioctl.new"
	fx disklabel.sd3 <<'EOF'
label: SR CRYPTO
  a:            8.0G               64  4.2BSD   2048 16384 12960
  c:            28.8G                0  unused
  d:            20.8G         16777280  MSDOS
EOF
	mkdir "$T/mnt"
	answers "🔒sd2a (28.9G SanDisk 3.2Gen1) CRYPTO" "sd1j 2.0G 4.2BSD" "$T/mnt"
	with_tty mounter
	notlogged '^(mount|mount_msdos|mount\.exfat|ntfs-3g) '
	notlogged 'doas mount'
}

t_mounter_excludes() {
	# Swap, the partitions of the mounted system, the chunk under it, and
	# a disk with no medium are never offered.
	answers
	with_tty mounter
	m=$(cat "$VT_STATE/menu.1")
	for p in sd0a sd1a sd1b sd1d sd1k sd1c sd2c cd0; do
		hasnt "$p not offered" "$p" "$m"
	done
	# A second softraid volume's chunk that is not in use is offered.
	add_partition sd2 "  a:            28.9G               64    RAID"
	rm -f "$VT_STATE/dmenu.n"
	with_tty mounter
	has "unused chunk offered" "🔒sd2a" "$(cat "$VT_STATE/menu.1")"
}

t_mounter_system_disk_unmounted_partition() {
	add_partition sd1 "  j:             2.0G        900000000  4.2BSD   2048 16384 12960 # /altroot"
	answers
	with_tty mounter
	hasnt "system disk partition not offered" "sd1j" "$(cat "$VT_STATE/menu.1")"
}

t_mounter_nothing() {
	setsysctl hw.disknames "sd0:4f2a19c07d3e8b61,sd1:9c1e5f7a3b2d4c68,cd0:"
	with_tty mounter
	logged '^notify-send 💾 mounter Nothing to mount\.$'
	[ -f "$VT_STATE/dmenu.n" ] && fail "dmenu opened with nothing to offer"
	return 0
}

t_mounter_phone() {
	echo "1: Google Pixel 6" >"$VT_STATE/phones"
	mkdir "$T/phone"
	answers "📱1: Google Pixel 6" "$T/phone"
	with_tty mounter
	has "phone offered first" "📱1: Google Pixel 6" "$(sed -n 1p "$VT_STATE/menu.1")"
	eq "default mount point from the name" /mnt/google-pixel-6 "$(sed -n 1p "$VT_STATE/menu.2")"
	logged "^simple-mtpfs -o allow_other,nosuid,nodev -o fsname=simple-mtpfs-google-pixel-6 --device 1 $T/phone\$"
}

t_mounter_reopens_in_terminal() {
	mounter </dev/null
	logged "^xterm -name floatterm -geometry 64x4 -e $REPO/.local/bin/mounter\$"
	unmounter </dev/null
	logged "^xterm -name floatterm -geometry 64x4 -e $REPO/.local/bin/unmounter\$"
	notlogged '^doas'
}

# unmounter: sd3 is an unlocked softraid volume (listed in volumes).
mounted() { printf '%s\n' "$@" >>"$VT_STATE/mounts"; }

t_unmounter_locks_empty_volume() {
	mount >/dev/null
	mounted "/dev/sd3a on /mnt/secure type ffs (local, nodev, nosuid)"
	printf 'sd1\nsd3\n' >"$VT_STATE/volumes"
	answers "💾/mnt/secure (/dev/sd3a)"
	with_tty unmounter
	eq "offered: not the system disk" "💾/mnt/secure (/dev/sd3a)" "$(cat "$VT_STATE/menu.1")"
	logged '^doas umount /mnt/secure$'
	logged '^doas rmdir /mnt/secure$'
	logged '^notify-send 💾 Drive unmounted\. /mnt/secure: safe to remove\.$'
	logged '^doas bioctl -d sd3$'
	logged '^notify-send 🔒 Drive locked\. sd3 detached\.$'
}

t_unmounter_keeps_volume_in_use() {
	mount >/dev/null
	mounted "/dev/sd3a on /mnt/secure type ffs (local, nodev, nosuid)" \
		"/dev/sd3d on /mnt/data type ffs (local, nodev, nosuid)"
	printf 'sd1\nsd3\n' >"$VT_STATE/volumes"
	answers "💾/mnt/secure (/dev/sd3a)"
	with_tty unmounter
	logged '^doas umount /mnt/secure$'
	notlogged 'bioctl -d'
}

t_unmounter_plain_stick() {
	mount >/dev/null
	mounted "/dev/sd2i on /mnt/usb type msdos (local, nodev, nosuid)"
	printf 'sd1\n' >"$VT_STATE/volumes"
	answers "💾/mnt/usb (/dev/sd2i)"
	with_tty unmounter
	logged '^doas umount /mnt/usb$'
	notlogged 'Drive locked'
}

t_unmounter_busy() {
	mount >/dev/null
	mounted "/dev/sd3a on /mnt/secure type ffs (local, nodev, nosuid)"
	printf 'sd1\nsd3\n' >"$VT_STATE/volumes"
	echo 1 >"$VT_STATE/rc.umount"
	answers "💾/mnt/secure (/dev/sd3a)"
	with_tty unmounter
	logged '^notify-send 💾 Unmount failed\.'
	notlogged 'bioctl -d'
	notlogged 'rmdir'
}

t_unmounter_typed_input() {
	# dmenu returns typed text too; only an offered line is unmounted.
	mount >/dev/null
	mounted "/dev/sd2i on /mnt/usb type msdos (local, nodev, nosuid)"
	answers "💾/home (/dev/sd1k)"
	with_tty unmounter
	notlogged 'umount'
	notlogged 'bioctl'
}

t_unmounter_phone() {
	mount >/dev/null
	# The fuse line's form is assumed: fsname first, as mounter sets it.
	mounted "simple-mtpfs-google-pixel-6 on /mnt/phone type fuse (local, nodev, nosuid)"
	answers "📱/mnt/phone (simple-mtpfs-google-pixel-6)"
	with_tty unmounter
	logged '^doas umount /mnt/phone$'
	notlogged 'bioctl'
}
