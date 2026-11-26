# Source builds and synthetic local accounts only; no sockets/authentication.
mail_runtime_case() {
 command -v python3 >/dev/null 2>&1 || skip 'no python3'
 PYTHONDONTWRITEBYTECODE=1 python3 "$REPO/.local/share/vertrice/tests/mutt-wizard-runtime.py" -v "Runtime.$1" || fail 'mail runtime regression'
}
t_mail_runtime_hashes_continuity_and_parsers() { mail_runtime_case test_hashes_continuity_and_parsers; }
t_mail_runtime_build_refuses_existing_symlink_drift_and_system_paths() { mail_runtime_case test_build_refuses_existing_symlink_drift_and_system_paths; }
t_mail_runtime_all_one_partial_allfailure_and_no_state() { mail_runtime_case test_all_one_partial_allfailure_and_no_state; }
t_mail_runtime_invalid_request_never_runs_child() { mail_runtime_case test_invalid_request_never_runs_child; }
t_mail_runtime_groups_refused_and_operands_deduplicated() { mail_runtime_case test_groups_refused_and_operands_deduplicated; }
t_mail_runtime_open_executable_source_loses_execute_bits() { mail_runtime_case test_open_executable_source_loses_execute_bits; }
t_mail_runtime_open_parent_trust() { mail_runtime_case test_open_parent_trust; }
t_mail_runtime_open_handoff_status_and_wait() { mail_runtime_case test_open_handoff_status_and_wait; }
t_mail_runtime_no_profile_notifications_index_or_message_scan() { mail_runtime_case test_no_profile_notifications_index_or_message_scan; }
t_mail_runtime_native_channel_parser_local_only() { mail_runtime_case test_native_channel_parser_local_only; }
t_mail_runtime_open_whitespace_unicode_dash_collision_retention() { mail_runtime_case test_open_whitespace_unicode_dash_collision_retention; }
t_mail_runtime_open_refuses_bad_cache_and_copy_failure() { mail_runtime_case test_open_refuses_bad_cache_and_copy_failure; }

t_mail_runtime_launchers() {
	mkdir -p "$XDG_DATA_HOME/openbsd/mail/mutt-wizard"
	cp -R "$REPO/.local/share/openbsd/mail/mutt-wizard/runtime" "$XDG_DATA_HOME/openbsd/mail/mutt-wizard/"
	cat >"$T/bin/mbsync" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >"$VT_STATE/sync-args"
EOF
	cat >"$T/bin/xdg-open" <<'EOF'
#!/bin/sh
printf '%s\n' "$1" >"$VT_STATE/opened"
EOF
	chmod +x "$T/bin/mbsync" "$T/bin/xdg-open"
	printf 'Channel fixture\n' >"$HOME/.mbsyncrc"
	MBSYNCRC="$HOME/.mbsyncrc" "$REPO/.local/bin/openbsd/vertrice-mail-sync" fixture || fail 'sync launcher'
	eq 'literal sync argv' "-c
$HOME/.mbsyncrc
fixture" "$(cat "$VT_STATE/sync-args")"
	printf 'local attachment\n' >"$T/a file.pdf"
	"$REPO/.local/bin/openbsd/vertrice-mail-openfile" "$T/a file.pdf" || fail 'attachment launcher'
	copy=$(cat "$VT_STATE/opened")
	cmp "$T/a file.pdf" "$copy" || fail 'retained attachment differs'
	eq 'private copy mode' 600 "$(stat -f %Lp "$copy")"
	grep -Fq 'text/html; vertrice-mail-openfile %s' "$REPO/.config/mutt/mailcap" || fail 'mailcap launcher mismatch'
}

t_mail_runtime_native_passcmd_failure_never_authenticates() { mail_runtime_case test_native_passcmd_failure_never_authenticates; }
