# Synthetic HOME/keyring/store only; native curl parser/bad-CA loopback proof,
# mocked enrollment connections, native parsers/pass/GPG. No provider access.
mutt_wizard_case() {
	[ -x /usr/local/bin/python3 ] || skip 'python3 not installed'
	[ -x /usr/local/bin/mbsync ] || skip 'native isync parser not installed'
	[ -x /usr/local/bin/msmtp ] || skip 'native msmtp parser not installed'
	[ -x /usr/local/bin/neomutt ] || skip 'native neomutt parser not installed'
	[ -x /usr/local/bin/pass ] || skip 'real pass fixture requires password-store'
	[ -x /usr/local/bin/gpg ] || skip 'real pass fixture requires gpg'
	# Drop harness Git/worktree and credential-store variables before fixtures.
	# Individual tests deliberately add selected variables back where relevant.
	(
		unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
		unset PASSWORD_STORE_DIR PASSWORD_STORE_KEY PASSWORD_STORE_SIGNING_KEY
		# Optional private short root avoids native agent socket path limits
		# under the runner's deeply nested TMPDIR, including HOME-filesystem runs.
		TMPDIR="${MW_FIXTURE_TMPDIR:-${TMPDIR:-/tmp}}" PYTHONDONTWRITEBYTECODE=1 \
			/usr/local/bin/python3 "$REPO/.local/share/vertrice/tests/mutt-wizard.py" "$@"
	) >"$T/mw-out" 2>&1 || fail "$(cat "$T/mw-out")"
}
# One real-keyring test per watchdog. No timeout exemptions or shared fixture state.
t_mutt_wizard_build() { mutt_wizard_case Overlay.test_build_and_continuity; }
t_mutt_wizard_curl_parser() { mutt_wizard_case Overlay.test_real_curl_parser; }
t_mutt_wizard_curl_bad_ca() { mutt_wizard_case Overlay.test_real_curl_bad_ca_never_authenticates; }
# Five exact consent variants, each retaining the same cancellation/edit/
# credential-preservation assertions. Full standalone method still runs all.
t_mutt_wizard_endpoint_tls() { MW_ENDPOINT_ANSWER= mutt_wizard_case Overlay.test_endpoint_choices_and_tls_preservation; }
t_mutt_wizard_endpoint_tls_y() { MW_ENDPOINT_ANSWER=y mutt_wizard_case Overlay.test_endpoint_choices_and_tls_preservation; }
t_mutt_wizard_endpoint_tls_Y() { MW_ENDPOINT_ANSWER=Y mutt_wizard_case Overlay.test_endpoint_choices_and_tls_preservation; }
t_mutt_wizard_endpoint_tls_yes() { MW_ENDPOINT_ANSWER=yes mutt_wizard_case Overlay.test_endpoint_choices_and_tls_preservation; }
t_mutt_wizard_endpoint_tls_mixed() { MW_ENDPOINT_ANSWER=YeS mutt_wizard_case Overlay.test_endpoint_choices_and_tls_preservation; }
t_mutt_wizard_endpoint_tty() { mutt_wizard_case Overlay.test_root_endpoint_real_tty; }
t_mutt_wizard_namespace_endpoint_tty() { mutt_wizard_case Overlay.test_namespace_endpoint_real_tty; }
t_mutt_wizard_resume_tty() { mutt_wizard_case Overlay.test_resume_real_tty_enter; }
t_mutt_wizard_native() { mutt_wizard_case Overlay.test_new_A_then_B_native_parsers_foreign_preserved; }
t_mutt_wizard_resume() { mutt_wizard_case Overlay.test_checkpoint_next_invocation_resume; }
t_mutt_wizard_archive() { mutt_wizard_case Overlay.test_committed_archive_gap; }
t_mutt_wizard_retry() { mutt_wizard_case Overlay.test_parser_and_write_retry_immediate; }
t_mutt_wizard_auth_retry() { mutt_wizard_case Overlay.test_invalid_only_staged_and_correct_retry; }
t_mutt_wizard_git() { mutt_wizard_case Overlay.test_inherited_git_variables_cleared; }
t_mutt_wizard_stage() { mutt_wizard_case Overlay.test_stage_outside_git_required; }
t_mutt_wizard_signed_metadata() { mutt_wizard_case Overlay.test_signed_recipient_metadata_and_key_override; }
t_mutt_wizard_marker() { mutt_wizard_case Overlay.test_marker_failure_restores_A_before_resume_B; }
t_mutt_wizard_collision() { mutt_wizard_case Overlay.test_credential_collision; }
t_mutt_wizard_binding_collision() { mutt_wizard_case Overlay.test_binding_collision_more_than_nine; }
t_mutt_wizard_edits() { mutt_wizard_case Overlay.test_external_edit_guard_and_symlink; }
t_mutt_wizard_published_edits() { mutt_wizard_case Overlay.test_published_external_edit_retained; }
t_mutt_wizard_symlink() { mutt_wizard_case Overlay.test_late_symlink; }
t_mutt_wizard_legacy() { mutt_wizard_case Overlay.test_legacy_refused; }
t_mutt_wizard_reuse() { mutt_wizard_case Overlay.test_reuse_never_overwritten; }
t_mutt_wizard_removal() { mutt_wizard_case Overlay.test_removal_refused; }
t_mutt_wizard_selectors() { mutt_wizard_case Overlay.test_multidigit_binding; }
t_mutt_wizard_tenth() { mutt_wizard_case Overlay.test_tenth_account_selector; }
t_mutt_wizard_ctrl_c_insert() { mutt_wizard_case Overlay.test_ctrl_c_insert; }
t_mutt_wizard_ctrl_c_readback() { mutt_wizard_case Overlay.test_ctrl_c_readback; }
t_mutt_wizard_ctrl_c_gap() { mutt_wizard_case Overlay.test_ctrl_c_link_phase_gap; }
t_mutt_wizard_ctrl_c_publish() { mutt_wizard_case Overlay.test_ctrl_c_publication; }
# Longer A/B/C end-to-end sequence remains in standalone qualification.
# Keep runner cases independent under the unchanged per-case watchdog.
t_mutt_wizard_edit_native() { mutt_wizard_case Overlay.test_lifecycle_edit_native_metadata_preserved; }
t_mutt_wizard_generated_alias() { mutt_wizard_case Overlay.test_lifecycle_generated_alias_name_edit; }
t_mutt_wizard_ambiguous_alias() { mutt_wizard_case Overlay.test_lifecycle_ambiguous_self_alias_refused; }
t_mutt_wizard_eof_refusal() { mutt_wizard_case Overlay.test_lifecycle_eof_reader_comment; }
# Three-account invalid-peer and other EOF variants remain in standalone
# qualification, like the longer native A/B/C lifecycle sequence.
t_mutt_wizard_default_retry() { mutt_wizard_case Overlay.test_lifecycle_default_retry; }
t_mutt_wizard_remove_last() { mutt_wizard_case Overlay.test_lifecycle_last_failure_resume; }
t_mutt_wizard_remove_marker() { mutt_wizard_case Overlay.test_lifecycle_remove_marker_failure; }
t_mutt_wizard_remove_checkpoint() { mutt_wizard_case Overlay.test_lifecycle_remove_postcommit_phase_failure; }
t_mutt_wizard_remove_archive() { mutt_wizard_case Overlay.test_lifecycle_remove_postcommit_archive_failure; }
t_mutt_wizard_remove_conflict() { mutt_wizard_case Overlay.test_lifecycle_remove_foreign_account_conflict; }
t_mutt_wizard_remove_symlink() { mutt_wizard_case Overlay.test_lifecycle_remove_symlink_refusal; }
t_mutt_wizard_remove_unsafe() { mutt_wizard_case Overlay.test_lifecycle_remove_unsafe_reader_no_evaluation; }
t_mutt_wizard_remove_smtp() { mutt_wizard_case Overlay.test_lifecycle_smtp_blocked; }
t_mutt_wizard_remove_ctrl_c() { mutt_wizard_case Overlay.test_lifecycle_remove_delete_ctrl_c; }
t_mutt_wizard_edit_ctrl_c() { mutt_wizard_case Overlay.test_lifecycle_edit_account_ctrl_c; }
t_mutt_wizard_writer_lock() { mutt_wizard_case Overlay.test_lifecycle_writer_lock; }
t_mutt_wizard_remove_committed_ctrl_c() { mutt_wizard_case Overlay.test_lifecycle_remove_committed_ctrl_c; }
# Native subtree opt-in; each uses only a disposable two-recipient keyring.
t_mutt_wizard_namespace() { mutt_wizard_case Overlay.test_namespace_native_recipients_and_next_invocation; }
t_mutt_wizard_namespace_signed() { mutt_wizard_case Overlay.test_namespace_signed_and_conflicting_overrides; }
t_mutt_wizard_namespace_native_signed() { mutt_wizard_case Overlay.test_namespace_signed_native_verification_without_key_override; }
t_mutt_wizard_namespace_native_tampered() { mutt_wizard_case Overlay.test_namespace_signed_native_tampered_refusal; }
t_mutt_wizard_namespace_native_wrong_pin() { mutt_wizard_case Overlay.test_namespace_signed_native_wrong_pin_refusal; }
t_mutt_wizard_namespace_paths() { mutt_wizard_case Overlay.test_namespace_unsafe_policy; }
t_mutt_wizard_namespace_changed() { mutt_wizard_case Overlay.test_namespace_policy_change_and_resume_refused; }
t_mutt_wizard_namespace_resume() { mutt_wizard_case Overlay.test_namespace_resume_collision_and_retry; }
t_mutt_wizard_namespace_legacy() { mutt_wizard_case Overlay.test_namespace_legacy_root_recognized_without_reinterpretation; }
t_mutt_wizard_namespace_unknown() { mutt_wizard_case Overlay.test_namespace_unrecognized_legacy_refused; }
t_mutt_wizard_namespace_store() { mutt_wizard_case Overlay.test_namespace_nondefault_active_store; }
t_mutt_wizard_namespace_fallback() { mutt_wizard_case Overlay.test_namespace_without_policy_keeps_root; }
t_mutt_wizard_namespace_absent() { mutt_wizard_case Overlay.test_namespace_absent_store_not_initialized; }
# Longer namespace A/B/C lifecycle is standalone, as for the root A/B/C case.
# Core repair receipts: native inherited argv/env tracing (including the old
# external printf positive control), exact generated high-port verified TLS,
# literal names, staged retry and atomic-lock SIGKILL recovery.
t_mutt_wizard_core_exec() { mutt_wizard_case Overlay.test_core_native_exec_observer; }
t_mutt_wizard_core_tls() { mutt_wizard_case Overlay.test_core_native_tls_exec_coverage; }
t_mutt_wizard_core_literal() { mutt_wizard_case Overlay.test_core_literal_names_and_plus_default; }
t_mutt_wizard_core_retry() { mutt_wizard_case Overlay.test_core_staged_network_retry_does_not_reinsert; }
t_mutt_wizard_core_sigkill() { mutt_wizard_case Overlay.test_core_sigkill_after_atomic_lock_link; }
# Historical 3de91 executable reconstruction, never owner pending/store data.
t_mutt_wizard_old_consent_resume() { skip 'historical executable not shipped; private Git history excluded'; }
t_mutt_wizard_old_password_resume() { skip 'historical executable not shipped; private Git history excluded'; }
t_mutt_wizard_old_saved_resume() { skip 'historical executable not shipped; private Git history excluded'; }
t_mutt_wizard_old_printf_edit() { skip 'historical executable not shipped; private Git history excluded'; }
t_mutt_wizard_profile_native() { mutt_wizard_case Overlay.test_afterrepair_generated_profile_native; }
