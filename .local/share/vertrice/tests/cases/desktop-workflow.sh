
t_desktop_workflow_offline() {
	[ "$VT_HOST" = OpenBSD ] || skip 'native OpenBSD desktop fixtures'
	export PATH=/usr/local/bin:/usr/X11R6/bin:/usr/bin:/bin
	for tool in python3 ffmpeg mediainfo mimetype pdftoppm ffmpegthumbnailer file; do
		command -v "$tool" >/dev/null 2>&1 || skip "desktop fixtures need $tool"
	done
	DISPLAY= WAYLAND_DISPLAY= DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent \
		python3 "$REPO/.local/share/vertrice/tests/desktop-workflow-20261112.py" \
		--source "$REPO" --pilot "$T/desktop-workflow" --label native-suite ||
		fail 'offline desktop workflow regression'
}
