# vertrice-install system, as a plan (no -y): what it would change under
# ROOT. pf_setup (install.sh) gives uid 0 and ROOT.

sys_setup() {
	pf_setup
	mkdir -p "$ROOT/etc"
	echo "wheel:*:0:root,me" >"$ROOT/etc/group"
	echo "me:*:1000:1000:staff:0:0:Me:/home/me:/bin/ksh" >"$ROOT/etc/master.passwd"
	: >"$ROOT/etc/login.conf"
	printf '#!/bin/sh\nexit 0\n' >"$T/bin/pkg_info"
	ln -s "$VT_MOCKS/_log" "$T/bin/rcctl"
	chmod +x "$T/bin/pkg_info"
	export VERTRICE_USER=me
}

t_system_touchpad_off() {
	sys_setup
	out=$(vertrice-install system)
	has "plan" "would   add mouse.tp.disable=1 to /etc/wsconsctl.conf" "$out"
	echo mouse.tp.disable=1 >"$ROOT/etc/wsconsctl.conf"
	has "done already" "ok      mouse.tp.disable=1 in /etc/wsconsctl.conf" "$(vertrice-install system)"
}
