# Aggregate CPU utilization: six OpenBSD states, with idle LAST. No sleeps;
# each invocation represents the next bar redraw. Existing block tests also
# cover temperature-only output and missing sensors/sysctl nodes.

cpu_sample() { setsysctl kern.cp_time "$1"; }
cpu_base() {
	setsysctl hw.cpuspeed 2300
	cpu_sample 100,10,20,30,40,800
	eq "first sample preserves original output" "🌡 52°C 2.3GHz" "$(sb-cpu)"
}

t_sb_cpu_interval() {
	cpu_base
	# 10 ticks in EACH busy state, 50 idle: 50% across all CPUs,
	# not a sum of per-core percentages and not treating intr as idle.
	cpu_sample 110,20,30,40,50,850
	eq "six-state aggregate" "🌡 52°C 2.3GHz CPU 50%" "$(sb-cpu)"
	cpu_sample 110,20,30,40,50,950
	eq "all idle" "🌡 52°C 2.3GHz CPU 0%" "$(sb-cpu)"
	cpu_sample 210,20,30,40,50,950
	eq "all busy" "🌡 52°C 2.3GHz CPU 100%" "$(sb-cpu)"
	cpu_sample 211,20,30,40,50,952
	eq "rounded third" "🌡 52°C 2.3GHz CPU 33%" "$(sb-cpu)"
	eq "zero delta has no percentage" "🌡 52°C 2.3GHz" "$(sb-cpu)"
}

t_sb_cpu_reset() {
	cpu_base
	# Only one state decreases; total still grows. Reject the entire delta.
	cpu_sample 99,20,30,40,50,900
	eq "counter reset" "🌡 52°C 2.3GHz" "$(sb-cpu)"
	cpu_sample 109,20,30,40,50,910
	eq "new baseline after reset" "🌡 52°C 2.3GHz CPU 50%" "$(sb-cpu)"
}

t_sb_cpu_malformed() {
	for bad in '1,2,3,4,5' '1,2,3,4,5,6,7' '1,2,no,4,5,6' \
	    '1,2,-3,4,5,6' '1,2,3.5,4,5,6' '1,2,,4,5,6' \
	    '1,2,3,4,5,9007199254740992' '<missing>' ''; do
		cpu_base
		cpu_sample "$bad"
		eq "invalid current sample: $bad" "🌡 52°C 2.3GHz" "$(sb-cpu)"
		cpu_sample 110,20,30,40,50,850
		eq "invalid sample cleared baseline" "🌡 52°C 2.3GHz" "$(sb-cpu)"
		rm -f "$XDG_CACHE_HOME/sb-cpu/ticks"
	done
}

t_sb_cpu_multiline_sysctl() {
	cpu_base
	# setsysctl is a line-based fixture; override only this node to test
	# actual multiline command output instead of truncating the fixture.
	printf '%s\n' '#!/bin/sh' \
	    'if [ "$2" = kern.cp_time ]; then' \
	    '  printf "%s\n" 100,10,20,30,40,800 100,10,20,30,40,800' \
	    'else exec "$VT_MOCKS/sysctl" "$@"; fi' >"$T/bin/sysctl"
	chmod +x "$T/bin/sysctl"
	eq "multiline sysctl rejected" "🌡 52°C 2.3GHz" "$(sb-cpu)"
	rm "$T/bin/sysctl"
	cpu_sample 110,20,30,40,50,850
	eq "multiline data cleared baseline" "🌡 52°C 2.3GHz" "$(sb-cpu)"
}

t_sb_cpu_cache_corruption() {
	cpu_base
	for bad in garbage '1,2,3,4,5' '1,2,3,4,5,6,7' \
	    "100,10,20,30,40,800
100,10,20,30,40,800"; do
		printf '%s\n' "$bad" >"$XDG_CACHE_HOME/sb-cpu/ticks"
		eq "bad cache ignored" "🌡 52°C 2.3GHz" "$(sb-cpu)"
		eq "cache repaired" 100,10,20,30,40,800 "$(cat "$XDG_CACHE_HOME/sb-cpu/ticks")"
	done
	# Octal-looking input is decimal ticks, never shell arithmetic/code.
	printf '%s\n' 0090,0010,0020,0030,0040,0790 >"$XDG_CACHE_HOME/sb-cpu/ticks"
	eq "leading zero counters" "🌡 52°C 2.3GHz CPU 50%" "$(sb-cpu)"
}

t_sb_cpu_cache_failures() {
	setsysctl hw.cpuspeed 2300
	cpu_sample 100,10,20,30,40,800
	mkdir -p "$T/blocked"
	chmod 500 "$T/blocked"
	eq "unwritable cache root" "🌡 52°C 2.3GHz" "$(XDG_CACHE_HOME="$T/blocked" sb-cpu)"
	chmod 700 "$T/blocked"
	printf 'do not overwrite\n' >"$T/sentinel"
	mkdir -p "$XDG_CACHE_HOME/sb-cpu"
	ln -s "$T/sentinel" "$XDG_CACHE_HOME/sb-cpu/ticks"
	eq "symlink cache refused" "🌡 52°C 2.3GHz" "$(sb-cpu)"
	eq "symlink target untouched" 'do not overwrite' "$(cat "$T/sentinel")"
	rm "$XDG_CACHE_HOME/sb-cpu/ticks"
	mkfifo "$XDG_CACHE_HOME/sb-cpu/ticks"
	eq "FIFO is not read (must not block)" "🌡 52°C 2.3GHz" "$(sb-cpu)"
	rm "$XDG_CACHE_HOME/sb-cpu/ticks"
	rmdir "$XDG_CACHE_HOME/sb-cpu"
	ln -s "$T/blocked" "$XDG_CACHE_HOME/sb-cpu"
	eq "symlink cache directory refused" "🌡 52°C 2.3GHz" "$(sb-cpu)"
	rm "$XDG_CACHE_HOME/sb-cpu"
	printf 'not a directory\n' >"$XDG_CACHE_HOME/sb-cpu"
	eq "cache directory blocked" "🌡 52°C 2.3GHz" "$(sb-cpu)"
}

t_sb_cpu_cache_home_fallback() {
	setsysctl hw.cpuspeed 1250
	cpu_sample 100,10,20,30,40,800
	eq "HOME cache and frequency rounding" "🌡 52°C 1.3GHz" "$(unset XDG_CACHE_HOME; sb-cpu)"
	[ -f "$HOME/.cache/sb-cpu/ticks" ] || fail "no HOME cache"
	cpu_sample 110,20,30,40,50,850
	eq "HOME cache reused" "🌡 52°C 1.3GHz CPU 50%" "$(unset XDG_CACHE_HOME; sb-cpu)"
}

t_sb_cpu_usage_without_sensors() {
	cpu_base
	setsysctl hw.sensors.cpu0.temp0 '<missing>'
	setsysctl hw.sensors.acpitz0.temp0 '<missing>'
	setsysctl hw.cpuspeed '<missing>'
	cpu_sample 110,20,30,40,50,850
	eq "utilization alone" "🌡 CPU 50%" "$(sb-cpu)"
}
