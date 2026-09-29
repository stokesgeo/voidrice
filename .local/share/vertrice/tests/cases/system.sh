# The fragments vertrice-install appends to /etc: the owner's touchpad and
# webcam rulings. That they land in /etc is install_system.

t_system_touchpad_off() {
	f=$REPO/.local/share/openbsd/wsconsctl.conf
	grep -qx 'mouse.tp.disable=1' "$f" || fail "no mouse.tp.disable=1"
	grep -qx 'keyboard.map+="keysym Caps_Lock = Escape"' "$f" || fail "no Caps Lock line"
}

t_system_webcam() {
	grep -qx 'kern.video.record=1' "$REPO/.local/share/openbsd/sysctl.conf" || fail "no kern.video.record=1"
	# fbtab(5): login device, mode, devices; one more ttyC0 line is read too.
	eq "fbtab line" '/dev/ttyC0	0600	/dev/video0' "$(grep -v '^#' "$REPO/.local/share/openbsd/fbtab")"
}
