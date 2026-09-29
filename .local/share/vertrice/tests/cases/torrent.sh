# The torrent screen: torwrap (Super+F6) and sb-torrent's click open tremc;
# the daemon and the counts stay transmission's. tremc and transmission
# are packages: stand-ins in $T/bin log their calls.

fx_torrent() {
	for c in tremc transmission-daemon transmission-remote; do
		printf '#!/bin/sh\necho "%s $*" >>"$VT_STATE/log"\n' "$c" >"$T/bin/$c"
		chmod +x "$T/bin/$c"
	done
}

t_torrent_torwrap() {
	fx_torrent
	torwrap
	logged '^transmission-daemon $'
	logged '^xterm -e tremc$'
	notlogged 'stig'
}

t_torrent_torwrap_no_tremc() {
	fx_torrent
	"$VT_REAL_RM" "$T/bin/tremc"
	torwrap
	logged '^notify-send 📦 tremc must be installed for this function\.$'
	notlogged '^xterm'
}

t_torrent_sb_click() {
	fx_torrent
	BLOCK_BUTTON=1 sb-torrent >/dev/null
	logged '^detach xterm -e tremc$'
	logged '^transmission-remote -l$'
}
