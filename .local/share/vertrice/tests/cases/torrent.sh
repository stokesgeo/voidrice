# torwrap (Super+F6) and sb-torrent's click open tremc.

t_torrent_tremc() {
	for c in tremc transmission-daemon transmission-remote; do ln -s "$VT_MOCKS/_log" "$T/bin/$c"; done
	torwrap
	logged '^xterm -e tremc$'
	BLOCK_BUTTON=1 sb-torrent >/dev/null
	logged '^detach xterm -e tremc$'
}
